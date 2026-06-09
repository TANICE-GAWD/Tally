# Tally

A phone app for construction crews and the people who pay them.

## What it does

A carpenter shows up to a jobsite at 7 AM. They open Tally on their phone. The app already knows they have arrived (it can tell from their location), and it asks if they want to clock in. They tap yes, pick the trade they are doing right now (Framing), and get to work. At 11 AM they switch to a different trade (Concrete). One tap. At 3:30 PM they leave the site, the app prompts them to clock out, and they go home.

That night, while the worker is asleep, the foreman in the trailer pulls up Tally on their own phone. They see, in real time, the labor cost for every worker on every job that day, broken down by trade, with the burn rate against budget. They tap a button and email themselves a CSV that lines up with what payroll needs on Friday.

That is what Tally does. The clever part is in the seams.

## Why this matters

Most specialty trade contractors (framing crews, concrete crews, electricians, the kind of company that does one thing well and gets hired by general contractors) still track this on paper, or in Excel, or in a chat app, or in a back-office staffer's head. Once a week, somebody types it all into a payroll system. When something gets lost, or written down wrong, or remembered fuzzy, the certified-payroll report the contractor owes the GC on Friday is wrong. The invoice bounces. The crew does not get paid until the next pay period.

A worker who switches from framing ($65 per hour) to demolition ($48 per hour) for half a day, then crosses 40 hours that same week, is owed overtime on the FLSA weighted-average rate of the work they actually did. Not the rate they happened to be earning at hour 41. Excel does not catch this. A foreman remembering at the end of the week does not catch this.

Tally catches the right facts at the moment they happen and writes them to a place that cannot be edited after the fact. It is not a payroll system. It is the structured data layer that makes a real payroll system possible.

This is the same thesis Trayd's CEO Anna Berger has stated publicly: before AI or anything else can add value in construction back-office work, the underlying data has to actually exist and be trustworthy. Tally is one floor below that.

## What it is not

- It is not a payroll calculator. It does not run tax tables or produce W-2s.
- It does not use AI. There are no language models in this codebase. The math is arithmetic.
- It is not a CRM, a scheduler, an estimator, or a project management tool. It does one job.

## Repo layout

```
supabase/        backend: schema, RLS, helper functions, seed, smoke tests
app/             Expo Router screens (login, jobsite, foreman dashboard)
src/lib/         shared modules with property-based tests
.maestro/flows/  YAML E2E flows against Expo Go
```


## The three users

| Role | What they do |
|---|---|
| Worker | Clocks in and out, switches cost codes mid-shift, sees auto-prompts when crossing a jobsite boundary |
| Foreman | Watches the live burn dashboard for the projects they are assigned to |
| Project Manager (PM) | Same view as foreman across all projects, plus weekly CSV export |

## System overview

```mermaid
graph TD
  subgraph "Mobile App"
    A["User enters Jobsite"] --> B["Clock In Prompt"]
    B --> C["Local Event Created"]
  end

  subgraph "Code Entities (src/)"
    C --> D["useGeofence hook"]
    D --> E["insertLocalEvent()"]
    E --> F[("clock_events_local (SQLite)")]
    F --> G["syncOnce() function"]
  end

  subgraph "Backend (Supabase)"
    G --> H[("clock_events (PostgreSQL)")]
    H --> I["get_project_burn RPC"]
  end

  style F stroke-dasharray: 5 5
  style H stroke-dasharray: 5 5
```

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Mobile | Expo (React Native) with TypeScript | Same language as the backend. Expo Go QR code lets anyone run the app in 30 seconds, no install. |
| Backend | Supabase (Postgres, Realtime, Auth, RLS, PostGIS) | The structured-data layer the README keeps talking about. PostGIS for jobsite polygons, Realtime for the live dashboard. |
| Local storage | expo-sqlite in WAL mode | Survives airplane mode, basements, dead zones. Where the truth lives until sync completes. |
| Geofence math | Turf.js on the client, PostGIS on the server | Same answer in both places. Client decides immediately, server validates. |
| Maps | react-native-maps | Renders the jobsite polygon and the worker's position. |
| Money | dinero.js v1 | Integer-cent arithmetic, no floats. Wrapped in `src/lib/money.ts` so the rest of the app does not touch the lib directly. |
| Testing | Vitest with fast-check, Maestro, smoke SQL via psql | Three orthogonal layers. Logic, UI, database. |

## How it works under the hood

### Authentication and route guard

Login uses Supabase Auth. After login, the app fetches the user's `profiles` row to learn their role, because the role determines what they see. A Postgres trigger called `handle_new_user` creates the profile row automatically when an auth user is inserted.

```mermaid
flowchart TD
    START["User Opens App"] --> ROOT["app/index.tsx"]
    ROOT --> AUTH_CHECK{"useAuth() loading?"}
    AUTH_CHECK -- "true" --> SPINNER["Show ActivityIndicator"]
    AUTH_CHECK -- "false" --> SESSION_CHECK{"session exists?"}
    SESSION_CHECK -- "yes" --> PROTECTED["Redirect to /(protected)"]
    SESSION_CHECK -- "no" --> LOGIN["Redirect to /login"]
```

### Clock state is derived, not stored

There are four event types: `clock_in`, `clock_out`, `trade_switch_in`, `trade_switch_out`. The app never stores "is this worker on the clock right now". Instead, it reads the event log and reduces over it. Out-of-order events (which happen when offline events sync late) get sorted by `event_at` first.

```mermaid
stateDiagram-v2
    [*] --> clocked_out
    clocked_out --> clocked_in : "clock_in or trade_switch_in"
    clocked_in --> clocked_in : "trade_switch_out then trade_switch_in"
    clocked_in --> clocked_out : "clock_out"
```

### Offline-first sync, the part that took the most thought

When a worker taps Clock In:

1. A row is written to a local SQLite table called `clock_events_local`, with `synced = 0` and a UUID generated on the device.
2. UI updates instantly. The dot next to the new event is orange (pending).
3. A sync engine runs on a 15-second timer, on app foreground, and on network reconnect. Each tick reads unsynced rows and uploads them in a single `upsert(..., { onConflict: 'id', ignoreDuplicates: true })` call. The server primary key is the same UUID the client generated, so retries collapse into one row.
4. On success, the local rows flip to `synced = 1` and the dot turns green.

```mermaid
flowchart LR
    subgraph "Triggers"
        T1["setInterval (15s)"]
        T2["NetInfo (Connected)"]
        T3["AppState (Active)"]
    end

    subgraph "Control Logic"
        T1 & T2 & T3 --> S["syncOnce()"]
        S --> G{"inFlight == true?"}
        G -- "Yes" --> Exit["Abort"]
        G -- "No" --> P["Push to Supabase"]
    end

    P --> M["markSynced()"]
```

The invariants:

1. A clock action is durable the moment the user taps. The local insert happens before any network call. If they kill the app, the event survives.
2. The same event syncs at most once on the server. Client UUID equals server primary key.
3. Events sort by `event_at` (client wall-clock), not by when they reached the server. A worker offline from 8 AM to 2 PM can submit four events at 2 PM and they still order correctly in reports.
4. Clock skew greater than one hour between `event_at` and `submitted_at` is preserved, not corrected. Foreman review can flag it.
5. A local row only flips to `synced = 1` after the server confirms. Partial batch failures retry on the next tick.

### Geofencing

Jobsites are stored as PostGIS `geography(POLYGON, 4326)` with a GiST spatial index. The backend exposes them as GeoJSON via a dedicated RPC because Supabase's default representation is hex-encoded EWKB, which is annoying to parse on the client.

```mermaid
stateDiagram-v2
    [*] --> unknown
    unknown --> inside: "first reading inside"
    unknown --> outside: "first reading outside"
    inside --> outside: "Location update (outside)"
    outside --> inside: "Location update (inside)"
```

The first reading sets state but does not fire a callback (because there was no transition from a known state). Only the second and subsequent crossings fire the auto-prompt banner. This matters for the demo: start the recording with the device outside the polygon, then move inside.

### Burn calculation

The foreman dashboard calls a SQL function called `get_project_burn(uuid)`. It pairs adjacent `*_in` events with their following `*_out` events into sessions, multiplies each session by the cost-code rate that was active during it, and aggregates to per-project totals. The same logic is also implemented in TypeScript (`src/lib/sessions.ts`) for the CSV export, so the code can be unit-tested with fast-check.

```mermaid
sequenceDiagram
    participant DB as "public.clock_events"
    participant CTE1 as "events_ordered (Window Function)"
    participant CTE2 as "sessions (Interval Calc)"
    participant CTE3 as "totals (Cost Join)"
    participant Out as "RPC Output"

    DB->>CTE1: Fetch events for p_project_id
    Note over CTE1: lag() partitions by user_id, orders by event_at
    CTE1->>CTE2: Filter in/out pairs
    Note over CTE2: Calculate hours per session
    CTE2->>CTE3: Join public.cost_codes
    Note over CTE3: Sum(hours * rate_cents_per_hour)
    CTE3->>Out: Calculate Burn Rate & Projections
```

The dashboard also subscribes to a Supabase Realtime channel on `clock_events` filtered by project. New events trigger a refetch within a second. No polling.

### What-if simulator

A pure function (`applyWhatIf` in `src/lib/burn.ts`) takes the current burn summary and a hypothetical of "add N workers, D days, trade T" and returns the new projected total, new overrun, and new percentage of budget. No ML. No LLM. Just multiplication.

## Row-Level Security

Every table has RLS enabled. The policies live in the database, not the app. A bug in the client code cannot leak another worker's hours.

| Table | Worker | Foreman (on their project) | PM |
|---|---|---|---|
| `profiles` | own row | own and project members | all |
| `projects` | assigned only | assigned only | all (CRUD) |
| `cost_codes` | their project's only | their project's only | all (CRUD) |
| `project_assignments` | own row | own project | all (CRUD) |
| `clock_events` | select and insert own only | select all on project | select all |

`clock_events` has no UPDATE or DELETE policy. Corrections happen via new compensating events, never destructive edits.

## Modeling decisions worth calling out

| Decision | Why |
|---|---|
| Money in `bigint` cents, never `numeric` or floats | Payroll math has zero tolerance for rounding drift. The DB rejects fractional cents at the type level. `dinero.js` handles display. |
| `clock_events` primary key is client-generated, not server-generated | This is what makes offline sync idempotent. Resync the same event ten times, get one row. |
| Four event types instead of two | Captures multi-rate shifts as first-class data. A worker who switches framing to electrical mid-day produces two sessions at two rates. No blended-rate inference. |
| Burn math lives twice: once in SQL, once in TypeScript | The dashboard reads SQL (fast, server-authoritative). The CSV export reads TS (works offline, testable with fast-check). They share an invariant: total wages equals the sum of (hours times rate) per session. |
| Sync is push-only, never destructive | The client never deletes from the server. Server inserts are idempotent. |

## Trade-offs and decisions I will defend

This is the section worth reading if you are evaluating my judgment. Everything here was a fork in the road during the four weekends I spent on Tally.

### Detox swapped out for Maestro

The original plan called for Detox for end-to-end testing. Detox is the React Native standard but requires a custom native build, a configured simulator, and several hundred lines of glue per test run. I chose Maestro because it is YAML-based, runs against Expo Go via the `host.exp.Exponent` app ID, and gets the same "did the offline-mid-shift flow round-trip correctly" signal in 30 lines of YAML. For a portfolio project where the bar is demonstrating test discipline, Maestro is the right trade. If this were production, Detox would be worth the setup cost.

### Edge Functions swapped for SQL functions

The plan called for projection logic in Supabase Edge Functions (Deno + TypeScript). I put it in SQL functions (`get_project_burn`, `get_my_projects`) instead. SQL is faster (no cold-start), runs in the same transaction as the read, and is automatically RLS-aware. I would defend this swap.

### Foreground geofencing instead of background

The plan said "background location". I shipped foreground-only because Expo Go cannot reliably run background TaskManager tasks (it works on Android, it does not on iOS without a development build). The foreground path still triggers the auto-prompt when the worker has the app open at the jobsite, which is the realistic case. The real fix is a development build via EAS, which is a half-day of work that I documented in the roadmap rather than shipped.

### dinero.js was almost not real

The plan said "use dinero.js loudly". For three weekends I had been using hand-rolled integer-cent math (`Math.round`, integer multiply) and just letting the README claim dinero. The math was mathematically correct (JavaScript integers are exact up to 2^53), but the README was aspirational. I caught this on the final audit and wired dinero in via `src/lib/money.ts` before submitting. Both formatters delegate to it now. If you grep for `dinero` in the code, you will find it.

### zod was listed in the plan and never used

I planned to use zod for shared schemas between mobile and Edge Functions. Since I dropped Edge Functions, the case for zod weakened. I went with plain TypeScript types in `src/types/db.ts`. This is a real gap. Runtime validation at the API boundary is weaker than it would be with zod parsing.

### Stretch goals I did not ship

- Next.js trailer dashboard. The plan called for a web view of the dashboard for tablets sitting on a desk in the project trailer. I never started it. The mobile dashboard works on iPad.
- Push notifications ("Crew 3 is pacing 12% over budget"). Never started. Expo Notifications would have added another moving part with no demo value for a 5-day project.

### Mistakes I caught before shipping

- The CSV export almost shipped with thousand-separator commas inside dollar amounts, which would have corrupted every CSV file because comma is also the field separator. I added `formatCentsPlain` (no thousand separators) for CSV output specifically. The dashboard still uses the readable `formatCents`.
- One of my property-based tests on multi-rate blending was wrong in a subtle way. The test asserted that "total hours times average rate" produces a different answer than "sum of hours times rate per session", which is true for any uneven split. I picked a 50/50 split as the example, which is the exact case where the two formulas mathematically coincide. The test passed initially, then failed after a small refactor exposed the coincidence. Fix was a one-line change to use 6 hours and 2 hours instead of 4 and 4. Property tests caught what example tests missed.
- The PostGIS reference table `spatial_ref_sys` triggers a Supabase security advisor warning because it does not have RLS enabled. The table is owned by the PostGIS extension and contains 8,500 coordinate-system definitions, not user data. I added a migration that enables RLS on it with a permissive read policy so the advisor dashboard is clean.

### Forced trade-offs with the platform

- Expo SDK 54 introduced a peer dependency mismatch between `react` and `react-dom`. Plain `npm install` fails. I added an `.npmrc` with `legacy-peer-deps=true` so anyone cloning the repo gets a working install on the first try.
- Reanimated 4 (which shipped with SDK 54) split its Babel plugin out into a separate package called `react-native-worklets`. The `babel.config.js` had to be updated to reference the new path. The first attempt to run the app failed on this until I traced the chain through the install logs.

### Things only the operator can finish

- Pushing to a public GitHub repo. The repo currently lives at `github.com/TANICE-GAWD/Polyburn` and will be renamed to Tally.
- Recording the Loom demo (the airplane-mode offline-sync round-trip is the money shot).
- An EAS preview build so recruiters can install the actual app instead of running it through Expo Go. Two hours of work, not done.

## Testing

Three layers, each catching a different category of bug.

```mermaid
graph TD
    subgraph "Logic Layer"
        dcs["deriveClockState"] --> Vitest["Vitest + fast-check"]
        awi["applyWhatIf"] --> Vitest
        ps["pairSessions"] --> Vitest
    end

    subgraph "Data Layer"
        rls["RLS_Policies"] --> psql["psql smoke tests"]
        ipp["is_point_in_project"] --> psql
        ce["clock_events"] --> psql
    end

    subgraph "UI Layer"
        lf["Login_Flow"] --> Maestro["Maestro YAML"]
        cc["Clock_Cycle"] --> Maestro
        fd["Foreman_Dashboard"] --> Maestro
    end
```

```bash
npm test                                        # Vitest + fast-check
npm run typecheck                               # tsc --noEmit
psql ... -f supabase/tests/smoke.sql            # RLS and PostGIS
maestro test .maestro/flows                     # E2E
```

34 unit and property tests, 4 Maestro flows, 5 SQL smoke checks. The property tests are the rigor flex: things like "hours are never negative", "wages are always integer cents", "a `clock_out` at the end of any random event sequence always yields the clocked-out state".

## Setup

### Backend (hosted Supabase, no Docker, no Supabase CLI)

1. Create a project at supabase.com. Save the DB password.
2. In SQL Editor, paste and Run, in order:
   1. `supabase/migrations/20260604120000_schema.sql`
   2. `supabase/migrations/20260604120001_functions.sql`
   3. `supabase/migrations/20260604120002_rls.sql`
   4. `supabase/migrations/20260604120003_geojson.sql`
   5. `supabase/migrations/20260604120004_burn.sql`
   6. `supabase/migrations/20260604120005_spatial_ref_sys_rls.sql`
   7. `supabase/seed.sql`
3. Database, Replication, `supabase_realtime`, confirm `clock_events` is checked.
4. Project Settings, API, copy Project URL and anon key.

Optional smoke test via local psql:

```bash
sudo dnf install -y postgresql
psql "postgresql://postgres:YOUR_PW@db.YOUR_REF.supabase.co:5432/postgres" -f supabase/tests/smoke.sql
```

### Mobile app

```bash
cp .env.example .env       # fill in the three EXPO_PUBLIC_* values
npm install                # .npmrc enables legacy-peer-deps automatically
npx expo install react-native-worklets
npx expo start -c
```

Scan the QR with Expo Go (Android scans inside Expo Go, iOS scans with the Camera app). Login screen prefills `worker1@jobsite.test` with password `password123`.

Seeded accounts:

| Email | Password | Role |
|---|---|---|
| worker1@jobsite.test | password123 | worker |
| worker2@jobsite.test | password123 | worker |
| foreman@jobsite.test | password123 | foreman |
| pm@jobsite.test | password123 | pm |

## Demo script

### Offline round-trip (the part to record)

1. Sign in as `worker1@jobsite.test`.
2. Turn airplane mode on.
3. Tap Clock in, pick Framing. Status flips, dot is orange (pending).
4. Tap Switch trade, pick Concrete. Two more orange events.
5. Tap Clock out. One more orange event.
6. Turn airplane mode off. Within 15 seconds all dots flip green.
7. Confirm in Supabase Studio that `clock_events` has 4 new rows for that user.

This is the demo. It is what proves the project actually does what the README promises.

### Live dashboard

1. Sign in on a second device (or re-login after sign-out) as `foreman@jobsite.test`. Tap Dashboard.
2. On the first device, clock in and out as `worker1`. The dashboard's burn numbers move in real time without refresh.
3. Move the Workers and Days steppers, pick a trade chip. The what-if panel recomputes immediately.
4. Tap Export week CSV. System share sheet opens with a CSV ready to email.

### Geofence auto-prompt

The geofence demo is the trickiest to film because it requires GPS to cross a polygon boundary. Options, in order of preference:

1. Android Emulator with extended location controls (built-in route simulator).
2. Real Android phone with the Fake GPS Location app (Lexa) plus scrcpy mirroring to record.
3. Walking around with the seeded polygon swapped to your actual address via a one-line SQL update.

The polygon is seeded near 120 Liberty Street, Manhattan, because the test data is supposed to feel like a real project.

## Glossary

| Term | Definition |
|---|---|
| Burn | Cumulative labor cost on a project to date, in integer cents. |
| Cost code | A billable category (Framing, Concrete, Electrical, etc.) with a `rate_cents_per_hour`. |
| Session | A paired in/out event window with a single cost code. The unit of payable work. |
| WAL | SQLite Write-Ahead Logging mode. Reads and writes do not block each other. |
| RLS | PostgreSQL Row-Level Security. Policies live in the database, not the client. |
| WH-347 | The federal certified-payroll form Davis-Bacon contractors file weekly. |
| FLSA | Fair Labor Standards Act. The federal law that says overtime is on weighted-average rate for multi-rate workers. |
| Davis-Bacon | The 1931 federal act that requires prevailing wages on federally funded construction projects. |

## Roadmap

If I were continuing this work past four weekends, the order would be:

1. True background geofencing. Build a development client with EAS, register a `TaskManager` task, replace the foreground-only watcher.
2. Wage-determination ingestion. Pull from SAM.gov for federal projects and at least the New York and New Jersey state DOL feeds. Normalize into the existing cost-code shape. This is the bridge to actual prevailing-wage compliance.
3. A real WH-347 PDF generator built on top of `summarizeSessions`. The output of that function is already shaped like what a certified-payroll generator needs.
4. Push notifications for foreman exceptions ("Crew 3 is pacing 12 percent over budget").

## A note on what this is, ultimately

Tally is one cold weekend's worth of construction-back-office product. It is not finished. Not deployed at scale, not field-tested with a real crew, not connected to a payroll system. What it is, hopefully, is a credible argument that the person who built it understands the problem space well enough to be useful at a company like Trayd from week one. Everything in it (the event sourcing, the multi-rate sessions, the geofencing, the RLS model, the property tests on money math) was a choice made because of something specific about how specialty trade contracting actually works. The code is the resume.
