-- Epsilon OS migration 008: client platform foundation (docs/designs/client-platform.md, OV5 step 1).
-- Additive and idempotent. Requires schema.sql and 002-007 applied first, and Supabase's auth schema.
-- No drops, no column rewrites, no change to existing rows.
--
-- Tables      organizations, staff, memberships, invites, projects, tickets, ticket_events, jobs
-- Functions   is_staff(), is_staff_for(org), is_member(org)          (security definer, used by RLS)
--             create_ticket(...), add_ticket_comment(...)              (the only client write paths)
-- RLS         one pattern on every org table: is_member(org_id) or is_staff_for(org_id), select only.
--             ticket_events also needs client_visible for members. invites and jobs are staff-only.
--             Existing Epsilon OS tables get a select-only staff policy; the worker keeps service_role.
-- Grants      anon gets nothing on the new tables or functions. authenticated gets select only
--             (projects.repo_path excluded: it is a worker-only local path, EN2).
--
-- Staff (F11, OV3): is_staff() is a 'full' scope staff row AND aal2. A 'test' scope staff row (the CI user)
-- counts only for is_test orgs, through is_staff_for(org_id), and never for jobs or the Epsilon OS tables.

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- organizations -------------------------------------------------------------
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  slug        citext not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  domain      citext,
  company_id  uuid references companies(id) on delete set null,
  status      text not null default 'active' check (status in ('active','archived')),
  is_test     boolean not null default false,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists organizations_company_idx on organizations (company_id) where company_id is not null;
create index if not exists organizations_test_idx on organizations (created_at) where is_test;

-- staff (founder, plus the low-privilege CI user with scope 'test') ------------
create table if not exists staff (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       citext not null unique,
  scope       text not null default 'full' check (scope in ('full','test')),
  created_at  timestamptz not null default now()
);

-- memberships -----------------------------------------------------------------
create table if not exists memberships (
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner','member')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists memberships_user_idx on memberships (user_id);

-- invites (7-day expiry, revocable; only the sha256 of the token is stored) ------
create table if not exists invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       citext not null,
  role        text not null default 'member' check (role in ('owner','member')),
  token_hash  text not null unique,
  invited_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists invites_org_idx on invites (org_id, created_at desc);

-- projects --------------------------------------------------------------------
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 200),
  status      text not null default 'active' check (status in ('active','paused','done','archived')),
  summary     text,
  repo_path   text,                                   -- local path on the Mac (EN2); worker-only
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, org_id)                                 -- target of the (project_id, org_id) foreign key
);
create index if not exists projects_org_idx on projects (org_id);
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'projects_updated') then
    create trigger projects_updated before update on projects for each row execute function set_updated_at();
  end if;
end $$;

-- tickets (number from a sequence, shown as EL-<n>) --------------------------------
create sequence if not exists ticket_number_seq as bigint start with 1;

create table if not exists tickets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  project_id  uuid not null,
  number      bigint not null unique default nextval('ticket_number_seq'),
  ref         text generated always as ('EL-' || number::text) stored,
  author_id   uuid references auth.users(id) on delete set null,
  title       text not null check (length(btrim(title)) between 1 and 200),
  body        text not null default '' check (length(body) <= 20000),
  type        text not null check (type in ('bug','change','question','new')),
  priority    text not null default 'normal' check (priority in ('low','normal','urgent')),
  status      text not null default 'new' check (status in
                ('new','triaged','briefed','planned','approved','in_progress','review','done','declined')),
  mode        text check (mode in ('agent','manual')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, org_id),
  -- a ticket can never point at another org's project
  foreign key (project_id, org_id) references projects(id, org_id) on delete cascade
);
alter sequence ticket_number_seq owned by tickets.number;
create index if not exists tickets_org_status_idx on tickets (org_id, status, updated_at desc);
create index if not exists tickets_project_idx on tickets (project_id, created_at desc);
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tickets_updated') then
    create trigger tickets_updated before update on tickets for each row execute function set_updated_at();
  end if;
end $$;

-- ticket_events (clients only ever see client_visible rows) ---------------------------
create table if not exists ticket_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  ticket_id       uuid not null,
  kind            text not null check (kind in ('status','comment','commit','brief','plan','diff','preview')),
  body            text check (body is null or length(body) <= 20000),
  data            jsonb,
  client_visible  boolean not null default false,
  actor           uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (ticket_id, org_id) references tickets(id, org_id) on delete cascade
);
create index if not exists ticket_events_ticket_idx on ticket_events (ticket_id, created_at);
create index if not exists ticket_events_org_idx on ticket_events (org_id);

-- jobs: the Mac worker's command queue (reliability baseline, F12) ------------------------
--   queued --claim (lease)--> claimed --> running --> done | failed ; expires_at passed / lease lapsed --> expired
create table if not exists jobs (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('ticket_brief','ticket_plan','ticket_execute','weekly_update',
                  'proposal_draft','invoice_draft','report_draft','referral_draft','run_agent')),
  params        jsonb not null default '{}'::jsonb,
  status        text not null default 'queued' check (status in ('queued','claimed','running','done','failed','expired')),
  lease_until   timestamptz,
  expires_at    timestamptz,
  attempts      smallint not null default 0 check (attempts between 0 and 10),
  result        jsonb,
  error         text,
  log_tail      text,
  requested_by  uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
create index if not exists jobs_status_idx on jobs (status, created_at);
create index if not exists jobs_lease_idx on jobs (lease_until) where status in ('claimed','running');

-- Helper functions (security definer so RLS policies can call them without recursion) -----------
create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.staff s where s.user_id = auth.uid() and s.scope = 'full')
$$;

create or replace function is_staff_for(p_org_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1 from public.staff s
        where s.user_id = auth.uid()
          and (s.scope = 'full'
               or (s.scope = 'test' and exists (select 1 from public.organizations o where o.id = p_org_id and o.is_test)))
     )
$$;

create or replace function is_member(p_org_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m where m.org_id = p_org_id and m.user_id = auth.uid())
$$;

-- Client write RPCs: author and org always come from auth.uid() and the database, never the caller --------
create or replace function create_ticket(p_project_id uuid, p_title text, p_body text, p_type text, p_priority text)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_org_ok boolean;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := coalesce(p_body, '');
  v_priority text := coalesce(nullif(btrim(p_priority), ''), 'normal');
  v_row tickets;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select p.org_id, (o.status = 'active' and not o.is_demo and p.status <> 'archived')
    into v_org, v_org_ok
    from projects p join organizations o on o.id = p.org_id
   where p.id = p_project_id;
  -- one message for "missing" and "not yours", so other orgs' project ids cannot be probed
  if v_org is null or not (is_member(v_org) or is_staff_for(v_org)) then
    raise exception 'project not found' using errcode = '42501';
  end if;
  if not v_org_ok then
    raise exception 'project is not accepting requests' using errcode = '22023';
  end if;
  if length(v_title) not between 1 and 200 then
    raise exception 'title must be 1-200 characters' using errcode = '22023';
  end if;
  if length(v_body) > 20000 then
    raise exception 'body is too long' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('bug','change','question','new') then
    raise exception 'invalid type' using errcode = '22023';
  end if;
  if v_priority not in ('low','normal','urgent') then
    raise exception 'invalid priority' using errcode = '22023';
  end if;
  insert into tickets (org_id, project_id, author_id, title, body, type, priority)
  values (v_org, p_project_id, v_uid, v_title, v_body, p_type, v_priority)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'number', v_row.number, 'ref', v_row.ref);
end $$;

create or replace function add_ticket_comment(p_ticket_id uuid, p_body text)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_member boolean;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select t.org_id into v_org
    from tickets t join organizations o on o.id = t.org_id
   where t.id = p_ticket_id;
  v_member := v_org is not null and is_member(v_org);
  if v_org is null or not (v_member or is_staff_for(v_org)) then
    raise exception 'ticket not found' using errcode = '42501';
  end if;
  if exists (select 1 from organizations o where o.id = v_org and (o.is_demo or o.status <> 'active')) then
    raise exception 'ticket is read-only' using errcode = '22023';
  end if;
  if length(v_body) not between 1 and 10000 then
    raise exception 'comment must be 1-10000 characters' using errcode = '22023';
  end if;
  -- A client's own words are visible to their org. A staff comment is an internal note until it is
  -- published through the approval rulebook (F13), so it starts hidden.
  insert into ticket_events (org_id, ticket_id, kind, body, client_visible, actor)
  values (v_org, p_ticket_id, 'comment', v_body, v_member, v_uid)
  returning id into v_id;
  update tickets set updated_at = now() where id = p_ticket_id;
  return v_id;
end $$;

-- RLS on every new table --------------------------------------------------------------------------
alter table organizations enable row level security;
alter table staff         enable row level security;
alter table memberships   enable row level security;
alter table invites       enable row level security;
alter table projects      enable row level security;
alter table tickets       enable row level security;
alter table ticket_events enable row level security;
alter table jobs          enable row level security;

do $$
declare
  p record;
begin
  for p in
    select * from (values
      ('organizations', 'org_read',      'is_member(id) or is_staff_for(id)'),
      ('staff',         'staff_read',    'user_id = (select auth.uid()) or (select is_staff())'),
      ('memberships',   'org_read',      'is_member(org_id) or is_staff_for(org_id)'),
      ('invites',       'staff_read',    'is_staff_for(org_id)'),
      ('projects',      'org_read',      'is_member(org_id) or is_staff_for(org_id)'),
      ('tickets',       'org_read',      'is_member(org_id) or is_staff_for(org_id)'),
      ('ticket_events', 'org_read',      '(client_visible and is_member(org_id)) or is_staff_for(org_id)'),
      ('jobs',          'staff_read',    '(select is_staff())')
    ) as v(tbl, name, expr)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on %I for select to authenticated using (%s)', p.name, p.tbl, p.expr);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = 'service_role_all') then
      execute format('create policy service_role_all on %I for all to service_role using (true) with check (true)', p.tbl);
    end if;
  end loop;
end $$;

-- Grants: anon nothing; authenticated select only; writes only through the RPCs above ----------------
revoke all on organizations, staff, memberships, invites, projects, tickets, ticket_events, jobs from public, anon, authenticated;
grant select on organizations, staff, memberships, invites, tickets, ticket_events, jobs to authenticated;
grant select (id, org_id, name, status, summary, created_at, updated_at) on projects to authenticated;
grant all on organizations, staff, memberships, invites, projects, tickets, ticket_events, jobs to service_role;
revoke all on sequence ticket_number_seq from public, anon, authenticated;
grant usage, select on sequence ticket_number_seq to service_role;

revoke all on function is_staff(), is_staff_for(uuid), is_member(uuid) from public, anon;
grant execute on function is_staff(), is_staff_for(uuid), is_member(uuid) to authenticated, service_role;
revoke all on function create_ticket(uuid, text, text, text, text), add_ticket_comment(uuid, text) from public, anon;
grant execute on function create_ticket(uuid, text, text, text, text), add_ticket_comment(uuid, text) to authenticated;

-- Existing Epsilon OS tables: staff (full scope, aal2) may read. Writes stay with the worker's service_role. ----
do $$
declare t text;
begin
  foreach t in array array['companies','contacts','deals','touches','suppression_list','agent_heartbeats',
                           'approval_queue','actions','dossiers','settings','opportunities']
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'staff_read') then
      execute format('create policy staff_read on %I for select to authenticated using ((select is_staff()))', t);
    end if;
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

commit;
