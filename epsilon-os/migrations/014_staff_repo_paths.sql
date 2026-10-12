-- Epsilon OS migration 014: staff read of projects.repo_path (EN2). The column is deliberately not granted to
-- `authenticated` (clients must never see a local Mac path), so admin.* reads it through this staff-only function.
-- Additive and idempotent.

begin;

create or replace function staff_project_paths(p_org_id uuid) returns table (id uuid, repo_path text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_staff_for(p_org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  return query select p.id, p.repo_path from projects p where p.org_id = p_org_id;
end $$;

revoke all on function staff_project_paths(uuid) from public, anon, authenticated;
grant execute on function staff_project_paths(uuid) to authenticated, service_role;

commit;
