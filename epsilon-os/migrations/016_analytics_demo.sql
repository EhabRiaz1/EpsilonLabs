-- Epsilon OS migration 016: site analytics and the demo portal (docs/designs/client-platform.md Phase 6, Phase 7 / E3,
-- F16). Additive and idempotent. Requires 008-013. No table or column drops and no change to existing rows. One CHECK
-- is replaced by a strictly wider one (invoices.number also accepts DEMO-NNNN, which only a demo org may use), and
-- 012's updates_guard / reports_guard are re-created with their bodies unchanged plus one early exit for reset_demo().
--
-- Analytics   site_events: one row per page view, link click, /start wizard step and /start submit. No IP address, no
--             user agent, no cookie: session_id is random per browser tab (sessionStorage), country comes from Vercel's
--             x-vercel-ip-country header only, device is a coarse class (mobile / tablet / desktop) the site function
--             derives from the user agent and then drops.
-- Anon RPC    record_events(p_batch)   THE ONLY function anon may execute here. p_batch = {client, events[1..20]}:
--             client is sha256(ip + daily salt) computed by /api/events (the raw IP never reaches the database) and is
--             used only for a per-client limit (300 events per hour, counter rows deleted after a day). A global cap
--             stores at most 20,000 events per UTC day. Kill switch: settings analytics.enabled = false.
-- Staff RPCs  analytics_top_pages, analytics_sources, analytics_funnel, analytics_daily, analytics_live,
--             analytics_breakdown   (is_staff(): full scope + aal2). Days are Asia/Karachi days.
-- Retention   prune_site_events() deletes events older than 180 days (F16) and stale counters. pg_cron is available on
--             the free plan but NOT enabled on the project (checked 2026-10-13), so the Mac scheduler's daily 03:00 PKT
--             prune calls it; if pg_cron is enabled later, re-running this file also schedules it there.
-- Demo (E3)   organizations.is_demo org "Northwind Industrial (demo)", seeded by reset_demo() with fictional, clearly
--             labelled data: 2 projects, 4 tickets with their threads, a published update, a published report, a paid
--             invoice DEMO-0001 and two bell notifications. demo_prepare() (service role, the /demo server action)
--             seeds it if missing and gives the demo login (demo_user_email()) a member seat.
-- Read-only   demo_guard triggers refuse every insert / update / delete on a demo org's rows made with a user's
--             (anon / authenticated) JWT, whichever RPC makes it: staff included. Only reset_demo() (a transaction-local
--             flag) and the worker's service role write there. The same holds for the demo login's own profile.
--             Write RPCs that already refused the demo org: create_ticket, add_ticket_comment, create_invite,
--             begin_upload, create_invoice_draft, submit_testimonial. The trigger also covers the ones that did not:
--             revoke_invite, remove_member, finish_upload, mark_notifications_read, save_project, set_ticket_status,
--             staff_ticket_reply, publish_ticket_event, save_my_prefs and every 012 staff RPC.
-- Nightly     reset_demo() runs from the same daily scheduler slot (or pg_cron, when enabled).

begin;

create extension if not exists pgcrypto;

-- ===================================================================================================== site_events
create table if not exists site_events (
  id             bigint generated always as identity primary key,
  session_id     text not null check (session_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  path           text not null check (length(path) <= 300 and path ~ '^/[^[:space:]?#]*$'),
  kind           text not null check (kind in ('view','click','start_step','start_submit')),
  target         text check (target is null or (length(target) between 1 and 300 and target !~ '[[:cntrl:]]')),
  referrer_host  text check (referrer_host is null or referrer_host ~ '^[a-z0-9.-]{1,253}$'),
  utm            jsonb check (utm is null or (jsonb_typeof(utm) = 'object' and length(utm::text) <= 600)),
  country        text check (country is null or country ~ '^[A-Z]{2}$'),
  device         text check (device is null or device in ('mobile','tablet','desktop')),
  created_at     timestamptz not null default now()
);
create index if not exists site_events_created_idx on site_events (created_at);
create index if not exists site_events_kind_idx on site_events (kind, created_at);

-- Global daily cap (UTC day) and the per-client hourly counter. Neither holds anything that identifies a visitor.
create table if not exists site_events_daily (
  day     date primary key,
  stored  integer not null default 0 check (stored >= 0)
);
create table if not exists site_events_rate (
  client        text not null check (client ~ '^[0-9a-f]{64}$'),
  window_start  timestamptz not null,
  hits          integer not null default 0 check (hits >= 0),
  primary key (client, window_start)
);
create index if not exists site_events_rate_window_idx on site_events_rate (window_start);

-- ===================================================================================================== record_events (anon)
create or replace function record_events(p_batch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_client  text := p_batch ->> 'client';
  v_events  jsonb := p_batch -> 'events';
  v_n       integer;
  e         jsonb;
  u         record;
  v_hits    integer;
  v_day     date := (now() at time zone 'UTC')::date;
  v_new_day date;
  v_done    integer;
  v_take    integer;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'object' or length(p_batch::text) > 32768
     or p_batch - 'client' - 'events' <> '{}'::jsonb then
    raise exception 'invalid batch' using errcode = '22023';
  end if;
  if v_client is null or v_client !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid client key' using errcode = '22023';
  end if;
  if v_events is null or jsonb_typeof(v_events) <> 'array' or jsonb_array_length(v_events) not between 1 and 20 then
    raise exception 'a batch holds 1-20 events' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(v_events);

  -- every event is checked before anything is stored: one bad event refuses the batch
  for e in select value from jsonb_array_elements(v_events) loop
    if jsonb_typeof(e) <> 'object' or e - array['s','p','k','t','r','u','c','d'] <> '{}'::jsonb then
      raise exception 'invalid event' using errcode = '22023';
    end if;
    if coalesce(e ->> 's', '') !~ '^[A-Za-z0-9_-]{8,64}$' then
      raise exception 'invalid session' using errcode = '22023';
    end if;
    if coalesce(e ->> 'p', '') !~ '^/[^[:space:]?#]*$' or length(e ->> 'p') > 300 then
      raise exception 'invalid path' using errcode = '22023';
    end if;
    if coalesce(e ->> 'k', '') not in ('view','click','start_step','start_submit') then
      raise exception 'invalid kind' using errcode = '22023';
    end if;
    if e ? 't' and jsonb_typeof(e -> 't') <> 'null' and (jsonb_typeof(e -> 't') <> 'string'
       or length(e ->> 't') not between 1 and 300 or (e ->> 't') ~ '[[:cntrl:]]') then
      raise exception 'invalid target' using errcode = '22023';
    end if;
    if e ? 'r' and jsonb_typeof(e -> 'r') <> 'null' and coalesce(e ->> 'r', '') !~ '^[a-z0-9.-]{1,253}$' then
      raise exception 'invalid referrer' using errcode = '22023';
    end if;
    if e ? 'c' and jsonb_typeof(e -> 'c') <> 'null' and coalesce(e ->> 'c', '') !~ '^[A-Z]{2}$' then
      raise exception 'invalid country' using errcode = '22023';
    end if;
    if e ? 'd' and jsonb_typeof(e -> 'd') <> 'null' and coalesce(e ->> 'd', '') not in ('mobile','tablet','desktop') then
      raise exception 'invalid device' using errcode = '22023';
    end if;
    if e ? 'u' and jsonb_typeof(e -> 'u') <> 'null' then
      if jsonb_typeof(e -> 'u') <> 'object' or (e -> 'u') - array['source','medium','campaign','term','content'] <> '{}'::jsonb then
        raise exception 'invalid utm' using errcode = '22023';
      end if;
      for u in select key, value from jsonb_each(e -> 'u') loop
        if jsonb_typeof(u.value) <> 'string' or length(u.value #>> '{}') not between 1 and 100
           or (u.value #>> '{}') ~ '[[:cntrl:]]' then
          raise exception 'invalid utm %', u.key using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  if coalesce((select value from settings where key = 'analytics.enabled'), 'true'::jsonb) = 'false'::jsonb then
    return jsonb_build_object('state', 'disabled', 'stored', 0);
  end if;

  -- per client: 300 events an hour. A refusal is a state, not an error, so the counter commits.
  insert into site_events_rate (client, window_start, hits) values (v_client, date_trunc('hour', now()), v_n)
  on conflict (client, window_start) do update set hits = site_events_rate.hits + excluded.hits
  returning hits into v_hits;
  if v_hits > 300 then
    return jsonb_build_object('state', 'rate_limited', 'stored', 0);
  end if;

  -- everyone: 20,000 stored events per UTC day (the public key is public; this bounds what a direct caller can add)
  insert into site_events_daily (day, stored) values (v_day, 0) on conflict (day) do nothing returning day into v_new_day;
  if v_new_day is not null then
    delete from site_events_rate where window_start < now() - interval '1 day';
  end if;
  select stored into v_done from site_events_daily where day = v_day for update;
  v_take := least(v_n, 20000 - v_done);
  if v_take <= 0 then
    return jsonb_build_object('state', 'capped', 'stored', 0);
  end if;

  insert into site_events (session_id, path, kind, target, referrer_host, utm, country, device)
  select x.value ->> 's', x.value ->> 'p', x.value ->> 'k', nullif(x.value ->> 't', ''), x.value ->> 'r',
         case when jsonb_typeof(x.value -> 'u') = 'object' and x.value -> 'u' <> '{}'::jsonb then x.value -> 'u' end,
         x.value ->> 'c', x.value ->> 'd'
    from jsonb_array_elements(v_events) with ordinality x(value, ord)
   where x.ord <= v_take;
  update site_events_daily set stored = stored + v_take where day = v_day;
  return jsonb_build_object('state', case when v_take < v_n then 'capped' else 'ok' end, 'stored', v_take);
end $$;

-- ===================================================================================================== retention
create or replace function prune_site_events() returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_events integer;
begin
  -- the worker's service role, staff, or pg_cron (no JWT at all)
  if auth.role() is not null and auth.role() <> 'service_role' and not is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from site_events where created_at < now() - interval '180 days';
  get diagnostics v_events = row_count;
  delete from site_events_rate where window_start < now() - interval '1 day';
  delete from site_events_daily where day < current_date - 400;
  return jsonb_build_object('deleted', v_events);
end $$;

-- ===================================================================================================== staff aggregates
-- Start of the window: Asia/Karachi midnight (p_days - 1) days ago, so "7 days" is today plus the six before it.
create or replace function analytics_since(p_days integer) returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select (date_trunc('day', now() at time zone 'Asia/Karachi') - make_interval(days => greatest(1, least(coalesce(p_days, 30), 180)) - 1))
         at time zone 'Asia/Karachi'
$$;

create or replace function analytics_require_staff() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
end $$;

create or replace function analytics_top_pages(p_days integer default 30, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform analytics_require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object('path', path, 'views', views, 'sessions', sessions) order by views desc, path)
      from (select path, count(*) as views, count(distinct session_id) as sessions
              from site_events
             where kind = 'view' and created_at >= analytics_since(p_days)
             group by path
             order by count(*) desc, path
             limit greatest(1, least(coalesce(p_limit, 20), 1000))) t), '[]'::jsonb);
end $$;

-- Where sessions came from, by each session's first page view.
create or replace function analytics_sources(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_since timestamptz := analytics_since(p_days);
begin
  perform analytics_require_staff();
  return (
    with firsts as (
      select distinct on (session_id) session_id, referrer_host, utm
        from site_events
       where kind = 'view' and created_at >= v_since
       order by session_id, created_at, id
    )
    select jsonb_build_object(
      'referrers', coalesce((select jsonb_agg(jsonb_build_object('host', host, 'sessions', n) order by n desc, host)
                               from (select coalesce(referrer_host, '') as host, count(*) as n from firsts
                                      group by 1 order by 2 desc, 1 limit 25) r), '[]'::jsonb),
      'utm', coalesce((select jsonb_agg(jsonb_build_object('source', src, 'medium', med, 'campaign', camp, 'sessions', n)
                                        order by n desc, src)
                         from (select coalesce(utm ->> 'source', '') as src, coalesce(utm ->> 'medium', '') as med,
                                      coalesce(utm ->> 'campaign', '') as camp, count(*) as n
                                 from firsts where utm is not null
                                group by 1, 2, 3 order by 4 desc, 1 limit 25) u), '[]'::jsonb),
      'sessions', (select count(*) from firsts)));
end $$;

-- The /start funnel in sessions: any page view -> a /start view -> each wizard step reached -> submitted.
create or replace function analytics_funnel(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_since timestamptz := analytics_since(p_days);
begin
  perform analytics_require_staff();
  return jsonb_build_object(
    'visits', (select count(distinct session_id) from site_events where kind = 'view' and created_at >= v_since),
    'start', (select count(distinct session_id) from site_events
               where kind = 'view' and path in ('/start/', '/start') and created_at >= v_since),
    'steps', (select coalesce(jsonb_agg(jsonb_build_object('step', s, 'sessions', coalesce(n, 0)) order by s), '[]'::jsonb)
                from generate_series(1, 7) s
                left join (select target, count(distinct session_id) as n from site_events
                            where kind = 'start_step' and created_at >= v_since group by target) t on t.target = s::text),
    'submit', (select count(distinct session_id) from site_events where kind = 'start_submit' and created_at >= v_since));
end $$;

-- Views and sessions per Asia/Karachi day, oldest first, every day present (zero when quiet).
create or replace function analytics_daily(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_since timestamptz := analytics_since(p_days);
begin
  perform analytics_require_staff();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'views', coalesce(v.views, 0), 'sessions', coalesce(v.sessions, 0))
                              order by d), '[]'::jsonb)
      from generate_series((v_since at time zone 'Asia/Karachi')::date, (now() at time zone 'Asia/Karachi')::date, interval '1 day') d
      left join (select (created_at at time zone 'Asia/Karachi')::date as day, count(*) as views,
                        count(distinct session_id) as sessions
                   from site_events where kind = 'view' and created_at >= v_since group by 1) v on v.day = d::date);
end $$;

-- Sessions with any event in the last p_minutes (1-60, default 5), and the page each one is on now.
create or replace function analytics_live(p_minutes integer default 5) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_since timestamptz := now() - make_interval(mins => greatest(1, least(coalesce(p_minutes, 5), 60)));
begin
  perform analytics_require_staff();
  return (
    with last as (
      select distinct on (session_id) session_id, path
        from site_events where created_at >= v_since
       order by session_id, created_at desc, id desc
    )
    select jsonb_build_object(
      'sessions', (select count(*) from last),
      'pages', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'sessions', n) order by n desc, path)
                           from (select path, count(*) as n from last group by path order by 2 desc, 1 limit 20) p), '[]'::jsonb)));
end $$;

-- Sessions by device class and by country.
create or replace function analytics_breakdown(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_since timestamptz := analytics_since(p_days);
begin
  perform analytics_require_staff();
  return (
    with s as (
      select distinct on (session_id) session_id, device, country
        from site_events where created_at >= v_since
       order by session_id, created_at, id
    )
    select jsonb_build_object(
      'devices', coalesce((select jsonb_agg(jsonb_build_object('device', k, 'sessions', n) order by n desc, k)
                             from (select coalesce(device, 'unknown') as k, count(*) as n from s group by 1) d), '[]'::jsonb),
      'countries', coalesce((select jsonb_agg(jsonb_build_object('country', k, 'sessions', n) order by n desc, k)
                               from (select coalesce(country, '') as k, count(*) as n from s group by 1
                                      order by 2 desc, 1 limit 30) c), '[]'::jsonb)));
end $$;

-- ===================================================================================================== RLS + grants (analytics)
alter table site_events       enable row level security;
alter table site_events_daily enable row level security;
alter table site_events_rate  enable row level security;
do $$
declare t text;
begin
  foreach t in array array['site_events','site_events_daily','site_events_rate'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'service_role_all') then
      execute format('create policy service_role_all on %I for all to service_role using (true) with check (true)', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_events' and policyname = 'staff_read') then
    create policy staff_read on site_events for select to authenticated using ((select is_staff()));
  end if;
end $$;
revoke all on site_events, site_events_daily, site_events_rate from public, anon, authenticated;
grant select on site_events to authenticated;
grant all on site_events, site_events_daily, site_events_rate to service_role;
revoke all on sequence site_events_id_seq from public, anon, authenticated;
grant usage, select on sequence site_events_id_seq to service_role;

-- ===================================================================================================== demo: identity
-- The one demo login. No mailbox behind it: the /demo action signs it in with a server-generated link, and the portal
-- mailer already skips demo orgs.
create or replace function demo_user_email() returns text
language sql immutable set search_path = public, pg_temp as $$ select 'demo-portal@epsilon-labs.co'::text $$;

create or replace function demo_org_id() returns uuid
language sql immutable set search_path = public, pg_temp as $$ select 'de300000-0000-4000-8000-000000000001'::uuid $$;

-- invoices.number: also DEMO-NNNN (never drawn from the real EL-YYYY-NNN counter). demo_guard keeps it to demo orgs.
do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'invoices'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%number ~%EL-%'
     and pg_get_constraintdef(oid) not like '%DEMO-%';
  if v_name is not null then
    execute format('alter table invoices drop constraint %I', v_name);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_number_check' and conrelid = 'invoices'::regclass) then
    alter table invoices add constraint invoices_number_check
      check (number is null or number ~ '^EL-[0-9]{4}-[0-9]{3,}$' or number ~ '^DEMO-[0-9]{4}$');
  end if;
end $$;

-- ===================================================================================================== demo: read-only guard
-- True while reset_demo() is running in this transaction. Only reset_demo() sets it (set_config is not reachable
-- through the API: PostgREST exposes the public schema only).
create or replace function demo_resetting() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(current_setting('epsilon.demo_reset', true), '') = 'on'
$$;

-- A write made with a user's JWT (anon or authenticated: clients and staff alike). The worker's service role and direct
-- database sessions without a JWT (migrations, Supabase Auth deleting a user) are not user writes.
create or replace function demo_user_write() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') in ('anon', 'authenticated') and not demo_resetting()
$$;

-- BEFORE INSERT/UPDATE/DELETE on every org-scoped table. TG_ARGV[0] names the org column ('id' on organizations).
create or replace function demo_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_col text := tg_argv[0];
  v_new uuid;
  v_old uuid;
begin
  if tg_op <> 'DELETE' then
    v_new := (to_jsonb(new) ->> v_col)::uuid;
  end if;
  if tg_op <> 'INSERT' then
    v_old := (to_jsonb(old) ->> v_col)::uuid;
  end if;
  if tg_table_name = 'invoices' and tg_op <> 'DELETE' and coalesce(to_jsonb(new) ->> 'number', '') like 'DEMO-%'
     and not exists (select 1 from organizations o where o.id = v_new and o.is_demo) then
    raise exception 'DEMO invoice numbers belong to the demo organisation' using errcode = '23514';
  end if;
  if demo_user_write() and (
       (tg_table_name = 'organizations' and tg_op <> 'DELETE' and coalesce((to_jsonb(new) ->> 'is_demo')::boolean, false))
       or exists (select 1 from organizations o where o.id in (v_new, v_old) and o.is_demo)) then
    raise exception 'The demo portal is read-only' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- The demo login's own rows that are not org-scoped (email preferences).
create or replace function demo_profile_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if demo_user_write() and exists (
       select 1 from memberships m join organizations o on o.id = m.org_id
        where o.is_demo and m.user_id = case when tg_op = 'DELETE' then old.user_id else new.user_id end) then
    raise exception 'The demo portal is read-only' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

do $$
declare
  t record;
begin
  for t in select * from (values
    ('organizations','id'), ('memberships','org_id'), ('invites','org_id'), ('projects','org_id'), ('tickets','org_id'),
    ('ticket_events','org_id'), ('files','org_id'), ('notifications','org_id'), ('invoices','org_id'),
    ('proposals','org_id'), ('updates','org_id'), ('reports','org_id'), ('testimonials','org_id'),
    ('retainers','org_id'), ('time_entries','org_id')) v(tbl, col)
  loop
    if not exists (select 1 from pg_trigger where tgname = 'demo_guard' and tgrelid = t.tbl::regclass) then
      execute format('create trigger demo_guard before insert or update or delete on %I for each row execute function demo_guard(%L)',
                     t.tbl, t.col);
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'demo_guard' and tgrelid = 'profiles'::regclass) then
    create trigger demo_guard before insert or update or delete on profiles for each row execute function demo_profile_guard();
  end if;
end $$;

-- 012's guards, unchanged except the first statement: reset_demo() may refresh the demo org's published rows (their
-- dates move with the reset so the demo never looks abandoned). Nothing else can set the flag.
create or replace function updates_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if demo_resetting() then
    if tg_op = 'DELETE' then
      if exists (select 1 from organizations o where o.id = old.org_id and o.is_demo) then
        return old;
      end if;
    elsif exists (select 1 from organizations o where o.id = new.org_id and o.is_demo) then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'a published update cannot be deleted' using errcode = '55000';
    end if;
    return old;
  end if;
  if old.status = 'published' and (new.title, new.body_md, new.org_id, new.project_id, new.status, new.published_at)
       is distinct from (old.title, old.body_md, old.org_id, old.project_id, old.status, old.published_at) then
    raise exception 'a published update is immutable' using errcode = '55000';
  end if;
  if old.status = 'skipped' and new.status <> 'skipped' then
    raise exception 'a skipped update stays skipped' using errcode = '55000';
  end if;
  return new;
end $$;

create or replace function reports_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if demo_resetting() then
    if tg_op = 'DELETE' then
      if exists (select 1 from organizations o where o.id = old.org_id and o.is_demo) then
        return old;
      end if;
    elsif exists (select 1 from organizations o where o.id = new.org_id and o.is_demo) then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('published','void') and old.pdf_path is not null then
      raise exception 'a published report cannot be deleted' using errcode = '55000';
    end if;
    return old;
  end if;
  if old.status in ('approved','published','void') and (new.title, new.period_label, new.content, new.org_id, new.project_id)
       is distinct from (old.title, old.period_label, old.content, old.org_id, old.project_id)
     and not (old.status = 'approved' and new.status = 'draft') then
    raise exception 'an approved report is frozen; reopen it as a draft to edit' using errcode = '55000';
  end if;
  if new.pdf_path is distinct from old.pdf_path and old.pdf_path is not null then
    raise exception 'a report PDF is rendered once' using errcode = '55000';
  end if;
  if new.status <> old.status and not (
       (old.status = 'draft'     and new.status in ('approved','void'))
    or (old.status = 'approved'  and new.status in ('draft','published','void'))
    or (old.status = 'published' and new.status = 'void')) then
    raise exception 'invalid report status change % -> %', old.status, new.status using errcode = '55000';
  end if;
  return new;
end $$;

-- ===================================================================================================== demo: seed
-- Re-seeds the demo org to a known state with fixed ids, so links stay stable and nothing accumulates. All names are
-- fictional. Ticket numbers are drawn once (first seed) and kept. The paid invoice is issued once and kept as it is:
-- an issued invoice is immutable and never deleted (009/012 rules hold here too).
create or replace function reset_demo() returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org   uuid := demo_org_id();
  v_p1    uuid := 'de300000-0000-4000-8000-000000000101';
  v_p2    uuid := 'de300000-0000-4000-8000-000000000102';
  v_t1    uuid := 'de300000-0000-4000-8000-000000000201';
  v_t2    uuid := 'de300000-0000-4000-8000-000000000202';
  v_t3    uuid := 'de300000-0000-4000-8000-000000000203';
  v_t4    uuid := 'de300000-0000-4000-8000-000000000204';
  v_up    uuid := 'de300000-0000-4000-8000-000000000301';
  v_rep   uuid := 'de300000-0000-4000-8000-000000000401';
  v_inv   uuid := 'de300000-0000-4000-8000-000000000501';
  v_user  uuid;
  v_staff uuid := (select s.user_id from staff s where s.scope = 'full' order by s.created_at limit 1);  -- replies "from Epsilon"
  r       record;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
begin
  -- the worker's service role, staff, or pg_cron (no JWT at all)
  if auth.role() is not null and auth.role() <> 'service_role' and not is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform set_config('epsilon.demo_reset', 'on', true);

  insert into organizations (id, name, slug, domain, status, is_test, is_demo)
  values (v_org, 'Northwind Industrial (demo)', 'northwind-demo', null, 'active', false, true)
  on conflict (id) do update set name = excluded.name, slug = excluded.slug, status = 'active', is_test = false, is_demo = true;

  -- the demo login: a member seat (never owner, so invite / remove buttons stay hidden), and nobody else
  select id into v_user from auth.users where lower(email) = demo_user_email() limit 1;
  delete from memberships where org_id = v_org and user_id is distinct from v_user;
  if v_user is not null then
    insert into memberships (org_id, user_id, role) values (v_org, v_user, 'member')
    on conflict (org_id, user_id) do update set role = 'member';
  end if;
  delete from invites where org_id = v_org;

  insert into projects (id, org_id, name, status, summary, progress, next_milestone, next_milestone_on) values
    (v_p1, v_org, 'Line 3 machine monitoring', 'active',
     'SAMPLE DATA. Current and vibration sensors on the six presses of Line 3, a gateway that reads the existing PLCs over '
     'Modbus, and a downtime dashboard for the shift supervisors.', 64, 'Dashboard pilot with the night shift', v_today + 9),
    (v_p2, v_org, 'Spare-parts inventory app', 'active',
     'SAMPLE DATA. A phone app for the store room: scan a part, see stock across both sites, raise a reorder.', 30,
     'Barcode scanning beta', v_today + 21)
  on conflict (id) do update set name = excluded.name, status = excluded.status, summary = excluded.summary,
    progress = excluded.progress, next_milestone = excluded.next_milestone, next_milestone_on = excluded.next_milestone_on;
  delete from projects where org_id = v_org and id not in (v_p1, v_p2);

  -- update in place, insert only what is missing: an INSERT .. ON CONFLICT would draw a ticket number every night
  for r in select * from (values
    (v_t1, v_p1, 'Add a shift filter to the downtime chart',
     'The night shift supervisor wants to see only their own stoppages.', 'change', 'normal', 'in_progress', interval '6 days'),
    (v_t2, v_p1, 'Export weekly OEE as CSV',
     'Finance pulls the numbers into their own sheet every Monday.', 'change', 'low', 'review', interval '9 days'),
    (v_t3, v_p1, 'Press 4 shows zero current after a power cut',
     'After Tuesday''s outage the press 4 tile stayed at 0 A until we restarted the gateway.', 'bug', 'urgent', 'done',
     interval '13 days'),
    (v_t4, v_p2, 'Can scanning work offline in the store room?',
     'There is no Wi-Fi signal behind the racking.', 'question', 'normal', 'triaged', interval '2 days')
  ) v(id, project_id, title, body, type, priority, status, age) loop
    update tickets set org_id = v_org, project_id = r.project_id, author_id = v_user, title = r.title, body = r.body,
           type = r.type, priority = r.priority, status = r.status, mode = null, created_at = now() - r.age
     where id = r.id;
    if not found then
      insert into tickets (id, org_id, project_id, author_id, title, body, type, priority, status, created_at)
      values (r.id, v_org, r.project_id, v_user, r.title, r.body, r.type, r.priority, r.status, now() - r.age);
    end if;
  end loop;
  delete from tickets where org_id = v_org and id not in (v_t1, v_t2, v_t3, v_t4);

  delete from ticket_events where org_id = v_org;
  insert into ticket_events (org_id, ticket_id, kind, body, data, client_visible, actor, created_at) values
    (v_org, v_t1, 'status', null, '{"from":"new","to":"triaged"}', true, v_staff, now() - interval '5 days 20 hours'),
    (v_org, v_t1, 'comment', 'Sample reply: we will add Day / Night / All above the chart, defaulting to the current shift.',
     null, true, v_staff, now() - interval '5 days 19 hours'),
    (v_org, v_t1, 'status', null, '{"from":"approved","to":"in_progress"}', true, v_staff, now() - interval '3 days'),
    (v_org, v_t2, 'status', null, '{"from":"in_progress","to":"review"}', true, v_staff, now() - interval '1 day'),
    (v_org, v_t2, 'comment', 'Sample reply: the export is on the staging dashboard under Reports. Does the column order work for finance?',
     null, true, v_staff, now() - interval '1 day'),
    (v_org, v_t3, 'comment', 'Sample reply: the gateway now reconnects to the PLC on its own after power returns. Fixed and tested on press 4.',
     null, true, v_staff, now() - interval '11 days'),
    (v_org, v_t3, 'status', null, '{"from":"in_progress","to":"done"}', true, v_staff, now() - interval '11 days'),
    (v_org, v_t4, 'status', null, '{"from":"new","to":"triaged"}', true, v_staff, now() - interval '1 day 4 hours');

  insert into updates (id, org_id, project_id, title, body_md, status, source, published_at, created_at) values
    (v_up, v_org, v_p1, 'Line 3: all six presses reporting',
     E'**Sample update for the demo portal.**\n\nAll six presses on Line 3 now report current and vibration every second. '
     || E'The gateway survived two planned power cuts without losing data.\n\n**Next week**\n\n- Shift filter on the downtime chart\n'
     || E'- Night-shift pilot with two supervisors\n\n**Needs from you**\n\n- Confirm the shift times (06:00 / 18:00?)',
     'published', 'manual', now() - interval '2 days', now() - interval '2 days')
  on conflict (id) do update set project_id = excluded.project_id, title = excluded.title, body_md = excluded.body_md,
    status = 'published', published_at = excluded.published_at;
  delete from updates where org_id = v_org and id <> v_up;

  insert into reports (id, org_id, project_id, title, period_label, content, status, pdf_path, approved_at, published_at, created_at)
  values (v_rep, v_org, v_p1, 'Line 3 monitoring: phase 1 delivery report', 'Sample period',
    jsonb_build_object(
      'title', 'Line 3 monitoring: phase 1',
      'subtitle', 'SAMPLE REPORT for the demo portal. Fictional company and figures.',
      'prepared_for', 'Northwind Industrial (demo)',
      'summary', jsonb_build_array(
        'Six presses on Line 3 now stream current and vibration data to a single downtime dashboard.',
        'Unplanned stoppages are logged automatically with a reason picked by the operator.'),
      'kpis', jsonb_build_array(jsonb_build_object('value', '6/6', 'label', 'Presses reporting'),
                                jsonb_build_object('value', '1 s', 'label', 'Sample interval'),
                                jsonb_build_object('value', '0', 'label', 'Data gaps after power cuts')),
      'measures', jsonb_build_array(jsonb_build_object('measure', 'Time to spot a stopped press', 'before', '~20 min', 'after', '< 1 min')),
      'sections', jsonb_build_array(jsonb_build_object(
        'title', 'What was delivered',
        'intro', 'Sensors, gateway and dashboard for Line 3.',
        'callout', null,
        'rows', jsonb_build_array(
          jsonb_build_object('item', 'Current and vibration sensors', 'outcome', 'Fitted on presses 1-6.', 'new', true),
          jsonb_build_object('item', 'Modbus gateway', 'outcome', 'Reads the existing PLCs; reconnects after power loss.', 'new', true),
          jsonb_build_object('item', 'Downtime dashboard', 'outcome', 'Live tiles per press and a weekly chart.', 'new', true)))),
      'verification', jsonb_build_array(jsonb_build_object('claim', 'Survives power cuts', 'proof', 'Two planned outages, no data lost (sample).')),
      'outstanding', jsonb_build_array(jsonb_build_object('item', 'Shift filter', 'action', 'In progress, ticket open.'))),
    'published', v_org::text || '/' || v_rep::text || '.pdf', now() - interval '8 days', now() - interval '8 days', now() - interval '9 days')
  on conflict (id) do update set project_id = excluded.project_id, title = excluded.title, period_label = excluded.period_label,
    content = excluded.content, status = 'published', pdf_path = excluded.pdf_path, approved_at = excluded.approved_at,
    published_at = excluded.published_at;
  delete from reports where org_id = v_org and id <> v_rep;

  -- issued once (first seed) and kept: issued invoices are immutable
  insert into invoices (id, org_id, number, kind, bill_company, bill_contact, project_label, lines, tax_rate, currency, total,
                        due_date, status, issued_at, paid_at)
  values (v_inv, v_org, 'DEMO-0001', 'invoice', 'Northwind Industrial (demo)', 'Sample contact', 'Line 3 machine monitoring',
          '[{"title":"Line 3 monitoring, phase 1 (sample)","desc":"Fictional line item for the demo portal.","amount":"2400.00"}]'::jsonb,
          0, 'USD', 2400, v_today - 6, 'paid', now() - interval '20 days', now() - interval '10 days')
  on conflict (id) do nothing;

  delete from notifications where org_id = v_org;
  delete from time_entries where org_id = v_org;
  delete from testimonials where org_id = v_org;
  delete from retainers where org_id = v_org;
  if v_user is not null then
    insert into notifications (org_id, user_id, kind, title, link, urgent, created_at, email_state) values
      (v_org, v_user, 'ticket_status', 'Export weekly OEE as CSV: needs your review', '/tickets/' || v_t2::text, false,
       now() - interval '1 day', 'skipped'),
      (v_org, v_user, 'update', 'New update: Line 3: all six presses reporting', '/updates', false, now() - interval '2 days', 'skipped');
  end if;

  perform deal_room_audit('demo_reset', 'organizations', v_org::text, jsonb_build_object('user', v_user));
  return jsonb_build_object('ok', true, 'org_id', v_org, 'user_id', v_user);
end $$;

-- The /demo server action (service role): seed if missing, then make sure the demo login has its seat.
create or replace function demo_prepare() returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role only' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = demo_user_email() limit 1;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'no demo login');
  end if;
  if not exists (select 1 from projects where org_id = demo_org_id())
     or not exists (select 1 from memberships where org_id = demo_org_id() and user_id = v_user) then
    perform reset_demo();
  end if;
  return jsonb_build_object('ok', true, 'org_id', demo_org_id(), 'user_id', v_user);
end $$;

-- ===================================================================================================== grants (functions)
do $$
declare
  f text;
begin
  foreach f in array array[
    'record_events(jsonb)', 'prune_site_events()', 'analytics_since(integer)', 'analytics_require_staff()',
    'analytics_top_pages(integer, integer)', 'analytics_sources(integer)', 'analytics_funnel(integer)',
    'analytics_daily(integer)', 'analytics_live(integer)', 'analytics_breakdown(integer)',
    'demo_user_email()', 'demo_org_id()', 'demo_resetting()', 'demo_user_write()', 'demo_guard()', 'demo_profile_guard()',
    'reset_demo()', 'demo_prepare()', 'updates_guard()', 'reports_guard()']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function record_events(jsonb) to anon, service_role;
grant execute on function analytics_top_pages(integer, integer), analytics_sources(integer), analytics_funnel(integer),
  analytics_daily(integer), analytics_live(integer), analytics_breakdown(integer) to authenticated;
grant execute on function prune_site_events(), reset_demo() to authenticated, service_role;
grant execute on function demo_prepare() to service_role;

-- ===================================================================================================== pg_cron (only if enabled)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $c$select cron.schedule('epsilon-prune-site-events', '17 22 * * *', 'select public.prune_site_events()')$c$;
    execute $c$select cron.schedule('epsilon-reset-demo', '27 22 * * *', 'select public.reset_demo()')$c$;
  end if;
end $$;

commit;
