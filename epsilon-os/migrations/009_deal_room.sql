-- Epsilon OS migration 009: deal room (docs/designs/client-platform.md "1b. Deal room", OV4, OV5 step 2, F15).
-- Additive and idempotent. Requires 008. No drops, no column rewrites, no change to existing rows.
--
-- Tables      terms_versions, proposals, accept_codes, acceptances, invoice_counters, invoices
-- Storage     private bucket 'invoices' (staff and org members read through RLS; only the service role writes)
-- Staff RPCs  create_proposal, update_proposal_draft, approve_proposal, mark_proposal_sent, void_proposal,
--             set_terms_active                          (is_staff() = full scope + aal2, or the worker's service role)
-- Token RPCs  get_proposal_by_token                     (anon: public fields only, marks the proposal viewed)
--             start_acceptance, confirm_acceptance, activate_invite
--                                                       (service role ONLY: start_acceptance returns the plain code so
--                                                        the server can email it, and confirm_acceptance records the
--                                                        caller's IP; neither may be callable with the public key)
-- Rules       a sent proposal is frozen (trigger); an edit is a new version, and sending it voids the older
--             version's link. Issued invoices are frozen (trigger). Invoice numbers EL-YYYY-NNN come from a
--             per-year counter row (row lock), are assigned when an invoice is issued, and are never reused.
-- Hashing     proposal tokens, accept codes and invite tokens are stored only as sha256 hex (pgcrypto).
--
-- Terms: T-2026-1 is seeded INACTIVE. The founder adds the registered address, republishes the PDF and activates
-- it in admin (which records the sha256 of the published file). Nothing can be accepted while its terms version is
-- inactive. A terms text that changes after acceptances exist must be a new version, never an edit.

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- terms_versions ------------------------------------------------------------------------------------------
create table if not exists terms_versions (
  version      text primary key check (version ~ '^T-[0-9]{4}-[0-9]{1,3}$'),
  title        text not null check (length(btrim(title)) between 1 and 200),
  pdf_path     text not null check (pdf_path ~ '^/legal/[A-Za-z0-9._-]+\.pdf$'),   -- path on client.epsilon-labs.co
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  active       boolean not null default false,
  activated_at timestamptz,
  created_at   timestamptz not null default now()
);

insert into terms_versions (version, title, pdf_path, sha256, active)
values ('T-2026-1', 'Epsilon Labs Services Agreement', '/legal/T-2026-1.pdf',
        '3070f3addf6ae872d65070cab93ee66edeebb7907ec46309341837a1f7773385', false)
on conflict (version) do nothing;

-- proposals ---------------------------------------------------------------------------------------------
--   draft <-> approved --send--> sent --> viewed --> accepted | declined | expired ; any non-accepted --> void
create table if not exists proposals (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references deals(id) on delete restrict,
  org_id          uuid references organizations(id) on delete set null,     -- set when accepted
  version         integer not null check (version between 1 and 999),
  title           text not null check (length(btrim(title)) between 1 and 200),
  client_company  text not null check (length(btrim(client_company)) between 1 and 200),
  contact_name    text not null check (length(btrim(contact_name)) between 1 and 200),
  contact_email   citext not null check (contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(contact_email) <= 254),
  summary         text not null default '' check (length(summary) <= 2000),
  scope_md        text not null default '' check (length(scope_md) <= 20000),
  timeline_md     text not null default '' check (length(timeline_md) <= 20000),
  changes_md      text not null default '' check (length(changes_md) <= 4000),
  lines           jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  schedule        jsonb not null default
                    '[{"label":"On signature","pct":40},{"label":"Milestone 2","pct":40},{"label":"On acceptance","pct":20}]'::jsonb
                    check (jsonb_typeof(schedule) = 'array'),
  currency        text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  total           numeric(12,2) not null default 0 check (total >= 0),
  valid_until     date not null,
  terms_version   text not null references terms_versions(version),
  status          text not null default 'draft' check (status in
                    ('draft','approved','sent','viewed','accepted','declined','expired','void')),
  token_hash      text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  sha256          text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  sent_at         timestamptz,
  viewed_at       timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (deal_id, version),
  -- everything past approval carries a link and a frozen fingerprint
  check (status in ('draft','approved','void') or (token_hash is not null and sha256 is not null and sent_at is not null))
);
create index if not exists proposals_deal_idx on proposals (deal_id, version desc);
create index if not exists proposals_status_idx on proposals (status, created_at desc);
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'proposals_updated') then
    create trigger proposals_updated before update on proposals for each row execute function set_updated_at();
  end if;
end $$;

-- accept_codes (6 digits, 10 minutes, 5 attempts; only the sha256 is stored) ------------------------------------
create table if not exists accept_codes (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references proposals(id) on delete cascade,
  code_hash    text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  name         text not null check (length(btrim(name)) between 2 and 200),
  expires_at   timestamptz not null default (now() + interval '10 minutes'),
  attempts     smallint not null default 0 check (attempts between 0 and 5),
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists accept_codes_proposal_idx on accept_codes (proposal_id, created_at desc);

-- acceptances (one per proposal: the idempotency key for accept) ---------------------------------------------
create table if not exists acceptances (
  proposal_id    uuid primary key references proposals(id) on delete restrict,
  name           text not null check (length(btrim(name)) between 2 and 200),
  email          citext not null,
  ip             inet,                         -- contract evidence only (OV4); never used for analytics
  user_agent     text check (user_agent is null or length(user_agent) <= 1000),
  terms_version  text not null references terms_versions(version),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),   -- sha256(proposal.sha256 || terms.sha256)
  accepted_at    timestamptz not null default now()
);

-- invoices ------------------------------------------------------------------------------------------------
create table if not exists invoice_counters (
  year         integer primary key check (year between 2000 and 2999),
  last_number  integer not null default 0 check (last_number >= 0)
);

create table if not exists invoices (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete restrict,
  number           text unique check (number is null or number ~ '^EL-[0-9]{4}-[0-9]{3,}$'),
  kind             text not null default 'invoice' check (kind in ('invoice','credit_note')),
  ref_invoice_id   uuid references invoices(id) on delete restrict,
  proposal_id      uuid references proposals(id) on delete restrict,
  bill_company     text not null check (length(btrim(bill_company)) between 1 and 200),
  bill_contact     text not null default '' check (length(bill_contact) <= 200),
  project_label    text not null default '' check (length(project_label) <= 200),
  lines            jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  tax_label        text check (tax_label is null or length(tax_label) <= 40),
  tax_rate         numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  currency         text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  total            numeric(12,2) not null check (total >= 0),
  due_date         date,
  status           text not null default 'draft' check (status in ('draft','approved','sent','paid','overdue','void')),
  pdf_path         text check (pdf_path is null or pdf_path ~ '^[0-9a-f-]{36}/EL-[0-9]{4}-[0-9]{3,}\.pdf$'),
  pdf_error        text check (pdf_error is null or length(pdf_error) <= 1000),
  pdf_attempted_at timestamptz,
  issued_at        timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (kind = 'invoice' or ref_invoice_id is not null),
  check (status in ('draft','approved','void') or (number is not null and issued_at is not null))
);
create index if not exists invoices_org_idx on invoices (org_id, created_at desc);
create index if not exists invoices_proposal_idx on invoices (proposal_id) where proposal_id is not null;
create index if not exists invoices_pdf_pending_idx on invoices (created_at) where pdf_path is null and number is not null;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'invoices_updated') then
    create trigger invoices_updated before update on invoices for each row execute function set_updated_at();
  end if;
end $$;

-- Internal helpers (no grants: callable only from the functions below and by the owner) ----------------------------
create or replace function deal_room_sha256(p text) returns text
language sql immutable set search_path = public, extensions, pg_temp as $$
  select encode(digest(coalesce(p, ''), 'sha256'), 'hex')
$$;

create or replace function deal_room_audit(p_action text, p_table text, p_id text, p_detail jsonb) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into actions (agent, action, target_table, target_id, detail)
  values ('platform', p_action, p_table, p_id,
          coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('actor', auth.uid(), 'role', coalesce(auth.role(), 'none')))
$$;

-- Staff (full scope, aal2) or the worker's service role (OV1). Never current_user: inside a security definer
-- function that is the owner, which would let anyone through.
create or replace function deal_room_is_operator() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_staff() or coalesce(auth.role(), '') = 'service_role'
$$;

create or replace function deal_room_mask_email(p citext) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when position('@' in p::text) > 1
              then left(split_part(p::text, '@', 1), 1) || '•••@' || split_part(p::text, '@', 2)
              else '•••' end
$$;

-- Validates price lines and returns their total. Each line: {slug, name, description, qty, unit_price, amount}.
-- Prices are copied from the catalogue by the server; here we only check the arithmetic and the shape.
create or replace function deal_room_lines_total(p_lines jsonb, p_require boolean) returns numeric
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  l jsonb;
  v_total numeric(12,2) := 0;
  v_qty integer;
  v_unit numeric(12,2);
  v_amount numeric(12,2);
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lines must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'at most 50 price lines' using errcode = '22023';
  end if;
  if p_require and jsonb_array_length(p_lines) = 0 then
    raise exception 'a proposal needs at least one price line' using errcode = '22023';
  end if;
  for l in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l) <> 'object' or length(btrim(coalesce(l->>'name', ''))) not between 1 and 200
       or length(coalesce(l->>'slug', '')) not between 1 and 80
       or length(coalesce(l->>'description', '')) > 1000 then
      raise exception 'invalid price line' using errcode = '22023';
    end if;
    v_qty := (l->>'qty')::integer;
    v_unit := (l->>'unit_price')::numeric;
    v_amount := (l->>'amount')::numeric;
    if v_qty is null or v_qty not between 1 and 10000 or v_unit is null or v_unit < 0 or v_amount is null
       or v_amount <> round(v_qty * v_unit, 2) then
      raise exception 'invalid price line amount' using errcode = '22023';
    end if;
    v_total := v_total + v_amount;
  end loop;
  return v_total;
end $$;

-- Validates a payment schedule: 1-6 stages of {label, pct}, whole percentages summing to 100.
create or replace function deal_room_check_schedule(p_schedule jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  s jsonb;
  v_sum integer := 0;
begin
  if p_schedule is null or jsonb_typeof(p_schedule) <> 'array' or jsonb_array_length(p_schedule) not between 1 and 6 then
    raise exception 'schedule must have 1-6 stages' using errcode = '22023';
  end if;
  for s in select value from jsonb_array_elements(p_schedule) loop
    if jsonb_typeof(s) <> 'object' or length(btrim(coalesce(s->>'label', ''))) not between 1 and 80
       or coalesce(s->>'pct', '') !~ '^[0-9]{1,3}$' or (s->>'pct')::integer not between 1 and 100 then
      raise exception 'invalid schedule stage' using errcode = '22023';
    end if;
    v_sum := v_sum + (s->>'pct')::integer;
  end loop;
  if v_sum <> 100 then
    raise exception 'schedule percentages must add up to 100' using errcode = '22023';
  end if;
end $$;

-- The exact content a client accepts. jsonb text output is canonical (sorted keys), so the hash is stable.
create or replace function proposal_fingerprint(p proposals) returns text
language sql stable set search_path = public, extensions, pg_temp as $$
  select deal_room_sha256(jsonb_build_object(
    'id', p.id, 'deal_id', p.deal_id, 'version', p.version, 'title', p.title, 'client_company', p.client_company,
    'contact_name', p.contact_name, 'contact_email', p.contact_email::text, 'summary', p.summary,
    'scope_md', p.scope_md, 'timeline_md', p.timeline_md, 'changes_md', p.changes_md, 'lines', p.lines,
    'schedule', p.schedule, 'currency', p.currency, 'total', p.total, 'valid_until', p.valid_until,
    'terms_version', p.terms_version)::text)
$$;

-- Next invoice number for the year of p_at (Pakistan time). The upsert takes the counter row's lock, so two
-- concurrent issues can never get the same number, and a number is never handed out twice.
create or replace function next_invoice_number(p_at timestamptz) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_year integer := extract(year from (coalesce(p_at, now()) at time zone 'Asia/Karachi'))::integer;
  v_n integer;
begin
  insert into invoice_counters (year, last_number) values (v_year, 1)
  on conflict (year) do update set last_number = invoice_counters.last_number + 1
  returning last_number into v_n;
  return 'EL-' || v_year || '-' || case when v_n < 1000 then lpad(v_n::text, 3, '0') else v_n::text end;
end $$;

-- Rules as triggers, so they hold for every caller including the service role ------------------------------------
create or replace function proposals_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.status not in ('draft','approved') then
      raise exception 'a sent proposal cannot be deleted' using errcode = '55000';
    end if;
    return old;
  end if;
  if old.status in ('draft','approved') then
    if new.status not in ('draft','approved','sent','void') then
      raise exception 'invalid proposal status change % -> %', old.status, new.status using errcode = '55000';
    end if;
    return new;
  end if;
  -- sent and later: the content and the link are frozen
  if (new.deal_id, new.version, new.title, new.client_company, new.contact_name, new.contact_email, new.summary,
      new.scope_md, new.timeline_md, new.changes_md, new.lines, new.schedule, new.currency, new.total, new.valid_until,
      new.terms_version, new.token_hash, new.sha256, new.sent_at, new.created_by, new.created_at)
     is distinct from
     (old.deal_id, old.version, old.title, old.client_company, old.contact_name, old.contact_email, old.summary,
      old.scope_md, old.timeline_md, old.changes_md, old.lines, old.schedule, old.currency, old.total, old.valid_until,
      old.terms_version, old.token_hash, old.sha256, old.sent_at, old.created_by, old.created_at) then
    raise exception 'a sent proposal is immutable; create a new version' using errcode = '55000';
  end if;
  if new.org_id is distinct from old.org_id and not (old.org_id is null and new.status = 'accepted') then
    raise exception 'org can only be set on acceptance' using errcode = '55000';
  end if;
  if new.viewed_at is distinct from old.viewed_at and old.viewed_at is not null then
    raise exception 'viewed_at is set once' using errcode = '55000';
  end if;
  if new.status <> old.status and not (
       (old.status = 'sent'    and new.status in ('viewed','accepted','declined','expired','void'))
    or (old.status = 'viewed'  and new.status in ('accepted','declined','expired','void'))
    or (old.status = 'expired' and new.status = 'void')) then
    raise exception 'invalid proposal status change % -> %', old.status, new.status using errcode = '55000';
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'proposals_guard') then
    create trigger proposals_guard before update or delete on proposals for each row execute function proposals_guard();
  end if;
end $$;

create or replace function invoices_number() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- issuing (sent) assigns the number and the issue time; drafts never consume a number
  if new.status in ('sent','paid','overdue') and new.number is null then
    new.issued_at := coalesce(new.issued_at, now());
    new.number := next_invoice_number(new.issued_at);
  end if;
  return new;
end $$;

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
      new.issued_at, new.created_at)
     is distinct from
     (old.org_id, old.number, old.kind, old.ref_invoice_id, old.proposal_id, old.bill_company, old.bill_contact,
      old.project_label, old.lines, old.tax_label, old.tax_rate, old.currency, old.total, old.due_date,
      old.issued_at, old.created_at) then
    raise exception 'a sent invoice is immutable; issue a credit note' using errcode = '55000';
  end if;
  if new.pdf_path is distinct from old.pdf_path and old.pdf_path is not null then
    raise exception 'an invoice PDF is rendered once' using errcode = '55000';
  end if;
  if new.status <> old.status and not (
       (old.status = 'sent'    and new.status in ('paid','overdue','void'))
    or (old.status = 'overdue' and new.status in ('paid','void'))) then
    raise exception 'invalid invoice status change % -> %', old.status, new.status using errcode = '55000';
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'invoices_number') then
    create trigger invoices_number before insert or update on invoices for each row execute function invoices_number();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'invoices_guard') then
    create trigger invoices_guard before update or delete on invoices for each row execute function invoices_guard();
  end if;
end $$;

-- Staff RPCs (one rulebook, EN5/OV1) -------------------------------------------------------------------------------
create or replace function create_proposal(
  p_deal_id uuid, p_title text, p_client_company text, p_contact_name text, p_contact_email text,
  p_summary text, p_scope_md text, p_timeline_md text, p_changes_md text,
  p_lines jsonb, p_schedule jsonb, p_valid_until date, p_terms_version text default null)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_version integer;
  v_terms text := nullif(btrim(coalesce(p_terms_version, '')), '');
  v_total numeric(12,2);
begin
  if not deal_room_is_operator() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if not exists (select 1 from deals where id = p_deal_id) then
    raise exception 'deal not found' using errcode = '22023';
  end if;
  v_total := deal_room_lines_total(coalesce(p_lines, '[]'::jsonb), false);
  perform deal_room_check_schedule(coalesce(p_schedule,
    '[{"label":"On signature","pct":40},{"label":"Milestone 2","pct":40},{"label":"On acceptance","pct":20}]'::jsonb));
  if v_terms is null then
    -- the newest active terms, else the newest version (it can be activated before anyone accepts)
    select version into v_terms from terms_versions order by active desc, created_at desc limit 1;
  end if;
  if v_terms is null or not exists (select 1 from terms_versions where version = v_terms) then
    raise exception 'unknown terms version' using errcode = '22023';
  end if;
  -- the deal row lock serialises version numbers for one deal
  perform 1 from deals where id = p_deal_id for update;
  select coalesce(max(version), 0) + 1 into v_version from proposals where deal_id = p_deal_id;
  insert into proposals (deal_id, version, title, client_company, contact_name, contact_email, summary, scope_md,
                         timeline_md, changes_md, lines, schedule, total, valid_until, terms_version, created_by)
  values (p_deal_id, v_version, btrim(coalesce(p_title, '')), btrim(coalesce(p_client_company, '')),
          btrim(coalesce(p_contact_name, '')), lower(btrim(coalesce(p_contact_email, ''))), coalesce(p_summary, ''),
          coalesce(p_scope_md, ''), coalesce(p_timeline_md, ''), coalesce(p_changes_md, ''), coalesce(p_lines, '[]'::jsonb),
          coalesce(p_schedule, '[{"label":"On signature","pct":40},{"label":"Milestone 2","pct":40},{"label":"On acceptance","pct":20}]'::jsonb),
          v_total, coalesce(p_valid_until, (now() at time zone 'Asia/Karachi')::date + 30), v_terms, auth.uid())
  returning id into v_id;
  perform deal_room_audit('proposal_created', 'proposals', v_id::text, jsonb_build_object('deal_id', p_deal_id, 'version', v_version));
  return v_id;
end $$;

create or replace function update_proposal_draft(
  p_id uuid, p_title text, p_client_company text, p_contact_name text, p_contact_email text,
  p_summary text, p_scope_md text, p_timeline_md text, p_changes_md text,
  p_lines jsonb, p_schedule jsonb, p_valid_until date)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_status text;
  v_total numeric(12,2);
begin
  if not deal_room_is_operator() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select status into v_status from proposals where id = p_id for update;
  if v_status is null then
    raise exception 'proposal not found' using errcode = '22023';
  end if;
  if v_status not in ('draft','approved') then
    raise exception 'a sent proposal is immutable; create a new version' using errcode = '55000';
  end if;
  v_total := deal_room_lines_total(coalesce(p_lines, '[]'::jsonb), false);
  perform deal_room_check_schedule(p_schedule);
  -- any edit sends an approved proposal back to draft: approval is of the exact content
  update proposals set
    title = btrim(coalesce(p_title, '')), client_company = btrim(coalesce(p_client_company, '')),
    contact_name = btrim(coalesce(p_contact_name, '')), contact_email = lower(btrim(coalesce(p_contact_email, ''))),
    summary = coalesce(p_summary, ''), scope_md = coalesce(p_scope_md, ''), timeline_md = coalesce(p_timeline_md, ''),
    changes_md = coalesce(p_changes_md, ''), lines = coalesce(p_lines, '[]'::jsonb), schedule = p_schedule,
    total = v_total, valid_until = coalesce(p_valid_until, valid_until), status = 'draft'
  where id = p_id;
  perform deal_room_audit('proposal_edited', 'proposals', p_id::text, null);
end $$;

create or replace function approve_proposal(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  p proposals;
begin
  if not deal_room_is_operator() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select * into p from proposals where id = p_id for update;
  if p.id is null then
    raise exception 'proposal not found' using errcode = '22023';
  end if;
  if p.status = 'approved' then
    return;
  end if;
  if p.status <> 'draft' then
    raise exception 'only a draft can be approved' using errcode = '55000';
  end if;
  if deal_room_lines_total(p.lines, true) <> p.total or p.total <= 0 then
    raise exception 'the proposal needs priced lines' using errcode = '22023';
  end if;
  perform deal_room_check_schedule(p.schedule);
  if p.valid_until < (now() at time zone 'Asia/Karachi')::date then
    raise exception 'valid-until is in the past' using errcode = '22023';
  end if;
  if length(btrim(p.scope_md)) = 0 then
    raise exception 'the proposal needs a scope' using errcode = '22023';
  end if;
  update proposals set status = 'approved' where id = p_id;
  perform deal_room_audit('proposal_approved', 'proposals', p_id::text, jsonb_build_object('total', p.total));
end $$;

-- Sending: freeze the content (sha256), attach the link hash, and void the deal's older live versions.
-- The token itself is derived on the server and never reaches the database.
create or replace function mark_proposal_sent(p_id uuid, p_token_hash text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  p proposals;
  v_sha text;
  v_voided integer;
begin
  if not deal_room_is_operator() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023';
  end if;
  select * into p from proposals where id = p_id for update;
  if p.id is null then
    raise exception 'proposal not found' using errcode = '22023';
  end if;
  if p.status in ('sent','viewed') and p.token_hash = p_token_hash then
    return jsonb_build_object('sha256', p.sha256, 'sent_at', p.sent_at, 'already', true);   -- retried send
  end if;
  if p.status <> 'approved' then
    raise exception 'only an approved proposal can be sent' using errcode = '55000';
  end if;
  perform 1 from deals where id = p.deal_id for update;
  if exists (select 1 from proposals where deal_id = p.deal_id and status = 'accepted') then
    raise exception 'this deal already has an accepted proposal' using errcode = '55000';
  end if;
  v_sha := proposal_fingerprint(p);
  update proposals set status = 'sent', token_hash = p_token_hash, sha256 = v_sha, sent_at = now() where id = p_id;
  update proposals set status = 'void'
   where deal_id = p.deal_id and version < p.version and status in ('draft','approved','sent','viewed','expired');
  get diagnostics v_voided = row_count;
  perform deal_room_audit('proposal_sent', 'proposals', p_id::text,
                          jsonb_build_object('sha256', v_sha, 'version', p.version, 'voided_versions', v_voided));
  return jsonb_build_object('sha256', v_sha, 'sent_at', now(), 'already', false);
end $$;

create or replace function void_proposal(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_status text;
begin
  if not deal_room_is_operator() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select status into v_status from proposals where id = p_id for update;
  if v_status is null then
    raise exception 'proposal not found' using errcode = '22023';
  end if;
  if v_status = 'void' then
    return;
  end if;
  if v_status in ('accepted','declined') then
    raise exception 'an accepted or declined proposal cannot be voided' using errcode = '55000';
  end if;
  update proposals set status = 'void' where id = p_id;
  perform deal_room_audit('proposal_voided', 'proposals', p_id::text, null);
end $$;

-- Activating records the sha256 of the published PDF. The fingerprint can change only while nothing has been
-- accepted under that version; after that, changed terms must be a new version.
create or replace function set_terms_active(p_version text, p_active boolean, p_sha256 text default null) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t terms_versions;
begin
  if not deal_room_is_operator() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select * into t from terms_versions where version = p_version for update;
  if t.version is null then
    raise exception 'unknown terms version' using errcode = '22023';
  end if;
  if p_sha256 is not null and p_sha256 <> t.sha256 then
    if p_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid sha256' using errcode = '22023';
    end if;
    if exists (select 1 from acceptances where terms_version = p_version) then
      raise exception 'proposals were accepted under %; changed terms need a new version', p_version using errcode = '55000';
    end if;
  end if;
  update terms_versions
     set active = coalesce(p_active, false),
         sha256 = coalesce(p_sha256, sha256),
         activated_at = case when coalesce(p_active, false) and not t.active then now() else activated_at end
   where version = p_version;
  perform deal_room_audit(case when coalesce(p_active, false) then 'terms_activated' else 'terms_deactivated' end,
                          'terms_versions', p_version, jsonb_build_object('sha256', coalesce(p_sha256, t.sha256)));
end $$;

-- Token RPCs -------------------------------------------------------------------------------------------------
-- Everything a token holder may see. Never the deal, the internal ids of other rows, or the full email.
create or replace function proposal_public(p proposals) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'version', p.version, 'title', p.title, 'client_company', p.client_company,
    'contact_name', p.contact_name, 'email_masked', deal_room_mask_email(p.contact_email),
    'summary', p.summary, 'scope_md', p.scope_md, 'timeline_md', p.timeline_md, 'changes_md', p.changes_md,
    'lines', p.lines, 'schedule', p.schedule, 'currency', p.currency, 'total', p.total,
    'valid_until', p.valid_until, 'sent_at', p.sent_at, 'sha256', p.sha256, 'status', p.status,
    'terms', (select jsonb_build_object('version', t.version, 'title', t.title, 'pdf_path', t.pdf_path, 'active', t.active)
                from terms_versions t where t.version = p.terms_version),
    'acceptance', (select jsonb_build_object('name', a.name, 'accepted_at', a.accepted_at, 'sha256', a.sha256,
                                             'terms_version', a.terms_version)
                     from acceptances a where a.proposal_id = p.id),
    'invoice', (select jsonb_build_object('number', i.number, 'total', i.total, 'currency', i.currency, 'due_date', i.due_date)
                  from invoices i where i.proposal_id = p.id and i.kind = 'invoice' order by i.created_at limit 1))
$$;

-- 'open' | 'accepted' | 'expired' | 'void' | 'declined' | 'unsent', from a locked or fresh row
create or replace function proposal_state(p proposals) returns text
language sql stable set search_path = public, pg_temp as $$
  select case
    when p.status = 'accepted' then 'accepted'
    when p.status in ('void','declined') then p.status
    when p.status = 'expired' or (p.status in ('sent','viewed') and p.valid_until < (now() at time zone 'Asia/Karachi')::date) then 'expired'
    when p.status in ('sent','viewed') then 'open'
    else 'unsent' end
$$;

create or replace function proposal_by_token(p_token text, p_lock boolean) returns proposals
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  p proposals;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    return null;
  end if;
  if p_lock then
    select * into p from proposals where token_hash = deal_room_sha256(p_token) for update;
  else
    select * into p from proposals where token_hash = deal_room_sha256(p_token);
  end if;
  return p;
end $$;

create or replace function get_proposal_by_token(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  p proposals;
  v_state text;
begin
  p := proposal_by_token(p_token, false);
  if p.id is null or p.status in ('draft','approved') then
    return jsonb_build_object('state', 'not_found');
  end if;
  v_state := proposal_state(p);
  -- the status guards in the WHERE make two concurrent first views update once
  if v_state = 'expired' and p.status in ('sent','viewed') then
    update proposals set status = 'expired' where id = p.id and status in ('sent','viewed');
    if found then
      perform deal_room_audit('proposal_expired', 'proposals', p.id::text, null);
    end if;
  elsif v_state = 'open' and p.status = 'sent' then
    update proposals set status = 'viewed', viewed_at = now() where id = p.id and status = 'sent';
    if found then
      perform deal_room_audit('proposal_viewed', 'proposals', p.id::text, null);
    end if;
  end if;
  select * into p from proposals where id = p.id;
  return proposal_public(p) || jsonb_build_object('state', v_state);
end $$;

-- Step 1 of accept: issue a 6-digit code. Returns the plain code and the full email to the SERVER, which emails it.
-- 5 codes per proposal per hour. A new code supersedes any earlier one.
create or replace function start_acceptance(p_token text, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  p proposals;
  v_state text;
  v_name text := btrim(coalesce(p_name, ''));
  v_code text;
  v_recent integer;
  v_oldest timestamptz;
  v_expires timestamptz;
  v_notify boolean;
  v_rand bytea;
begin
  p := proposal_by_token(p_token, true);
  if p.id is null or p.status in ('draft','approved') then
    return jsonb_build_object('state', 'not_found');
  end if;
  v_state := proposal_state(p);
  if v_state <> 'open' then
    return jsonb_build_object('state', v_state);
  end if;
  if length(v_name) not between 2 and 200 then
    raise exception 'name must be 2-200 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from terms_versions where version = p.terms_version and active) then
    -- tell the founder once an hour per proposal, not on every click
    v_notify := not exists (select 1 from actions where action = 'proposal_accept_blocked_terms'
                              and target_id = p.id::text and at > now() - interval '1 hour');
    perform deal_room_audit('proposal_accept_blocked_terms', 'proposals', p.id::text,
                            jsonb_build_object('terms_version', p.terms_version));
    return jsonb_build_object('state', 'terms_inactive', 'notify', v_notify, 'title', p.title,
                              'client_company', p.client_company, 'terms_version', p.terms_version);
  end if;
  select count(*), min(created_at) into v_recent, v_oldest
    from accept_codes where proposal_id = p.id and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return jsonb_build_object('state', 'rate_limited', 'retry_at', v_oldest + interval '1 hour');
  end if;
  update accept_codes set expires_at = least(expires_at, now())
   where proposal_id = p.id and consumed_at is null and expires_at > now();
  v_rand := gen_random_bytes(4);
  v_code := lpad((((get_byte(v_rand, 0)::bigint << 24) | (get_byte(v_rand, 1) << 16) | (get_byte(v_rand, 2) << 8)
                   | get_byte(v_rand, 3)) % 1000000)::text, 6, '0');
  v_expires := now() + interval '10 minutes';
  insert into accept_codes (proposal_id, code_hash, name, expires_at)
  values (p.id, deal_room_sha256(p.id::text || ':' || v_code), v_name, v_expires);
  perform deal_room_audit('proposal_code_sent', 'proposals', p.id::text, null);
  return jsonb_build_object('state', 'code_sent', 'code', v_code, 'email', p.contact_email::text,
                            'email_masked', deal_room_mask_email(p.contact_email), 'expires_at', v_expires,
                            'title', p.title, 'contact_name', p.contact_name);
end $$;

-- What a confirmed acceptance returns, the first time and on every replay.
create or replace function acceptance_result(p_id uuid, p_replay boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'state', 'accepted', 'replay', p_replay, 'proposal_id', p.id, 'org_id', p.org_id,
    'email', p.contact_email::text, 'email_masked', deal_room_mask_email(p.contact_email),
    'title', p.title, 'client_company', p.client_company,
    'acceptance', (select jsonb_build_object('name', a.name, 'accepted_at', a.accepted_at, 'sha256', a.sha256,
                                             'terms_version', a.terms_version) from acceptances a where a.proposal_id = p.id),
    'invoice', (select jsonb_build_object('id', i.id, 'number', i.number, 'total', i.total, 'currency', i.currency,
                                          'due_date', i.due_date)
                  from invoices i where i.proposal_id = p.id and i.kind = 'invoice' order by i.created_at limit 1),
    'invite_id', (select v.id from invites v where v.org_id = p.org_id and v.email = p.contact_email
                   order by v.created_at limit 1))
  from proposals p where p.id = p_id
$$;

-- Step 2 of accept. One transaction: organisation, project, owner invite, deposit invoice (sent, due in 14 days),
-- acceptance record, proposal accepted, deal won, audit row. The proposal row lock plus the unique acceptance
-- make it idempotent: a double submit returns the first result.
create or replace function confirm_acceptance(p_token text, p_code text, p_name text, p_ip inet, p_ua text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  p proposals;
  v_state text;
  v_name text := btrim(coalesce(p_name, ''));
  c accept_codes;
  v_terms_sha text;
  v_company uuid;
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_org uuid;
  v_deposit numeric(12,2);
  v_stage jsonb;
begin
  p := proposal_by_token(p_token, true);
  if p.id is null or p.status in ('draft','approved') then
    return jsonb_build_object('state', 'not_found');
  end if;
  if p.status = 'accepted' then
    return acceptance_result(p.id, true);
  end if;
  v_state := proposal_state(p);
  if v_state <> 'open' then
    return jsonb_build_object('state', v_state);
  end if;
  select sha256 into v_terms_sha from terms_versions where version = p.terms_version and active;
  if v_terms_sha is null then
    return jsonb_build_object('state', 'terms_inactive');
  end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' then
    return jsonb_build_object('state', 'wrong_code', 'attempts_left', null);
  end if;
  select * into c from accept_codes where proposal_id = p.id order by created_at desc limit 1 for update;
  if c.id is null or c.consumed_at is not null then
    return jsonb_build_object('state', 'no_code');
  end if;
  if c.attempts >= 5 then
    return jsonb_build_object('state', 'locked');
  end if;
  if c.expires_at <= now() then
    return jsonb_build_object('state', 'code_expired');
  end if;
  if c.code_hash <> deal_room_sha256(p.id::text || ':' || p_code) then
    update accept_codes set attempts = attempts + 1 where id = c.id returning * into c;
    if c.attempts >= 5 then
      perform deal_room_audit('proposal_code_locked', 'proposals', p.id::text, null);
      return jsonb_build_object('state', 'locked');
    end if;
    return jsonb_build_object('state', 'wrong_code', 'attempts_left', 5 - c.attempts);
  end if;
  if length(v_name) not between 2 and 200 then
    v_name := c.name;
  end if;

  update accept_codes set consumed_at = now() where id = c.id;

  -- organisation, slugged from the company name
  select company_id into v_company from deals where id = p.deal_id;
  v_base := btrim(left(btrim(regexp_replace(lower(p.client_company), '[^a-z0-9]+', '-', 'g'), '-'), 50), '-');
  if v_base = '' then
    v_base := 'client';
  end if;
  v_slug := v_base;
  while exists (select 1 from organizations where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  insert into organizations (name, slug, company_id) values (left(p.client_company, 200), v_slug, v_company)
  returning id into v_org;

  insert into projects (org_id, name, summary) values (v_org, left(p.title, 200), nullif(p.summary, ''));

  -- owner invite; the server creates the login and links it with activate_invite()
  insert into invites (org_id, email, role, token_hash, invited_by)
  values (v_org, p.contact_email, 'owner', deal_room_sha256(encode(gen_random_bytes(32), 'hex')), p.created_by);

  -- deposit invoice: the first schedule stage, issued now (the number comes from the invoices_number trigger)
  v_stage := p.schedule -> 0;
  v_deposit := round(p.total * (v_stage->>'pct')::integer / 100.0, 2);
  insert into invoices (org_id, kind, proposal_id, bill_company, bill_contact, project_label, lines, tax_label,
                        tax_rate, currency, total, due_date, status, issued_at)
  values (v_org, 'invoice', p.id, left(p.client_company, 200), left(p.contact_name, 200), left(p.title, 200),
          jsonb_build_array(jsonb_build_object(
            'title', 'Deposit · ' || (v_stage->>'pct') || '% ' || lower(v_stage->>'label'),
            'desc', p.title || ' · proposal v' || p.version || ', accepted ' ||
                    to_char(now() at time zone 'Asia/Karachi', 'DD Mon YYYY') || '. Total ' || p.currency || ' ' ||
                    to_char(p.total, 'FM999,999,999,990.00') || '.',
            'amount', v_deposit)),
          null, 0, p.currency, v_deposit, (now() at time zone 'Asia/Karachi')::date + 14, 'sent', now());

  insert into acceptances (proposal_id, name, email, ip, user_agent, terms_version, sha256)
  values (p.id, v_name, p.contact_email, p_ip, left(p_ua, 1000), p.terms_version,
          deal_room_sha256(p.sha256 || v_terms_sha));

  update proposals set status = 'accepted', org_id = v_org where id = p.id;
  update deals set stage = 'won', closed_at = coalesce(closed_at, now()) where id = p.deal_id and stage <> 'won';

  perform deal_room_audit('proposal_accepted', 'proposals', p.id::text,
                          jsonb_build_object('org_id', v_org, 'deal_id', p.deal_id, 'name', v_name,
                                             'terms_version', p.terms_version, 'deposit', v_deposit));
  return acceptance_result(p.id, false);
end $$;

-- Links an invite to an existing auth user (the server creates the user first with the Auth admin API).
-- Idempotent. Returns whether the membership exists.
create or replace function activate_invite(p_invite_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v invites;
  v_user uuid;
begin
  select * into v from invites where id = p_invite_id for update;
  if v.id is null or v.revoked_at is not null then
    return jsonb_build_object('linked', false, 'reason', 'invite not found');
  end if;
  select id into v_user from auth.users where lower(email) = lower(v.email::text) limit 1;
  if v_user is null then
    return jsonb_build_object('linked', false, 'reason', 'no user for invite email');
  end if;
  insert into memberships (org_id, user_id, role, invited_by)
  values (v.org_id, v_user, v.role, v.invited_by)
  on conflict (org_id, user_id) do nothing;
  if v.accepted_at is null then
    update invites set accepted_at = now() where id = v.id;
    perform deal_room_audit('invite_accepted', 'invites', v.id::text, jsonb_build_object('org_id', v.org_id));
  end if;
  return jsonb_build_object('linked', true, 'org_id', v.org_id);
end $$;

-- RLS ---------------------------------------------------------------------------------------------------------
alter table terms_versions   enable row level security;
alter table proposals        enable row level security;
alter table accept_codes     enable row level security;
alter table acceptances      enable row level security;
alter table invoice_counters enable row level security;
alter table invoices         enable row level security;

do $$
declare
  p record;
  t text;
begin
  for p in
    select * from (values
      ('terms_versions',   'staff_read', '(select is_staff())'),
      ('proposals',        'staff_read', '(select is_staff())'),
      ('acceptances',      'staff_read', '(select is_staff())'),
      ('invoice_counters', 'staff_read', '(select is_staff())'),
      ('invoices',         'org_read',   'is_member(org_id) or is_staff_for(org_id)')
    ) as v(tbl, name, expr)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on %I for select to authenticated using (%s)', p.name, p.tbl, p.expr);
    end if;
  end loop;
  -- accept_codes has no authenticated policy at all: only the service role touches it
  foreach t in array array['terms_versions','proposals','accept_codes','acceptances','invoice_counters','invoices'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'service_role_all') then
      execute format('create policy service_role_all on %I for all to service_role using (true) with check (true)', t);
    end if;
  end loop;
end $$;

-- Grants: anon nothing on the tables; authenticated select only (RLS decides rows); writes only through RPCs ---------
revoke all on terms_versions, proposals, accept_codes, acceptances, invoice_counters, invoices from public, anon, authenticated;
grant select on terms_versions, proposals, acceptances, invoice_counters, invoices to authenticated;
grant all on terms_versions, proposals, accept_codes, acceptances, invoice_counters, invoices to service_role;

revoke all on function
  deal_room_sha256(text), deal_room_audit(text, text, text, jsonb), deal_room_is_operator(), deal_room_mask_email(citext),
  deal_room_lines_total(jsonb, boolean), deal_room_check_schedule(jsonb), proposal_fingerprint(proposals),
  next_invoice_number(timestamptz), proposals_guard(), invoices_number(), invoices_guard(),
  proposal_public(proposals), proposal_state(proposals), proposal_by_token(text, boolean), acceptance_result(uuid, boolean),
  create_proposal(uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, date, text),
  update_proposal_draft(uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, date),
  approve_proposal(uuid), mark_proposal_sent(uuid, text), void_proposal(uuid), set_terms_active(text, boolean, text),
  get_proposal_by_token(text), start_acceptance(text, text), confirm_acceptance(text, text, text, inet, text),
  activate_invite(uuid)
from public, anon, authenticated;

grant execute on function
  create_proposal(uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, date, text),
  update_proposal_draft(uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, date),
  approve_proposal(uuid), mark_proposal_sent(uuid, text), void_proposal(uuid), set_terms_active(text, boolean, text)
to authenticated, service_role;
grant execute on function get_proposal_by_token(text) to anon, authenticated, service_role;
grant execute on function start_acceptance(text, text), confirm_acceptance(text, text, text, inet, text),
  activate_invite(uuid)
to service_role;

-- Storage: private 'invoices' bucket. Staff and members of the invoice's org may read the stored PDF; nobody but the
-- service role (which bypasses RLS) can write. Paths are <org_id>/<number>.pdf and must match invoices.pdf_path.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
    on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                     and policyname = 'invoices_read') then
      create policy invoices_read on storage.objects for select to authenticated using (
        bucket_id = 'invoices' and exists (
          select 1 from public.invoices i
           where i.pdf_path = objects.name and (public.is_member(i.org_id) or public.is_staff_for(i.org_id))));
    end if;
  end if;
end $$;

commit;
