-- Trade Engine: Supabase schema for cross-device sync
-- Run this in the Supabase SQL editor for your project.

-- User profiles (optional but used by the app to store username/email)
create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

do $$ begin
  create policy "user_profiles_select_own"
    on public.user_profiles for select
    using (auth.uid() = id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "user_profiles_insert_own"
    on public.user_profiles for insert
    with check (auth.uid() = id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "user_profiles_update_own"
    on public.user_profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);
exception when duplicate_object then null; end $$;

-- Helper template: single-row-per-user JSON blob tables
-- Each table stores one row per user_id with a JSON string in `data`.
-- The app uses `upsert` with `onConflict: user_id`.

create table if not exists public.user_trade_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_journal_pages (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_trade_tag_options (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_trade_tag_overrides (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_trade_reviews (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_historical_bars (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_journal_checklist_templates (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_workspace_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_trade_tag_catalog (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_playbooks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_library_pages (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_headlines (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_select_option_additions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

-- Enable RLS + per-user policies for each blob table.
-- (Idempotent: policies are wrapped in `do $$` blocks.)

do $$
declare
  t text;
  tables text[] := array[
    'user_trade_sessions',
    'user_journal_pages',
    'user_settings',
    'user_trade_tag_options',
    'user_trade_tag_overrides',
    'user_trade_reviews',
    'user_historical_bars',
    'user_journal_checklist_templates',
    'user_workspace_state',
    'user_trade_tag_catalog',
    'user_playbooks',
    'user_library_pages',
    'user_headlines',
    'user_select_option_additions'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);

    begin
      execute format(
        'create policy %I on public.%I for select using (auth.uid() = user_id);',
        t || '_select_own',
        t
      );
    exception when duplicate_object then null; end;

    begin
      execute format(
        'create policy %I on public.%I for insert with check (auth.uid() = user_id);',
        t || '_insert_own',
        t
      );
    exception when duplicate_object then null; end;

    begin
      execute format(
        'create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);',
        t || '_update_own',
        t
      );
    exception when duplicate_object then null; end;

    begin
      execute format(
        'create policy %I on public.%I for delete using (auth.uid() = user_id);',
        t || '_delete_own',
        t
      );
    exception when duplicate_object then null; end;
  end loop;
end $$;
