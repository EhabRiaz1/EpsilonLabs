-- 018: client-facing copy says "Epsilon", not the founder's first name (brand, 2026-10-19).
-- Only the notification title changes; the function body is otherwise identical to 012's request_testimonial.
begin;

create or replace function request_testimonial(p_org_id uuid, p_project_id uuid, p_suggested text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
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
  perform notify_org(p_org_id, 'testimonial', 'Epsilon asked for a short testimonial', '/testimonial', false, null,
                     'testimonial:' || v_id::text);
  perform deal_room_audit('testimonial_requested', 'testimonials', v_id::text, jsonb_build_object('org_id', p_org_id));
  return v_id;
end $$;

-- Existing unread notifications keep their old title otherwise.
update notifications set title = 'Epsilon asked for a short testimonial'
 where kind = 'testimonial' and title = 'Ehab asked for a short testimonial';

commit;
