-- Epsilon OS migration v5 (additive, idempotent). Requires schema.sql and 002-004 applied first.
-- Three-touch follow-up sequence for cold outreach (agents/followups.py).
--   sequence_step    1 = first touch, 2 and 3 = follow-ups; null for everything that is not an outbound sequence draft
--   sequence_parent  approval_queue id of the first touch (steps 2 and 3 both point at step 1)

alter table approval_queue add column if not exists sequence_step smallint;
alter table approval_queue add column if not exists sequence_parent uuid references approval_queue(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'approval_queue_sequence_step_chk') then
    alter table approval_queue add constraint approval_queue_sequence_step_chk
      check (sequence_step is null or sequence_step between 1 and 3);
  end if;
end $$;

-- Prospector first touches that already exist are step 1 (inbox replies on the outreach mailbox are also
-- kind 'outbound' but are not part of a sequence, so they stay null).
update approval_queue set sequence_step = 1
 where kind = 'outbound' and agent = 'prospector' and sequence_step is null;

-- "Is there already a draft for this step of this sequence?" and "which follow-ups are in flight".
create index if not exists approval_queue_sequence_idx
  on approval_queue (sequence_parent, sequence_step) where sequence_parent is not null;
-- "Which sent first touches / step 2s might be due a follow-up".
create index if not exists approval_queue_followup_due_idx
  on approval_queue (sequence_step, created_at) where kind = 'outbound' and status = 'sent';
