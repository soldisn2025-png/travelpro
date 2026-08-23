insert into public.day_plans (city_stop_id, plan_date)
select
  city_stops.id,
  city_stops.departure_date
from public.city_stops
where city_stops.departure_date is not null
on conflict (city_stop_id, plan_date) do nothing;

insert into public.day_items (
  day_plan_id,
  item_type,
  title,
  start_time,
  end_time,
  duration_minutes,
  schedule_mode,
  priority
)
select
  departure_plans.id,
  'fixed_anchor'::day_item_type,
  meal.title,
  meal.start_time::time,
  meal.end_time::time,
  60,
  'meal',
  'must'
from public.day_plans departure_plans
join public.city_stops
  on city_stops.id = departure_plans.city_stop_id
 and city_stops.departure_date = departure_plans.plan_date
cross join (
  values
    ('Lunch', '12:00', '13:00'),
    ('Dinner', '18:00', '19:00')
) as meal(title, start_time, end_time)
where not exists (
  select 1
  from public.day_items
  where day_items.day_plan_id = departure_plans.id
    and day_items.item_type = 'fixed_anchor'
    and lower(day_items.title) like lower(meal.title) || '%'
);
