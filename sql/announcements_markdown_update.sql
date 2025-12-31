-- Migrate announcements to markdown-friendly storage
alter table if exists public.announcements
  add column if not exists body_md text;

update public.announcements
set body_md = coalesce(body_md, body)
where body_md is null;

alter table if exists public.announcements
  alter column body_md set not null;

alter table if exists public.announcements
  add column if not exists updated_at timestamptz not null default now();
