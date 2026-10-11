-- Epsilon OS migration 010: /start intake and client portal v1 (docs/designs/client-platform.md Phases 1 and 2,
-- OV5 steps 3 and 4). Additive and idempotent. Requires 008 and 009. No drops, no column rewrites, no change to
-- existing rows.
--
-- Tables      intake, intake_rate, files, notifications; projects gains progress / next_milestone / next_milestone_on
-- Storage     private bucket 'client-files' (25 MB, MIME allow-list). Paths <org_id>/<ticket_or_project>/<uuid>-<name>.
--             Uploaders write only a path they registered with begin_upload(); members of the org and staff read
--             ready files. Downloads are short-lived signed URLs with Content-Disposition: attachment (the app).
-- Anon RPC    submit_intake(ip_hash, payload)   the ONLY function anon may execute here (F11). Validates the payload,
--             applies the per-IP limit (5 per hour, keyed by sha256(ip + daily salt) computed by the site function;
--             the raw IP never reaches the database) and a global cap, then creates/links companies, contacts and a
--             deals lead (source_channel 'inbound') and writes an actions row.
-- Staff RPCs  set_intake_status, create_org, save_project, set_ticket_status, staff_ticket_reply, publish_ticket_event
--             (staff = is_staff_for(org) with aal2, or the worker's service role; set_intake_status / create_org need
--             full-scope staff)
-- Org RPCs    create_invite, revoke_invite, remove_member (staff, or an owner of the org: owners invite members only),
--             org_team, people, begin_upload, finish_upload, mark_notifications_read
-- Server RPCs peek_invite, accept_invite        (service role only: the invite link is a bearer credential and
--                                                accepting it needs the Auth admin API on the server)
-- Notify      notifications rows on ticket status change, staff reply, invoice issued (trigger) and new file.
--             Email digests are a later step; nothing here sends mail.

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- intake ----------------------------------------------------------------------------------------------------------
create table if not exists intake (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 1 and 200),
  email         citext not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(email) <= 254),
  company       text check (company is null or length(company) <= 200),
  kind          text not null check (kind in ('software','hardware','both')),
  budget        text check (budget is null or length(budget) <= 80),
  message       text not null default '' check (length(message) <= 10000),
  source        text not null default 'epsilon-labs.co/start' check (length(source) between 1 and 200),
  answers       jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  status        text not null default 'new' check (status in ('new','contacted','converted','spam')),
  company_id    uuid references companies(id) on delete set null,
  contact_id    uuid references contacts(id) on delete set null,
  deal_id       uuid references deals(id) on delete set null,
  deal_created  boolean not null default false,       -- this intake opened the deal (spam closes it again)
  contacted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists intake_status_idx on intake (status, created_at desc);
create index if not exists intake_email_idx on intake (email, created_at desc);
create index if not exists intake_created_idx on intake (created_at);
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'intake_updated') then
    create trigger intake_updated before update on intake for each row execute function set_updated_at();
  end if;
end $$;

-- Per-IP counter, one row per (hashed client, hour). The hash rotates daily (salted by the site function), so a row
-- cannot be tied back to an address; rows older than a day are deleted on every submit.
create table if not exists intake_rate (
  ip_hash       text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_start  timestamptz not null,
  hits          integer not null default 0 check (hits >= 0),
  primary key (ip_hash, window_start)
);

-- projects: what the client home shows on each project card ----------------------------------------------------
alter table projects add column if not exists progress smallint check (progress is null or progress between 0 and 100);
alter table projects add column if not exists next_milestone text check (next_milestone is null or length(next_milestone) <= 120);
alter table projects add column if not exists next_milestone_on date;

-- files ----------------------------------------------------------------------------------------------------------
create table if not exists files (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  project_id   uuid,
  ticket_id    uuid,
  path         text not null unique
                 check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$'),
  name         text not null check (length(btrim(name)) between 1 and 255),
  mime         text not null check (mime in ('application/pdf','image/png','image/jpeg','image/webp','text/plain',
                                             'text/csv','application/zip','model/step','model/stl')),
  size         bigint not null check (size between 1 and 26214400),
  status       text not null default 'pending' check (status in ('pending','ready')),
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  ready_at     timestamptz,
  check (project_id is not null or ticket_id is not null),
  -- a file can never point at another org's project or ticket
  foreign key (project_id, org_id) references projects(id, org_id) on delete cascade,
  foreign key (ticket_id, org_id) references tickets(id, org_id) on delete cascade
);
create index if not exists files_org_idx on files (org_id, created_at desc);
create index if not exists files_ticket_idx on files (ticket_id, created_at) where ticket_id is not null;
create index if not exists files_pending_idx on files (uploaded_by, created_at) where status = 'pending';

-- notifications (the outbox the digest reads later; the bell reads it now) ----------------------------------------
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('ticket_status','reply','invoice','file')),
  title       text not null check (length(title) between 1 and 200),
  link        text check (link is null or (link ~ '^/[A-Za-z0-9/_.?=&-]*$' and length(link) <= 300)),
  urgent      boolean not null default false,
  emailed_at  timestamptz,
  read_at     timestamptz,
  digest_key  text check (digest_key is null or length(digest_key) <= 100),
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on notifications (user_id) where read_at is null;
create index if not exists notifications_org_idx on notifications (org_id);

-- Internal helpers (no grants) -------------------------------------------------------------------------------------
-- Staff for this org (aal2; test scope only for is_test orgs) or the worker's service role (OV1).
create or replace function platform_is_operator_for(p_org_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_staff_for(p_org_id) or coalesce(auth.role(), '') = 'service_role'
$$;

create or replace function platform_is_owner(p_org_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m where m.org_id = p_org_id and m.user_id = auth.uid() and m.role = 'owner')
$$;

-- The client-facing name of a ticket status (the client sees status only, Phase 5).
create or replace function ticket_status_label(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p
    when 'new' then 'Received' when 'triaged' then 'Triaged' when 'briefed' then 'Triaged'
    when 'planned' then 'Planned' when 'approved' then 'Planned' when 'in_progress' then 'In progress'
    when 'review' then 'Needs your review' when 'done' then 'Done' when 'declined' then 'Declined'
    else p end
$$;

-- Allowed uploads: the extension decides the MIME type (Reliability baseline). null = not allowed.
create or replace function upload_mime_for(p_ext text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case lower(coalesce(p_ext, ''))
    when 'pdf' then 'application/pdf' when 'png' then 'image/png' when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg' when 'webp' then 'image/webp' when 'txt' then 'text/plain'
    when 'csv' then 'text/csv' when 'zip' then 'application/zip' when 'step' then 'model/step'
    when 'stp' then 'model/step' when 'stl' then 'model/stl'
    else null end
$$;

-- One notification row per member of the org (except one user, usually the actor).
create or replace function notify_org(p_org_id uuid, p_kind text, p_title text, p_link text, p_urgent boolean,
                                      p_except uuid, p_digest text) returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  insert into notifications (org_id, user_id, kind, title, link, urgent, digest_key)
  select p_org_id, m.user_id, p_kind, left(p_title, 200), p_link, coalesce(p_urgent, false), left(p_digest, 100)
    from memberships m
   where m.org_id = p_org_id and m.user_id is distinct from p_except;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Invoice issued (a number was assigned): tell the org. Covers every path that issues, including the deal room.
create or replace function invoices_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.number is not null and new.status in ('sent','overdue','paid')
     and (tg_op = 'INSERT' or old.number is null) then
    perform notify_org(new.org_id, 'invoice',
                       case when new.kind = 'credit_note' then 'Credit note ' else 'Invoice ' end || new.number || ' issued',
                       '/invoices/' || new.id::text, true, null, 'invoice:' || new.id::text);
  end if;
  return null;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'invoices_notify') then
    create trigger invoices_notify after insert or update on invoices for each row execute function invoices_notify();
  end if;
end $$;

-- /start intake (anon) ---------------------------------------------------------------------------------------------
create or replace function submit_intake(p_ip_hash text, p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_name     text := btrim(coalesce(p_payload->>'name', ''));
  v_email    text := lower(btrim(coalesce(p_payload->>'email', '')));
  v_company  text := nullif(btrim(coalesce(p_payload->>'company', '')), '');
  v_kind     text := btrim(coalesce(p_payload->>'kind', ''));
  v_budget   text := nullif(btrim(coalesce(p_payload->>'budget', '')), '');
  v_message  text := btrim(coalesce(p_payload->>'message', ''));
  v_source   text := coalesce(nullif(btrim(coalesce(p_payload->>'source', '')), ''), 'epsilon-labs.co/start');
  v_answers  jsonb := coalesce(p_payload->'answers', '{}'::jsonb);
  v_window   timestamptz := date_trunc('hour', now());
  a          record;
  v_hits     integer;
  v_dup      uuid;
  v_domain   text;
  v_free     boolean;
  v_company_id uuid;
  v_contact_id uuid;
  v_deal_id  uuid;
  v_deal_new boolean := false;
  v_wedge    wedge;
  v_title    text;
  v_id       uuid;
  v_ack      boolean;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid client key' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 32768 then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  -- the honeypot: a bot filled the hidden field. Looks accepted, stores nothing.
  if length(btrim(coalesce(p_payload->>'website', ''))) > 0 then
    return jsonb_build_object('state', 'ok', 'id', null, 'ack', false, 'notify', false);
  end if;
  if coalesce((select value from settings where key = 'intake.enabled'), 'true'::jsonb) = 'false'::jsonb then
    return jsonb_build_object('state', 'disabled');
  end if;

  -- validation (the site function checks the same; this is the rule for every caller of the public key)
  if length(v_name) not between 1 and 200 then
    raise exception 'name must be 1-200 characters' using errcode = '22023';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'a valid email is required' using errcode = '22023';
  end if;
  if length(coalesce(v_company, '')) > 200 then
    raise exception 'company must be at most 200 characters' using errcode = '22023';
  end if;
  if v_kind not in ('software','hardware','both') then
    raise exception 'kind must be software, hardware or both' using errcode = '22023';
  end if;
  if length(coalesce(v_budget, '')) > 80 then
    raise exception 'budget must be at most 80 characters' using errcode = '22023';
  end if;
  if length(v_message) > 10000 then
    raise exception 'message must be at most 10000 characters' using errcode = '22023';
  end if;
  if length(v_source) > 200 then
    raise exception 'source must be at most 200 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(v_answers) <> 'object' then
    raise exception 'answers must be an object' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(v_answers)) > 20 then
    raise exception 'answers must have at most 20 fields' using errcode = '22023';
  end if;
  for a in select key, value from jsonb_each(v_answers) loop
    if a.key !~ '^[a-z_]{1,40}$' or jsonb_typeof(a.value) <> 'string' or length(a.value #>> '{}') > 500 then
      raise exception 'invalid answer %', left(a.key, 40) using errcode = '22023';
    end if;
  end loop;

  -- per client: 5 per hour. Counted only for valid submissions; a refusal is a state, not an error, so it commits.
  insert into intake_rate (ip_hash, window_start, hits) values (p_ip_hash, v_window, 1)
  on conflict (ip_hash, window_start) do update set hits = intake_rate.hits + 1
  returning hits into v_hits;
  delete from intake_rate where window_start < now() - interval '1 day';
  if v_hits > 5 then
    return jsonb_build_object('state', 'rate_limited', 'retry_at', v_window + interval '1 hour');
  end if;
  -- everyone: the public key is public, so a direct caller can vary the hash; this bounds what it can create
  if (select count(*) from intake where created_at > now() - interval '1 hour') >= 60 then
    perform deal_room_audit('intake_busy', 'intake', null, null);
    return jsonb_build_object('state', 'rate_limited', 'retry_at', now() + interval '1 hour');
  end if;

  -- a double submit returns the first row
  select id into v_dup from intake
   where email = v_email::citext and message = v_message and created_at > now() - interval '10 minutes'
   order by created_at limit 1;
  if v_dup is not null then
    return jsonb_build_object('state', 'ok', 'id', v_dup, 'ack', false, 'notify', false, 'duplicate', true);
  end if;

  -- contact, company (by the contact, then the email domain unless it is a personal mailbox), open deal
  v_domain := split_part(v_email, '@', 2);
  v_free := v_domain in ('gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','hotmail.com','hotmail.co.uk','outlook.com',
                         'live.com','msn.com','icloud.com','me.com','aol.com','proton.me','protonmail.com','gmx.com',
                         'gmx.de','yandex.com','mail.com','zoho.com');
  select id, company_id into v_contact_id, v_company_id from contacts where email = v_email::citext;
  if v_company_id is null and not v_free then
    select id into v_company_id from companies where domain = v_domain::citext;
  end if;
  if v_company_id is null then
    insert into companies (name, domain, notes)
    values (left(coalesce(v_company, v_name), 200), case when v_free then null else v_domain end, 'Inbound via ' || v_source)
    on conflict (domain) do nothing
    returning id into v_company_id;
    if v_company_id is null then
      select id into v_company_id from companies where domain = v_domain::citext;
    end if;
  end if;
  if v_contact_id is null then
    insert into contacts (company_id, full_name, email, legal_basis)
    values (v_company_id, v_name, v_email, 'inbound')
    on conflict (email) do nothing
    returning id into v_contact_id;
    if v_contact_id is null then
      select id into v_contact_id from contacts where email = v_email::citext;
    end if;
  else
    update contacts set company_id = coalesce(company_id, v_company_id), full_name = coalesce(full_name, v_name)
     where id = v_contact_id;
  end if;

  select id into v_deal_id from deals
   where company_id = v_company_id and stage in ('lead','conversation','scoping_call','quote_out')
   order by created_at desc limit 1;
  if v_deal_id is null then
    v_wedge := case v_answers->>'offer'
      when '/products/efuelpro/' then 'fuel_retail'::wedge
      when '/products/epsilon1/' then 'industrial_monitoring'::wedge
      when '/hardware/retrofits/' then 'industrial_monitoring'::wedge
      when '/services/protocol-decode/' then 'protocol_decode'::wedge
      when '/services/remote-decode/' then 'protocol_decode'::wedge
      else null end;
    v_title := left(coalesce(nullif(v_answers->>'offer_name', ''), nullif(v_answers->>'need', ''), 'Website enquiry'), 160)
               || ' (' || v_kind || ')';
    insert into deals (company_id, primary_contact_id, title, stage, wedge, source_channel)
    values (v_company_id, v_contact_id, v_title, 'lead', v_wedge, 'inbound')
    returning id into v_deal_id;
    v_deal_new := true;
  end if;

  insert into intake (name, email, company, kind, budget, message, source, answers, company_id, contact_id, deal_id, deal_created)
  values (v_name, v_email, v_company, v_kind, v_budget, v_message, v_source, v_answers, v_company_id, v_contact_id,
          v_deal_id, v_deal_new)
  returning id into v_id;

  -- the fixed-template acknowledgement (F13): once a day per address, never to a suppressed one
  v_ack := not is_suppressed(v_email)
           and not exists (select 1 from intake where email = v_email::citext and id <> v_id
                             and created_at > now() - interval '24 hours');

  perform deal_room_audit('intake_received', 'intake', v_id::text,
                          jsonb_build_object('deal_id', v_deal_id, 'deal_created', v_deal_new, 'company_id', v_company_id,
                                             'contact_id', v_contact_id, 'kind', v_kind, 'source', v_source));
  return jsonb_build_object('state', 'ok', 'id', v_id, 'ack', v_ack, 'notify', true);
end $$;

-- Staff: intake status. Spam closes the lead this intake opened (if nobody moved it on).
create or replace function set_intake_status(p_id uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  i intake;
begin
  if not deal_room_is_operator() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('new','contacted','converted','spam') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select * into i from intake where id = p_id for update;
  if i.id is null then
    raise exception 'intake not found' using errcode = '22023';
  end if;
  if i.status = p_status then
    return;
  end if;
  update intake set status = p_status,
                    contacted_at = case when p_status = 'contacted' then coalesce(contacted_at, now()) else contacted_at end
   where id = p_id;
  if p_status = 'spam' and i.deal_created and i.deal_id is not null then
    update deals set stage = 'lost', lost_reason = coalesce(lost_reason, 'spam (intake)'), closed_at = coalesce(closed_at, now())
     where id = i.deal_id and stage = 'lead';
  end if;
  perform deal_room_audit('intake_' || p_status, 'intake', p_id::text, jsonb_build_object('from', i.status));
end $$;

-- Staff: organisations and projects ----------------------------------------------------------------------------------
create or replace function create_org(p_name text, p_slug text, p_domain text, p_company_id uuid) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_domain text := nullif(lower(btrim(coalesce(p_domain, ''))), '');
begin
  if not deal_room_is_operator() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 200 then
    raise exception 'name must be 1-200 characters' using errcode = '22023';
  end if;
  if coalesce(p_slug, '') !~ '^[a-z0-9][a-z0-9-]{0,62}$' then
    raise exception 'slug: lowercase letters, digits and dashes' using errcode = '22023';
  end if;
  if exists (select 1 from organizations where slug = p_slug::citext) then
    raise exception 'that slug is taken' using errcode = '23505';
  end if;
  if v_domain is not null and v_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'invalid domain' using errcode = '22023';
  end if;
  if p_company_id is not null and not exists (select 1 from companies where id = p_company_id) then
    raise exception 'company not found' using errcode = '22023';
  end if;
  insert into organizations (name, slug, domain, company_id) values (btrim(p_name), p_slug, v_domain, p_company_id)
  returning id into v_id;
  perform deal_room_audit('org_created', 'organizations', v_id::text, jsonb_build_object('slug', p_slug, 'company_id', p_company_id));
  return v_id;
end $$;

-- Creates (p_id null) or updates a project. repo_path is staff/worker-only data (EN2).
create or replace function save_project(p_id uuid, p_org_id uuid, p_name text, p_status text, p_summary text,
                                        p_repo_path text, p_progress integer, p_next_milestone text,
                                        p_next_milestone_on date) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := p_org_id;
  v_id uuid := p_id;
begin
  if p_id is not null then
    select org_id into v_org from projects where id = p_id;
  end if;
  if v_org is null or not platform_is_operator_for(v_org) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_id is not null and p_org_id is not null and p_org_id <> v_org then
    raise exception 'a project cannot move between organisations' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 200 then
    raise exception 'name must be 1-200 characters' using errcode = '22023';
  end if;
  if coalesce(p_status, '') not in ('active','paused','done','archived') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_progress is not null and p_progress not between 0 and 100 then
    raise exception 'progress must be 0-100' using errcode = '22023';
  end if;
  if length(coalesce(p_summary, '')) > 2000 or length(coalesce(p_repo_path, '')) > 500
     or length(coalesce(p_next_milestone, '')) > 120 then
    raise exception 'a field is too long' using errcode = '22023';
  end if;
  if p_id is null then
    insert into projects (org_id, name, status, summary, repo_path, progress, next_milestone, next_milestone_on)
    values (v_org, btrim(p_name), p_status, nullif(btrim(coalesce(p_summary, '')), ''), nullif(btrim(coalesce(p_repo_path, '')), ''),
            p_progress, nullif(btrim(coalesce(p_next_milestone, '')), ''), p_next_milestone_on)
    returning id into v_id;
    perform deal_room_audit('project_created', 'projects', v_id::text, jsonb_build_object('org_id', v_org));
  else
    update projects set name = btrim(p_name), status = p_status, summary = nullif(btrim(coalesce(p_summary, '')), ''),
                        repo_path = nullif(btrim(coalesce(p_repo_path, '')), ''), progress = p_progress,
                        next_milestone = nullif(btrim(coalesce(p_next_milestone, '')), ''), next_milestone_on = p_next_milestone_on
     where id = p_id;
    perform deal_room_audit('project_updated', 'projects', p_id::text, jsonb_build_object('org_id', v_org, 'status', p_status));
  end if;
  return v_id;
end $$;

-- Invites (7 days, revocable; only sha256(token) is stored) ---------------------------------------------------------
create or replace function create_invite(p_org_id uuid, p_email text, p_role text, p_token_hash text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_staff boolean := platform_is_operator_for(p_org_id);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := coalesce(nullif(btrim(p_role), ''), 'member');
  o organizations;
  v_id uuid;
  v_expires timestamptz;
begin
  if not (v_staff or platform_is_owner(p_org_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_role not in ('owner','member') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if not v_staff and v_role <> 'member' then
    raise exception 'owners can invite members only' using errcode = '42501';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'a valid email is required' using errcode = '22023';
  end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023';
  end if;
  select * into o from organizations where id = p_org_id;
  if o.id is null then
    raise exception 'organisation not found' using errcode = '22023';
  end if;
  if o.status <> 'active' or o.is_demo then
    raise exception 'this organisation is read-only' using errcode = '22023';
  end if;
  if exists (select 1 from memberships m join auth.users u on u.id = m.user_id
              where m.org_id = p_org_id and lower(u.email::text) = v_email) then
    raise exception 'already a member' using errcode = '22023';
  end if;
  if not v_staff and (select count(*) from invites where org_id = p_org_id and invited_by = auth.uid()
                        and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many invites today' using errcode = '22023';
  end if;
  -- a new invite replaces any pending one for the same address
  update invites set revoked_at = now()
   where org_id = p_org_id and email = v_email::citext and accepted_at is null and revoked_at is null;
  insert into invites (org_id, email, role, token_hash, invited_by)
  values (p_org_id, v_email, v_role, p_token_hash, auth.uid())
  returning id, expires_at into v_id, v_expires;
  perform deal_room_audit('invite_created', 'invites', v_id::text,
                          jsonb_build_object('org_id', p_org_id, 'role', v_role, 'by_staff', v_staff));
  return jsonb_build_object('id', v_id, 'org_name', o.name, 'role', v_role, 'expires_at', v_expires);
end $$;

create or replace function revoke_invite(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v invites;
begin
  select * into v from invites where id = p_id for update;
  if v.id is null or not (platform_is_operator_for(v.org_id) or platform_is_owner(v.org_id)) then
    raise exception 'invite not found' using errcode = '42501';
  end if;
  if v.accepted_at is not null then
    raise exception 'this invite was accepted; remove the member instead' using errcode = '55000';
  end if;
  if v.revoked_at is not null then
    return;
  end if;
  update invites set revoked_at = now() where id = p_id;
  perform deal_room_audit('invite_revoked', 'invites', p_id::text, jsonb_build_object('org_id', v.org_id));
end $$;

create or replace function remove_member(p_org_id uuid, p_user_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_role text;
begin
  if not (platform_is_operator_for(p_org_id) or platform_is_owner(p_org_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select role into v_role from memberships where org_id = p_org_id and user_id = p_user_id for update;
  if v_role is null then
    return;
  end if;
  if v_role = 'owner' and (select count(*) from memberships where org_id = p_org_id and role = 'owner') <= 1 then
    raise exception 'an organisation keeps at least one owner' using errcode = '55000';
  end if;
  delete from memberships where org_id = p_org_id and user_id = p_user_id;
  perform deal_room_audit('member_removed', 'memberships', p_user_id::text, jsonb_build_object('org_id', p_org_id));
end $$;

-- Server only: what an invite link holder may learn, before they accept.
create or replace function peek_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v invites;
  v_org text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    return jsonb_build_object('state', 'not_found');
  end if;
  select * into v from invites where token_hash = deal_room_sha256(p_token);
  if v.id is null then
    return jsonb_build_object('state', 'not_found');
  end if;
  select name into v_org from organizations where id = v.org_id;
  return jsonb_build_object(
    'state', case when v.revoked_at is not null then 'revoked' when v.accepted_at is not null then 'used'
                  when v.expires_at <= now() then 'expired' else 'open' end,
    'org_name', v_org, 'role', v.role, 'email', v.email::text, 'email_masked', deal_room_mask_email(v.email));
end $$;

-- Server only, after the server has made sure a login exists for the invite's email (Auth admin API).
create or replace function accept_invite(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  v invites;
  v_user uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    return jsonb_build_object('state', 'not_found');
  end if;
  select * into v from invites where token_hash = deal_room_sha256(p_token) for update;
  if v.id is null then
    return jsonb_build_object('state', 'not_found');
  end if;
  if v.revoked_at is not null then
    return jsonb_build_object('state', 'revoked');
  end if;
  if v.accepted_at is not null then
    return jsonb_build_object('state', 'used');
  end if;
  if v.expires_at <= now() then
    return jsonb_build_object('state', 'expired');
  end if;
  select id into v_user from auth.users where lower(email) = lower(v.email::text) limit 1;
  if v_user is null then
    return jsonb_build_object('state', 'no_user');
  end if;
  insert into memberships (org_id, user_id, role, invited_by) values (v.org_id, v_user, v.role, v.invited_by)
  on conflict (org_id, user_id) do nothing;
  update invites set accepted_at = now() where id = v.id;
  perform deal_room_audit('invite_accepted', 'invites', v.id::text, jsonb_build_object('org_id', v.org_id));
  return jsonb_build_object('state', 'accepted', 'org_id', v.org_id, 'email', v.email::text);
end $$;

-- Team list for members; pending invites too for owners and staff.
create or replace function org_team(p_org_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_manage boolean := platform_is_operator_for(p_org_id) or platform_is_owner(p_org_id);
begin
  if not (is_member(p_org_id) or platform_is_operator_for(p_org_id)) then
    raise exception 'organisation not found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_manage', v_manage,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id, 'email', u.email::text, 'role', m.role, 'joined_at', m.created_at,
               'name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''),
               'is_me', m.user_id = auth.uid())
             order by m.role, m.created_at)
        from memberships m join auth.users u on u.id = m.user_id
       where m.org_id = p_org_id), '[]'::jsonb),
    'invites', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'email', i.email::text, 'role', i.role, 'created_at', i.created_at, 'expires_at', i.expires_at,
               'state', case when i.revoked_at is not null then 'revoked' when i.accepted_at is not null then 'accepted'
                             when i.expires_at <= now() then 'expired' else 'pending' end)
             order by i.created_at desc)
        from (select * from invites where org_id = p_org_id order by created_at desc limit 50) i), '[]'::jsonb)
      else '[]'::jsonb end);
end $$;

-- Display names for authors in tickets and timelines: only people the caller shares an org with, and staff.
create or replace function people(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id,
           'name', coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'name', ''),
                            split_part(u.email::text, '@', 1)),
           'staff', exists (select 1 from public.staff s where s.user_id = u.id))), '[]'::jsonb)
    from auth.users u
   where u.id = any ((coalesce(p_ids, '{}'::uuid[]))[1:200])
     and auth.uid() is not null
     and (exists (select 1 from public.staff s where s.user_id = u.id)
          or exists (select 1 from public.memberships m
                      where m.user_id = u.id and (is_member(m.org_id) or is_staff_for(m.org_id))))
$$;

-- Tickets (staff) ----------------------------------------------------------------------------------------------------
create or replace function set_ticket_status(p_ticket_id uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t tickets;
begin
  select * into t from tickets where id = p_ticket_id for update;
  if t.id is null or not platform_is_operator_for(t.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('new','triaged','briefed','planned','approved','in_progress','review','done','declined') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if t.status = p_status then
    return;
  end if;
  update tickets set status = p_status where id = p_ticket_id;
  -- a status change is a fixed-template message (F13): visible to the client straight away
  insert into ticket_events (org_id, ticket_id, kind, data, client_visible, actor)
  values (t.org_id, t.id, 'status', jsonb_build_object('from', t.status, 'to', p_status), true, auth.uid());
  perform notify_org(t.org_id, 'ticket_status', t.ref || ' · ' || ticket_status_label(p_status) || ': ' || t.title,
                     '/tickets/' || t.id::text, p_status = 'review', null, 'ticket:' || t.id::text);
  perform deal_room_audit('ticket_status', 'tickets', t.id::text, jsonb_build_object('from', t.status, 'to', p_status));
end $$;

-- A founder reply goes to the client when he sends it (F13); an internal note stays hidden.
create or replace function staff_ticket_reply(p_ticket_id uuid, p_body text, p_to_client boolean) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t tickets;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  select * into t from tickets where id = p_ticket_id for update;
  if t.id is null or not platform_is_operator_for(t.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if length(v_body) not between 1 and 10000 then
    raise exception 'reply must be 1-10000 characters' using errcode = '22023';
  end if;
  insert into ticket_events (org_id, ticket_id, kind, body, client_visible, actor)
  values (t.org_id, t.id, 'comment', v_body, coalesce(p_to_client, false), auth.uid())
  returning id into v_id;
  update tickets set updated_at = now() where id = t.id;
  if coalesce(p_to_client, false) then
    perform notify_org(t.org_id, 'reply', 'Reply on ' || t.ref || ': ' || t.title, '/tickets/' || t.id::text, false, null,
                       'ticket:' || t.id::text);
    perform deal_room_audit('ticket_reply_sent', 'ticket_events', v_id::text, jsonb_build_object('ticket_id', t.id));
  else
    perform deal_room_audit('ticket_note', 'ticket_events', v_id::text, jsonb_build_object('ticket_id', t.id));
  end if;
  return v_id;
end $$;

-- Sends an internal staff comment (e.g. a draft written earlier) to the client. One way only.
create or replace function publish_ticket_event(p_event_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  e ticket_events;
  t tickets;
begin
  select * into e from ticket_events where id = p_event_id for update;
  if e.id is null or not platform_is_operator_for(e.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if e.kind <> 'comment' or e.actor is null or not exists (select 1 from staff s where s.user_id = e.actor) then
    raise exception 'only a staff comment can be sent to the client' using errcode = '55000';
  end if;
  if e.client_visible then
    return;
  end if;
  update ticket_events set client_visible = true where id = e.id;
  select * into t from tickets where id = e.ticket_id;
  update tickets set updated_at = now() where id = t.id;
  perform notify_org(t.org_id, 'reply', 'Reply on ' || t.ref || ': ' || t.title, '/tickets/' || t.id::text, false, null,
                     'ticket:' || t.id::text);
  perform deal_room_audit('ticket_reply_sent', 'ticket_events', e.id::text, jsonb_build_object('ticket_id', t.id));
end $$;

-- Uploads: register, upload to Storage (the policy below only admits a registered path), confirm -------------------------
create or replace function begin_upload(p_project_id uuid, p_ticket_id uuid, p_name text, p_mime text, p_size bigint)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_project uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_ext text;
  v_base text;
  v_safe text;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_ticket_id is not null then
    select t.org_id, t.project_id into v_org, v_project from tickets t where t.id = p_ticket_id;
    if p_project_id is not null and p_project_id is distinct from v_project then
      v_org := null;
    end if;
  elsif p_project_id is not null then
    select p.org_id, p.id into v_org, v_project from projects p where p.id = p_project_id;
  end if;
  -- one message for "missing" and "not yours", so other orgs' ids cannot be probed
  if v_org is null or not (is_member(v_org) or is_staff_for(v_org)) then
    raise exception 'not found' using errcode = '42501';
  end if;
  if exists (select 1 from organizations o where o.id = v_org and (o.is_demo or o.status <> 'active')) then
    raise exception 'this organisation is read-only' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 255 then
    raise exception 'file name must be 1-255 characters' using errcode = '22023';
  end if;
  v_ext := lower(substring(v_name from '\.([A-Za-z0-9]{1,10})$'));
  if upload_mime_for(v_ext) is null then
    raise exception 'file type not allowed' using errcode = '22023';
  end if;
  if p_mime is distinct from upload_mime_for(v_ext) then
    raise exception 'file type does not match its extension' using errcode = '22023';
  end if;
  if p_size is null or p_size < 1 or p_size > 26214400 then
    raise exception 'files must be under 25 MB' using errcode = '22023';
  end if;
  if (select count(*) from files where uploaded_by = v_uid and status = 'pending' and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many unfinished uploads; try again later' using errcode = '22023';
  end if;
  v_base := regexp_replace(left(v_name, length(v_name) - length(v_ext) - 1), '[^A-Za-z0-9._-]+', '-', 'g');
  v_base := btrim(left(v_base, 110 - length(v_ext)), '.-');
  v_safe := coalesce(nullif(v_base, ''), 'file') || '.' || v_ext;
  v_path := v_org::text || '/' || coalesce(p_ticket_id, v_project)::text || '/' || v_id::text || '-' || v_safe;
  insert into files (id, org_id, project_id, ticket_id, path, name, mime, size, uploaded_by)
  values (v_id, v_org, v_project, p_ticket_id, v_path, v_name, p_mime, p_size, v_uid);
  return jsonb_build_object('id', v_id, 'path', v_path, 'bucket', 'client-files');
end $$;

create or replace function finish_upload(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  f files;
  v_meta jsonb;
  v_found boolean;
  v_size bigint;
  t tickets;
begin
  select * into f from files where id = p_id for update;
  if f.id is null or auth.uid() is null or f.uploaded_by is distinct from auth.uid() then
    raise exception 'file not found' using errcode = '42501';
  end if;
  if f.status = 'ready' then
    return jsonb_build_object('id', f.id, 'status', 'ready');
  end if;
  select true, o.metadata into v_found, v_meta from storage.objects o where o.bucket_id = 'client-files' and o.name = f.path;
  if v_found is null then
    raise exception 'upload not found' using errcode = '22023';
  end if;
  v_size := nullif(v_meta->>'size', '')::bigint;
  if v_size is not null and v_size > 26214400 then
    raise exception 'files must be under 25 MB' using errcode = '22023';
  end if;
  update files set status = 'ready', ready_at = now(), size = coalesce(nullif(v_size, 0), size) where id = f.id;
  if f.ticket_id is not null then
    select * into t from tickets where id = f.ticket_id;
    update tickets set updated_at = now() where id = t.id;
  end if;
  perform notify_org(f.org_id, 'file',
                     'New file: ' || left(f.name, 120) || case when t.id is not null then ' on ' || t.ref else '' end,
                     case when t.id is not null then '/tickets/' || t.id::text else '/' end, false, auth.uid(),
                     'file:' || f.id::text);
  perform deal_room_audit('file_uploaded', 'files', f.id::text,
                          jsonb_build_object('org_id', f.org_id, 'ticket_id', f.ticket_id, 'size', coalesce(v_size, f.size)));
  return jsonb_build_object('id', f.id, 'status', 'ready');
end $$;

create or replace function mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- RLS -----------------------------------------------------------------------------------------------------------
alter table intake        enable row level security;
alter table intake_rate   enable row level security;
alter table files         enable row level security;
alter table notifications enable row level security;

do $$
declare
  p record;
  t text;
begin
  for p in
    select * from (values
      ('intake',        'staff_read', '(select is_staff())'),
      ('files',         'org_read',   '(status = ''ready'' and is_member(org_id)) or is_staff_for(org_id)'
                                      ' or (uploaded_by = (select auth.uid()) and is_member(org_id))'),
      ('notifications', 'own_read',   'user_id = (select auth.uid()) and (org_id is null or is_member(org_id))')
    ) as v(tbl, name, expr)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on %I for select to authenticated using (%s)', p.name, p.tbl, p.expr);
    end if;
  end loop;
  -- intake_rate has no authenticated policy at all: only submit_intake (definer) and the service role touch it
  foreach t in array array['intake','intake_rate','files','notifications'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'service_role_all') then
      execute format('create policy service_role_all on %I for all to service_role using (true) with check (true)', t);
    end if;
  end loop;
end $$;

-- Grants: anon nothing on the tables; authenticated select only (RLS decides rows); writes only through RPCs ----------
revoke all on intake, intake_rate, files, notifications from public, anon, authenticated;
grant select on intake, files, notifications to authenticated;
grant all on intake, intake_rate, files, notifications to service_role;
grant select (progress, next_milestone, next_milestone_on) on projects to authenticated;

revoke all on function
  platform_is_operator_for(uuid), platform_is_owner(uuid), ticket_status_label(text), upload_mime_for(text),
  notify_org(uuid, text, text, text, boolean, uuid, text), invoices_notify(),
  submit_intake(text, jsonb), set_intake_status(uuid, text), create_org(text, text, text, uuid),
  save_project(uuid, uuid, text, text, text, text, integer, text, date),
  create_invite(uuid, text, text, text), revoke_invite(uuid), remove_member(uuid, uuid),
  peek_invite(text), accept_invite(text), org_team(uuid), people(uuid[]),
  set_ticket_status(uuid, text), staff_ticket_reply(uuid, text, boolean), publish_ticket_event(uuid),
  begin_upload(uuid, uuid, text, text, bigint), finish_upload(uuid), mark_notifications_read(uuid[])
from public, anon, authenticated;

grant execute on function submit_intake(text, jsonb) to anon, service_role;
grant execute on function
  set_intake_status(uuid, text), create_org(text, text, text, uuid),
  save_project(uuid, uuid, text, text, text, text, integer, text, date),
  create_invite(uuid, text, text, text), revoke_invite(uuid), remove_member(uuid, uuid),
  org_team(uuid), people(uuid[]),
  set_ticket_status(uuid, text), staff_ticket_reply(uuid, text, boolean), publish_ticket_event(uuid),
  begin_upload(uuid, uuid, text, text, bigint), finish_upload(uuid), mark_notifications_read(uuid[])
to authenticated, service_role;
grant execute on function peek_invite(text), accept_invite(text) to service_role;

-- Storage: private 'client-files' bucket -------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('client-files', 'client-files', false)
    on conflict (id) do nothing;
    -- Supabase enforces these on upload; the stub schema in the offline tests may not have the columns
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets'
                 and column_name = 'file_size_limit') then
      execute $u$update storage.buckets set public = false, file_size_limit = 26214400,
        allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/csv',
                                   'application/zip','model/step','model/stl']
        where id = 'client-files'$u$;
    end if;
    -- upload: only to a path the caller registered with begin_upload() and has not finished
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                     and policyname = 'client_files_insert') then
      create policy client_files_insert on storage.objects for insert to authenticated with check (
        bucket_id = 'client-files' and exists (
          select 1 from public.files f
           where f.path = objects.name and f.status = 'pending' and f.uploaded_by = (select auth.uid())));
    end if;
    -- read: members of the file's org (ready files) and staff; the uploader sees their own pending upload
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                     and policyname = 'client_files_read') then
      create policy client_files_read on storage.objects for select to authenticated using (
        bucket_id = 'client-files' and exists (
          select 1 from public.files f
           where f.path = objects.name
             and ((f.status = 'ready' and public.is_member(f.org_id)) or public.is_staff_for(f.org_id)
                  or (f.uploaded_by = (select auth.uid()) and public.is_member(f.org_id)))));
    end if;
  end if;
end $$;

commit;
