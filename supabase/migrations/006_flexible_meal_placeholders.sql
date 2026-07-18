alter table public.day_items
drop constraint if exists day_items_schedule_mode_check;

alter table public.day_items
add constraint day_items_schedule_mode_check
check (schedule_mode in ('auto', 'pinned', 'anchor', 'meal'));

update public.day_items
set schedule_mode = 'meal',
    priority = 'must',
    duration_minutes = 60
where item_type = 'fixed_anchor'
  and (
    lower(title) like 'lunch%'
    or lower(title) like 'dinner%'
  );
