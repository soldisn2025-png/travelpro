alter table public.day_items
add column if not exists schedule_mode text not null default 'auto'
check (schedule_mode in ('auto', 'pinned', 'anchor'));

alter table public.day_items
add column if not exists priority text not null default 'nice'
check (priority in ('must', 'nice', 'maybe'));

update public.day_items
set schedule_mode = 'anchor',
    priority = 'must'
where item_type = 'fixed_anchor';

update public.day_items
set schedule_mode = 'auto'
where item_type = 'spot'
  and schedule_mode = 'anchor';
