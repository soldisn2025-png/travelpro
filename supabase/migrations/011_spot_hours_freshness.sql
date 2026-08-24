-- Opening hours were snapshotted at verification and never refreshed, so a trip
-- verified months ahead schedules against stale, often seasonal, hours.
alter table public.spots
  add column if not exists hours_verified_at timestamptz;

-- Existing verified spots are backdated to their last write so they surface as
-- stale rather than falsely appearing freshly checked.
update public.spots
  set hours_verified_at = updated_at
  where hours_verified_at is null
    and verification_status = 'verified';
