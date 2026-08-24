-- City-to-city drive times were tracked by hand next to each leg. Store the
-- computed values so multi-city trips are honest about transit days.
alter table public.travel_legs
  add column if not exists duration_minutes integer,
  add column if not exists distance_meters integer,
  add column if not exists route_mode text;
