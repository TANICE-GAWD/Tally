\echo '=========================================='
\echo 'SMOKE TEST 1: PostGIS point-in-polygon'
\echo '=========================================='

\echo 'Expect TRUE (inside the jobsite polygon):'
select public.is_point_in_project(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  40.7128, -74.0134
) as inside_jobsite;

\echo 'Expect FALSE (Brooklyn, far outside):'
select public.is_point_in_project(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  40.6782, -73.9442
) as outside_jobsite;

\echo 'Expect 1 project matching the point inside:'
select * from public.projects_for_point(40.7128, -74.0134);

\echo 'Expect 0 projects matching the point outside:'
select * from public.projects_for_point(40.6782, -73.9442);

\echo ''
\echo '=========================================='
\echo 'SMOKE TEST 2: RLS as a worker'
\echo '=========================================='

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

\echo 'Worker should see exactly 1 profile (their own) plus any in shared projects:'
select id, full_name, role from public.profiles order by full_name;

\echo 'Worker should see exactly 1 project they are assigned to:'
select id, name from public.projects;

\echo 'Worker should see all 3 cost codes for that project:'
select label, rate_cents_per_hour from public.cost_codes order by label;

reset role;

\echo ''
\echo '=========================================='
\echo 'SMOKE TEST 3: RLS as a foreman'
\echo '=========================================='

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

\echo 'Foreman should see all 4 assignments on their project:'
select user_id, role_on_project from public.project_assignments order by role_on_project;

reset role;

\echo ''
\echo '=========================================='
\echo 'SMOKE TEST 4: RLS as a PM'
\echo '=========================================='

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

\echo 'PM should see all 4 profiles:'
select count(*) as profile_count from public.profiles;

\echo 'PM should see all projects:'
select count(*) as project_count from public.projects;

reset role;

\echo ''
\echo '=========================================='
\echo 'SMOKE TEST 5: Clock event insert as worker'
\echo '=========================================='

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

\echo 'Worker inserts a valid clock_in for themselves on their project (should succeed):'
insert into public.clock_events (
  id, user_id, project_id, cost_code_id,
  event_type, event_at, lat, lon, source
) values (
  gen_random_uuid(),
  '33333333-3333-3333-3333-333333333333',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'cccccccc-cccc-cccc-cccc-cccccccccc01',
  'clock_in', now(), 40.7128, -74.0134, 'geofence_auto'
)
returning id, event_type, event_at;

\echo 'Worker tries to insert a clock_in pretending to be another worker (should FAIL):'
do $$
begin
  begin
    insert into public.clock_events (
      id, user_id, project_id, cost_code_id,
      event_type, event_at, lat, lon, source
    ) values (
      gen_random_uuid(),
      '44444444-4444-4444-4444-444444444444',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'cccccccc-cccc-cccc-cccc-cccccccccc01',
      'clock_in', now(), 40.7128, -74.0134, 'manual'
    );
    raise exception 'EXPECTED RLS to block, but insert succeeded';
  exception when insufficient_privilege or check_violation then
    raise notice 'OK: insert blocked as expected';
  end;
end $$;

reset role;
