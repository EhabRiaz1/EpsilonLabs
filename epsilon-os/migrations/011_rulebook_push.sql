-- Epsilon OS migration 011: the Deck rulebook, hosted settings / tenders / run-now, and push to the founder's phone
-- (docs/designs/client-platform.md EN5, OV1, E5, F16; OV5 step 5). Additive and idempotent. Requires 008-010.
-- No drops, no column rewrites, no change to existing rows.
--
-- Status      approval_status gains 'edited_pending_lint': a draft edited off the Mac (admin.*). The outbox never claims
--             it (it claims approved / edited_approved only); the Mac's outbox lints it first (complete_draft_lint):
--             clean -> edited_approved, lint hits -> back to the deck, held, with the lint reasons (as at draft time).
-- Deck RPCs   approve_draft, edit_and_approve_draft, reject_draft, hold_draft ("Later"), release_held_draft,
--             undo_decision, complete_draft_lint. They mirror dashboard/actions.py exactly (same checks, same order, same
--             result codes and messages) and return {ok, ...} / {ok:false, error, message, ...} instead of raising, so
--             8787 and admin.* show the same words. Callers: is_staff() (aal2) or the worker's service role (OV1).
--             Only the service role (the Mac, which can lint) may pass p_lint / p_diff / p_now; from staff they are
--             ignored, so a phone can never mark a draft "lint clean" or move the undo clock.
-- Settings    get_settings(), save_settings(p jsonb): the /settings form of 8787 with validation identical to
--             dashboard/actions.save_settings_all and core/settings.py.
-- Tenders     decide_opportunity(id, act, reason): dashboard/actions.opp_decide.
-- Jobs        queue_run_agent(agent) (staff; allow-list prospector | tenders | brief), claim_jobs / finish_job (worker).
--             run_agent params are pinned by a CHECK so nothing else can be queued.
-- Push (E5)   push_subscriptions (staff-only RLS; save/delete RPCs), push_queue written by triggers on new pending
--             approval_queue rows, intake, tickets, proposals viewed/accepted, invoices paid and error heartbeats.
--             Payloads carry a short fixed title only (no client words). claim_push_batch / finish_push for the sender.
--             Kill switch: settings push.enabled = false.
-- Usage       platform_usage(): DB and Storage bytes against the free-plan caps (F16).

-- A new enum value cannot be used in the transaction that adds it, so this runs on its own, before BEGIN.
alter type approval_status add value if not exists 'edited_pending_lint';

begin;

create extension if not exists pgcrypto;

-- ===================================================================================================== helpers
create or replace function deck_is_service() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role'
$$;

-- The clock: server time, except a test or replay from the Mac's service role may pin it (it can write rows anyway).
create or replace function deck_now(p_now timestamptz) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select case when deck_is_service() and p_now is not null then p_now else now() end
$$;

-- Same audit row as dashboard/actions._log: agent 'dashboard' when the Mac calls, 'admin' from admin.*.
create or replace function deck_audit(p_action text, p_table text, p_id text, p_detail jsonb, p_at timestamptz)
returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into actions (at, agent, run_id, action, target_table, target_id, detail)
  values (coalesce(p_at, now()), case when deck_is_service() then 'dashboard' else 'admin' end, gen_random_uuid(),
          p_action, p_table, p_id,
          case when p_detail is null and deck_is_service() then null
               else coalesce(p_detail, '{}'::jsonb)
                    || case when deck_is_service() then '{}'::jsonb
                            else jsonb_build_object('actor', auth.uid(), 'role', coalesce(auth.role(), 'none')) end end)
$$;

-- dashboard/actions._norm: lower case, whitespace collapsed, end punctuation stripped.
create or replace function deck_norm(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select btrim(btrim(regexp_replace(lower(coalesce(p, '')), '\s+', ' ', 'g')), ' .!?,;:')
$$;

-- Python str.strip(): every kind of whitespace, both ends.
create or replace function deck_strip(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select regexp_replace(coalesce(p, ''), '^\s+|\s+$', '', 'g')
$$;

create or replace function deck_fail(p_code text, p_message text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object('ok', false, 'error', p_code, 'message', p_message) || coalesce(p_extra, '{}'::jsonb)
$$;

create or replace function deck_require_operator() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (is_staff() or deck_is_service()) then
    raise exception 'staff only' using errcode = '42501';
  end if;
end $$;

create or replace function deck_lint_or_null(p jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p) = 'array' then p else null end
$$;

-- ===================================================================================================== Deck rulebook
-- actions.approve without an edit (also used when the "edited" text normalises to the draft).
create or replace function approve_draft(p_id uuid, p_confirm_lint boolean default false, p_lint jsonb default null,
                                         p_now timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r approval_queue;
  v_now timestamptz := deck_now(p_now);
  v_edit boolean;
  v_hits jsonb;
  v_n integer;
  v_status approval_status;
  v_material boolean;
begin
  perform deck_require_operator();
  select * into r from approval_queue where id = p_id for update;
  if r.id is null then
    return deck_fail('not_found', 'Draft not found.');
  end if;
  if r.status <> 'pending' then
    return deck_fail('not_pending', 'Already ' || r.status || '.');
  end if;
  if r.held then
    return deck_fail('held', 'This draft is held. Release it to the deck first.');
  end if;
  -- a stored edit (an off-Mac edit that lint held back) is what gets approved
  v_edit := r.final_text is not null;
  if deck_strip(case when v_edit then r.final_text else r.draft end) = '' then
    return deck_fail('empty', 'Draft is empty. Write something before sending.');
  end if;
  v_hits := coalesce(deck_lint_or_null(r.lint), case when deck_is_service() then deck_lint_or_null(p_lint) end);
  if v_hits is null then
    -- nobody has linted this text and the caller cannot: the Mac lints it before the outbox may claim it
    update approval_queue set status = 'edited_pending_lint', decided_at = v_now, material_edit = null where id = p_id;
    perform deck_audit('approve', 'approval_queue', p_id::text,
                       jsonb_build_object('edited', v_edit, 'pending_lint', true, 'confirmed_lint', false), v_now);
    return jsonb_build_object('ok', true, 'status', 'edited_pending_lint', 'edited', v_edit, 'diff', null,
                              'decided_at', v_now, 'undo_seconds', 10);
  end if;
  v_n := jsonb_array_length(v_hits);
  if v_n > 0 and not coalesce(p_confirm_lint, false) then
    return deck_fail('lint_confirm_required', 'Draft has lint warnings. Confirm to send anyway.', jsonb_build_object('lint', v_hits));
  end if;
  v_status := case when v_edit then 'edited_approved' else 'approved' end;
  v_material := case when v_edit then coalesce((r.diff ->> 'material')::boolean, false) else false end;
  update approval_queue
     set status = v_status, decided_at = v_now,
         final_text = case when v_edit then r.final_text end, diff = case when v_edit then r.diff end,
         material_edit = v_material
   where id = p_id;
  perform deck_audit('approve', 'approval_queue', p_id::text,
                     jsonb_build_object('edited', v_edit, 'lint_hits', v_n, 'confirmed_lint', v_n > 0, 'material_edit', v_material),
                     v_now);
  return jsonb_build_object('ok', true, 'status', v_status, 'edited', v_edit, 'diff', case when v_edit then r.diff end,
                            'decided_at', v_now, 'undo_seconds', 10);
end $$;

-- actions.approve with final_text. From the Mac (service role) p_lint / p_diff carry Python's lint and diff and the
-- draft goes straight to edited_approved, as today. From admin.* it goes to edited_pending_lint (EN5).
create or replace function edit_and_approve_draft(p_id uuid, p_body text, p_confirm_lint boolean default false,
                                                  p_lint jsonb default null, p_diff jsonb default null,
                                                  p_now timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r approval_queue;
  v_now timestamptz := deck_now(p_now);
  v_text text := deck_strip(p_body);
  v_hits jsonb;
  v_n integer;
  v_material boolean;
begin
  perform deck_require_operator();
  select * into r from approval_queue where id = p_id for update;
  if r.id is null then
    return deck_fail('not_found', 'Draft not found.');
  end if;
  if r.status <> 'pending' then
    return deck_fail('not_pending', 'Already ' || r.status || '.');
  end if;
  if r.held then
    return deck_fail('held', 'This draft is held. Release it to the deck first.');
  end if;
  if deck_norm(p_body) = deck_norm(r.draft) then
    -- not an edit (actions.approve: the text normalises to the draft): approve the draft itself
    if r.final_text is not null then
      update approval_queue set final_text = null, diff = null where id = p_id;
    end if;
    return approve_draft(p_id, p_confirm_lint, p_lint, p_now);
  end if;
  if v_text = '' then
    return deck_fail('empty', 'Draft is empty. Write something before sending.');
  end if;
  if length(v_text) > 20000 then
    return deck_fail('too_long', 'Draft is too long (20,000 characters at most).');
  end if;
  v_hits := case when deck_is_service() then deck_lint_or_null(p_lint) end;
  if v_hits is null then
    update approval_queue
       set status = 'edited_pending_lint', decided_at = v_now, final_text = v_text, diff = null, material_edit = null
     where id = p_id;
    perform deck_audit('approve', 'approval_queue', p_id::text,
                       jsonb_build_object('edited', true, 'pending_lint', true, 'confirmed_lint', false), v_now);
    return jsonb_build_object('ok', true, 'status', 'edited_pending_lint', 'edited', true, 'diff', null,
                              'decided_at', v_now, 'undo_seconds', 10);
  end if;
  v_n := jsonb_array_length(v_hits);
  if v_n > 0 and not coalesce(p_confirm_lint, false) then
    return deck_fail('lint_confirm_required', 'Draft has lint warnings. Confirm to send anyway.', jsonb_build_object('lint', v_hits));
  end if;
  v_material := coalesce((p_diff ->> 'material')::boolean, false);
  update approval_queue
     set status = 'edited_approved', decided_at = v_now, final_text = v_text, diff = p_diff,
         material_edit = v_material, lint = v_hits
   where id = p_id;
  perform deck_audit('approve', 'approval_queue', p_id::text,
                     jsonb_build_object('edited', true, 'lint_hits', v_n, 'confirmed_lint', v_n > 0, 'material_edit', v_material),
                     v_now);
  return jsonb_build_object('ok', true, 'status', 'edited_approved', 'edited', true, 'diff', p_diff,
                            'decided_at', v_now, 'undo_seconds', 10);
end $$;

-- actions.undo: back to pending inside the undo window and before the outbox claims it.
create or replace function undo_decision(p_id uuid, p_now timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := deck_now(p_now);
  v_status approval_status;
begin
  perform deck_require_operator();
  update approval_queue
     set status = 'pending', decided_at = null, final_text = null, diff = null, material_edit = null
   where id = p_id and status in ('approved', 'edited_approved', 'edited_pending_lint')
     and decided_at >= v_now - interval '10 seconds';
  if found then
    perform deck_audit('undo', 'approval_queue', p_id::text, null, v_now);
    return jsonb_build_object('ok', true);
  end if;
  select status into v_status from approval_queue where id = p_id;
  if v_status is null then
    return deck_fail('not_found', 'Draft not found.');
  end if;
  if v_status = 'pending' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  return deck_fail('too_late', 'Too late, already sending.');
end $$;

create or replace function reject_draft(p_id uuid, p_reason text default null, p_now timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := deck_now(p_now);
  v_status approval_status;
  v_reason text := nullif(left(deck_strip(p_reason), 300), '');
begin
  perform deck_require_operator();
  select status into v_status from approval_queue where id = p_id;
  if v_status is null then
    return deck_fail('not_found', 'Draft not found.');
  end if;
  update approval_queue set status = 'rejected', decided_at = v_now where id = p_id and status = 'pending';
  if not found then
    select status into v_status from approval_queue where id = p_id;
    return deck_fail('not_pending', 'Already ' || v_status || '.');
  end if;
  perform deck_audit('reject', 'approval_queue', p_id::text, jsonb_build_object('reason', v_reason), v_now);
  return jsonb_build_object('ok', true);
end $$;

-- actions.later ("hold" on the Deck): no state change; the audit row moves it to the end of the deck.
create or replace function hold_draft(p_id uuid, p_now timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_status approval_status;
begin
  perform deck_require_operator();
  select status into v_status from approval_queue where id = p_id;
  if v_status is null then
    return deck_fail('not_found', 'Draft not found.');
  end if;
  if v_status <> 'pending' then
    return deck_fail('not_pending', 'Already ' || v_status || '.');
  end if;
  perform deck_audit('later', 'approval_queue', p_id::text, null, deck_now(p_now));
  return jsonb_build_object('ok', true);
end $$;

-- actions.release_held
create or replace function release_held_draft(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_was text;
begin
  perform deck_require_operator();
  update approval_queue a set held = false
    from (select id, held_reason from approval_queue where id = p_id for update) old
   where a.id = old.id and a.status = 'pending' and a.held
  returning old.held_reason into v_was;
  if not found then
    return deck_fail('not_held', 'Not a held draft.');
  end if;
  perform deck_audit('release_held', 'approval_queue', p_id::text, jsonb_build_object('was', v_was), null);
  return jsonb_build_object('ok', true);
end $$;

-- The Mac's lint step for edited_pending_lint (service role only): p_lint is core.lint.lint(text), p_diff is
-- actions.compute_diff(draft, final_text). Clean -> approved / edited_approved (decided_at kept, so the undo window
-- still counts from the founder's tap). Hits -> pending + held with "lint: <types>", exactly like a held draft.
create or replace function complete_draft_lint(p_id uuid, p_lint jsonb, p_diff jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r approval_queue;
  v_hits jsonb := deck_lint_or_null(p_lint);
  v_reason text;
begin
  if not deck_is_service() then
    raise exception 'worker only' using errcode = '42501';
  end if;
  if v_hits is null then
    raise exception 'lint must be a JSON array' using errcode = '22023';
  end if;
  select * into r from approval_queue where id = p_id for update;
  if r.id is null then
    return deck_fail('not_found', 'Draft not found.');
  end if;
  if r.status <> 'edited_pending_lint' then
    return deck_fail('not_pending_lint', 'Already ' || r.status || '.');
  end if;
  if jsonb_array_length(v_hits) = 0 then
    update approval_queue
       set status = case when r.final_text is null then 'approved'::approval_status else 'edited_approved'::approval_status end,
           lint = v_hits,
           diff = case when r.final_text is null then null else p_diff end,
           material_edit = case when r.final_text is null then false else coalesce((p_diff ->> 'material')::boolean, false) end
     where id = p_id;
    perform deck_audit('lint_passed', 'approval_queue', p_id::text,
                       jsonb_build_object('edited', r.final_text is not null), null);
    return jsonb_build_object('ok', true, 'status', case when r.final_text is null then 'approved' else 'edited_approved' end);
  end if;
  select 'lint: ' || string_agg(t, ', ' order by t) into v_reason
    from (select distinct coalesce(h ->> 'type', '?') as t from jsonb_array_elements(v_hits) h) x;
  update approval_queue
     set status = 'pending', held = true, held_reason = v_reason, lint = v_hits, diff = p_diff,
         decided_at = null, material_edit = null
   where id = p_id;
  perform deck_audit('lint_held', 'approval_queue', p_id::text,
                     jsonb_build_object('lint_hits', jsonb_array_length(v_hits), 'reason', v_reason), null);
  return jsonb_build_object('ok', true, 'status', 'held', 'held_reason', v_reason, 'lint', v_hits);
end $$;

-- ===================================================================================================== settings
-- Code defaults of core/settings.py (DEFAULTS), so "changed" is computed the same way as cfg.get(db, key) != value.
create or replace function settings_defaults() returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'prospector.per_day', 40,
    'prospector.markets', to_jsonb(string_to_array('US CA MX BR CL GB IE AT BE BG HR CY CZ DK EE FI FR DE GR HU IT LV LT LU MT NL PL PT RO SK SI ES SE NO IS LI CH TR IL AE SA QA KW BH OM JO EG MA ZA KE NG SG MY ID TH VN PH HK TW JP KR AU NZ', ' ')),
    'prospector.segments', '["industrial","oem_hardware","smb_software"]'::jsonb,
    'prospector.paused', false,
    'llm.daily_budget', 250,
    'outreach.daily_cap', 50,
    'outreach.ramp', '{"start":5,"step":5,"every_days":3}'::jsonb,
    'outreach.started_on', null,
    'outreach.address', '',
    'strategy.quotas', '{"s2_trigger":6,"s3_regulation":4,"s4_partner":6,"s5_intent":5,"s7_orphaned":6,"s8_tradeshow":5,"s9_crowdfund":4,"s10_accelerator":4}'::jsonb,
    'strategy.auto_rebalance', true,
    'strategy.pinned', '[]'::jsonb,
    'tenders.per_day', 15,
    'tenders.value_min', 10000,
    'tenders.value_max', 500000,
    'tenders.sources', '["ted","uk_fts","uk_cf","canadabuys","austender","ungm","samgov","worldbank","ebrd"]'::jsonb,
    'tenders.paused', false,
    'push.enabled', true)
$$;

-- Python str(p.get(k, "")) for a JSON form value.
create or replace function settings_str(p jsonb, k text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case jsonb_typeof(p -> k)
           when 'string' then p ->> k
           when 'boolean' then case when (p -> k)::boolean then 'True' else 'False' end
           when 'null' then 'None'
           when 'number' then p ->> k
           when 'array' then (p -> k)::text
           when 'object' then (p -> k)::text
           else '' end
$$;

-- core/settings._int on a stripped string: whole number or null.
create or replace function settings_int(p text) returns bigint
language sql immutable set search_path = public, pg_temp as $$
  select case when deck_strip(p) ~ '^-?[0-9]{1,15}$' then deck_strip(p)::bigint end
$$;

-- p.get(k) in (True, "1", "on", "true")
create or replace function settings_on(p jsonb, k text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p -> k = 'true'::jsonb or (jsonb_typeof(p -> k) = 'string' and p ->> k in ('1', 'on', 'true')), false)
$$;

-- a checkbox group: a list, or one string
create or replace function settings_list(p jsonb, k text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case jsonb_typeof(p -> k)
           when 'array' then array(select case jsonb_typeof(e) when 'string' then e #>> '{}' else e::text end
                                     from jsonb_array_elements(p -> k) e)
           when 'string' then case when p ->> k = '' then '{}'::text[] else array[p ->> k] end
           else '{}'::text[] end
$$;

create or replace function get_settings() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
begin
  perform deck_require_operator();
  select settings_defaults() || coalesce(jsonb_object_agg(key, value) filter (where value <> 'null'::jsonb), '{}'::jsonb)
    into v from settings;
  return v;
end $$;

-- dashboard/actions.save_settings_all: validate every field first; one bad field saves nothing and reports all errors.
create or replace function save_settings(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  segs constant text[] := array['industrial','oem_hardware','smb_software'];
  sids constant text[] := array['s2_trigger','s3_regulation','s4_partner','s5_intent','s7_orphaned','s8_tradeshow','s9_crowdfund','s10_accelerator'];
  slabel constant jsonb := '{"s2_trigger":"Trigger events","s3_regulation":"Regulation","s4_partner":"Partners","s5_intent":"Outsourcing intent","s7_orphaned":"Orphaned devices","s8_tradeshow":"Trade-show exhibitors","s9_crowdfund":"Crowdfunded hardware","s10_accelerator":"Accelerators and spinouts"}'::jsonb;
  srcs constant text[] := array['ted','uk_fts','uk_cf','canadabuys','austender','ungm','samgov','worldbank','ebrd',
                                'adb','afdb','isdb','aiib','etimad','dubai','monaqasat','oman','bahrain','kuwait'];
  excluded constant text[] := array['PK','IR','KP','SY','CU','RU','BY'];
  defaults jsonb := settings_defaults();
  stored jsonb;
  errors jsonb := '{}'::jsonb;
  terrors jsonb := '{}'::jsonb;
  clean jsonb := '{}'::jsonb;          -- ordered writes: main keys, then tender keys
  tclean jsonb := '{}'::jsonb;
  n bigint;
  per_day bigint;
  f record;
  arr text[];
  bad text[];
  x text;
  code text;
  quotas jsonb := '{}'::jsonb;
  total bigint;
  addr text;
  cur jsonb;
  changed text[] := '{}';
  tchanged text[] := '{}';
  k text;
begin
  perform deck_require_operator();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'settings must be a JSON object' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into stored from settings;

  -- Tenders fieldset (actions.tender_fields), validated first; any error saves nothing
  if p ? 'tenders_per_day' then
    n := settings_int(settings_str(p, 'tenders_per_day'));
    if n is null or n not between 0 and 50 then
      terrors := terrors || '{"tenders_per_day":"Enter a whole number from 0 to 50."}';
    else
      tclean := tclean || jsonb_build_object('tenders.per_day', n);
    end if;
    foreach x in array array['tenders_value_min', 'tenders_value_max'] loop
      n := settings_int(settings_str(p, x));
      if n is null or n not between 0 and 100000000 then
        terrors := terrors || jsonb_build_object(x, 'Enter a whole dollar amount from 0 to 100,000,000.');
      else
        tclean := tclean || jsonb_build_object(replace(x, 'tenders_', 'tenders.'), n);
      end if;
    end loop;
    arr := settings_list(p, 'tenders_sources');
    bad := array(select s from unnest(arr) with ordinality u(s, o) where s <> all(srcs) order by o);
    if cardinality(bad) > 0 then
      terrors := terrors || jsonb_build_object('tenders_sources', 'Unknown source: ' || array_to_string(bad, ', '));
    elsif not exists (select 1 from unnest(srcs) s where s = any(arr)) then
      terrors := terrors || '{"tenders_sources":"Pick at least one source, or pause tenders."}';
    else
      tclean := tclean || jsonb_build_object('tenders.sources', to_jsonb(array(select s from unnest(srcs) with ordinality u(s, o) where s = any(arr) order by o)));
    end if;
    tclean := tclean || jsonb_build_object('tenders.paused', settings_on(p, 'tenders_paused'));
    if terrors = '{}'::jsonb and (tclean ->> 'tenders.value_min')::bigint > (tclean ->> 'tenders.value_max')::bigint then
      terrors := terrors || '{"tenders_value_min":"The minimum cannot be above the maximum."}';
    end if;
    if terrors <> '{}'::jsonb then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Some settings need attention.', 'errors', terrors);
    end if;
  end if;

  -- actions.save_settings: bounded whole numbers
  for f in select * from (values ('per_day', 'prospector.per_day', 0, 80), ('daily_budget', 'llm.daily_budget', 50, 1000),
                                 ('daily_cap', 'outreach.daily_cap', 0, 100)) v(field, key, lo, hi) loop
    n := settings_int(btrim(settings_str(p, f.field)));
    if n is null or n not between f.lo and f.hi then
      errors := errors || jsonb_build_object(f.field, format('Enter a whole number from %s to %s.', f.lo, f.hi));
    else
      clean := clean || jsonb_build_object(f.key, n);
    end if;
  end loop;
  arr := settings_list(p, 'segments');
  bad := array(select s from unnest(arr) with ordinality u(s, o) where s <> all(segs) order by o);
  if cardinality(bad) > 0 then
    errors := errors || jsonb_build_object('segments', 'Unknown segment: ' || array_to_string(bad, ', '));
  elsif not exists (select 1 from unnest(segs) s where s = any(arr)) then
    errors := errors || '{"segments":"Pick at least one segment, or pause the prospector."}';
  else
    clean := clean || jsonb_build_object('prospector.segments', to_jsonb(array(select s from unnest(segs) with ordinality u(s, o) where s = any(arr) order by o)));
  end if;
  clean := clean || jsonb_build_object('prospector.paused', settings_on(p, 'paused'));
  per_day := (clean ->> 'prospector.per_day')::bigint;

  -- Strategies fieldset (core/settings.strategy_form): only when the form carries quota fields
  if exists (select 1 from unnest(sids) s where p ? ('quota_' || s)) then
    declare
      serr jsonb := '{}'::jsonb;
      markets text[] := '{}';
      merr text;
    begin
      foreach x in array sids loop
        n := settings_int(btrim(case when p ? ('quota_' || x) then settings_str(p, 'quota_' || x) else '' end));
        if n is null or n not between 0 and 50 then
          serr := serr || jsonb_build_object('quota_' || x, 'Enter a whole number from 0 to 50.');
        else
          quotas := quotas || jsonb_build_object(x, n);
        end if;
      end loop;
      if serr = '{}'::jsonb and per_day is not null then
        select sum(value::bigint) into total from jsonb_each_text(quotas);
        if total > per_day then
          serr := serr || jsonb_build_object('quotas', format(
            'Quotas add up to %s, more than the %s prospects per day. Lower a quota or raise the daily total.', total, per_day));
        end if;
      end if;
      if serr = '{}'::jsonb and p ? 'markets' then
        foreach x in array regexp_split_to_array(settings_str(p, 'markets'), '[\s,;]+') loop
          code := upper(btrim(x));
          continue when code = '';
          if code !~ '^[A-Z]{2}$' then
            merr := format('''%s'' is not a two-letter country code.', left(btrim(x), 20));
            exit;
          end if;
          if code <> all(excluded) and code <> all(markets) then
            markets := markets || code;
          end if;
        end loop;
        if merr is null and cardinality(markets) = 0 then
          merr := 'Keep at least one market (Pakistan and sanctioned markets are never allowed).';
        end if;
        if merr is not null then
          serr := jsonb_build_object('markets', merr);
        else
          clean := clean || jsonb_build_object('prospector.markets', to_jsonb(markets));
        end if;
      end if;
      if serr <> '{}'::jsonb then
        errors := errors || serr;
      else
        clean := clean || jsonb_build_object(
          'strategy.quotas', quotas,
          'strategy.auto_rebalance', settings_on(p, 'auto_rebalance'),
          'strategy.pinned', to_jsonb(array(select s from unnest(sids) with ordinality u(s, o) where settings_on(p, 'pin_' || s) order by o)));
      end if;
    end;
  end if;

  -- outreach.address: settable once, then read-only here
  cur := stored -> 'outreach.address';
  if coalesce(cur #>> '{}', '') = '' then
    addr := lower(btrim(case when jsonb_typeof(p -> 'address') = 'string' then p ->> 'address'
                             when p -> 'address' is null or p -> 'address' = 'null'::jsonb then ''
                             else settings_str(p, 'address') end));
    if addr <> '' and addr !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
      errors := errors || '{"address":"Enter a full email address."}';
    elsif addr <> '' then
      clean := clean || jsonb_build_object('outreach.address', addr);
    end if;
  end if;

  if errors <> '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Some settings need attention.', 'errors', errors);
  end if;

  for k in select key from jsonb_each(clean) loop
    if coalesce(nullif(stored -> k, 'null'::jsonb), defaults -> k) is distinct from clean -> k then
      insert into settings (key, value) values (k, clean -> k)
      on conflict (key) do update set value = excluded.value, updated_at = now();
      changed := changed || k;
    end if;
  end loop;
  if cardinality(changed) > 0 then
    perform deck_audit('settings_changed', null, null, jsonb_build_object('keys', to_jsonb(changed)), null);
  end if;
  for k in select key from jsonb_each(tclean) loop
    if coalesce(nullif(stored -> k, 'null'::jsonb), defaults -> k) is distinct from tclean -> k then
      insert into settings (key, value) values (k, tclean -> k)
      on conflict (key) do update set value = excluded.value, updated_at = now();
      tchanged := tchanged || k;
    end if;
  end loop;
  if cardinality(tchanged) > 0 then
    perform deck_audit('settings_changed', null, null, jsonb_build_object('keys', to_jsonb(tchanged)), null);
  end if;
  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed || tchanged));
end $$;

-- ===================================================================================================== tenders
-- dashboard/actions.opp_decide: records the founder's decision only. Nothing bids or contacts anyone.
create or replace function decide_opportunity(p_id uuid, p_act text, p_reason text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_from text[];
  v_to text;
  v_status text;
  v_note text := '';
  v_verb text;
begin
  perform deck_require_operator();
  select f, t, w into v_from, v_to, v_verb from (values
    ('bid', array['new','pass'], 'bid', 'Marked as bid'), ('pass', array['new','bid'], 'pass', 'Passed'),
    ('submitted', array['bid'], 'submitted', 'Marked as submitted'), ('won', array['submitted','bid'], 'won', 'Marked as won'),
    ('lost', array['submitted','bid'], 'lost', 'Marked as lost')) m(a, f, t, w)
   where a = p_act;
  if v_to is null then
    return deck_fail('unknown_action', 'Unknown action.');
  end if;
  select status into v_status from opportunities where id = p_id;
  if v_status is null then
    return deck_fail('not_found', 'No such opportunity.');
  end if;
  if p_act = 'pass' then
    v_note := left(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), 300);
  end if;
  update opportunities
     set status = v_to, decided_at = now(), notes = case when v_note <> '' then v_note else notes end
   where id = p_id and status = any(v_from);
  if not found then
    return deck_fail('conflict', 'This opportunity is now ' || v_status || '; reload to see it.');
  end if;
  perform deck_audit('opportunity_' || p_act, 'opportunities', p_id::text,
                     case when v_note <> '' then jsonb_build_object('reason', v_note) end, null);
  return jsonb_build_object('ok', true, 'status', v_to, 'message', v_verb);
end $$;

-- ===================================================================================================== jobs: run now
-- Only run_agent with an allow-listed agent may be queued as run_agent (NOT VALID: older rows are left alone).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_run_agent_allowlist') then
    alter table jobs add constraint jobs_run_agent_allowlist
      check (type <> 'run_agent' or (coalesce(params ->> 'agent', '') in ('prospector','tenders','brief')
                                     and params - 'agent' = '{}'::jsonb)) not valid;
  end if;
end $$;

-- Staff: "Run now". One open request per agent; the Mac worker starts it with launchctl kickstart.
create or replace function queue_run_agent(p_agent text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  perform deck_require_operator();
  if p_agent is null or p_agent not in ('prospector', 'tenders', 'brief') then
    return deck_fail('unknown_job', 'That job can''t be started from here.');
  end if;
  select id into v_id from jobs
   where type = 'run_agent' and params ->> 'agent' = p_agent and status in ('queued', 'claimed', 'running')
     and created_at > now() - interval '30 minutes'
   order by created_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'id', v_id, 'already', true);
  end if;
  insert into jobs (type, params, expires_at, requested_by)
  values ('run_agent', jsonb_build_object('agent', p_agent), now() + interval '30 minutes', auth.uid())
  returning id into v_id;
  perform deck_audit('run_agent_queued', 'jobs', v_id::text, jsonb_build_object('agent', p_agent), null);
  return jsonb_build_object('ok', true, 'id', v_id, 'already', false);
end $$;

-- Worker (service role): expire, recover lapsed leases (retry once, then failed), then claim with a lease.
create or replace function claim_jobs(p_types text[], p_lease_seconds integer default 300, p_limit integer default 5)
returns setof jobs
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not deck_is_service() then
    raise exception 'worker only' using errcode = '42501';
  end if;
  update jobs set status = 'expired', finished_at = now()
   where status = 'queued' and expires_at is not null and expires_at < now();
  update jobs set status = 'failed', finished_at = now(), error = 'lease lapsed (worker stopped) and the retry also lapsed'
   where status in ('claimed', 'running') and lease_until < now() and attempts >= 2;
  update jobs set status = 'queued', lease_until = null
   where status in ('claimed', 'running') and lease_until < now() and attempts < 2;
  return query
  update jobs j
     set status = 'claimed', lease_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 3600))),
         attempts = j.attempts + 1, started_at = coalesce(j.started_at, now())
   where j.id in (select id from jobs
                   where status = 'queued' and type = any(p_types) and (expires_at is null or expires_at > now())
                   order by created_at
                   limit greatest(1, least(coalesce(p_limit, 5), 50))
                   for update skip locked)
  returning j.*;
end $$;

create or replace function finish_job(p_id uuid, p_ok boolean, p_result jsonb default null, p_error text default null)
returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not deck_is_service() then
    raise exception 'worker only' using errcode = '42501';
  end if;
  update jobs
     set status = case when p_ok then 'done' else 'failed' end, finished_at = now(), lease_until = null,
         result = p_result, error = left(p_error, 1000)
   where id = p_id and status in ('claimed', 'running');
  return found;
end $$;

-- ===================================================================================================== push (E5)
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  keys        jsonb not null check (jsonb_typeof(keys) = 'object' and keys ? 'p256dh' and keys ? 'auth'),
  user_agent  text check (user_agent is null or length(user_agent) <= 300),
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

create table if not exists push_queue (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (length(title) between 1 and 120),
  body        text check (body is null or length(body) <= 200),
  url         text not null default '/' check (url ~ '^/[A-Za-z0-9/_.?=&-]*$' and length(url) <= 300),
  kind        text not null check (kind in ('draft','reply','intake','ticket','proposal','invoice','agent_error','test')),
  urgent      boolean not null default false,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  sent_at     timestamptz,
  emailed_at  timestamptz,
  error       text check (error is null or length(error) <= 500)
);
create index if not exists push_queue_pending_idx on push_queue (created_at) where sent_at is null and error is null;
create index if not exists push_queue_kind_idx on push_queue (kind, created_at desc);

-- One row per full-scope staff user. Fixed titles only (E5): never a client's words.
create or replace function push_staff(p_kind text, p_title text, p_body text, p_url text, p_urgent boolean) returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  if exists (select 1 from settings where key = 'push.enabled' and value = 'false'::jsonb) then
    return 0;
  end if;
  insert into push_queue (user_id, kind, title, body, url, urgent)
  select s.user_id, p_kind, left(p_title, 120), left(p_body, 200), coalesce(p_url, '/'), coalesce(p_urgent, false)
    from staff s where s.scope = 'full';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Triggers never block the write that fired them: push is best-effort (Reliability baseline).
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
      -- a prospector batch is one push, not forty
      if not exists (select 1 from push_queue where kind = 'draft' and created_at > now() - interval '30 minutes') then
        perform push_staff('draft', 'New drafts to approve', 'Open Approvals to review them.', '/approvals', false);
      end if;
    elsif coalesce(new.kind, 'reply') <> 'ack' then        -- an intake ack is covered by the intake push
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

create or replace function push_on_intake() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform push_staff('intake', 'New enquiry on epsilon-labs.co', 'Open Intake to read it.', '/intake/' || new.id::text, true);
  exception when others then
    raise warning 'push_on_intake: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function push_on_ticket() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if not exists (select 1 from organizations o where o.id = new.org_id and (o.is_test or o.is_demo)) then
      perform push_staff('ticket', 'New ticket ' || new.ref || case when new.priority = 'urgent' then ' · urgent' else '' end,
                         'Open Tickets to triage it.', '/tickets/' || new.id::text, new.priority = 'urgent');
    end if;
  exception when others then
    raise warning 'push_on_ticket: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function push_on_proposal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.status = 'viewed' and old.status is distinct from 'viewed' then
      perform push_staff('proposal', 'Proposal viewed', 'A prospect opened a proposal link.', '/proposals/' || new.id::text, false);
    elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
      perform push_staff('proposal', 'Proposal accepted', 'Deposit invoice is next.', '/proposals/' || new.id::text, true);
    end if;
  exception when others then
    raise warning 'push_on_proposal: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function push_on_invoice() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.status = 'paid' and old.status is distinct from 'paid'
       and not exists (select 1 from organizations o where o.id = new.org_id and (o.is_test or o.is_demo)) then
      perform push_staff('invoice', 'Invoice ' || coalesce(new.number, '') || ' paid', null, '/invoices/' || new.id::text, true);
    end if;
  exception when others then
    raise warning 'push_on_invoice: %', sqlerrm;
  end;
  return null;
end $$;

-- An error heartbeat pushes once per agent per hour (the outbox beats every minute).
create or replace function push_on_heartbeat() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status <> 'error' then
    return null;
  end if;
  begin
    if not exists (select 1 from push_queue where kind = 'agent_error' and body = 'Agent: ' || left(new.agent, 60)
                     and created_at > now() - interval '60 minutes') then
      perform push_staff('agent_error', 'Agent error: ' || left(new.agent, 60), 'Agent: ' || left(new.agent, 60), '/agents', true);
    end if;
  exception when others then
    raise warning 'push_on_heartbeat: %', sqlerrm;
  end;
  return null;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'approval_queue_push') then
    create trigger approval_queue_push after insert on approval_queue for each row execute function push_on_approval();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'intake_push') then
    create trigger intake_push after insert on intake for each row execute function push_on_intake();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tickets_push') then
    create trigger tickets_push after insert on tickets for each row execute function push_on_ticket();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'proposals_push') then
    create trigger proposals_push after update of status on proposals for each row execute function push_on_proposal();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'invoices_push') then
    create trigger invoices_push after update of status on invoices for each row execute function push_on_invoice();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'agent_heartbeats_push') then
    create trigger agent_heartbeats_push after insert on agent_heartbeats for each row execute function push_on_heartbeat();
  end if;
end $$;

-- Staff: this device's subscription (an endpoint seen before moves to the current user).
create or replace function save_push_subscription(p_endpoint text, p_keys jsonb, p_user_agent text default null) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then
    raise exception 'invalid endpoint' using errcode = '22023';
  end if;
  if p_keys is null or jsonb_typeof(p_keys) <> 'object' or coalesce(jsonb_typeof(p_keys -> 'p256dh'), '') <> 'string'
     or coalesce(jsonb_typeof(p_keys -> 'auth'), '') <> 'string' or length(p_keys::text) > 500 then
    raise exception 'invalid keys' using errcode = '22023';
  end if;
  insert into push_subscriptions (user_id, endpoint, keys, user_agent)
  values (auth.uid(), p_endpoint, jsonb_build_object('p256dh', p_keys ->> 'p256dh', 'auth', p_keys ->> 'auth'), left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys, user_agent = excluded.user_agent
  returning id into v_id;
  perform deck_audit('push_subscribed', 'push_subscriptions', v_id::text, null, null);
  return v_id;
end $$;

create or replace function delete_push_subscription(p_endpoint text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  return found;
end $$;

-- Staff: queue a test notification to yourself (the settings "Send a test" button).
create or replace function queue_test_push() returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  insert into push_queue (user_id, kind, title, body, url) values (auth.uid(), 'test', 'Test notification', 'Push works on this device.', '/settings')
  returning id into v_id;
  return v_id;
end $$;

-- Sender (service role): claim a batch (stale claims are retried after 5 min), prune sent rows after 14 days.
create or replace function claim_push_batch(p_limit integer default 50) returns setof push_queue
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not deck_is_service() then
    raise exception 'sender only' using errcode = '42501';
  end if;
  delete from push_queue where created_at < now() - interval '14 days';
  -- older than a day and never delivered: give up quietly rather than buzz a phone with stale news
  update push_queue set error = 'expired before delivery'
   where sent_at is null and error is null and created_at < now() - interval '1 day';
  return query
  update push_queue q set claimed_at = now()
   where q.id in (select id from push_queue
                   where sent_at is null and error is null and (claimed_at is null or claimed_at < now() - interval '5 minutes')
                   order by created_at
                   limit greatest(1, least(coalesce(p_limit, 50), 200))
                   for update skip locked)
  returning q.*;
end $$;

create or replace function finish_push(p_id uuid, p_sent boolean, p_error text default null, p_emailed boolean default false)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not deck_is_service() then
    raise exception 'sender only' using errcode = '42501';
  end if;
  update push_queue
     set sent_at = case when p_sent then now() else sent_at end,
         error = case when p_sent then null else left(coalesce(p_error, 'failed'), 500) end,
         emailed_at = case when p_emailed then coalesce(emailed_at, now()) else emailed_at end
   where id = p_id;
end $$;

-- ===================================================================================================== usage (F16)
create or replace function platform_usage() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_storage bigint := 0;
begin
  perform deck_require_operator();
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects'
               and column_name = 'metadata') then
    execute 'select coalesce(sum((metadata ->> ''size'')::bigint), 0) from storage.objects' into v_storage;
  end if;
  return jsonb_build_object('db_bytes', pg_database_size(current_database()), 'db_cap', 500 * 1024 * 1024,
                            'storage_bytes', v_storage, 'storage_cap', 1024 * 1024 * 1024);
end $$;

-- ===================================================================================================== RLS + grants
alter table push_subscriptions enable row level security;
alter table push_queue         enable row level security;

do $$
declare
  p record;
  t text;
begin
  for p in
    select * from (values
      ('push_subscriptions', 'own_staff_read', 'user_id = (select auth.uid()) and (select is_staff())'),
      ('push_queue',         'own_staff_read', 'user_id = (select auth.uid()) and (select is_staff())')
    ) as v(tbl, name, expr)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on %I for select to authenticated using (%s)', p.name, p.tbl, p.expr);
    end if;
  end loop;
  foreach t in array array['push_subscriptions', 'push_queue'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'service_role_all') then
      execute format('create policy service_role_all on %I for all to service_role using (true) with check (true)', t);
    end if;
  end loop;
end $$;

revoke all on push_subscriptions, push_queue from public, anon, authenticated;
grant select (id, user_id, endpoint, user_agent, created_at) on push_subscriptions to authenticated;
grant select on push_queue to authenticated;
grant all on push_subscriptions, push_queue to service_role;

revoke all on function
  deck_is_service(), deck_now(timestamptz), deck_audit(text, text, text, jsonb, timestamptz), deck_norm(text),
  deck_strip(text), deck_fail(text, text, jsonb), deck_require_operator(), deck_lint_or_null(jsonb),
  approve_draft(uuid, boolean, jsonb, timestamptz), edit_and_approve_draft(uuid, text, boolean, jsonb, jsonb, timestamptz),
  undo_decision(uuid, timestamptz), reject_draft(uuid, text, timestamptz), hold_draft(uuid, timestamptz),
  release_held_draft(uuid), complete_draft_lint(uuid, jsonb, jsonb),
  settings_defaults(), settings_str(jsonb, text), settings_int(text), settings_on(jsonb, text), settings_list(jsonb, text),
  get_settings(), save_settings(jsonb), decide_opportunity(uuid, text, text),
  queue_run_agent(text), claim_jobs(text[], integer, integer), finish_job(uuid, boolean, jsonb, text),
  push_staff(text, text, text, text, boolean), push_on_approval(), push_on_intake(), push_on_ticket(), push_on_proposal(),
  push_on_invoice(), push_on_heartbeat(), save_push_subscription(text, jsonb, text), delete_push_subscription(text),
  queue_test_push(), claim_push_batch(integer), finish_push(uuid, boolean, text, boolean), platform_usage()
from public, anon, authenticated;

grant execute on function
  approve_draft(uuid, boolean, jsonb, timestamptz), edit_and_approve_draft(uuid, text, boolean, jsonb, jsonb, timestamptz),
  undo_decision(uuid, timestamptz), reject_draft(uuid, text, timestamptz), hold_draft(uuid, timestamptz),
  release_held_draft(uuid), get_settings(), save_settings(jsonb), decide_opportunity(uuid, text, text),
  queue_run_agent(text), platform_usage()
to authenticated, service_role;
grant execute on function save_push_subscription(text, jsonb, text), delete_push_subscription(text), queue_test_push()
to authenticated;
grant execute on function complete_draft_lint(uuid, jsonb, jsonb), claim_jobs(text[], integer, integer),
  finish_job(uuid, boolean, jsonb, text), claim_push_batch(integer), finish_push(uuid, boolean, text, boolean)
to service_role;

commit;
