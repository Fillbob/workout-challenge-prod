create table if not exists public.strava_connections (
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

create or replace function public.set_strava_connections_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists strava_connections_set_updated_at on public.strava_connections;
create trigger strava_connections_set_updated_at
before update on public.strava_connections
for each row
execute procedure public.set_strava_connections_updated_at();

alter table if exists public.strava_connections enable row level security;

create index if not exists strava_connections_expiry_idx on public.strava_connections(expires_at);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'strava_connections'
      and policyname = 'strava_connections_select_self'
  ) then
    create policy strava_connections_select_self on public.strava_connections
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'strava_connections'
      and policyname = 'strava_connections_select_service'
  ) then
    create policy strava_connections_select_service on public.strava_connections
      for select using (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'strava_connections'
      and policyname = 'strava_connections_insert_self'
  ) then
    create policy strava_connections_insert_self on public.strava_connections
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'strava_connections'
      and policyname = 'strava_connections_update_self'
  ) then
    create policy strava_connections_update_self on public.strava_connections
      for update using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'strava_connections'
      and policyname = 'strava_connections_delete_self'
  ) then
    create policy strava_connections_delete_self on public.strava_connections
      for delete using (auth.uid() = user_id);
  end if;
end;
$$;
