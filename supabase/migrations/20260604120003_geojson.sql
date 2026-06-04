create or replace function public.get_my_projects()
returns table (
  id uuid,
  name text,
  budget_cents bigint,
  planned_start_date date,
  planned_end_date date,
  polygon_geojson text
)
language sql
stable
as $$
  select
    p.id,
    p.name,
    p.budget_cents,
    p.planned_start_date,
    p.planned_end_date,
    st_asgeojson(p.polygon)::text as polygon_geojson
  from public.projects p;
$$;

grant execute on function public.get_my_projects() to authenticated;
