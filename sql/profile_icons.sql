-- Add a selectable profile icon for each athlete
alter table if exists profiles
  add column if not exists profile_icon text;

-- Seed a default icon for anyone missing one so the UI can render immediately
update profiles
set profile_icon = coalesce(profile_icon, 'flame');
