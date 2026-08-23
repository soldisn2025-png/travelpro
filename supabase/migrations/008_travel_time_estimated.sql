-- Travel times that Google could not compute fall back to a flat estimate.
-- Flag them so the UI never presents a guess as a real routing result.
alter table public.day_items
  add column if not exists travel_time_is_estimated boolean not null default false;
