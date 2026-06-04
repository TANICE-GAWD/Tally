create or replace function public.get_project_burn(p_project_id uuid)
returns table (
  total_labor_cents bigint,
  total_hours numeric,
  budget_cents bigint,
  pct_burned numeric,
  days_elapsed numeric,
  days_planned numeric,
  burn_rate_cents_per_day numeric,
  projected_total_cents numeric,
  projected_overrun_cents numeric
)
language sql
stable
as $$
  with events_ordered as (
    select
      user_id,
      cost_code_id,
      event_type,
      event_at,
      lag(event_at)       over (partition by user_id order by event_at) as prev_event_at,
      lag(event_type)     over (partition by user_id order by event_at) as prev_event_type,
      lag(cost_code_id)   over (partition by user_id order by event_at) as prev_cost_code_id
    from public.clock_events
    where project_id = p_project_id
  ),
  sessions as (
    select
      prev_cost_code_id as cost_code_id,
      extract(epoch from (event_at - prev_event_at)) / 3600.0 as hours
    from events_ordered
    where prev_event_type in ('clock_in', 'trade_switch_in')
      and event_type in ('clock_out', 'trade_switch_out')
      and prev_cost_code_id is not null
  ),
  totals as (
    select
      coalesce(sum(s.hours * cc.rate_cents_per_hour), 0)::bigint as labor_cents,
      coalesce(sum(s.hours), 0)::numeric as hours
    from sessions s
    join public.cost_codes cc on cc.id = s.cost_code_id
  ),
  proj as (
    select
      budget_cents,
      planned_start_date,
      planned_end_date,
      greatest(
        extract(epoch from (now() - planned_start_date::timestamptz)) / 86400.0,
        1
      )::numeric as days_elapsed,
      greatest(
        extract(epoch from (planned_end_date::timestamptz - planned_start_date::timestamptz)) / 86400.0,
        1
      )::numeric as days_planned
    from public.projects
    where id = p_project_id
  )
  select
    t.labor_cents as total_labor_cents,
    t.hours       as total_hours,
    p.budget_cents,
    case when p.budget_cents > 0
      then (t.labor_cents::numeric / p.budget_cents * 100)
      else 0::numeric
    end as pct_burned,
    p.days_elapsed,
    p.days_planned,
    (t.labor_cents::numeric / p.days_elapsed) as burn_rate_cents_per_day,
    (t.labor_cents::numeric / p.days_elapsed * p.days_planned) as projected_total_cents,
    ((t.labor_cents::numeric / p.days_elapsed * p.days_planned) - p.budget_cents) as projected_overrun_cents
  from totals t cross join proj p;
$$;

grant execute on function public.get_project_burn(uuid) to authenticated;

alter publication supabase_realtime add table public.clock_events;
