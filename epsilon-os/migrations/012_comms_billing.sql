-- Epsilon OS migration 012: client comms, weekly updates, delivery reports, invoices beyond the deposit, referrals,
-- testimonials and retainers (docs/designs/client-platform.md Phases 3, 4 and 4b; E2, E4, E6; F9, F13, F15, F16).
-- Additive and idempotent. Requires 008-011. No table or column drops and no change to existing rows. Three CHECK
-- constraints are replaced by strictly wider ones (new allowed values only): notifications.kind, push_queue.kind and
-- approval_queue.kind ('referral').
--
-- Tables      profiles (timezone, email preference), email_digests (one daily digest per person per local day),
--             updates (weekly / manual project posts), reports (delivery reports), testimonials, retainers, time_entries
-- Columns     notifications: email_state / email_claim / email_claimed_at / email_attempts / email_error
--             invoices: schedule_stage, credit_reason, approved_at       updates: lint (review aid only)
-- Storage     private bucket 'reports' (members of the org read published reports; only the service role writes)
-- Mailer      claim_email_batch / finish_email (service role): urgent rows are emailed at once; the rest wait for one
--             digest per person per day at 10:00 in their timezone (default Asia/Karachi); preference immediate / daily
--             / off; suppressed addresses, test/demo orgs, stale (>3 days) rows and ex-members are skipped. A claim that
--             lapses (sender died) is retried after 10 minutes, at most 3 attempts. emailed_at is written on send.
-- Updates     save_update_draft (worker or staff), edit_update, publish_update, skip_update, queue_weekly_update(s)
-- Reports     save_report_draft, approve_report, mark_report_published (service role, after the PDF is stored),
--             void_report, queue_report_draft
-- Invoices    create_invoice_draft, invoice_from_schedule, update_invoice_draft, approve_invoice, issue_invoice,
--             mark_invoice_paid, void_invoice, create_credit_note, mark_overdue_invoices
-- Referrals   referral_draft jobs are queued by triggers (project done; final schedule invoice paid). The worker drafts a
--             personal ask into approval_queue (kind 'referral'): it waits in Approvals and leaves from er@ via the outbox.
-- Testimonials request_testimonial (staff), submit_testimonial / withdraw_testimonial (members), mark_testimonial_published
-- Retainers   save_retainer, log_time, delete_time_entry (staff), retainer_usage (members and staff; upsell flag staff only)
-- Profile     save_my_prefs (any signed-in user, own row only)
-- Jobs        weekly_update / report_draft / referral_draft params pinned by CHECKs (NOT VALID); one live job per key.

begin;

create extension if not exists pgcrypto;

-- ===================================================================================================== widened checks
do $$
declare
  c record;
begin
  for c in select * from (values
    ('notifications', 'notifications_kind_check',
     'check (kind in (''ticket_status'',''reply'',''invoice'',''file'',''update'',''report'',''testimonial''))', 'testimonial'),
    ('push_queue', 'push_queue_kind_check',
     'check (kind in (''draft'',''reply'',''intake'',''ticket'',''proposal'',''invoice'',''agent_error'',''test'',''testimonial''))', 'testimonial'),
    ('approval_queue', 'approval_queue_kind_check',
     'check (kind in (''ack'',''reply'',''outbound'',''quote'',''optout_confirm'',''referral''))', 'referral')
  ) v(tbl, name, def, marker)
  loop
    if exists (select 1 from pg_constraint where conname = c.name and conrelid = c.tbl::regclass
                 and pg_get_constraintdef(oid) not like '%' || c.marker || '%') then
      execute format('alter table %I drop constraint %I', c.tbl, c.name);
    end if;
    if not exists (select 1 from pg_constraint where conname = c.name and conrelid = c.tbl::regclass) then
      execute format('alter table %I add constraint %I %s', c.tbl, c.name, c.def);
    end if;
  end loop;
end $$;

-- ===================================================================================================== profiles
create table if not exists profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  timezone    text not null default 'Asia/Karachi' check (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$' and length(timezone) <= 64),
  email_pref  text not null default 'daily' check (email_pref in ('immediate','daily','off')),
  updated_at  timestamptz not null default now()
);

-- ===================================================================================================== notifications mailer
alter table notifications add column if not exists email_state text
  check (email_state is null or email_state in ('claimed','sent','skipped','suppressed','failed'));
alter table notifications add column if not exists email_claim uuid;
alter table notifications add column if not exists email_claimed_at timestamptz;
alter table notifications add column if not exists email_attempts smallint not null default 0;
alter table notifications add column if not exists email_error text check (email_error is null or length(email_error) <= 300);
create index if not exists notifications_email_pending_idx on notifications (user_id, created_at)
  where email_state is null or email_state = 'claimed';
create index if not exists notifications_email_claim_idx on notifications (email_claim) where email_claim is not null;

create table if not exists email_digests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  local_date  date not null,
  state       text not null default 'claimed' check (state in ('claimed','sent','failed')),
  claim       uuid,
  claimed_at  timestamptz,
  items       integer not null default 0 check (items >= 0),
  attempts    smallint not null default 0 check (attempts >= 0),
  error       text check (error is null or length(error) <= 300),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (user_id, local_date)
);

-- ===================================================================================================== updates (E2)
create table if not exists updates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  project_id     uuid not null,
  title          text not null check (length(btrim(title)) between 1 and 200),
  body_md        text not null default '' check (length(body_md) <= 20000),
  status         text not null default 'draft' check (status in ('draft','published','skipped')),
  source         text not null default 'manual' check (source in ('weekly','manual')),
  week_of        date,                                  -- Monday (PKT) of the week a weekly update covers
  inputs         jsonb check (inputs is null or jsonb_typeof(inputs) = 'object'),   -- what the draft was built from
  lint           jsonb check (lint is null or jsonb_typeof(lint) = 'array'),        -- core.lint hits, a review aid
  job_id         uuid references jobs(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  edited_at      timestamptz,
  published_at   timestamptz,
  published_by   uuid references auth.users(id) on delete set null,
  skipped_reason text check (skipped_reason is null or length(skipped_reason) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (project_id, org_id) references projects(id, org_id) on delete cascade,
  check (source <> 'weekly' or week_of is not null),
  check (status <> 'published' or published_at is not null)
);
create unique index if not exists updates_weekly_uniq on updates (project_id, week_of) where source = 'weekly';
create index if not exists updates_org_idx on updates (org_id, status, published_at desc);
create index if not exists updates_draft_idx on updates (created_at) where status = 'draft';

-- ===================================================================================================== reports
create table if not exists reports (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  project_id       uuid not null,
  title            text not null check (length(btrim(title)) between 1 and 200),
  period_label     text not null default '' check (length(period_label) <= 80),
  content          jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and length(content::text) <= 200000),
  status           text not null default 'draft' check (status in ('draft','approved','published','void')),
  pdf_path         text check (pdf_path is null or pdf_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  pdf_error        text check (pdf_error is null or length(pdf_error) <= 1000),
  pdf_attempted_at timestamptz,
  job_id           uuid references jobs(id) on delete set null,
  created_by       uuid references auth.users(id) on delete set null,
  edited_at        timestamptz,
  approved_at      timestamptz,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (project_id, org_id) references projects(id, org_id) on delete cascade,
  check (status <> 'published' or (pdf_path is not null and published_at is not null))
);
create index if not exists reports_org_idx on reports (org_id, status, published_at desc);

-- ===================================================================================================== testimonials (E4)
create table if not exists testimonials (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  project_id    uuid,
  quote         text not null default '' check (length(quote) <= 1200),
  author_name   text not null default '' check (length(author_name) <= 120),
  author_role   text not null default '' check (length(author_role) <= 120),
  status        text not null default 'requested' check (status in ('requested','client_approved','published','withdrawn')),
  requested_by  uuid references auth.users(id) on delete set null,
  approved_by   uuid references auth.users(id) on delete set null,
  approved_at   timestamptz,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (project_id, org_id) references projects(id, org_id) on delete cascade,
  check (status not in ('client_approved','published') or
         (approved_at is not null and length(btrim(quote)) >= 10 and length(btrim(author_name)) >= 2))
);
create index if not exists testimonials_org_idx on testimonials (org_id, created_at desc);

-- ===================================================================================================== retainers (E6)
create table if not exists retainers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  tier            text not null check (tier in ('r10','r20','r40','custom')),
  hours_included  numeric(6,2) not null check (hours_included > 0 and hours_included <= 744),
  period          text not null default 'monthly' check (period = 'monthly'),
  starts_on       date not null,
  ends_on         date,
  status          text not null default 'active' check (status in ('active','paused','ended')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create unique index if not exists retainers_one_active on retainers (org_id) where status = 'active';

create table if not exists time_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  ticket_id   uuid,
  minutes     integer not null check (minutes between 1 and 1440),
  note        text not null default '' check (length(note) <= 500),
  billable    boolean not null default true,
  worked_on   date not null default ((now() at time zone 'Asia/Karachi')::date),
  logged_by   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (ticket_id, org_id) references tickets(id, org_id) on delete cascade
);
create index if not exists time_entries_org_idx on time_entries (org_id, worked_on desc);
create index if not exists time_entries_ticket_idx on time_entries (ticket_id) where ticket_id is not null;

-- ===================================================================================================== invoices: columns
alter table invoices add column if not exists schedule_stage smallint check (schedule_stage is null or schedule_stage between 0 and 5);
alter table invoices add column if not exists credit_reason text check (credit_reason is null or length(credit_reason) <= 500);
alter table invoices add column if not exists approved_at timestamptz;
create index if not exists invoices_overdue_idx on invoices (due_date) where status = 'sent' and kind = 'invoice';
create index if not exists invoices_ref_idx on invoices (ref_invoice_id) where ref_invoice_id is not null;

-- ===================================================================================================== jobs: params + one live job per key
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_weekly_update_params') then
    alter table jobs add constraint jobs_weekly_update_params check (type <> 'weekly_update' or (
      coalesce(params ->> 'project_id', '') ~ '^[0-9a-f-]{36}$' and coalesce(params ->> 'week_of', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (not params ? 'notes' or (jsonb_typeof(params -> 'notes') = 'string' and length(params ->> 'notes') <= 2000))
      and params - 'project_id' - 'week_of' - 'notes' = '{}'::jsonb)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_report_draft_params') then
    alter table jobs add constraint jobs_report_draft_params check (type <> 'report_draft' or (
      coalesce(params ->> 'project_id', '') ~ '^[0-9a-f-]{36}$'
      and coalesce(params ->> 'period_start', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and coalesce(params ->> 'period_end', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (not params ? 'notes' or (jsonb_typeof(params -> 'notes') = 'string' and length(params ->> 'notes') <= 4000))
      and params - 'project_id' - 'period_start' - 'period_end' - 'notes' = '{}'::jsonb)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_referral_draft_params') then
    alter table jobs add constraint jobs_referral_draft_params check (type <> 'referral_draft' or (
      coalesce(params ->> 'org_id', '') ~ '^[0-9a-f-]{36}$' and coalesce(params ->> 'trigger', '') in ('project_done','invoice_paid')
      and coalesce(params ->> 'ref_id', '') ~ '^[0-9a-f-]{36}$'
      and params - 'org_id' - 'trigger' - 'ref_id' = '{}'::jsonb)) not valid;
  end if;
end $$;
create unique index if not exists jobs_weekly_update_uniq on jobs ((params ->> 'project_id'), (params ->> 'week_of'))
  where type = 'weekly_update' and status in ('queued','claimed','running','done');
create unique index if not exists jobs_report_draft_live on jobs ((params ->> 'project_id'))
  where type = 'report_draft' and status in ('queued','claimed','running');
create unique index if not exists jobs_referral_draft_uniq on jobs ((params ->> 'org_id'), (params ->> 'trigger'), (params ->> 'ref_id'))
  where type = 'referral_draft';

-- ===================================================================================================== updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['updates','reports','testimonials','retainers'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_updated') then
      execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated', t);
    end if;
  end loop;
end $$;

-- ===================================================================================================== helpers (no grants)
-- Monday (PKT) of the week that contains p_at.
create or replace function pkt_week_of(p_at timestamptz) returns date
language sql stable set search_path = public, pg_temp as $$
  select date_trunc('week', (coalesce(p_at, now()) at time zone 'Asia/Karachi'))::date
$$;

-- Invoice lines [{title, desc, amount}]: 1-30 lines, positive amounts with at most 2 decimals. Returns the subtotal.
create or replace function invoice_lines_subtotal(p_lines jsonb) returns numeric
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  l jsonb;
  v_sum numeric(12,2) := 0;
  v_amt numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 30 then
    raise exception 'an invoice needs 1-30 lines' using errcode = '22023';
  end if;
  for l in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l) <> 'object' or length(btrim(coalesce(l ->> 'title', ''))) not between 1 and 200
       or length(coalesce(l ->> 'desc', '')) > 1000 or coalesce(l ->> 'amount', '') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
      raise exception 'invalid invoice line' using errcode = '22023';
    end if;
    v_amt := (l ->> 'amount')::numeric;
    if v_amt <= 0 then
      raise exception 'line amounts must be above zero' using errcode = '22023';
    end if;
    v_sum := v_sum + v_amt;
  end loop;
  return v_sum;
end $$;

-- Total with the optional single tax line (rounded half away from zero, as lib/invoice-sheet.ts computeTotals).
create or replace function invoice_total(p_lines jsonb, p_tax_rate numeric) returns numeric
language sql immutable set search_path = public, pg_temp as $$
  select invoice_lines_subtotal(p_lines) + round(invoice_lines_subtotal(p_lines) * coalesce(p_tax_rate, 0) / 100, 2)
$$;

create or replace function invoice_check_fields(p_tax_label text, p_tax_rate numeric, p_currency text, p_bill_company text,
                                                p_due_date date) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_tax_rate is null or p_tax_rate < 0 or p_tax_rate > 100 then
    raise exception 'tax rate must be 0-100' using errcode = '22023';
  end if;
  if p_tax_rate > 0 and length(btrim(coalesce(p_tax_label, ''))) not between 1 and 40 then
    raise exception 'name the tax (e.g. Sales tax)' using errcode = '22023';
  end if;
  if coalesce(p_currency, '') !~ '^[A-Z]{3}$' then
    raise exception 'currency must be a 3-letter code' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_bill_company, ''))) not between 1 and 200 then
    raise exception 'bill-to company is required' using errcode = '22023';
  end if;
end $$;

-- The schedule stage a proposal-linked invoice covers: the deposit from confirm_acceptance (009) predates the column.
create or replace function invoice_stage(i invoices) returns integer
language sql stable set search_path = public, pg_temp as $$
  select case when i.kind <> 'invoice' or i.proposal_id is null then null
              else coalesce(i.schedule_stage::integer, 0) end
$$;

-- A short, fixed push to the founder (never client words), coalesced per title for 30 minutes.
create or replace function push_staff_once(p_kind text, p_title text, p_body text, p_url text, p_urgent boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from push_queue where title = left(p_title, 120) and created_at > now() - interval '30 minutes') then
    perform push_staff(p_kind, p_title, p_body, p_url, p_urgent);
  end if;
end $$;

-- ===================================================================================================== rules as triggers
create or replace function updates_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
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

-- 009's invoice guard, with the 012 columns frozen too and "paid" set once.
create or replace function invoices_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.number is not null then
      raise exception 'an issued invoice cannot be deleted; issue a credit note' using errcode = '55000';
    end if;
    return old;
  end if;
  if old.status in ('draft','approved') then
    return new;
  end if;
  if (new.org_id, new.number, new.kind, new.ref_invoice_id, new.proposal_id, new.bill_company, new.bill_contact,
      new.project_label, new.lines, new.tax_label, new.tax_rate, new.currency, new.total, new.due_date,
      new.issued_at, new.created_at, new.schedule_stage, new.credit_reason)
     is distinct from
     (old.org_id, old.number, old.kind, old.ref_invoice_id, old.proposal_id, old.bill_company, old.bill_contact,
      old.project_label, old.lines, old.tax_label, old.tax_rate, old.currency, old.total, old.due_date,
      old.issued_at, old.created_at, old.schedule_stage, old.credit_reason) then
    raise exception 'a sent invoice is immutable; issue a credit note' using errcode = '55000';
  end if;
  if new.pdf_path is distinct from old.pdf_path and old.pdf_path is not null then
    raise exception 'an invoice PDF is rendered once' using errcode = '55000';
  end if;
  if new.paid_at is distinct from old.paid_at and old.paid_at is not null then
    raise exception 'the paid date is set once' using errcode = '55000';
  end if;
  if new.status <> old.status and not (
       (old.status = 'sent'    and new.status in ('paid','overdue','void'))
    or (old.status = 'overdue' and new.status in ('paid','void'))) then
    raise exception 'invalid invoice status change % -> %', old.status, new.status using errcode = '55000';
  end if;
  return new;
end $$;

create or replace function testimonials_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception 'a withdrawn testimonial stays withdrawn; ask for a new one' using errcode = '55000';
  end if;
  if old.status = 'published' and (new.quote, new.author_name, new.author_role) is distinct from (old.quote, old.author_name, old.author_role) then
    raise exception 'a published testimonial is not edited; withdraw it and ask again' using errcode = '55000';
  end if;
  return new;
end $$;

-- Referral asks (E4): queue a referral_draft job. Best-effort; never blocks the write that fired it.
create or replace function queue_referral(p_org uuid, p_trigger text, p_ref uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from organizations o where o.id = p_org and (o.is_test or o.is_demo or o.status <> 'active')) then
    return;
  end if;
  insert into jobs (type, params, expires_at)
  values ('referral_draft', jsonb_build_object('org_id', p_org, 'trigger', p_trigger, 'ref_id', p_ref), now() + interval '14 days')
  on conflict do nothing;
end $$;

create or replace function projects_referral() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.status = 'done' and old.status is distinct from 'done' then
      perform queue_referral(new.org_id, 'project_done', new.id);
    end if;
  exception when others then
    raise warning 'projects_referral: %', sqlerrm;
  end;
  return null;
end $$;

-- The final schedule stage of a proposal was paid: the project is paid in full.
create or replace function invoices_referral() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_last integer;
begin
  begin
    if new.status = 'paid' and old.status is distinct from 'paid' and new.kind = 'invoice' and new.proposal_id is not null then
      select jsonb_array_length(schedule) - 1 into v_last from proposals where id = new.proposal_id;
      if invoice_stage(new) = v_last then
        perform queue_referral(new.org_id, 'invoice_paid', new.id);
      end if;
    end if;
  exception when others then
    raise warning 'invoices_referral: %', sqlerrm;
  end;
  return null;
end $$;

-- Founder pushes for new review work (fixed titles only, E5).
create or replace function updates_push() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.status = 'draft' and new.source = 'weekly' then
      perform push_staff_once('draft', 'Weekly updates to review', 'Open Approvals to publish or skip them.', '/approvals', false);
    end if;
  exception when others then
    raise warning 'updates_push: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function reports_push() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.status = 'draft' and new.job_id is not null then
      perform push_staff('draft', 'Delivery report draft ready', 'Open it to review and publish.', '/reports/' || new.id::text, false);
    end if;
  exception when others then
    raise warning 'reports_push: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function testimonials_push() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.status = 'client_approved' and (tg_op = 'INSERT' or old.status is distinct from 'client_approved')
       and not exists (select 1 from organizations o where o.id = new.org_id and (o.is_test or o.is_demo)) then
      perform push_staff('testimonial', 'A client approved a testimonial', 'Open Testimonials to copy it.', '/testimonials', false);
    end if;
  exception when others then
    raise warning 'testimonials_push: %', sqlerrm;
  end;
  return null;
end $$;

-- 011's approval push, with its own title for referral asks.
create or replace function push_on_approval() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_label text;
begin
  if new.status <> 'pending' then
    return null;
  end if;
  begin
    if new.kind = 'outbound' then
      if not exists (select 1 from push_queue where kind = 'draft' and created_at > now() - interval '30 minutes') then
        perform push_staff('draft', 'New drafts to approve', 'Open Approvals to review them.', '/approvals', false);
      end if;
    elsif new.kind = 'referral' then
      perform push_staff('draft', 'Referral ask to approve', 'Open Approvals to review it.', '/approvals', false);
    elsif coalesce(new.kind, 'reply') <> 'ack' then
      select t.classifier ->> 'label' into v_label from touches t where t.id = new.in_reply_to_touch_id;
      if v_label = 'inquiry' then
        perform push_staff('reply', 'Interested reply · draft ready', 'Open Approvals to answer.', '/approvals', true);
      else
        perform push_staff('reply', 'Reply draft to approve', 'Open Approvals to review it.', '/approvals', false);
      end if;
    end if;
  exception when others then
    raise warning 'push_on_approval: %', sqlerrm;
  end;
  return null;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'updates_guard') then
    create trigger updates_guard before update or delete on updates for each row execute function updates_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'reports_guard') then
    create trigger reports_guard before update or delete on reports for each row execute function reports_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'testimonials_guard') then
    create trigger testimonials_guard before update on testimonials for each row execute function testimonials_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'projects_referral') then
    create trigger projects_referral after update of status on projects for each row execute function projects_referral();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'invoices_referral') then
    create trigger invoices_referral after update of status on invoices for each row execute function invoices_referral();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'updates_push') then
    create trigger updates_push after insert on updates for each row execute function updates_push();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'reports_push') then
    create trigger reports_push after insert on reports for each row execute function reports_push();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'testimonials_push') then
    create trigger testimonials_push after insert or update of status on testimonials for each row execute function testimonials_push();
  end if;
end $$;

-- ===================================================================================================== profile
create or replace function save_my_prefs(p_timezone text, p_email_pref text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_tz text := btrim(coalesce(p_timezone, ''));
  v_pref text := btrim(coalesce(p_email_pref, ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_pref not in ('immediate','daily','off') then
    raise exception 'email preference must be immediate, daily or off' using errcode = '22023';
  end if;
  if v_tz !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$' or length(v_tz) > 64
     or not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'unknown timezone' using errcode = '22023';
  end if;
  insert into profiles (user_id, timezone, email_pref) values (auth.uid(), v_tz, v_pref)
  on conflict (user_id) do update set timezone = excluded.timezone, email_pref = excluded.email_pref, updated_at = now();
  return jsonb_build_object('timezone', v_tz, 'email_pref', v_pref);
end $$;

-- ===================================================================================================== mailer (service role)
-- One call claims everything due now and returns one entry per email to send. Each entry is finished with
-- finish_email(claim, user, ok, error). Two overlapping calls never claim the same row (skip locked + claim id).
create or replace function claim_email_batch(p_now timestamptz default null, p_limit integer default 100) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_claim uuid := gen_random_uuid();
  u record;
  v_local timestamp;
  v_date date;
  v_digest boolean;
  v_items jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  if not deck_is_service() then
    raise exception 'sender only' using errcode = '42501';
  end if;

  -- a sender that died mid-batch: its rows go back to pending (or fail after 3 attempts)
  update notifications
     set email_state = case when email_attempts >= 3 then 'failed' else null end,
         email_error = case when email_attempts >= 3 then 'claim lapsed 3 times' else email_error end,
         email_claim = null, email_claimed_at = null
   where email_state = 'claimed' and email_claimed_at < v_now - interval '10 minutes';
  update email_digests set state = 'failed', error = 'claim lapsed', claim = null
   where state = 'claimed' and claimed_at < v_now - interval '10 minutes';

  -- rows that will never be emailed are settled first, so they are never looked at again
  update notifications n
     set email_state = case when x.why = 'suppressed address' then 'suppressed' else 'skipped' end, email_error = x.why
    from (
      select n2.id,
             case
               when n2.created_at < v_now - interval '3 days' then 'stale'
               when nullif(u2.email::text, '') is null then 'no address'
               when n2.org_id is not null and (o.id is null or o.is_test or o.is_demo) then 'test or demo org'
               when n2.org_id is not null and not exists (select 1 from memberships m where m.org_id = n2.org_id and m.user_id = n2.user_id)
                 then 'no longer a member'
               when coalesce(p.email_pref, 'daily') = 'off' then 'email off'
               when is_suppressed(u2.email::text) then 'suppressed address'
             end as why
        from notifications n2
        join auth.users u2 on u2.id = n2.user_id
        left join organizations o on o.id = n2.org_id
        left join profiles p on p.user_id = n2.user_id
       where n2.email_state is null
    ) x
   where x.id = n.id and x.why is not null;

  -- only people with something due now, so people waiting for their 10:00 digest never crowd out urgent mail
  for u in
    select * from (
      select n.user_id, u2.email::text as email,
             coalesce(nullif(u2.raw_user_meta_data ->> 'full_name', ''), nullif(u2.raw_user_meta_data ->> 'name', ''), '') as name,
             coalesce(p.timezone, 'Asia/Karachi') as tz, coalesce(p.email_pref, 'daily') as pref,
             bool_or(n.urgent) as any_urgent, bool_or(not n.urgent) as any_normal, min(n.created_at) as first_at
        from notifications n
        join auth.users u2 on u2.id = n.user_id
        left join profiles p on p.user_id = n.user_id
       where n.email_state is null
       group by n.user_id, u2.email, u2.raw_user_meta_data, p.timezone, p.email_pref
    ) x
     where x.any_urgent or x.pref = 'immediate'
        or (x.pref = 'daily' and x.any_normal and (v_now at time zone x.tz)::time >= time '10:00'
            and not exists (select 1 from email_digests d
                             where d.user_id = x.user_id and d.local_date = (v_now at time zone x.tz)::date
                               and (d.state = 'sent' or (d.state = 'claimed' and d.claimed_at >= v_now - interval '10 minutes'))))
     order by x.first_at
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    v_local := v_now at time zone u.tz;
    v_date := v_local::date;
    -- the daily digest: once per local day, from 10:00, only when something non-urgent waits
    v_digest := u.pref = 'daily' and u.any_normal and v_local::time >= time '10:00'
                and not exists (select 1 from email_digests d where d.user_id = u.user_id and d.local_date = v_date
                                  and (d.state = 'sent' or (d.state = 'claimed' and d.claimed_at >= v_now - interval '10 minutes')));
    if not v_digest and not u.any_urgent and u.pref <> 'immediate' then
      continue;
    end if;
    with picked as (
      select n.id from notifications n
       where n.user_id = u.user_id and n.email_state is null
         and (v_digest or n.urgent or u.pref = 'immediate')
       order by n.created_at
       limit 50
       for update skip locked
    ), claimed as (
      update notifications n
         set email_state = 'claimed', email_claim = v_claim, email_claimed_at = v_now, email_attempts = n.email_attempts + 1
        from picked where picked.id = n.id
      returning n.*
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'kind', c.kind, 'title', c.title, 'link', c.link, 'urgent', c.urgent, 'created_at', c.created_at,
             'org_id', c.org_id, 'org_name', o.name) order by c.created_at), '[]'::jsonb)
      into v_items
      from claimed c left join organizations o on o.id = c.org_id;
    if jsonb_array_length(v_items) = 0 then
      continue;
    end if;
    if v_digest then
      insert into email_digests (user_id, local_date, state, claim, claimed_at, items, attempts)
      values (u.user_id, v_date, 'claimed', v_claim, v_now, jsonb_array_length(v_items), 1)
      on conflict (user_id, local_date) do update
        set state = 'claimed', claim = v_claim, claimed_at = v_now, items = excluded.items,
            attempts = email_digests.attempts + 1, error = null
        where email_digests.state <> 'sent';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'user_id', u.user_id, 'to', u.email, 'name', u.name, 'timezone', u.tz,
      'mode', case when v_digest then 'digest' else 'immediate' end, 'local_date', v_date, 'items', v_items));
  end loop;
  return jsonb_build_object('claim', v_claim, 'emails', v_out);
end $$;

create or replace function finish_email(p_claim uuid, p_user_id uuid, p_ok boolean, p_error text default null) returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  if not deck_is_service() then
    raise exception 'sender only' using errcode = '42501';
  end if;
  if coalesce(p_ok, false) then
    update notifications set email_state = 'sent', emailed_at = coalesce(emailed_at, now()), email_error = null,
                             email_claim = null, email_claimed_at = null
     where email_claim = p_claim and user_id = p_user_id and email_state = 'claimed';
    get diagnostics v_n = row_count;
    update email_digests set state = 'sent', sent_at = now(), claim = null
     where claim = p_claim and user_id = p_user_id and state = 'claimed';
  else
    update notifications
       set email_state = case when email_attempts >= 3 then 'failed' else null end,
           email_error = left(coalesce(p_error, 'send failed'), 300), email_claim = null, email_claimed_at = null
     where email_claim = p_claim and user_id = p_user_id and email_state = 'claimed';
    get diagnostics v_n = row_count;
    update email_digests set state = 'failed', error = left(coalesce(p_error, 'send failed'), 300), claim = null
     where claim = p_claim and user_id = p_user_id and state = 'claimed';
  end if;
  return v_n;
end $$;

-- ===================================================================================================== updates (E2)
-- The worker (or staff, for a manual post) writes a draft. A weekly draft is one per project per week: a re-run of the
-- same job refreshes a draft nobody has edited and never touches one the founder edited, published or skipped.
create or replace function save_update_draft(p_project_id uuid, p_title text, p_body_md text, p_source text default 'manual',
                                             p_week_of date default null, p_inputs jsonb default null, p_lint jsonb default null,
                                             p_job_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  u updates;
  v_title text := btrim(coalesce(p_title, ''));
  v_source text := coalesce(nullif(btrim(p_source), ''), 'manual');
begin
  select org_id into v_org from projects where id = p_project_id;
  if v_org is null or not platform_is_operator_for(v_org) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if v_source not in ('weekly','manual') then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  if v_source = 'weekly' and p_week_of is null then
    raise exception 'a weekly update needs its week' using errcode = '22023';
  end if;
  if length(v_title) not between 1 and 200 or length(coalesce(p_body_md, '')) > 20000 then
    raise exception 'title 1-200 characters, body at most 20000' using errcode = '22023';
  end if;
  if v_source = 'weekly' then
    select * into u from updates where project_id = p_project_id and week_of = p_week_of and source = 'weekly' for update;
    if u.id is not null then
      if u.status = 'draft' and u.edited_at is null then
        update updates set title = v_title, body_md = coalesce(p_body_md, ''), inputs = p_inputs, lint = p_lint,
                           job_id = coalesce(p_job_id, job_id)
         where id = u.id;
        return jsonb_build_object('id', u.id, 'state', 'refreshed');
      end if;
      return jsonb_build_object('id', u.id, 'state', 'kept');
    end if;
  end if;
  insert into updates (org_id, project_id, title, body_md, source, week_of, inputs, lint, job_id, created_by)
  values (v_org, p_project_id, v_title, coalesce(p_body_md, ''), v_source, case when v_source = 'weekly' then p_week_of end,
          p_inputs, p_lint, p_job_id, auth.uid())
  returning * into u;
  perform deal_room_audit('update_drafted', 'updates', u.id::text, jsonb_build_object('project_id', p_project_id, 'source', v_source));
  return jsonb_build_object('id', u.id, 'state', 'created');
end $$;

create or replace function edit_update(p_id uuid, p_title text, p_body_md text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  u updates;
begin
  select * into u from updates where id = p_id for update;
  if u.id is null or not platform_is_operator_for(u.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if u.status <> 'draft' then
    raise exception 'only a draft can be edited' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 200 or length(coalesce(p_body_md, '')) > 20000 then
    raise exception 'title 1-200 characters, body at most 20000' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_body_md, ''))) = 0 then
    raise exception 'the update is empty' using errcode = '22023';
  end if;
  update updates set title = btrim(p_title), body_md = p_body_md, edited_at = now(), lint = null where id = p_id;
  perform deal_room_audit('update_edited', 'updates', p_id::text, null);
end $$;

-- F13: AI-written wording reaches the client only through this, by the founder. Idempotent.
create or replace function publish_update(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  u updates;
  v_project text;
begin
  select * into u from updates where id = p_id for update;
  if u.id is null or not platform_is_operator_for(u.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if u.status = 'published' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if u.status <> 'draft' then
    raise exception 'a skipped update cannot be published' using errcode = '55000';
  end if;
  if length(btrim(u.body_md)) = 0 then
    raise exception 'the update is empty' using errcode = '22023';
  end if;
  update updates set status = 'published', published_at = now(), published_by = auth.uid() where id = p_id;
  select name into v_project from projects where id = u.project_id;
  perform notify_org(u.org_id, 'update', 'Update · ' || coalesce(v_project, 'your project') || ': ' || u.title,
                     '/updates', false, null, 'update:' || u.id::text);
  perform deal_room_audit('update_published', 'updates', p_id::text, jsonb_build_object('project_id', u.project_id));
  return jsonb_build_object('ok', true, 'already', false);
end $$;

create or replace function skip_update(p_id uuid, p_reason text default null) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  u updates;
begin
  select * into u from updates where id = p_id for update;
  if u.id is null or not platform_is_operator_for(u.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if u.status = 'skipped' then
    return;
  end if;
  if u.status <> 'draft' then
    raise exception 'a published update cannot be skipped' using errcode = '55000';
  end if;
  update updates set status = 'skipped', skipped_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '') where id = p_id;
  perform deal_room_audit('update_skipped', 'updates', p_id::text, null);
end $$;

-- Staff "Draft now" for one project (this week, optional notes for the drafter). One live job per project and week.
create or replace function queue_weekly_update(p_project_id uuid, p_notes text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_week date := pkt_week_of(now());
  v_id uuid;
  v_params jsonb;
begin
  select org_id into v_org from projects where id = p_project_id;
  if v_org is null or not platform_is_operator_for(v_org) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'notes are at most 2000 characters' using errcode = '22023';
  end if;
  select id into v_id from jobs where type = 'weekly_update' and params ->> 'project_id' = p_project_id::text
     and params ->> 'week_of' = v_week::text and status in ('queued','claimed','running') limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'id', v_id, 'already', true);
  end if;
  -- a finished job for this week is replaced by the new request (the draft itself is kept if it was edited)
  update jobs set status = 'expired', error = 'superseded by a new request'
   where type = 'weekly_update' and params ->> 'project_id' = p_project_id::text and params ->> 'week_of' = v_week::text
     and status = 'done';
  v_params := jsonb_build_object('project_id', p_project_id, 'week_of', v_week)
              || case when nullif(btrim(coalesce(p_notes, '')), '') is null then '{}'::jsonb
                      else jsonb_build_object('notes', btrim(p_notes)) end;
  insert into jobs (type, params, expires_at, requested_by) values ('weekly_update', v_params, now() + interval '2 days', auth.uid())
  returning id into v_id;
  perform deal_room_audit('weekly_update_queued', 'jobs', v_id::text, jsonb_build_object('project_id', p_project_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'already', false);
end $$;

-- The Mac's Friday 15:00 PKT run: one job per active project of an active client org, once per week.
create or replace function queue_weekly_updates(p_week_of date default null) returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_week date := coalesce(p_week_of, pkt_week_of(now()));
  v_n integer;
begin
  if not deck_is_service() then
    raise exception 'worker only' using errcode = '42501';
  end if;
  insert into jobs (type, params, expires_at)
  select 'weekly_update', jsonb_build_object('project_id', p.id, 'week_of', v_week), now() + interval '2 days'
    from projects p join organizations o on o.id = p.org_id
   where p.status = 'active' and o.status = 'active' and not o.is_test and not o.is_demo
     and not exists (select 1 from updates u where u.project_id = p.id and u.week_of = v_week and u.source = 'weekly')
     and not exists (select 1 from jobs j where j.type = 'weekly_update' and j.params ->> 'project_id' = p.id::text
                       and j.params ->> 'week_of' = v_week::text)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ===================================================================================================== reports
create or replace function save_report_draft(p_id uuid, p_project_id uuid, p_title text, p_period_label text, p_content jsonb,
                                             p_job_id uuid default null) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r reports;
  v_org uuid;
  v_id uuid := p_id;
begin
  if p_id is not null then
    select * into r from reports where id = p_id for update;
    v_org := r.org_id;
  else
    select org_id into v_org from projects where id = p_project_id;
  end if;
  if v_org is null or not platform_is_operator_for(v_org) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 200 or length(coalesce(p_period_label, '')) > 80 then
    raise exception 'title 1-200 characters, period at most 80' using errcode = '22023';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' or length(p_content::text) > 200000 then
    raise exception 'report content must be a JSON object under 200 kB' using errcode = '22023';
  end if;
  if p_id is null then
    insert into reports (org_id, project_id, title, period_label, content, job_id, created_by)
    values (v_org, p_project_id, btrim(p_title), coalesce(p_period_label, ''), p_content, p_job_id, auth.uid())
    returning id into v_id;
    perform deal_room_audit('report_drafted', 'reports', v_id::text, jsonb_build_object('project_id', p_project_id));
  else
    if r.status not in ('draft','approved') then
      raise exception 'a published report is frozen' using errcode = '55000';
    end if;
    -- any edit sends an approved report back to draft: approval is of the exact content
    update reports set title = btrim(p_title), period_label = coalesce(p_period_label, ''), content = p_content,
                       status = 'draft', approved_at = null, edited_at = case when auth.uid() is not null then now() else edited_at end
     where id = p_id;
    perform deal_room_audit('report_edited', 'reports', p_id::text, null);
  end if;
  return v_id;
end $$;

create or replace function approve_report(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r reports;
begin
  select * into r from reports where id = p_id for update;
  if r.id is null or not platform_is_operator_for(r.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if r.status in ('approved','published') then
    return;
  end if;
  if r.status <> 'draft' then
    raise exception 'only a draft can be approved' using errcode = '55000';
  end if;
  if coalesce(jsonb_typeof(r.content -> 'summary'), '') <> 'array' or jsonb_array_length(r.content -> 'summary') = 0
     or coalesce(jsonb_typeof(r.content -> 'sections'), '') <> 'array' then
    raise exception 'the report needs a summary and sections' using errcode = '22023';
  end if;
  update reports set status = 'approved', approved_at = now() where id = p_id;
  perform deal_room_audit('report_approved', 'reports', p_id::text, null);
end $$;

-- Service role only, after the PDF is stored (F15: an issued document never changes; a failed render leaves it approved).
create or replace function mark_report_published(p_id uuid, p_pdf_path text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r reports;
  v_project text;
begin
  if not deck_is_service() then
    raise exception 'publisher only' using errcode = '42501';
  end if;
  select * into r from reports where id = p_id for update;
  if r.id is null then
    raise exception 'report not found' using errcode = '22023';
  end if;
  if r.status = 'published' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if r.status <> 'approved' then
    raise exception 'only an approved report can be published' using errcode = '55000';
  end if;
  if p_pdf_path is distinct from (r.org_id::text || '/' || r.id::text || '.pdf') then
    raise exception 'unexpected PDF path' using errcode = '22023';
  end if;
  update reports set status = 'published', pdf_path = p_pdf_path, pdf_error = null, published_at = now() where id = p_id;
  select name into v_project from projects where id = r.project_id;
  perform notify_org(r.org_id, 'report', 'Report published · ' || r.title, '/reports/' || r.id::text, true, null,
                     'report:' || r.id::text);
  perform deal_room_audit('report_published', 'reports', p_id::text, jsonb_build_object('project', v_project));
  return jsonb_build_object('ok', true, 'already', false);
end $$;

create or replace function void_report(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r reports;
begin
  select * into r from reports where id = p_id for update;
  if r.id is null or not platform_is_operator_for(r.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if r.status = 'void' then
    return;
  end if;
  update reports set status = 'void' where id = p_id;
  perform deal_room_audit('report_voided', 'reports', p_id::text, jsonb_build_object('was', r.status));
end $$;

create or replace function queue_report_draft(p_project_id uuid, p_period_start date, p_period_end date, p_notes text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select org_id into v_org from projects where id = p_project_id;
  if v_org is null or not platform_is_operator_for(v_org) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start or p_period_end - p_period_start > 400 then
    raise exception 'pick a period of at most 400 days' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 4000 then
    raise exception 'notes are at most 4000 characters' using errcode = '22023';
  end if;
  select id into v_id from jobs where type = 'report_draft' and params ->> 'project_id' = p_project_id::text
     and status in ('queued','claimed','running') limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'id', v_id, 'already', true);
  end if;
  insert into jobs (type, params, expires_at, requested_by)
  values ('report_draft', jsonb_build_object('project_id', p_project_id, 'period_start', p_period_start, 'period_end', p_period_end)
                          || case when nullif(btrim(coalesce(p_notes, '')), '') is null then '{}'::jsonb
                                  else jsonb_build_object('notes', btrim(p_notes)) end,
          now() + interval '2 days', auth.uid())
  returning id into v_id;
  perform deal_room_audit('report_draft_queued', 'jobs', v_id::text, jsonb_build_object('project_id', p_project_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'already', false);
end $$;

-- ===================================================================================================== invoices
create or replace function create_invoice_draft(p_org_id uuid, p_bill_company text, p_bill_contact text, p_project_label text,
                                                p_lines jsonb, p_tax_label text, p_tax_rate numeric, p_currency text,
                                                p_due_date date) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_total numeric(12,2);
begin
  if not platform_is_operator_for(p_org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if not exists (select 1 from organizations where id = p_org_id and status = 'active' and not is_demo) then
    raise exception 'organisation not found or read-only' using errcode = '22023';
  end if;
  perform invoice_check_fields(p_tax_label, coalesce(p_tax_rate, 0), p_currency, p_bill_company, p_due_date);
  v_total := invoice_total(p_lines, coalesce(p_tax_rate, 0));
  insert into invoices (org_id, kind, bill_company, bill_contact, project_label, lines, tax_label, tax_rate, currency, total,
                        due_date, status)
  values (p_org_id, 'invoice', btrim(p_bill_company), left(btrim(coalesce(p_bill_contact, '')), 200),
          left(btrim(coalesce(p_project_label, '')), 200), p_lines, nullif(btrim(coalesce(p_tax_label, '')), ''),
          coalesce(p_tax_rate, 0), p_currency, v_total, p_due_date, 'draft')
  returning id into v_id;
  perform deal_room_audit('invoice_drafted', 'invoices', v_id::text, jsonb_build_object('org_id', p_org_id, 'total', v_total));
  return v_id;
end $$;

-- A milestone / final invoice from an accepted proposal's payment schedule. The last stage takes the rounding remainder,
-- so the stages always add up to the proposal total. One live invoice per stage.
create or replace function invoice_from_schedule(p_proposal_id uuid, p_stage integer, p_due_date date default null) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  p proposals;
  v_n integer;
  v_stage jsonb;
  v_amount numeric(12,2);
  v_id uuid;
  v_kind text;
begin
  select * into p from proposals where id = p_proposal_id for update;
  if p.id is null or p.org_id is null or not platform_is_operator_for(p.org_id) then
    raise exception 'accepted proposal not found' using errcode = '42501';
  end if;
  if p.status <> 'accepted' then
    raise exception 'only an accepted proposal has a payment schedule to invoice' using errcode = '55000';
  end if;
  v_n := jsonb_array_length(p.schedule);
  if p_stage is null or p_stage < 0 or p_stage >= v_n then
    raise exception 'no such schedule stage' using errcode = '22023';
  end if;
  if exists (select 1 from invoices i where i.proposal_id = p.id and i.status <> 'void' and invoice_stage(i) = p_stage) then
    raise exception 'that stage is already invoiced' using errcode = '55000';
  end if;
  v_stage := p.schedule -> p_stage;
  if p_stage = v_n - 1 then
    select p.total - coalesce(sum(round(p.total * (s.value ->> 'pct')::integer / 100.0, 2)), 0) into v_amount
      from jsonb_array_elements(p.schedule) with ordinality s(value, ord) where s.ord <= v_n - 1;
  else
    v_amount := round(p.total * (v_stage ->> 'pct')::integer / 100.0, 2);
  end if;
  v_kind := case when p_stage = 0 then 'Deposit' when p_stage = v_n - 1 then 'Final payment' else 'Milestone payment' end;
  insert into invoices (org_id, kind, proposal_id, schedule_stage, bill_company, bill_contact, project_label, lines, tax_rate,
                        currency, total, due_date, status)
  values (p.org_id, 'invoice', p.id, p_stage, left(p.client_company, 200), left(p.contact_name, 200), left(p.title, 200),
          jsonb_build_array(jsonb_build_object(
            'title', v_kind || ' · ' || (v_stage ->> 'pct') || '% ' || lower(v_stage ->> 'label'),
            'desc', p.title || ' · proposal v' || p.version || '. Total ' || p.currency || ' ' ||
                    to_char(p.total, 'FM999,999,999,990.00') || ', stage ' || (p_stage + 1) || ' of ' || v_n || '.',
            'amount', v_amount)),
          0, p.currency, v_amount, p_due_date, 'draft')
  returning id into v_id;
  perform deal_room_audit('invoice_drafted', 'invoices', v_id::text,
                          jsonb_build_object('org_id', p.org_id, 'proposal_id', p.id, 'stage', p_stage, 'total', v_amount));
  return v_id;
end $$;

create or replace function update_invoice_draft(p_id uuid, p_bill_company text, p_bill_contact text, p_project_label text,
                                                p_lines jsonb, p_tax_label text, p_tax_rate numeric, p_currency text,
                                                p_due_date date) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  i invoices;
  v_total numeric(12,2);
begin
  select * into i from invoices where id = p_id for update;
  if i.id is null or not platform_is_operator_for(i.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if i.status not in ('draft','approved') then
    raise exception 'a sent invoice is immutable; issue a credit note' using errcode = '55000';
  end if;
  perform invoice_check_fields(p_tax_label, coalesce(p_tax_rate, 0), p_currency, p_bill_company, p_due_date);
  v_total := invoice_total(p_lines, coalesce(p_tax_rate, 0));
  if i.kind = 'credit_note' and v_total > (select r.total - coalesce((select sum(c.total) from invoices c
                                                 where c.ref_invoice_id = r.id and c.kind = 'credit_note' and c.status <> 'void'
                                                   and c.id <> i.id), 0)
                                           from invoices r where r.id = i.ref_invoice_id) then
    raise exception 'a credit note cannot exceed what is left of the invoice' using errcode = '22023';
  end if;
  update invoices set bill_company = btrim(p_bill_company), bill_contact = left(btrim(coalesce(p_bill_contact, '')), 200),
                      project_label = left(btrim(coalesce(p_project_label, '')), 200), lines = p_lines,
                      tax_label = nullif(btrim(coalesce(p_tax_label, '')), ''), tax_rate = coalesce(p_tax_rate, 0),
                      currency = case when i.kind = 'credit_note' then i.currency else p_currency end,
                      total = v_total, due_date = p_due_date, status = 'draft', approved_at = null
   where id = p_id;
  perform deal_room_audit('invoice_edited', 'invoices', p_id::text, jsonb_build_object('total', v_total));
end $$;

create or replace function approve_invoice(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  i invoices;
begin
  select * into i from invoices where id = p_id for update;
  if i.id is null or not platform_is_operator_for(i.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if i.status = 'approved' then
    return;
  end if;
  if i.status <> 'draft' then
    raise exception 'only a draft can be approved' using errcode = '55000';
  end if;
  if invoice_total(i.lines, i.tax_rate) <> i.total or i.total <= 0 then
    raise exception 'the invoice total does not match its lines' using errcode = '22023';
  end if;
  update invoices set status = 'approved', approved_at = now() where id = p_id;
  perform deal_room_audit('invoice_approved', 'invoices', p_id::text, jsonb_build_object('total', i.total));
end $$;

-- approved -> sent. The invoices_number trigger assigns EL-YYYY-NNN; invoices_notify tells the org (urgent: emailed now).
create or replace function issue_invoice(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  i invoices;
begin
  select * into i from invoices where id = p_id for update;
  if i.id is null or not platform_is_operator_for(i.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if i.status in ('sent','paid','overdue') then
    return jsonb_build_object('number', i.number, 'already', true);
  end if;
  if i.status <> 'approved' then
    raise exception 'approve the invoice first' using errcode = '55000';
  end if;
  update invoices
     set status = 'sent', issued_at = now(),
         due_date = case when kind = 'invoice' then coalesce(due_date, (now() at time zone 'Asia/Karachi')::date + 14) else due_date end
   where id = p_id
  returning * into i;
  perform deal_room_audit('invoice_issued', 'invoices', p_id::text, jsonb_build_object('number', i.number, 'total', i.total));
  return jsonb_build_object('number', i.number, 'already', false);
end $$;

create or replace function mark_invoice_paid(p_id uuid, p_paid_on date) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  i invoices;
begin
  select * into i from invoices where id = p_id for update;
  if i.id is null or not platform_is_operator_for(i.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if i.kind <> 'invoice' then
    raise exception 'a credit note is not paid' using errcode = '55000';
  end if;
  if i.status = 'paid' then
    return;
  end if;
  if i.status not in ('sent','overdue') then
    raise exception 'only an issued invoice can be marked paid' using errcode = '55000';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Karachi')::date
     or p_paid_on < (i.issued_at at time zone 'Asia/Karachi')::date - 1 then
    raise exception 'the paid date must be between the issue date and today' using errcode = '22023';
  end if;
  update invoices set status = 'paid', paid_at = (p_paid_on::timestamp + time '12:00') at time zone 'Asia/Karachi' where id = p_id;
  perform deal_room_audit('invoice_paid', 'invoices', p_id::text, jsonb_build_object('paid_on', p_paid_on, 'total', i.total));
end $$;

create or replace function void_invoice(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  i invoices;
begin
  select * into i from invoices where id = p_id for update;
  if i.id is null or not platform_is_operator_for(i.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if i.status = 'void' then
    return;
  end if;
  if i.status not in ('draft','approved') then
    raise exception 'an issued invoice is corrected with a credit note' using errcode = '55000';
  end if;
  update invoices set status = 'void' where id = p_id;
  perform deal_room_audit('invoice_voided', 'invoices', p_id::text, null);
end $$;

-- A draft credit note against an issued invoice: same org, client and currency; never more than what is left.
create or replace function create_credit_note(p_invoice_id uuid, p_lines jsonb, p_reason text) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r invoices;
  v_total numeric(12,2);
  v_left numeric(12,2);
  v_id uuid;
begin
  select * into r from invoices where id = p_invoice_id for update;
  if r.id is null or not platform_is_operator_for(r.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if r.kind <> 'invoice' or r.status not in ('sent','paid','overdue') then
    raise exception 'credit notes reference an issued invoice' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'give the reason for the credit (3-500 characters)' using errcode = '22023';
  end if;
  v_total := invoice_total(p_lines, r.tax_rate);
  select r.total - coalesce(sum(c.total), 0) into v_left
    from invoices c where c.ref_invoice_id = r.id and c.kind = 'credit_note' and c.status <> 'void';
  if v_total > v_left then
    raise exception 'a credit note cannot exceed what is left of the invoice (% %)', r.currency, v_left using errcode = '22023';
  end if;
  insert into invoices (org_id, kind, ref_invoice_id, proposal_id, bill_company, bill_contact, project_label, lines, tax_label,
                        tax_rate, currency, total, status, credit_reason)
  values (r.org_id, 'credit_note', r.id, r.proposal_id, r.bill_company, r.bill_contact,
          left('Credit for ' || r.number || case when r.project_label <> '' then ' · ' || r.project_label else '' end, 200),
          p_lines, r.tax_label, r.tax_rate, r.currency, v_total, 'draft', btrim(p_reason))
  returning id into v_id;
  perform deal_room_audit('credit_note_drafted', 'invoices', v_id::text, jsonb_build_object('ref', r.number, 'total', v_total));
  return v_id;
end $$;

-- Cron (the hosted comms route, every 5 minutes): sent invoices past their due date (PKT) become overdue. Idempotent.
create or replace function mark_overdue_invoices(p_today date default null) returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  i record;
  v_n integer := 0;
begin
  if not (deal_room_is_operator()) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_today is not null and deck_is_service() then
    v_today := p_today;
  end if;
  for i in
    update invoices set status = 'overdue'
     where status = 'sent' and kind = 'invoice' and due_date is not null and due_date < v_today
    returning id, number, org_id
  loop
    v_n := v_n + 1;
    perform deal_room_audit('invoice_overdue', 'invoices', i.id::text, jsonb_build_object('number', i.number));
    begin
      if not exists (select 1 from organizations o where o.id = i.org_id and (o.is_test or o.is_demo)) then
        perform push_staff('invoice', 'Invoice ' || i.number || ' is overdue', null, '/invoices/' || i.id::text, false);
      end if;
    exception when others then
      raise warning 'overdue push: %', sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

-- ===================================================================================================== testimonials
create or replace function request_testimonial(p_org_id uuid, p_project_id uuid, p_suggested text default null) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not platform_is_operator_for(p_org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_project_id is not null and not exists (select 1 from projects where id = p_project_id and org_id = p_org_id) then
    raise exception 'project not found' using errcode = '22023';
  end if;
  if length(coalesce(p_suggested, '')) > 1200 then
    raise exception 'suggested wording is at most 1200 characters' using errcode = '22023';
  end if;
  if exists (select 1 from testimonials where org_id = p_org_id and status = 'requested') then
    raise exception 'there is already an open request for this client' using errcode = '55000';
  end if;
  insert into testimonials (org_id, project_id, quote, status, requested_by)
  values (p_org_id, p_project_id, coalesce(btrim(p_suggested), ''), 'requested', auth.uid())
  returning id into v_id;
  perform notify_org(p_org_id, 'testimonial', 'Ehab asked for a short testimonial', '/testimonial', false, null,
                     'testimonial:' || v_id::text);
  perform deal_room_audit('testimonial_requested', 'testimonials', v_id::text, jsonb_build_object('org_id', p_org_id));
  return v_id;
end $$;

-- A member writes or approves the wording (p_id: the open request; null: their own, unprompted). Approval is consent to
-- quote it with the name and role given.
create or replace function submit_testimonial(p_id uuid, p_org_id uuid, p_quote text, p_author_name text, p_author_role text)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t testimonials;
  v_org uuid := p_org_id;
  v_quote text := btrim(coalesce(p_quote, ''));
  v_name text := btrim(coalesce(p_author_name, ''));
  v_role text := btrim(coalesce(p_author_role, ''));
  v_id uuid := p_id;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_id is not null then
    select * into t from testimonials where id = p_id for update;
    v_org := t.org_id;
  end if;
  if v_org is null or not is_member(v_org) then
    raise exception 'not found' using errcode = '42501';
  end if;
  if exists (select 1 from organizations o where o.id = v_org and (o.is_demo or o.status <> 'active')) then
    raise exception 'this organisation is read-only' using errcode = '22023';
  end if;
  if length(v_quote) not between 10 and 1200 then
    raise exception 'the testimonial is 10-1200 characters' using errcode = '22023';
  end if;
  if length(v_name) not between 2 and 120 or length(v_role) > 120 then
    raise exception 'give your name (and optionally your role)' using errcode = '22023';
  end if;
  if p_id is null then
    if (select count(*) from testimonials where org_id = v_org and created_at > now() - interval '1 day') >= 5 then
      raise exception 'too many testimonials today' using errcode = '22023';
    end if;
    insert into testimonials (org_id, quote, author_name, author_role, status, approved_by, approved_at)
    values (v_org, v_quote, v_name, v_role, 'client_approved', auth.uid(), now())
    returning id into v_id;
  else
    if t.status not in ('requested','client_approved') then
      raise exception 'this testimonial can no longer be changed' using errcode = '55000';
    end if;
    update testimonials set quote = v_quote, author_name = v_name, author_role = v_role, status = 'client_approved',
                            approved_by = auth.uid(), approved_at = now()
     where id = p_id;
  end if;
  perform deal_room_audit('testimonial_approved', 'testimonials', v_id::text, jsonb_build_object('org_id', v_org));
  return v_id;
end $$;

create or replace function withdraw_testimonial(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t testimonials;
begin
  select * into t from testimonials where id = p_id for update;
  if t.id is null or not (is_member(t.org_id) or platform_is_operator_for(t.org_id)) then
    raise exception 'not found' using errcode = '42501';
  end if;
  if t.status = 'withdrawn' then
    return;
  end if;
  update testimonials set status = 'withdrawn' where id = p_id;
  perform deal_room_audit('testimonial_withdrawn', 'testimonials', p_id::text, jsonb_build_object('was', t.status));
  if t.status = 'published' then
    perform push_staff('testimonial', 'A published testimonial was withdrawn', 'Remove it from epsilon-labs.co.', '/testimonials', true);
  end if;
end $$;

-- Bookkeeping only: the founder put it on the website by hand (nothing edits the site automatically).
create or replace function mark_testimonial_published(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t testimonials;
begin
  select * into t from testimonials where id = p_id for update;
  if t.id is null or not platform_is_operator_for(t.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if t.status = 'published' then
    return;
  end if;
  if t.status <> 'client_approved' then
    raise exception 'only a client-approved testimonial can be published' using errcode = '55000';
  end if;
  update testimonials set status = 'published', published_at = now() where id = p_id;
  perform deal_room_audit('testimonial_published', 'testimonials', p_id::text, null);
end $$;

-- ===================================================================================================== retainers (E6)
create or replace function save_retainer(p_id uuid, p_org_id uuid, p_tier text, p_hours_included numeric, p_starts_on date,
                                         p_ends_on date, p_status text) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := p_org_id;
  v_id uuid := p_id;
begin
  if p_id is not null then
    select org_id into v_org from retainers where id = p_id;
  end if;
  if v_org is null or not platform_is_operator_for(v_org) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if coalesce(p_tier, '') not in ('r10','r20','r40','custom') then
    raise exception 'invalid tier' using errcode = '22023';
  end if;
  if p_hours_included is null or p_hours_included <= 0 or p_hours_included > 744 then
    raise exception 'hours included must be above 0' using errcode = '22023';
  end if;
  if coalesce(p_status, '') not in ('active','paused','ended') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_starts_on is null or (p_ends_on is not null and p_ends_on < p_starts_on) then
    raise exception 'check the start and end dates' using errcode = '22023';
  end if;
  if p_status = 'active' and exists (select 1 from retainers where org_id = v_org and status = 'active' and id is distinct from p_id) then
    raise exception 'this client already has an active retainer; end it first' using errcode = '55000';
  end if;
  if p_id is null then
    insert into retainers (org_id, tier, hours_included, starts_on, ends_on, status)
    values (v_org, p_tier, p_hours_included, p_starts_on, p_ends_on, p_status) returning id into v_id;
  else
    update retainers set tier = p_tier, hours_included = p_hours_included, starts_on = p_starts_on, ends_on = p_ends_on,
                         status = p_status where id = p_id;
  end if;
  perform deal_room_audit('retainer_saved', 'retainers', v_id::text,
                          jsonb_build_object('org_id', v_org, 'tier', p_tier, 'hours', p_hours_included, 'status', p_status));
  return v_id;
end $$;

create or replace function log_time(p_org_id uuid, p_ticket_id uuid, p_minutes integer, p_note text, p_billable boolean,
                                    p_worked_on date) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := p_org_id;
  v_id uuid;
begin
  if p_ticket_id is not null then
    select org_id into v_org from tickets where id = p_ticket_id;
    if p_org_id is not null and v_org is distinct from p_org_id then
      v_org := null;
    end if;
  end if;
  if v_org is null or not platform_is_operator_for(v_org) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes not between 1 and 1440 then
    raise exception 'minutes must be 1-1440' using errcode = '22023';
  end if;
  if length(coalesce(p_note, '')) > 500 then
    raise exception 'the note is at most 500 characters' using errcode = '22023';
  end if;
  if p_worked_on is not null and p_worked_on > (now() at time zone 'Asia/Karachi')::date then
    raise exception 'time cannot be logged in the future' using errcode = '22023';
  end if;
  insert into time_entries (org_id, ticket_id, minutes, note, billable, worked_on, logged_by)
  values (v_org, p_ticket_id, p_minutes, btrim(coalesce(p_note, '')), coalesce(p_billable, true),
          coalesce(p_worked_on, (now() at time zone 'Asia/Karachi')::date), auth.uid())
  returning id into v_id;
  perform deal_room_audit('time_logged', 'time_entries', v_id::text,
                          jsonb_build_object('org_id', v_org, 'ticket_id', p_ticket_id, 'minutes', p_minutes));
  return v_id;
end $$;

create or replace function delete_time_entry(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  e time_entries;
begin
  select * into e from time_entries where id = p_id for update;
  if e.id is null or not platform_is_operator_for(e.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  delete from time_entries where id = p_id;
  perform deal_room_audit('time_deleted', 'time_entries', p_id::text, jsonb_build_object('org_id', e.org_id, 'minutes', e.minutes));
end $$;

-- Hours used vs included per calendar month (PKT), newest first, for the months a retainer covered. Billable time only.
-- upsell (staff only; null for clients): above 85% in at least 2 of the last 3 periods. Overage is shown, never billed.
create or replace function retainer_usage(p_org_id uuid, p_months integer default 6, p_today date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_staff boolean := platform_is_operator_for(p_org_id);
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Karachi')::date);
  v_cur date := date_trunc('month', v_today)::date;
  r retainers;
  v_periods jsonb;
  v_over integer;
begin
  if not (is_member(p_org_id) or v_staff) then
    raise exception 'organisation not found' using errcode = '42501';
  end if;
  select * into r from retainers where org_id = p_org_id and status in ('active','paused')
   order by (status = 'active') desc, starts_on desc limit 1;
  if r.id is null then
    select * into r from retainers where org_id = p_org_id order by starts_on desc limit 1;
  end if;
  if r.id is null then
    return jsonb_build_object('retainer', null, 'periods', '[]'::jsonb, 'upsell', case when v_staff then false end, 'over_85', 0);
  end if;
  with months as (
    select (v_cur - make_interval(months => g))::date as m
      from generate_series(0, greatest(1, least(coalesce(p_months, 6), 36)) - 1) g
  ), cover as (
    select m.m,
           (select x.hours_included from retainers x
             where x.org_id = p_org_id and x.starts_on <= (m.m + interval '1 month' - interval '1 day')::date
               and (x.ends_on is null or x.ends_on >= m.m)
             order by x.starts_on desc limit 1) as hours
      from months m
  ), used as (
    select c.m, c.hours,
           coalesce((select sum(t.minutes) from time_entries t
                      where t.org_id = p_org_id and t.billable and t.worked_on >= c.m
                        and t.worked_on < (c.m + interval '1 month')::date), 0)::integer as minutes
      from cover c where c.hours is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'period', to_char(u.m, 'YYYY-MM'), 'starts_on', u.m, 'current', u.m = v_cur,
           'included_minutes', (u.hours * 60)::integer, 'used_minutes', u.minutes,
           'pct', round(u.minutes * 100.0 / (u.hours * 60), 1)) order by u.m desc), '[]'::jsonb)
    into v_periods from used u;
  select count(*) into v_over
    from (select value from jsonb_array_elements(v_periods) limit 3) last3
   where (value ->> 'pct')::numeric > 85;
  return jsonb_build_object(
    'retainer', jsonb_build_object('id', r.id, 'tier', r.tier, 'hours_included', r.hours_included, 'period', r.period,
                                   'starts_on', r.starts_on, 'ends_on', r.ends_on, 'status', r.status),
    'periods', v_periods,
    'over_85', v_over,
    'upsell', case when v_staff then v_over >= 2 end);
end $$;

-- ===================================================================================================== RLS
alter table profiles      enable row level security;
alter table email_digests enable row level security;
alter table updates       enable row level security;
alter table reports       enable row level security;
alter table testimonials  enable row level security;
alter table retainers     enable row level security;
alter table time_entries  enable row level security;

do $$
declare
  p record;
  t text;
begin
  for p in
    select * from (values
      ('profiles',      'own_read',   'user_id = (select auth.uid())'),
      ('email_digests', 'staff_read', '(select is_staff())'),
      ('updates',       'org_read',   '(status = ''published'' and is_member(org_id)) or is_staff_for(org_id)'),
      ('reports',       'org_read',   '(status = ''published'' and is_member(org_id)) or is_staff_for(org_id)'),
      ('testimonials',  'org_read',   'is_member(org_id) or is_staff_for(org_id)'),
      ('retainers',     'org_read',   'is_member(org_id) or is_staff_for(org_id)'),
      ('time_entries',  'org_read',   '(billable and is_member(org_id)) or is_staff_for(org_id)')
    ) as v(tbl, name, expr)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on %I for select to authenticated using (%s)', p.name, p.tbl, p.expr);
    end if;
  end loop;
  foreach t in array array['profiles','email_digests','updates','reports','testimonials','retainers','time_entries'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'service_role_all') then
      execute format('create policy service_role_all on %I for all to service_role using (true) with check (true)', t);
    end if;
  end loop;
end $$;

-- Grants: anon nothing; authenticated select only (RLS decides rows); writes only through the RPCs ---------------------
revoke all on profiles, email_digests, updates, reports, testimonials, retainers, time_entries from public, anon, authenticated;
grant select on profiles, email_digests, updates, reports, testimonials, retainers, time_entries to authenticated;
grant all on profiles, email_digests, updates, reports, testimonials, retainers, time_entries to service_role;

revoke all on function
  pkt_week_of(timestamptz), invoice_lines_subtotal(jsonb), invoice_total(jsonb, numeric),
  invoice_check_fields(text, numeric, text, text, date), invoice_stage(invoices),
  push_staff_once(text, text, text, text, boolean), updates_guard(), reports_guard(), invoices_guard(), testimonials_guard(),
  queue_referral(uuid, text, uuid), projects_referral(), invoices_referral(), updates_push(), reports_push(), testimonials_push(),
  push_on_approval(), save_my_prefs(text, text), claim_email_batch(timestamptz, integer), finish_email(uuid, uuid, boolean, text),
  save_update_draft(uuid, text, text, text, date, jsonb, jsonb, uuid), edit_update(uuid, text, text), publish_update(uuid),
  skip_update(uuid, text), queue_weekly_update(uuid, text), queue_weekly_updates(date),
  save_report_draft(uuid, uuid, text, text, jsonb, uuid), approve_report(uuid), mark_report_published(uuid, text),
  void_report(uuid), queue_report_draft(uuid, date, date, text),
  create_invoice_draft(uuid, text, text, text, jsonb, text, numeric, text, date), invoice_from_schedule(uuid, integer, date),
  update_invoice_draft(uuid, text, text, text, jsonb, text, numeric, text, date), approve_invoice(uuid), issue_invoice(uuid),
  mark_invoice_paid(uuid, date), void_invoice(uuid), create_credit_note(uuid, jsonb, text), mark_overdue_invoices(date),
  request_testimonial(uuid, uuid, text), submit_testimonial(uuid, uuid, text, text, text), withdraw_testimonial(uuid),
  mark_testimonial_published(uuid), save_retainer(uuid, uuid, text, numeric, date, date, text),
  log_time(uuid, uuid, integer, text, boolean, date), delete_time_entry(uuid), retainer_usage(uuid, integer, date)
from public, anon, authenticated;

grant execute on function
  save_my_prefs(text, text),
  save_update_draft(uuid, text, text, text, date, jsonb, jsonb, uuid), edit_update(uuid, text, text), publish_update(uuid),
  skip_update(uuid, text), queue_weekly_update(uuid, text),
  save_report_draft(uuid, uuid, text, text, jsonb, uuid), approve_report(uuid), void_report(uuid),
  queue_report_draft(uuid, date, date, text),
  create_invoice_draft(uuid, text, text, text, jsonb, text, numeric, text, date), invoice_from_schedule(uuid, integer, date),
  update_invoice_draft(uuid, text, text, text, jsonb, text, numeric, text, date), approve_invoice(uuid), issue_invoice(uuid),
  mark_invoice_paid(uuid, date), void_invoice(uuid), create_credit_note(uuid, jsonb, text), mark_overdue_invoices(date),
  request_testimonial(uuid, uuid, text), submit_testimonial(uuid, uuid, text, text, text), withdraw_testimonial(uuid),
  mark_testimonial_published(uuid), save_retainer(uuid, uuid, text, numeric, date, date, text),
  log_time(uuid, uuid, integer, text, boolean, date), delete_time_entry(uuid), retainer_usage(uuid, integer, date)
to authenticated, service_role;
grant execute on function claim_email_batch(timestamptz, integer), finish_email(uuid, uuid, boolean, text),
  queue_weekly_updates(date), mark_report_published(uuid, text)
to service_role;

-- Storage: private 'reports' bucket. Members read the PDF of a published report of their org; staff read all; only the
-- service role (which bypasses RLS) writes. Paths are <org_id>/<report_id>.pdf and must match reports.pdf_path.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('reports', 'reports', false)
    on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                     and policyname = 'reports_read') then
      create policy reports_read on storage.objects for select to authenticated using (
        bucket_id = 'reports' and exists (
          select 1 from public.reports r
           where r.pdf_path = objects.name
             and ((r.status = 'published' and public.is_member(r.org_id)) or public.is_staff_for(r.org_id))));
    end if;
  end if;
end $$;

commit;
