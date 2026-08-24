-- Transit was hardcoded, which gives real but misleading numbers in a dense
-- walkable centre. Let each trip say how it actually gets around.
-- CREATE TYPE has no IF NOT EXISTS, so guard it to keep this file re-runnable.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'travel_mode') then
    create type travel_mode as enum ('walk', 'transit', 'drive');
  end if;
end $$;

alter table public.trips
  add column if not exists travel_mode travel_mode not null default 'transit';

-- Every "Auto-plan day" click re-billed the Routes API for the same journeys.
-- Cache a computed matrix by the exact inputs that produced it.
create table if not exists public.travel_matrices (
  cache_key text primary key,
  matrix jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists travel_matrices_created_idx
  on public.travel_matrices(created_at);

alter table public.travel_matrices enable row level security;

-- CREATE POLICY has no IF NOT EXISTS either; drop first so re-runs are clean.
drop policy if exists "signed in users can read travel matrices"
  on public.travel_matrices;
drop policy if exists "signed in users can write travel matrices"
  on public.travel_matrices;

-- The cache holds only travel durations between coordinates, no trip data, and
-- is read and written by signed-in users through the scheduler.
create policy "signed in users can read travel matrices"
  on public.travel_matrices
  for select using (auth.uid() is not null);

create policy "signed in users can write travel matrices"
  on public.travel_matrices
  for insert with check (auth.uid() is not null);
