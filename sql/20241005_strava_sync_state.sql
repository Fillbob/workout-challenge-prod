-- Add richer logging for sync windows and cursor sources.
alter table if exists public.strava_sync_logs
  add column if not exists window_after timestamptz,
  add column if not exists window_before timestamptz,
  add column if not exists mode text,
  add column if not exists cursor_source text;

-- Track per-user Strava sync cursor and lock state.
create table if not exists public.strava_sync_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  athlete_id bigint,
  last_activity_at timestamptz,
  sync_in_progress boolean default false,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function public.set_strava_sync_state_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists strava_sync_state_set_updated_at on public.strava_sync_state;
create trigger strava_sync_state_set_updated_at
before update on public.strava_sync_state
for each row execute procedure public.set_strava_sync_state_updated_at();
