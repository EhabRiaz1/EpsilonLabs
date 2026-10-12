-- Epsilon OS migration 015: the project agent (docs/designs/client-platform.md Phase 5; F10, EN2, EN3, OV2).
-- Additive and idempotent. Requires 008-014. No table or column drops and no change to existing rows. One CHECK is
-- replaced by a strictly wider one (jobs.type gains push_preview and scan_commits).
--
-- The flow   client ticket -> TOOL-LESS brief (ticket_brief job; the raw ticket never reaches a session with tools)
--            -> founder approves (approve_brief / edit_brief) -> READ-ONLY plan agent in the project's folder
--            (ticket_plan job) -> founder approves (approve_plan / edit_plan) -> founder picks the mode (choose_mode):
--              agent   request_execute -> ticket_execute job: Claude Code edits ONLY in a git worktree
--                      ~/EpsilonWork/worktrees/<project-slug>/EL-<n> on branch ticket/EL-<n>, may run only the project's
--                      configured test command; the worker commits on that branch and records diff + test result.
--                      The founder reviews: mark_merged (he merged it himself), push_preview_request (the worker's
--                      plain code runs `git push origin ticket/EL-<n>`), send_back_run (notes, a new run in the same
--                      worktree) or discard_run. Nothing ever merges or touches main automatically.
--              manual  the worker scans `git log` every 10 minutes for EL-<n> and adds internal ticket_events.
-- Projects   test_command / test_env_file / default_branch / agent_enabled (staff, save_project_agent) and is_git /
--            git_checked_at (detected by the worker). None of them is granted to `authenticated`: staff read them through
--            staff_project_agent(org) (security definer), clients never see them.
-- Runs       ticket_runs (brief | plan | execute): output, diff_stat, diff (capped 200 KB by the worker), test_result,
--            usage and tokens. Staff-only RLS; the client portal never reads it.
-- Budget     settings agent.daily_token_budget (default 2,000,000) and agent.enabled (kill switch). The worker pauses
--            brief/plan/execute jobs when today's tokens (PKT day) reach the budget. agent_usage_daily() feeds admin Health.
-- Client     sees only status labels (set through set_ticket_status, as before) and what the founder publishes
--            (attach_preview with p_to_client = true is a founder reply). Briefs, plans and diffs stay internal.

begin;

-- ===================================================================================================== projects
alter table projects add column if not exists test_command text
  check (test_command is null or (length(test_command) between 1 and 200 and test_command ~ '^[A-Za-z0-9 ._:/=@+-]+$'));
alter table projects add column if not exists test_env_file text
  check (test_env_file is null or (length(test_env_file) between 1 and 200 and test_env_file ~ '^[A-Za-z0-9._-][A-Za-z0-9._/-]*$'
                                   and test_env_file !~ '(^|/)\.\.(/|$)'));
alter table projects add column if not exists default_branch text
  check (default_branch is null or (default_branch ~ '^[A-Za-z0-9._/-]{1,100}$' and default_branch !~ '\.\.' and default_branch !~ '^-'));
alter table projects add column if not exists is_git boolean;
alter table projects add column if not exists git_checked_at timestamptz;
alter table projects add column if not exists agent_enabled boolean not null default false;
-- deliberately no grant to authenticated on these columns (see the header)

-- ===================================================================================================== jobs
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'jobs_type_check' and conrelid = 'jobs'::regclass
               and pg_get_constraintdef(oid) not like '%scan_commits%') then
    alter table jobs drop constraint jobs_type_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_type_check' and conrelid = 'jobs'::regclass) then
    alter table jobs add constraint jobs_type_check check (type in ('ticket_brief','ticket_plan','ticket_execute','weekly_update',
      'proposal_draft','invoice_draft','report_draft','referral_draft','run_agent','push_preview','scan_commits'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_ticket_run_params') then
    alter table jobs add constraint jobs_ticket_run_params check (type not in ('ticket_brief','ticket_plan','ticket_execute') or (
      coalesce(params ->> 'ticket_id', '') ~ '^[0-9a-f-]{36}$' and coalesce(params ->> 'run_id', '') ~ '^[0-9a-f-]{36}$'
      and params - 'ticket_id' - 'run_id' = '{}'::jsonb)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_push_preview_params') then
    alter table jobs add constraint jobs_push_preview_params check (type <> 'push_preview' or (
      coalesce(params ->> 'run_id', '') ~ '^[0-9a-f-]{36}$' and params - 'run_id' = '{}'::jsonb)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_scan_commits_params') then
    alter table jobs add constraint jobs_scan_commits_params check (type <> 'scan_commits' or (
      (not params ? 'project_id' or coalesce(params ->> 'project_id', '') ~ '^[0-9a-f-]{36}$')
      and params - 'project_id' = '{}'::jsonb)) not valid;
  end if;
end $$;
-- one live job per run (brief / plan / execute / push)
create unique index if not exists jobs_ticket_run_live on jobs ((params ->> 'run_id'), type)
  where type in ('ticket_brief','ticket_plan','ticket_execute','push_preview') and status in ('queued','claimed','running');

-- ===================================================================================================== ticket_runs
create table if not exists ticket_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  ticket_id     uuid not null,
  stage         text not null check (stage in ('brief','plan','execute')),
  job_id        uuid references jobs(id) on delete set null,
  status        text not null default 'queued' check (status in
                  ('queued','ready','approved','failed','superseded','merged','discarded','sent_back')),
  output        jsonb check (output is null or (jsonb_typeof(output) = 'object' and length(output::text) <= 100000)),
  notes         text check (notes is null or length(notes) <= 4000),          -- founder notes for the executor
  diff_stat     jsonb check (diff_stat is null or jsonb_typeof(diff_stat) = 'object'),
  diff          text check (diff is null or length(diff) <= 210000),          -- worker caps it at 200 KB
  test_result   jsonb check (test_result is null or jsonb_typeof(test_result) = 'object'),
  usage         jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
  tokens        bigint not null default 0 check (tokens >= 0),
  worktree      text check (worktree is null or length(worktree) <= 500),
  branch        text check (branch is null or branch ~ '^ticket/EL-[0-9]{1,12}$'),
  base_sha      text check (base_sha is null or base_sha ~ '^[0-9a-f]{7,64}$'),
  head_sha      text check (head_sha is null or head_sha ~ '^[0-9a-f]{7,64}$'),
  error         text check (error is null or length(error) <= 1000),
  edited_at     timestamptz,
  approved_at   timestamptz,
  approved_by   uuid references auth.users(id) on delete set null,
  preview_requested_at timestamptz,
  pushed_at     timestamptz,
  push_error    text check (push_error is null or length(push_error) <= 500),
  preview_url   text check (preview_url is null or (preview_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^\s<>"]*)?$' and length(preview_url) <= 500)),
  cleaned_at    timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (ticket_id, org_id) references tickets(id, org_id) on delete cascade
);
create index if not exists ticket_runs_ticket_idx on ticket_runs (ticket_id, stage, created_at desc);
create index if not exists ticket_runs_ready_idx on ticket_runs (created_at) where status = 'ready';
create index if not exists ticket_runs_finished_idx on ticket_runs (finished_at) where tokens > 0;
create index if not exists ticket_runs_cleanup_idx on ticket_runs (created_at)
  where stage = 'execute' and status in ('merged','discarded') and cleaned_at is null;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'ticket_runs_updated') then
    create trigger ticket_runs_updated before update on ticket_runs for each row execute function set_updated_at();
  end if;
end $$;

-- a commit is recorded once per ticket (the 10-minute scan is idempotent)
create unique index if not exists ticket_events_commit_uniq on ticket_events (ticket_id, (data ->> 'sha')) where kind = 'commit';

alter table ticket_runs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ticket_runs' and policyname = 'staff_read') then
    create policy staff_read on ticket_runs for select to authenticated using (is_staff_for(org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ticket_runs' and policyname = 'service_role_all') then
    create policy service_role_all on ticket_runs for all to service_role using (true) with check (true);
  end if;
end $$;
revoke all on ticket_runs from public, anon, authenticated;
grant select on ticket_runs to authenticated;
grant all on ticket_runs to service_role;

-- ===================================================================================================== helpers (no grants)
create or replace function agent_setting_on(p_key text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from settings where key = p_key and value = 'false'::jsonb)
$$;

-- Internal: a new run plus its job. Older live runs of the same stage are superseded.
create or replace function ticket_queue_run(t tickets, p_stage text, p_notes text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_run uuid;
  v_job uuid;
begin
  update ticket_runs set status = 'superseded' where ticket_id = t.id and stage = p_stage and status in ('queued','ready');
  update jobs set status = 'expired', error = 'superseded by a new run', finished_at = now()
   where type = 'ticket_' || p_stage and params ->> 'ticket_id' = t.id::text and status = 'queued';
  insert into ticket_runs (org_id, ticket_id, stage, notes, created_by)
  values (t.org_id, t.id, p_stage, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_run;
  insert into jobs (type, params, expires_at, requested_by)
  values ('ticket_' || p_stage, jsonb_build_object('ticket_id', t.id, 'run_id', v_run),
          now() + case p_stage when 'brief' then interval '2 days' else interval '1 day' end, auth.uid())
  returning id into v_job;
  update ticket_runs set job_id = v_job where id = v_run;
  return jsonb_build_object('ok', true, 'run_id', v_run, 'job_id', v_job);
end $$;

create or replace function ticket_internal_event(t tickets, p_kind text, p_body text, p_data jsonb) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into ticket_events (org_id, ticket_id, kind, body, data, client_visible, actor)
  values (t.org_id, t.id, p_kind, left(p_body, 20000), p_data, false, auth.uid())
$$;

-- Staff ticket + run lookups with the operator check (one message for missing / not yours).
create or replace function ticket_for_staff(p_ticket_id uuid) returns tickets
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t tickets;
begin
  select * into t from tickets where id = p_ticket_id;
  if t.id is null or not platform_is_operator_for(t.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  return t;
end $$;

create or replace function run_for_staff(p_run_id uuid) returns ticket_runs
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r ticket_runs;
begin
  select * into r from ticket_runs where id = p_run_id for update;
  if r.id is null or not platform_is_operator_for(r.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  return r;
end $$;

-- The output of a brief or plan as the founder edits it: an object, at most 100 KB, no nested surprises.
create or replace function ticket_check_output(p_stage text, p jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 100000 then
    raise exception 'the % must be a JSON object under 100 KB', p_stage using errcode = '22023';
  end if;
  if p_stage = 'brief' and (jsonb_typeof(p -> 'problem') is distinct from 'string' or length(btrim(p ->> 'problem')) = 0
                            or jsonb_typeof(p -> 'change') is distinct from 'array') then
    raise exception 'a brief needs a problem and a list of changes' using errcode = '22023';
  end if;
  if p_stage = 'plan' and (jsonb_typeof(p -> 'summary') is distinct from 'string' or jsonb_typeof(p -> 'steps') is distinct from 'array') then
    raise exception 'a plan needs a summary and a list of steps' using errcode = '22023';
  end if;
end $$;

-- ===================================================================================================== auto brief
-- A new ticket gets a tool-less brief drafted (cheap, and nothing reaches the client). Test and demo orgs never do, and
-- agent.enabled = false stops it. Never blocks the ticket insert.
create or replace function tickets_queue_brief() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if agent_setting_on('agent.enabled')
       and exists (select 1 from organizations o where o.id = new.org_id and o.status = 'active' and not o.is_test and not o.is_demo) then
      perform ticket_queue_run(new, 'brief');
    end if;
  exception when others then
    -- best effort (as the 011 push triggers): the ticket is saved; the founder can press "Draft brief"
    raise warning 'tickets_queue_brief: %', sqlstate;
  end;
  return null;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tickets_queue_brief') then
    create trigger tickets_queue_brief after insert on tickets for each row execute function tickets_queue_brief();
  end if;
end $$;

-- ===================================================================================================== staff RPCs
create or replace function request_brief(p_ticket_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t tickets := ticket_for_staff(p_ticket_id);
  v jsonb;
begin
  if t.status in ('done','declined') then
    raise exception 'the ticket is closed' using errcode = '55000';
  end if;
  v := ticket_queue_run(t, 'brief');
  perform deal_room_audit('brief_requested', 'ticket_runs', v ->> 'run_id', jsonb_build_object('ticket_id', t.id));
  return v;
end $$;

create or replace function edit_brief(p_run_id uuid, p_output jsonb) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r ticket_runs := run_for_staff(p_run_id);
begin
  if r.stage <> 'brief' then
    raise exception 'not a brief' using errcode = '22023';
  end if;
  if r.status <> 'ready' then
    raise exception 'only a brief waiting for approval can be edited' using errcode = '55000';
  end if;
  perform ticket_check_output('brief', p_output);
  update ticket_runs set output = p_output || jsonb_build_object('edited', true), edited_at = now() where id = r.id;
  perform deal_room_audit('brief_edited', 'ticket_runs', r.id::text, jsonb_build_object('ticket_id', r.ticket_id));
end $$;

-- Approving the brief moves the ticket to "briefed" (client sees "Triaged") and, when the project has a folder and the
-- agent is enabled for it, queues the read-only plan.
create or replace function approve_brief(p_run_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r ticket_runs := run_for_staff(p_run_id);
  t tickets;
  p projects;
  v_plan jsonb;
begin
  if r.stage <> 'brief' then
    raise exception 'not a brief' using errcode = '22023';
  end if;
  if r.status = 'approved' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if r.status <> 'ready' then
    raise exception 'this brief is not waiting for approval' using errcode = '55000';
  end if;
  select * into t from tickets where id = r.ticket_id for update;
  if t.status in ('done','declined') then
    raise exception 'the ticket is closed' using errcode = '55000';
  end if;
  update ticket_runs set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = r.id;
  update ticket_runs set status = 'superseded' where ticket_id = t.id and stage = 'brief' and status = 'approved' and id <> r.id;
  if t.status in ('new','triaged') then
    perform set_ticket_status(t.id, 'briefed');
  end if;
  perform ticket_internal_event(t, 'brief', 'You approved the brief' || case when r.edited_at is not null then ' (edited)' else '' end,
                                jsonb_build_object('run_id', r.id, 'action', 'approved'));
  select * into p from projects where id = t.project_id;
  if p.repo_path is not null and p.agent_enabled then
    v_plan := ticket_queue_run(t, 'plan');
  end if;
  perform deal_room_audit('brief_approved', 'ticket_runs', r.id::text,
                          jsonb_build_object('ticket_id', t.id, 'plan_run', v_plan ->> 'run_id'));
  return jsonb_build_object('ok', true, 'already', false, 'plan_run_id', v_plan ->> 'run_id');
end $$;

create or replace function request_plan(p_ticket_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t tickets := ticket_for_staff(p_ticket_id);
  p projects;
  v jsonb;
begin
  if t.status in ('done','declined') then
    raise exception 'the ticket is closed' using errcode = '55000';
  end if;
  if not exists (select 1 from ticket_runs where ticket_id = t.id and stage = 'brief' and status = 'approved') then
    raise exception 'approve the brief first' using errcode = '55000';
  end if;
  select * into p from projects where id = t.project_id;
  if p.repo_path is null then
    raise exception 'the project has no folder; work on it manually' using errcode = '55000';
  end if;
  if not p.agent_enabled then
    raise exception 'the agent is off for this project' using errcode = '55000';
  end if;
  v := ticket_queue_run(t, 'plan');
  perform deal_room_audit('plan_requested', 'ticket_runs', v ->> 'run_id', jsonb_build_object('ticket_id', t.id));
  return v;
end $$;

create or replace function edit_plan(p_run_id uuid, p_output jsonb) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r ticket_runs := run_for_staff(p_run_id);
begin
  if r.stage <> 'plan' then
    raise exception 'not a plan' using errcode = '22023';
  end if;
  if r.status <> 'ready' then
    raise exception 'only a plan waiting for approval can be edited' using errcode = '55000';
  end if;
  perform ticket_check_output('plan', p_output);
  update ticket_runs set output = p_output || jsonb_build_object('edited', true), edited_at = now() where id = r.id;
  perform deal_room_audit('plan_edited', 'ticket_runs', r.id::text, jsonb_build_object('ticket_id', r.ticket_id));
end $$;

create or replace function approve_plan(p_run_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r ticket_runs := run_for_staff(p_run_id);
  t tickets;
begin
  if r.stage <> 'plan' then
    raise exception 'not a plan' using errcode = '22023';
  end if;
  if r.status = 'approved' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if r.status <> 'ready' then
    raise exception 'this plan is not waiting for approval' using errcode = '55000';
  end if;
  select * into t from tickets where id = r.ticket_id for update;
  if t.status in ('done','declined') then
    raise exception 'the ticket is closed' using errcode = '55000';
  end if;
  update ticket_runs set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = r.id;
  update ticket_runs set status = 'superseded' where ticket_id = t.id and stage = 'plan' and status = 'approved' and id <> r.id;
  if t.status in ('new','triaged','briefed') then
    perform set_ticket_status(t.id, 'planned');
  end if;
  perform ticket_internal_event(t, 'plan', 'You approved the plan' || case when r.edited_at is not null then ' (edited)' else '' end,
                                jsonb_build_object('run_id', r.id, 'action', 'approved'));
  perform deal_room_audit('plan_approved', 'ticket_runs', r.id::text, jsonb_build_object('ticket_id', t.id));
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- Agent needs an approved plan, a git folder (detected by the worker) and the project's agent switch. Manual needs an
-- approved brief only (or nothing, when the founder takes it over straight away) and is always available.
create or replace function choose_mode(p_ticket_id uuid, p_mode text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t tickets := ticket_for_staff(p_ticket_id);
  p projects;
begin
  if p_mode is null or p_mode not in ('agent','manual') then
    raise exception 'mode must be agent or manual' using errcode = '22023';
  end if;
  if t.status in ('done','declined') then
    raise exception 'the ticket is closed' using errcode = '55000';
  end if;
  select * into t from tickets where id = t.id for update;
  if p_mode = 'agent' then
    select * into p from projects where id = t.project_id;
    if p.repo_path is null or p.is_git is not true then
      raise exception 'agent mode needs a git folder; this project is manual only' using errcode = '55000';
    end if;
    if not p.agent_enabled then
      raise exception 'the agent is off for this project' using errcode = '55000';
    end if;
    if not exists (select 1 from ticket_runs where ticket_id = t.id and stage = 'plan' and status = 'approved') then
      raise exception 'approve a plan first' using errcode = '55000';
    end if;
  end if;
  if t.mode is not distinct from p_mode then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if exists (select 1 from ticket_runs where ticket_id = t.id and stage = 'execute' and status in ('queued','ready')) then
    raise exception 'an agent run is open; discard or finish it first' using errcode = '55000';
  end if;
  update tickets set mode = p_mode where id = t.id;
  perform ticket_internal_event(t, 'plan', 'Mode: ' || p_mode, jsonb_build_object('mode', p_mode, 'action', 'mode'));
  if p_mode = 'manual' and t.status in ('new','triaged','briefed','planned','approved') then
    perform set_ticket_status(t.id, 'in_progress');
  end if;
  perform deal_room_audit('ticket_mode', 'tickets', t.id::text, jsonb_build_object('mode', p_mode));
  return jsonb_build_object('ok', true, 'already', false);
end $$;

create or replace function request_execute(p_ticket_id uuid, p_notes text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t tickets := ticket_for_staff(p_ticket_id);
  p projects;
  v jsonb;
begin
  select * into t from tickets where id = t.id for update;
  if t.status in ('done','declined') then
    raise exception 'the ticket is closed' using errcode = '55000';
  end if;
  if t.mode is distinct from 'agent' then
    raise exception 'choose agent mode first' using errcode = '55000';
  end if;
  if length(coalesce(p_notes, '')) > 4000 then
    raise exception 'notes are at most 4000 characters' using errcode = '22023';
  end if;
  select * into p from projects where id = t.project_id;
  if p.repo_path is null or p.is_git is not true or not p.agent_enabled then
    raise exception 'agent mode needs a git folder with the agent enabled' using errcode = '55000';
  end if;
  if not exists (select 1 from ticket_runs where ticket_id = t.id and stage = 'plan' and status = 'approved') then
    raise exception 'approve a plan first' using errcode = '55000';
  end if;
  if exists (select 1 from ticket_runs where ticket_id = t.id and stage = 'execute' and status in ('queued','ready')) then
    raise exception 'an agent run is already open for this ticket' using errcode = '55000';
  end if;
  v := ticket_queue_run(t, 'execute', p_notes);
  if t.status in ('new','triaged','briefed','planned','approved','review') then
    perform set_ticket_status(t.id, 'in_progress');
  end if;
  perform deal_room_audit('execute_requested', 'ticket_runs', v ->> 'run_id', jsonb_build_object('ticket_id', t.id));
  return v;
end $$;

-- "Send back with notes": this run's diff stays on the branch; a new run continues in the same worktree with the notes.
create or replace function send_back_run(p_run_id uuid, p_notes text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r ticket_runs := run_for_staff(p_run_id);
  t tickets;
  v jsonb;
begin
  if r.stage <> 'execute' or r.status not in ('ready','failed') then
    raise exception 'only an agent run in review can be sent back' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_notes, ''))) not between 1 and 4000 then
    raise exception 'write what to change (1-4000 characters)' using errcode = '22023';
  end if;
  select * into t from tickets where id = r.ticket_id for update;
  if t.status in ('done','declined') then
    raise exception 'the ticket is closed' using errcode = '55000';
  end if;
  update ticket_runs set status = 'sent_back' where id = r.id;
  v := ticket_queue_run(t, 'execute', p_notes);
  perform ticket_internal_event(t, 'diff', 'You sent the diff back with notes', jsonb_build_object('run_id', r.id, 'next_run', v ->> 'run_id'));
  perform deal_room_audit('run_sent_back', 'ticket_runs', r.id::text, jsonb_build_object('ticket_id', t.id, 'next_run', v ->> 'run_id'));
  return v;
end $$;

-- The founder merged ticket/EL-<n> himself (on his Mac). The ticket is done; the worker removes the worktree.
create or replace function mark_merged(p_run_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r ticket_runs := run_for_staff(p_run_id);
begin
  if r.stage <> 'execute' then
    raise exception 'not an agent run' using errcode = '22023';
  end if;
  if r.status = 'merged' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if r.status <> 'ready' then
    raise exception 'only a run in review can be marked merged' using errcode = '55000';
  end if;
  update ticket_runs set status = 'merged', approved_at = now(), approved_by = auth.uid() where id = r.id;
  perform ticket_internal_event((select t from tickets t where t.id = r.ticket_id), 'diff', 'You merged ' || coalesce(r.branch, 'the branch'),
                                jsonb_build_object('run_id', r.id, 'action', 'merged'));
  perform set_ticket_status(r.ticket_id, 'done');
  perform deal_room_audit('run_merged', 'ticket_runs', r.id::text, jsonb_build_object('ticket_id', r.ticket_id, 'branch', r.branch));
  return jsonb_build_object('ok', true, 'already', false);
end $$;

create or replace function discard_run(p_run_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r ticket_runs := run_for_staff(p_run_id);
begin
  if r.stage <> 'execute' then
    raise exception 'not an agent run' using errcode = '22023';
  end if;
  if r.status = 'discarded' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if r.status not in ('queued','ready','failed') then
    raise exception 'this run can no longer be discarded' using errcode = '55000';
  end if;
  update ticket_runs set status = 'discarded' where id = r.id;
  update jobs set status = 'expired', error = 'run discarded', finished_at = now()
   where id = r.job_id and status = 'queued';
  perform ticket_internal_event((select t from tickets t where t.id = r.ticket_id), 'diff', 'You discarded the agent run',
                                jsonb_build_object('run_id', r.id, 'action', 'discarded'));
  perform deal_room_audit('run_discarded', 'ticket_runs', r.id::text, jsonb_build_object('ticket_id', r.ticket_id));
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- EN3: only on the founder's click. The worker's plain code runs `git push origin ticket/EL-<n>`; the AI never pushes.
create or replace function push_preview_request(p_run_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r ticket_runs := run_for_staff(p_run_id);
  v_job uuid;
begin
  if r.stage <> 'execute' or r.status <> 'ready' or r.branch is null or r.head_sha is null then
    raise exception 'only a finished agent run in review can be pushed' using errcode = '55000';
  end if;
  select id into v_job from jobs where type = 'push_preview' and params ->> 'run_id' = r.id::text
     and status in ('queued','claimed','running') limit 1;
  if v_job is not null then
    return jsonb_build_object('ok', true, 'already', true, 'job_id', v_job);
  end if;
  insert into jobs (type, params, expires_at, requested_by)
  values ('push_preview', jsonb_build_object('run_id', r.id), now() + interval '1 hour', auth.uid())
  returning id into v_job;
  update ticket_runs set preview_requested_at = now(), push_error = null where id = r.id;
  perform deal_room_audit('preview_push_requested', 'ticket_runs', r.id::text, jsonb_build_object('ticket_id', r.ticket_id, 'branch', r.branch));
  return jsonb_build_object('ok', true, 'already', false, 'job_id', v_job);
end $$;

-- The founder pastes the preview URL. With p_to_client it is a founder reply the client sees (F13: he sends it).
create or replace function attach_preview(p_run_id uuid, p_url text, p_to_client boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r ticket_runs := run_for_staff(p_run_id);
  t tickets;
  v_url text := btrim(coalesce(p_url, ''));
begin
  if r.stage <> 'execute' then
    raise exception 'not an agent run' using errcode = '22023';
  end if;
  if v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^\s<>"]*)?$' or length(v_url) > 500 then
    raise exception 'enter an https:// preview URL' using errcode = '22023';
  end if;
  update ticket_runs set preview_url = v_url where id = r.id;
  select * into t from tickets where id = r.ticket_id;
  perform ticket_internal_event(t, 'preview', v_url, jsonb_build_object('run_id', r.id, 'url', v_url));
  if coalesce(p_to_client, false) then
    perform staff_ticket_reply(t.id, 'A preview of this change is ready to check: ' || v_url, true);
  end if;
  perform deal_room_audit('preview_attached', 'ticket_runs', r.id::text, jsonb_build_object('ticket_id', t.id, 'to_client', coalesce(p_to_client, false)));
  return jsonb_build_object('ok', true);
end $$;

-- Staff: "Scan commits now" for a project (manual mode). One live scan per project.
create or replace function request_commit_scan(p_project_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select org_id into v_org from projects where id = p_project_id;
  if v_org is null or not platform_is_operator_for(v_org) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select id into v_id from jobs where type = 'scan_commits' and params ->> 'project_id' = p_project_id::text
     and status in ('queued','claimed','running') limit 1;
  if v_id is null then
    insert into jobs (type, params, expires_at, requested_by)
    values ('scan_commits', jsonb_build_object('project_id', p_project_id), now() + interval '30 minutes', auth.uid())
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'job_id', v_id);
end $$;

-- Project settings for the agent (EN2, OV2). The test command is set here by the founder, never by the AI.
create or replace function save_project_agent(p_project_id uuid, p_test_command text, p_test_env_file text,
                                              p_default_branch text, p_agent_enabled boolean) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  p projects;
  v_cmd text := nullif(btrim(regexp_replace(coalesce(p_test_command, ''), '\s+', ' ', 'g')), '');
  v_env text := nullif(btrim(coalesce(p_test_env_file, '')), '');
  v_branch text := nullif(btrim(coalesce(p_default_branch, '')), '');
begin
  select * into p from projects where id = p_project_id for update;
  if p.id is null or not is_staff_for(p.org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if v_cmd is not null and (length(v_cmd) > 200 or v_cmd !~ '^[A-Za-z0-9 ._:/=@+-]+$') then
    raise exception 'the test command may use letters, digits, spaces and . _ : / = @ + - only (no shell operators)' using errcode = '22023';
  end if;
  if v_env is not null and (length(v_env) > 200 or v_env !~ '^[A-Za-z0-9._-][A-Za-z0-9._/-]*$' or v_env ~ '(^|/)\.\.(/|$)') then
    raise exception 'the test env file is a path inside the project folder, like .env.test' using errcode = '22023';
  end if;
  if v_branch is not null and (v_branch !~ '^[A-Za-z0-9._/-]{1,100}$' or v_branch ~ '\.\.' or v_branch ~ '^-') then
    raise exception 'invalid branch name' using errcode = '22023';
  end if;
  if coalesce(p_agent_enabled, false) and p.repo_path is null then
    raise exception 'set the project folder before enabling the agent' using errcode = '22023';
  end if;
  update projects set test_command = v_cmd, test_env_file = v_env, default_branch = v_branch,
                      agent_enabled = coalesce(p_agent_enabled, false)
   where id = p.id;
  perform deal_room_audit('project_agent_saved', 'projects', p.id::text,
                          jsonb_build_object('test_command', v_cmd, 'test_env_file', v_env, 'default_branch', v_branch,
                                             'agent_enabled', coalesce(p_agent_enabled, false)));
  return jsonb_build_object('ok', true);
end $$;

-- Staff read of the agent fields (not granted to authenticated as columns).
create or replace function staff_project_agent(p_org_id uuid)
returns table (id uuid, repo_path text, test_command text, test_env_file text, default_branch text, is_git boolean,
               git_checked_at timestamptz, agent_enabled boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_staff_for(p_org_id) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  return query select p.id, p.repo_path, p.test_command, p.test_env_file, p.default_branch, p.is_git, p.git_checked_at,
                      p.agent_enabled
                 from projects p where p.org_id = p_org_id order by p.created_at;
end $$;

-- ===================================================================================================== usage guard
create or replace function save_agent_settings(p_daily_token_budget bigint, p_enabled boolean) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_daily_token_budget is null or p_daily_token_budget not between 10000 and 100000000 then
    raise exception 'the daily token budget is a whole number from 10,000 to 100,000,000' using errcode = '22023';
  end if;
  insert into settings (key, value) values ('agent.daily_token_budget', to_jsonb(p_daily_token_budget))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into settings (key, value) values ('agent.enabled', to_jsonb(coalesce(p_enabled, true)))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform deck_audit('settings_changed', null, null, jsonb_build_object('keys', '["agent.daily_token_budget","agent.enabled"]'::jsonb), null);
  return jsonb_build_object('ok', true);
end $$;

-- Tokens per PKT day (Claude Code + tool-less brief calls, from `claude -p --output-format json`), the budget and the
-- pause state. Staff (aal2) or the worker.
create or replace function agent_usage_daily(p_days integer default 14) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 14), 90));
  v_budget bigint;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_used bigint;
  v_rows jsonb;
begin
  if not (is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select case when jsonb_typeof(value) = 'number' then value::text::bigint end into v_budget
    from settings where key = 'agent.daily_token_budget';
  v_budget := coalesce(v_budget, 2000000);
  select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'tokens', coalesce(u.tokens, 0), 'runs', coalesce(u.runs, 0),
                                               'cost_usd', coalesce(u.cost, 0)) order by d), '[]'::jsonb)
    into v_rows
    from generate_series(v_today - (v_days - 1), v_today, interval '1 day') d
    left join (select (finished_at at time zone 'Asia/Karachi')::date as day, sum(tokens) as tokens, count(*) as runs,
                      sum(coalesce((usage ->> 'cost_usd')::numeric, 0)) as cost
                 from ticket_runs
                where finished_at >= ((v_today - (v_days - 1))::timestamp at time zone 'Asia/Karachi')
                group by 1) u on u.day = d::date;
  select coalesce(sum(tokens), 0) into v_used from ticket_runs
   where finished_at >= (v_today::timestamp at time zone 'Asia/Karachi');
  return jsonb_build_object('budget', v_budget, 'used_today', v_used, 'enabled', agent_setting_on('agent.enabled'),
                            'paused', v_used >= v_budget or not agent_setting_on('agent.enabled'), 'days', v_rows);
end $$;

-- ===================================================================================================== grants
revoke all on function
  agent_setting_on(text), ticket_queue_run(tickets, text, text), ticket_internal_event(tickets, text, text, jsonb),
  ticket_for_staff(uuid), run_for_staff(uuid), ticket_check_output(text, jsonb), tickets_queue_brief(),
  request_brief(uuid), edit_brief(uuid, jsonb), approve_brief(uuid), request_plan(uuid), edit_plan(uuid, jsonb),
  approve_plan(uuid), choose_mode(uuid, text), request_execute(uuid, text), send_back_run(uuid, text), mark_merged(uuid),
  discard_run(uuid), push_preview_request(uuid), attach_preview(uuid, text, boolean), request_commit_scan(uuid),
  save_project_agent(uuid, text, text, text, boolean), staff_project_agent(uuid), save_agent_settings(bigint, boolean),
  agent_usage_daily(integer)
from public, anon, authenticated;

grant execute on function
  request_brief(uuid), edit_brief(uuid, jsonb), approve_brief(uuid), request_plan(uuid), edit_plan(uuid, jsonb),
  approve_plan(uuid), choose_mode(uuid, text), request_execute(uuid, text), send_back_run(uuid, text), mark_merged(uuid),
  discard_run(uuid), push_preview_request(uuid), attach_preview(uuid, text, boolean), request_commit_scan(uuid),
  save_project_agent(uuid, text, text, text, boolean), staff_project_agent(uuid), save_agent_settings(bigint, boolean),
  agent_usage_daily(integer)
to authenticated, service_role;

commit;
