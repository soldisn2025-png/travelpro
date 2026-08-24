-- Cost tracking by category, the half of the planning spreadsheet the app had
-- no concept of: airfare, car, lodging, food, fuel, other.
create table if not exists public.trip_costs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  city_stop_id uuid references public.city_stops(id) on delete set null,
  category text not null default 'other',
  label text not null default '',
  amount numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists trip_costs_trip_idx on public.trip_costs(trip_id);

alter table public.trip_costs enable row level security;

drop policy if exists "owners can manage trip costs" on public.trip_costs;

create policy "owners can manage trip costs" on public.trip_costs
for all using (
  exists (
    select 1 from public.trips
    where trips.id = trip_costs.trip_id
      and trips.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.trips
    where trips.id = trip_costs.trip_id
      and trips.owner_user_id = auth.uid()
  )
);
