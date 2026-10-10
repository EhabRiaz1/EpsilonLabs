-- Epsilon OS migration v4 (additive, idempotent). Requires schema.sql, 002 and 003 applied first.
-- Prospector + outreach (build doc P1-P5): runtime settings editable from the dashboard (/settings).

create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;
drop policy if exists service_role_all on settings;
create policy service_role_all on settings for all to service_role using (true) with check (true);

-- Seed defaults without overwriting anything the founder already changed.
-- outreach.started_on is the JSON null until the first successful outreach send sets it to a date.
insert into settings (key, value) values
  ('prospector.per_day',    '20'::jsonb),
  ('prospector.segments',   '["industrial","oem_hardware","smb_software"]'::jsonb),
  ('prospector.paused',     'false'::jsonb),
  ('llm.daily_budget',      '250'::jsonb),
  ('outreach.daily_cap',    '50'::jsonb),
  ('outreach.ramp',         '{"start":5,"step":5,"every_days":3}'::jsonb),
  ('outreach.started_on',   'null'::jsonb)
on conflict (key) do nothing;

-- schema.sql already ships deals_source_idx on (source_channel); only add one if no index covers it.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = current_schema() and tablename = 'deals' and indexdef ilike '%(source_channel)%'
  ) then
    create index deals_source_channel_idx on deals (source_channel);
  end if;
end $$;
