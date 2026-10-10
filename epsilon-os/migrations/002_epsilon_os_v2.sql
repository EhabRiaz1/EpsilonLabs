-- Epsilon OS migration v2 (additive, idempotent). Requires schema.sql applied first.

alter type approval_status add value if not exists 'sending';
alter type approval_status add value if not exists 'failed';

alter table approval_queue add column if not exists kind text
  check (kind in ('ack','reply','outbound','quote','optout_confirm'));
alter table approval_queue add column if not exists to_email citext;
alter table approval_queue add column if not exists subject text;
alter table approval_queue add column if not exists in_reply_to_message_id text;
alter table approval_queue add column if not exists references_hdr text;
alter table approval_queue add column if not exists send_error text;
alter table approval_queue add column if not exists sent_message_id text;
alter table approval_queue add column if not exists claimed_at timestamptz;
alter table approval_queue add column if not exists run_id uuid;

create table if not exists actions (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  agent        text not null,
  run_id       uuid,
  action       text not null,
  target_table text,
  target_id    text,
  detail       jsonb,
  model        text,
  input_tokens integer,
  output_tokens integer,
  cost_usd     numeric(10,6)
);
create index if not exists actions_action_at_idx on actions (action, at);

create table if not exists dossiers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  version    integer not null default 1,
  body_md    text not null,
  sources    jsonb,
  created_at timestamptz not null default now(),
  created_by text,
  unique (company_id, version)
);

do $$
declare t text;
begin
  foreach t in array array['actions','dossiers']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists service_role_all on %I', t);
    execute format('create policy service_role_all on %I for all to service_role using (true) with check (true)', t);
  end loop;
end $$;
-- actions is insert-only by convention: the service role is the only writer and agents never update/delete it.
-- Enforce at DB level so a bug cannot rewrite history.
revoke update, delete, truncate on actions from service_role;
