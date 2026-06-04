alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.cost_codes enable row level security;
alter table public.project_assignments enable row level security;
alter table public.clock_events enable row level security;

create policy profiles_select_self
  on public.profiles
  for select
  using (id = auth.uid());

create policy profiles_select_pm
  on public.profiles
  for select
  using (public.current_user_role() = 'pm');

create policy profiles_select_project_members
  on public.profiles
  for select
  using (
    exists (
      select 1
      from public.project_assignments a
      join public.project_assignments b on a.project_id = b.project_id
      where a.user_id = auth.uid()
        and b.user_id = public.profiles.id
        and a.role_on_project in ('foreman', 'pm')
    )
  );

create policy profiles_update_self
  on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy projects_select_pm
  on public.projects
  for select
  using (public.current_user_role() = 'pm');

create policy projects_select_assigned
  on public.projects
  for select
  using (public.is_project_member(id));

create policy projects_insert_pm
  on public.projects
  for insert
  with check (public.current_user_role() = 'pm');

create policy projects_update_pm
  on public.projects
  for update
  using (public.current_user_role() = 'pm')
  with check (public.current_user_role() = 'pm');

create policy projects_delete_pm
  on public.projects
  for delete
  using (public.current_user_role() = 'pm');

create policy cost_codes_select_pm
  on public.cost_codes
  for select
  using (public.current_user_role() = 'pm');

create policy cost_codes_select_assigned
  on public.cost_codes
  for select
  using (public.is_project_member(project_id));

create policy cost_codes_write_pm
  on public.cost_codes
  for all
  using (public.current_user_role() = 'pm')
  with check (public.current_user_role() = 'pm');

create policy assignments_select_pm
  on public.project_assignments
  for select
  using (public.current_user_role() = 'pm');

create policy assignments_select_self
  on public.project_assignments
  for select
  using (user_id = auth.uid());

create policy assignments_select_project_foreman
  on public.project_assignments
  for select
  using (public.is_project_foreman(project_id));

create policy assignments_write_pm
  on public.project_assignments
  for all
  using (public.current_user_role() = 'pm')
  with check (public.current_user_role() = 'pm');

create policy clock_events_select_self
  on public.clock_events
  for select
  using (user_id = auth.uid());

create policy clock_events_select_project_foreman
  on public.clock_events
  for select
  using (public.is_project_foreman(project_id));

create policy clock_events_select_pm
  on public.clock_events
  for select
  using (public.current_user_role() = 'pm');

create policy clock_events_insert_self
  on public.clock_events
  for insert
  with check (
    user_id = auth.uid()
    and public.is_project_member(project_id)
  );
