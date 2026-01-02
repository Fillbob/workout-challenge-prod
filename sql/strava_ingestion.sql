-- Tables to support Strava ingestion and partial progress tracking.

-- Track each Strava activity we've processed so replays/webhooks stay idempotent.
create table if not exists public.strava_activity_ingestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_id bigint not null,
  processed_at timestamptz not null default now(),
  raw_payload jsonb,
  unique(activity_id)
);

-- Store partial progress toward a challenge from individual activities.
create table if not exists public.submission_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  activity_id bigint not null,
  progress_value numeric not null,
  target_value numeric,
  completed boolean default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(challenge_id, user_id, activity_id)
);

create index if not exists submission_progress_user_challenge_idx
  on public.submission_progress(user_id, challenge_id);

create or replace function public.set_submission_progress_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists submission_progress_set_updated_at on public.submission_progress;
create trigger submission_progress_set_updated_at
before update on public.submission_progress
for each row execute procedure public.set_submission_progress_updated_at();

-- Allow storing the last time we ran an ingestion for a connection.
alter table if exists public.strava_connections
  add column if not exists last_synced_at timestamptz;
