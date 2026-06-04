create extension if not exists "uuid-ossp";
create extension if not exists "postgis";
create extension if not exists "pgcrypto";

create type user_role as enum ('worker', 'foreman', 'pm');

create type clock_event_type as enum (
  'clock_in',
  'clock_out',
  'trade_switch_out',
  'trade_switch_in'
);

create type clock_event_source as enum ('geofence_auto', 'manual');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'worker',
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  budget_cents bigint not null check (budget_cents >= 0),
  planned_start_date date not null,
  planned_end_date date not null,
  polygon geography(polygon, 4326) not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (planned_end_date >= planned_start_date)
);

create index projects_polygon_gix on public.projects using gist (polygon);

create table public.cost_codes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null,
  rate_cents_per_hour bigint not null check (rate_cents_per_hour >= 0),
  created_at timestamptz not null default now(),
  unique (project_id, label)
);

create table public.project_assignments (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_on_project user_role not null,
  assigned_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_assignments_user_idx on public.project_assignments (user_id);

create table public.clock_events (
  id uuid primary key,
  user_id uuid not null references public.profiles(id),
  project_id uuid not null references public.projects(id),
  cost_code_id uuid references public.cost_codes(id),
  event_type clock_event_type not null,
  event_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  lat double precision not null,
  lon double precision not null,
  source clock_event_source not null,
  check (lat between -90 and 90),
  check (lon between -180 and 180),
  check (
    (event_type in ('clock_in', 'trade_switch_in') and cost_code_id is not null)
    or
    (event_type in ('clock_out', 'trade_switch_out'))
  )
);

create index clock_events_user_project_idx
  on public.clock_events (user_id, project_id, event_at desc);

create index clock_events_project_event_at_idx
  on public.clock_events (project_id, event_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'worker')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
