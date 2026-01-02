create table if not exists public.strava_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  athlete_id bigint,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.strava_tokens enable row level security;

create index if not exists strava_tokens_expiry_idx on public.strava_tokens(expires_at);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'strava_tokens'
      and policyname = 'strava_tokens_select_self'
  ) then
    create policy strava_tokens_select_self on public.strava_tokens
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'strava_tokens'
      and policyname = 'strava_tokens_insert_self'
  ) then
    create policy strava_tokens_insert_self on public.strava_tokens
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'strava_tokens'
      and policyname = 'strava_tokens_update_self'
  ) then
    create policy strava_tokens_update_self on public.strava_tokens
      for update using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'strava_tokens'
      and policyname = 'strava_tokens_delete_self'
  ) then
    create policy strava_tokens_delete_self on public.strava_tokens
      for delete using (auth.uid() = user_id);
  end if;
end;
$$;
