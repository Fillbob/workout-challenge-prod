-- Track late completion requests for closed challenges.
create table if not exists public.late_completion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create unique index if not exists late_completion_unique_user_challenge
  on public.late_completion_requests(user_id, challenge_id);

alter table public.late_completion_requests enable row level security;

create policy "Late completion requests are visible to owners"
  on public.late_completion_requests
  for select
  using (auth.uid() = user_id);

create policy "Late completion requests can be created by owners"
  on public.late_completion_requests
  for insert
  with check (auth.uid() = user_id);

create policy "Late completion requests can be updated by admins"
  on public.late_completion_requests
  for update
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'mod')
    )
  );
