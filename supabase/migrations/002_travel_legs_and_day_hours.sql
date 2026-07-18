create table if not exists public.travel_legs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  to_city_stop_id uuid references public.city_stops(id) on delete cascade,
  order_index integer not null default 0,
  origin text not null default '',
  destination text not null default '',
  departure_date date,
  arrival_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(to_city_stop_id)
);

create index if not exists travel_legs_trip_order_idx
on public.travel_legs(trip_id, order_index);

alter table public.travel_legs enable row level security;

create policy "owners can manage travel legs" on public.travel_legs
for all using (
  exists (
    select 1 from public.trips
    where trips.id = travel_legs.trip_id
      and trips.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.trips
    where trips.id = travel_legs.trip_id
      and trips.owner_user_id = auth.uid()
  )
);

insert into public.travel_legs (
  trip_id,
  to_city_stop_id,
  order_index,
  origin,
  destination,
  departure_date,
  arrival_date
)
select
  city_stop_rows.trip_id,
  city_stop_rows.id,
  city_stop_rows.order_index,
  coalesce(city_stop_rows.previous_city, ''),
  city_stop_rows.city,
  coalesce(city_stop_rows.previous_departure_date, trips.start_date),
  city_stop_rows.arrival_date
from (
  select
    city_stops.*,
    lag(city) over (
      partition by trip_id
      order by order_index
    ) as previous_city,
    lag(departure_date) over (
      partition by trip_id
      order by order_index
    ) as previous_departure_date
  from public.city_stops
) city_stop_rows
join public.trips on trips.id = city_stop_rows.trip_id
on conflict (to_city_stop_id) do nothing;

insert into public.day_plans (city_stop_id, plan_date)
select
  city_stops.id,
  generated_dates.plan_date::date
from public.city_stops
cross join lateral generate_series(
  city_stops.arrival_date,
  city_stops.departure_date - interval '1 day',
  interval '1 day'
) as generated_dates(plan_date)
where city_stops.arrival_date is not null
  and city_stops.departure_date is not null
  and city_stops.departure_date > city_stops.arrival_date
on conflict (city_stop_id, plan_date) do nothing;

insert into public.day_items (
  day_plan_id,
  item_type,
  title,
  start_time,
  end_time,
  duration_minutes
)
select
  day_plans.id,
  'fixed_anchor'::day_item_type,
  meal.title,
  meal.start_time::time,
  meal.end_time::time,
  60
from public.day_plans
cross join (
  values
    ('Lunch', '12:00', '13:00'),
    ('Dinner', '18:00', '19:00')
) as meal(title, start_time, end_time)
where not exists (
  select 1
  from public.day_items
  where day_items.day_plan_id = day_plans.id
    and day_items.item_type = 'fixed_anchor'
    and day_items.title = meal.title
);
