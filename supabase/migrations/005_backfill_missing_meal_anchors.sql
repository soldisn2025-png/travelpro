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
  day_plans.id,
  'fixed_anchor'::day_item_type,
  meal.title,
  meal.start_time::time,
  meal.end_time::time,
  60,
  'anchor',
  'must'
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
    and lower(day_items.title) like lower(meal.title) || '%'
);
