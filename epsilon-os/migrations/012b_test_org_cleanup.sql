-- Epsilon OS migration 012b (applied live 2026-10-13 as epsilon_os_v12f_test_org_cleanup): deleting a whole test org,
-- or an org being deleted (service role only), takes its updates and reports with it. Published rows of real client
-- orgs stay protected for every caller. 016 re-creates these guards and must keep the guard_allows_cleanup() exit.

begin;

create or replace function guard_allows_cleanup(p_org_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role'
     and (not exists (select 1 from organizations o where o.id = p_org_id)
          or exists (select 1 from organizations o where o.id = p_org_id and o.is_test))
$$;
revoke all on function guard_allows_cleanup(uuid) from public, anon, authenticated;

-- updates_guard() / reports_guard(): 012's bodies with `if guard_allows_cleanup(old.org_id) then return old; end if;`
-- as the first statement of the DELETE branch (see the live definitions; 016 carries the same line).

commit;
