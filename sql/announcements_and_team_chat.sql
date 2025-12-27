-- Announcements visible to all signed-in users
create table if not exists public.announcements (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Team text chat, one row per message
create table if not exists public.team_messages (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists team_messages_team_created_at_idx on public.team_messages(team_id, created_at desc);

-- Enable RLS and policies for announcements
alter table if exists public.announcements enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'announcements'
      and policyname = 'announcements_select_authenticated'
  ) then
    create policy announcements_select_authenticated
      on public.announcements
      for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'announcements'
      and policyname = 'announcements_insert_admin_mod'
  ) then
    create policy announcements_insert_admin_mod
      on public.announcements
      for insert
      with check (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and p.id = created_by
            and p.role in ('admin', 'mod')
        )
      );
  end if;
end
$$;

-- Enable RLS and policies for team messages
alter table if exists public.team_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'team_messages'
      and policyname = 'team_messages_select_team_member'
  ) then
    create policy team_messages_select_team_member
      on public.team_messages
      for select
      using (
        exists (
          select 1 from public.team_members tm
          where tm.team_id = public.team_messages.team_id
            and tm.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'team_messages'
      and policyname = 'team_messages_insert_team_member'
  ) then
    create policy team_messages_insert_team_member
      on public.team_messages
      for insert
      with check (
        exists (
          select 1 from public.team_members tm
          where tm.team_id = public.team_messages.team_id
            and tm.user_id = auth.uid()
        )
      );
  end if;
end
$$;
