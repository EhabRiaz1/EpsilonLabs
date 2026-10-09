-- Epsilon OS schema (Supabase Postgres). Solo founder: RLS on, one service-role policy.
-- Apply: Supabase dashboard > SQL editor, or `psql "$DATABASE_URL" -f schema.sql`.
-- Idempotent where practical.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- Enums ---------------------------------------------------------------
do $$ begin
  create type source_channel as enum ('referral','outbound','dream25','inbound','pre_existing');
exception when duplicate_object then null; end $$;

do $$ begin
  create type deal_stage as enum ('lead','conversation','scoping_call','quote_out','won','lost','dormant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type wedge as enum ('fuel_retail','industrial_monitoring','protocol_decode','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type touch_type as enum ('human_reply','auto_reply','bounce','opt_out','sent','call','quote');
exception when duplicate_object then null; end $$;

do $$ begin
  create type touch_direction as enum ('inbound','outbound','internal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type approval_status as enum ('pending','approved','edited_approved','rejected','sent','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type heartbeat_status as enum ('ok','warn','error');
exception when duplicate_object then null; end $$;

-- Shared updated_at trigger ---------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- companies ------------------------------------------------------------
create table if not exists companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  domain       citext unique,
  country      text,                       -- ISO 3166-1 alpha-2
  sector       text,
  wedge        wedge,
  is_dream25   boolean not null default false,
  notes        text,
  last_contacted_at timestamptz,           -- drives 18-month non-responder retention
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists companies_wedge_idx on companies (wedge);
create index if not exists companies_dream25_idx on companies (is_dream25) where is_dream25;
create trigger companies_updated before update on companies
  for each row execute function set_updated_at();

-- contacts -------------------------------------------------------------
create table if not exists contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references companies(id) on delete set null,
  full_name    text,
  email        citext unique,
  role         text,
  linkedin_url text,
  region       text,                       -- e.g. 'PK','UK','EU','GULF' (legal basis tracking)
  legal_basis  text,                       -- e.g. 'legitimate_interest_b2b','inbound','existing_relationship'
  opted_out    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists contacts_company_idx on contacts (company_id);
create trigger contacts_updated before update on contacts
  for each row execute function set_updated_at();

-- deals ----------------------------------------------------------------
create table if not exists deals (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  primary_contact_id uuid references contacts(id) on delete set null,
  title          text not null,
  stage          deal_stage not null default 'lead',
  value_usd      numeric(12,2) check (value_usd is null or value_usd >= 0),
  wedge          wedge,
  source_channel source_channel not null,  -- mandatory tag: tests the engine, not the old network
  quoted_at      timestamptz,
  closed_at      timestamptz,
  collected_at   timestamptz,              -- hiring trigger counts COLLECTED cash
  lost_reason    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists deals_stage_idx on deals (stage);
create index if not exists deals_company_idx on deals (company_id);
create index if not exists deals_source_idx on deals (source_channel);
create index if not exists deals_closed_idx on deals (closed_at) where closed_at is not null;
create trigger deals_updated before update on deals
  for each row execute function set_updated_at();

-- touches (events) -------------------------------------------------------
-- Distinct types so bounces/auto-replies never count as interested replies.
create table if not exists touches (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid references deals(id) on delete set null,
  contact_id    uuid references contacts(id) on delete set null,
  type          touch_type not null,
  direction     touch_direction not null default 'inbound',
  channel       text not null default 'email',
  message_id    text,                      -- RFC 5322 Message-ID, for dedupe
  subject       text,
  body_excerpt  text,                      -- UNTRUSTED text; store, never execute
  classifier    jsonb,                     -- agent output: label, confidence, flags (e.g. injection_suspected)
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create unique index if not exists touches_message_id_uq on touches (message_id) where message_id is not null;
create index if not exists touches_deal_idx on touches (deal_id, occurred_at desc);
create index if not exists touches_contact_idx on touches (contact_id, occurred_at desc);
create index if not exists touches_type_time_idx on touches (type, occurred_at desc);

-- suppression_list ---------------------------------------------------------
create table if not exists suppression_list (
  id         uuid primary key default gen_random_uuid(),
  email      citext not null unique,
  reason     text not null,                -- 'opt_out','hard_bounce','complaint','manual'
  forever    boolean not null default true,-- policy: honored forever
  source_touch_id uuid references touches(id) on delete set null,
  created_at timestamptz not null default now()
);

-- agent_heartbeats -------------------------------------------------------
create table if not exists agent_heartbeats (
  id        uuid primary key default gen_random_uuid(),
  agent     text not null,                 -- prospector|concierge|triage|quote
  last_run  timestamptz not null default now(),
  status    heartbeat_status not null default 'ok',
  detail    jsonb                          -- counts, errors, unprocessed inbox count
);
create index if not exists agent_heartbeats_agent_idx on agent_heartbeats (agent, last_run desc);

-- approval_queue ---------------------------------------------------------
create table if not exists approval_queue (
  id          uuid primary key default gen_random_uuid(),
  agent       text not null,
  deal_id     uuid references deals(id) on delete set null,
  contact_id  uuid references contacts(id) on delete set null,
  in_reply_to_touch_id uuid references touches(id) on delete set null,
  draft       text not null,
  final_text  text,                        -- what was actually sent (diff = "material edit" signal)
  status      approval_status not null default 'pending',
  autonomy_stage smallint not null default 2 check (autonomy_stage between 1 and 4),
  material_edit boolean,                   -- set on approval; feeds the 20-clean-runs counter
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create index if not exists approval_queue_status_idx on approval_queue (status, created_at);

-- Helper: block drafting to suppressed addresses --------------------------
create or replace function is_suppressed(addr text) returns boolean
language sql stable as $$
  select exists (select 1 from suppression_list where email = addr::citext)
$$;

-- RLS: solo founder. Enable everywhere; only service_role passes. -------------
do $$
declare t text;
begin
  foreach t in array array['companies','contacts','deals','touches','suppression_list','agent_heartbeats','approval_queue']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists service_role_all on %I', t);
    execute format('create policy service_role_all on %I for all to service_role using (true) with check (true)', t);
  end loop;
end $$;
-- anon/authenticated have no policy => no access. The service-role key stays local (.env/keychain), never in the site.
