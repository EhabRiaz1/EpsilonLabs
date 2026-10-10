-- Epsilon OS migration v3 (additive, idempotent). Requires schema.sql and 002 applied first.
-- Held tray (DD3), lint results (D11), edit diff (DD4).

alter table approval_queue add column if not exists held boolean not null default false;
alter table approval_queue add column if not exists held_reason text;
alter table approval_queue add column if not exists lint jsonb;
alter table approval_queue add column if not exists diff jsonb;

create index if not exists approval_queue_status_held_idx on approval_queue (status, held, created_at);
