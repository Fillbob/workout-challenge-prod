-- Ensure Strava sync lock columns exist to prevent runtime errors.
alter table if exists public.strava_sync_state
  add column if not exists sync_in_progress boolean default false,
  add column if not exists locked_at timestamptz,
  add column if not exists lock_expires_at timestamptz;
