-- Epsilon OS migration 013: research sources. Software strategies S11-S13, the prospector.mix setting and the
-- Pakistan PPRA EPMS tender source. Requires 011. Idempotent; no table rewrites, no change to existing rows' data.
--
-- Settings      settings_defaults() and save_settings(p jsonb) are 011's bodies with only these changes, so the hosted
--               rulebook stays identical to dashboard/actions.save_settings_all and core/settings.py:
--                 - strategy ids and labels gain s11_software, s12_devpartner, s13_hn; default quotas become
--                   24 hardware + 16 software (= 40% software of the default 40 a day)
--                 - new key prospector.mix (whole number 0-100, default 40): validated only when the form posts `mix`,
--                   so an older client without the field leaves it alone
--                 - tenders sources allow-list and default list gain ppra_epms (enabled by default)
-- Constraints   companies_strategy_chk / deals_strategy_chk accept the three new strategy ids, and the opportunities
--               source check accepts ppra_epms (dropped and re-created with the longer list; existing rows all pass).
-- Eligibility   no new column: a PPRA notice's Pakistani registration hints (PEC category, FBR, OEM letter) are stored
--               in the existing jsonb columns, raw.eligibility_flags (what code read) and fit.eligibility.notes
--               ("Needs PEC C-6 ..."), which both the 8787 and admin Opportunities pages already show.
-- Grants        create or replace keeps 011's grants and revokes on both functions.

begin;

alter table companies drop constraint if exists companies_strategy_chk;
alter table companies add constraint companies_strategy_chk
  check (strategy is null or strategy in ('s2_trigger','s3_regulation','s4_partner','s5_intent','s7_orphaned','s8_tradeshow',
                                          's9_crowdfund','s10_accelerator','s11_software','s12_devpartner','s13_hn','legacy'));
alter table deals drop constraint if exists deals_strategy_chk;
alter table deals add constraint deals_strategy_chk
  check (strategy is null or strategy in ('s2_trigger','s3_regulation','s4_partner','s5_intent','s7_orphaned','s8_tradeshow',
                                          's9_crowdfund','s10_accelerator','s11_software','s12_devpartner','s13_hn','legacy'));

alter table opportunities drop constraint if exists opportunities_source_check;
alter table opportunities add constraint opportunities_source_check
  check (source in ('ted','uk_fts','uk_cf','canadabuys','austender','ungm','samgov','worldbank','ebrd','ppra_epms',
                    'adb','afdb','isdb','aiib','etimad','dubai','monaqasat','oman','bahrain','kuwait'));

-- Code defaults of core/settings.py (DEFAULTS), so "changed" is computed the same way as cfg.get(db, key) != value.
create or replace function settings_defaults() returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'prospector.per_day', 40,
    'prospector.markets', to_jsonb(string_to_array('US CA MX BR CL GB IE AT BE BG HR CY CZ DK EE FI FR DE GR HU IT LV LT LU MT NL PL PT RO SK SI ES SE NO IS LI CH TR IL AE SA QA KW BH OM JO EG MA ZA KE NG SG MY ID TH VN PH HK TW JP KR AU NZ', ' ')),
    'prospector.segments', '["industrial","oem_hardware","smb_software"]'::jsonb,
    'prospector.paused', false,
    'prospector.mix', 40,
    'llm.daily_budget', 250,
    'outreach.daily_cap', 50,
    'outreach.ramp', '{"start":5,"step":5,"every_days":3}'::jsonb,
    'outreach.started_on', null,
    'outreach.address', '',
    'strategy.quotas', '{"s2_trigger":4,"s3_regulation":2,"s4_partner":4,"s5_intent":3,"s7_orphaned":4,"s8_tradeshow":3,"s9_crowdfund":2,"s10_accelerator":2,"s11_software":7,"s12_devpartner":5,"s13_hn":4}'::jsonb,
    'strategy.auto_rebalance', true,
    'strategy.pinned', '[]'::jsonb,
    'tenders.per_day', 15,
    'tenders.value_min', 10000,
    'tenders.value_max', 500000,
    'tenders.sources', '["ted","uk_fts","uk_cf","canadabuys","austender","ungm","samgov","worldbank","ebrd","ppra_epms"]'::jsonb,
    'tenders.paused', false,
    'push.enabled', true)
$$;


-- dashboard/actions.save_settings_all: validate every field first; one bad field saves nothing and reports all errors.
create or replace function save_settings(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  segs constant text[] := array['industrial','oem_hardware','smb_software'];
  sids constant text[] := array['s2_trigger','s3_regulation','s4_partner','s5_intent','s7_orphaned','s8_tradeshow','s9_crowdfund','s10_accelerator',
                                's11_software','s12_devpartner','s13_hn'];
  slabel constant jsonb := '{"s2_trigger":"Trigger events","s3_regulation":"Regulation","s4_partner":"Partners","s5_intent":"Outsourcing intent","s7_orphaned":"Orphaned devices","s8_tradeshow":"Trade-show exhibitors","s9_crowdfund":"Crowdfunded hardware","s10_accelerator":"Accelerators and spinouts","s11_software":"Software triggers","s12_devpartner":"Seeking a dev partner","s13_hn":"Hacker News Seeking Freelancer"}'::jsonb;
  srcs constant text[] := array['ted','uk_fts','uk_cf','canadabuys','austender','ungm','samgov','worldbank','ebrd','ppra_epms',
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

  -- prospector.mix (actions.save_settings): only when the form carries the field
  if p ? 'mix' then
    n := settings_int(btrim(settings_str(p, 'mix')));
    if n is null or n not between 0 and 100 then
      errors := errors || '{"mix":"Enter a whole number from 0 to 100."}';
    else
      clean := clean || jsonb_build_object('prospector.mix', n);
    end if;
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

commit;
