create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_assignments
    where project_id = p_project_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_project_foreman(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_assignments
    where project_id = p_project_id
      and user_id = auth.uid()
      and role_on_project = 'foreman'
  );
$$;

create or replace function public.is_point_in_project(
  p_project_id uuid,
  p_lat double precision,
  p_lon double precision
)
returns boolean
language sql
stable
as $$
  select st_covers(
    polygon,
    st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography
  )
  from public.projects
  where id = p_project_id;
$$;

create or replace function public.projects_for_point(
  p_lat double precision,
  p_lon double precision
)
returns table (project_id uuid, project_name text)
language sql
stable
as $$
  select id, name
  from public.projects
  where st_covers(
    polygon,
    st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography
  );
$$;
