-- Stores the short note shown on the login and sign-up screens.
create table if not exists auth_page_messages (
  id uuid primary key default uuid_generate_v4(),
  message text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index if not exists auth_page_messages_updated_at_idx on auth_page_messages (updated_at desc);
