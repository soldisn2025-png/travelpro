-- Planning notes routinely park a blog or booking link next to a place.
alter table public.spots
  add column if not exists reference_url text not null default '';
