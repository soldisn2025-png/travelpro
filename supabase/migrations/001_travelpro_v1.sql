create extension if not exists pgcrypto;

create type trip_status as enum ('planning', 'confirmed', 'archived');
create type planning_mode as enum ('easygoing', 'normal', 'fast_walker');
create type spot_verification_status as enum ('ai_candidate', 'verified', 'rejected');
create type day_item_type as enum ('spot', 'fixed_anchor');

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  status trip_status not null default 'planning',
  planning_mode planning_mode not null default 'normal',
  share_token text not null unique default translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_date_order check (end_date >= start_date)
);

create table public.city_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  city text not null,
  country text not null default '',
  order_index integer not null default 0,
  nights integer not null default 1 check (nights >= 1),
  arrival_date date,
  departure_date date,
  arrival_details text not null default '',
  departure_details text not null default '',
  hotel_notes text not null default '',
  flight_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.spots (
  id uuid primary key default gen_random_uuid(),
  city_stop_id uuid not null references public.city_stops(id) on delete cascade,
  name text not null,
  category text not null default 'sight',
  duration_minutes integer not null default 90 check (duration_minutes > 0),
  indoor_outdoor text not null default 'indoor',
  google_place_id text,
  address text not null default '',
  latitude double precision,
  longitude double precision,
  opening_hours jsonb not null default '{}'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  verification_status spot_verification_status not null default 'ai_candidate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.day_plans (
  id uuid primary key default gen_random_uuid(),
  city_stop_id uuid not null references public.city_stops(id) on delete cascade,
  plan_date date not null,
  start_time time not null default '09:00',
  end_time time not null default '21:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(city_stop_id, plan_date)
);

create table public.day_items (
  id uuid primary key default gen_random_uuid(),
  day_plan_id uuid not null references public.day_plans(id) on delete cascade,
  item_type day_item_type not null,
  spot_id uuid references public.spots(id) on delete cascade,
  title text not null,
  start_time time,
  end_time time,
  duration_minutes integer not null default 60 check (duration_minutes > 0),
  sort_order integer not null default 0,
  travel_time_from_previous_minutes integer,
  conflict_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spot_items_need_spot check (
    (item_type = 'spot' and spot_id is not null) or
    (item_type = 'fixed_anchor' and spot_id is null)
  )
);

create index city_stops_trip_order_idx on public.city_stops(trip_id, order_index);
create index spots_city_stop_idx on public.spots(city_stop_id);
create index day_plans_city_date_idx on public.day_plans(city_stop_id, plan_date);
create index day_items_plan_order_idx on public.day_items(day_plan_id, sort_order);

alter table public.trips enable row level security;
alter table public.city_stops enable row level security;
alter table public.spots enable row level security;
alter table public.day_plans enable row level security;
alter table public.day_items enable row level security;

create policy "owners can manage trips" on public.trips
for all using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create policy "owners can manage city stops" on public.city_stops
for all using (
  exists (
    select 1 from public.trips
    where trips.id = city_stops.trip_id
      and trips.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.trips
    where trips.id = city_stops.trip_id
      and trips.owner_user_id = auth.uid()
  )
);

create policy "owners can manage spots" on public.spots
for all using (
  exists (
    select 1 from public.city_stops
    join public.trips on trips.id = city_stops.trip_id
    where city_stops.id = spots.city_stop_id
      and trips.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.city_stops
    join public.trips on trips.id = city_stops.trip_id
    where city_stops.id = spots.city_stop_id
      and trips.owner_user_id = auth.uid()
  )
);

create policy "owners can manage day plans" on public.day_plans
for all using (
  exists (
    select 1 from public.city_stops
    join public.trips on trips.id = city_stops.trip_id
    where city_stops.id = day_plans.city_stop_id
      and trips.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.city_stops
    join public.trips on trips.id = city_stops.trip_id
    where city_stops.id = day_plans.city_stop_id
      and trips.owner_user_id = auth.uid()
  )
);

create policy "owners can manage day items" on public.day_items
for all using (
  exists (
    select 1 from public.day_plans
    join public.city_stops on city_stops.id = day_plans.city_stop_id
    join public.trips on trips.id = city_stops.trip_id
    where day_plans.id = day_items.day_plan_id
      and trips.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.day_plans
    join public.city_stops on city_stops.id = day_plans.city_stop_id
    join public.trips on trips.id = city_stops.trip_id
    where day_plans.id = day_items.day_plan_id
      and trips.owner_user_id = auth.uid()
  )
);
