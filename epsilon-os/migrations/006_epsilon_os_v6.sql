-- Epsilon OS migration v6 (additive, idempotent). Requires schema.sql and 002-005 applied first.
-- Strategy S1, tenders: public procurement notices found by code from official open feeds
-- (agents/tenders.py), scored against the catalogue, and decided by the founder in the dashboard.
-- Nothing here bids or sends anything.
--   fit  {score 0-100, offer_slug, reasons[], eligibility{status ok|flag|exclude, notes[]}, effort, what_we_need[]}

create table if not exists opportunities (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('ted','uk_fts','uk_cf','canadabuys','austender','ungm','samgov','worldbank','ebrd',
                                                  'adb','afdb','isdb','aiib','etimad','dubai','monaqasat','oman','bahrain','kuwait')),
  source_id     text not null,
  url           text,
  title         text not null,
  buyer         text,
  country       text,
  cpv_or_naics  text[] not null default '{}',
  published_at  timestamptz,
  deadline_at   timestamptz,
  value_min     numeric,
  value_max     numeric,
  currency      text,
  summary       text,
  raw           jsonb,
  fit           jsonb,
  status        text not null default 'new' check (status in ('new','bid','pass','submitted','won','lost','expired')),
  decided_at    timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (source, source_id)
);

-- Dashboard list: open work first, soonest deadline.
create index if not exists opportunities_status_deadline_idx on opportunities (status, deadline_at);
create index if not exists opportunities_created_idx on opportunities (created_at desc);

alter table opportunities enable row level security;

drop policy if exists service_role_all on opportunities;
create policy service_role_all on opportunities for all to service_role using (true) with check (true);

-- Tender settings are read from the settings table with code defaults; no seed rows needed.
