-- Epsilon OS migration v7 (additive, idempotent). Requires schema.sql and 002-005 applied first.
-- Multi-strategy prospecting (docs/designs/epsilon-os-build.md, "Multi-strategy research").
--   companies.strategy / deals.strategy   which strategy found the prospect:
--       s2_trigger | s3_regulation | s4_partner | s5_intent | s7_orphaned | s8_tradeshow | s9_crowdfund | s10_accelerator | legacy (everything the old segment-based prospector made)
--       null = not a prospector row (referral, inbound, dream25, pre_existing ...)
--
-- Per-strategy statistics (30 / 90 days: created, drafts approved, sent, replies, positive replies, opt-outs,
-- deals past lead, won value) are NOT a SQL view. They are computed in code (agents/prospector.py strategy_stats) from
-- deals.strategy joined in memory to approval_queue / touches, because "positive" depends on the classifier label
-- inside touches.classifier (jsonb) and the same function feeds both the dashboard Health block and the weekly
-- quota rebalance, so there is one definition. Nothing else to apply for it.
--
-- The new settings strategy.quotas / strategy.auto_rebalance / strategy.pinned are not seeded: code defaults apply
-- until the first save from /settings.

alter table companies add column if not exists strategy text;
alter table deals add column if not exists strategy text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_strategy_chk') then
    alter table companies add constraint companies_strategy_chk
      check (strategy is null or strategy in ('s2_trigger','s3_regulation','s4_partner','s5_intent','s7_orphaned','s8_tradeshow','s9_crowdfund','s10_accelerator','legacy'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deals_strategy_chk') then
    alter table deals add constraint deals_strategy_chk
      check (strategy is null or strategy in ('s2_trigger','s3_regulation','s4_partner','s5_intent','s7_orphaned','s8_tradeshow','s9_crowdfund','s10_accelerator','legacy'));
  end if;
end $$;

-- Existing prospector rows: companies carry the note "Prospector (<segment>): ..." (agents/prospector.py _write);
-- their deals are the outbound deals on those companies. Only rows still null are touched, so re-applying never
-- rewrites a strategy set later.
update companies set strategy = 'legacy' where strategy is null and notes like 'Prospector (%';
update deals set strategy = 'legacy'
 where strategy is null and source_channel = 'outbound'
   and company_id in (select id from companies where strategy = 'legacy');

create index if not exists companies_strategy_idx on companies (strategy) where strategy is not null;
create index if not exists deals_strategy_idx on deals (strategy, created_at) where strategy is not null;
