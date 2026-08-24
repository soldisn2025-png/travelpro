-- The hotel is the first and last leg of every day, but it was free text only,
-- so day routes were planned without knowing where the traveller sleeps.
alter table public.city_stops
  add column if not exists hotel_name text not null default '',
  add column if not exists hotel_address text not null default '',
  add column if not exists hotel_place_id text,
  add column if not exists hotel_latitude double precision,
  add column if not exists hotel_longitude double precision;
