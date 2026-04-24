-- Trade Engine: Supabase schema for cross-device sync
-- Run this in the Supabase SQL editor for your project.
-- For safe backup + legacy migration steps, run scripts/supabase-multi-user-migration.sql first.

-- User profiles (optional but used by the app to store username/email)
create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  username text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles add column if not exists is_admin boolean not null default false;

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

create or replace function public.user_profiles_protect_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.is_admin, false) and auth.uid() is not null and auth.role() <> 'service_role' then
      raise exception 'Only service role may set is_admin.' using errcode = '42501';
    end if;
  elsif new.is_admin is distinct from old.is_admin then
    if auth.uid() is not null and auth.role() <> 'service_role' then
      raise exception 'Only service role may change is_admin.' using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_profiles_protect_admin_flag_trigger on public.user_profiles;

create trigger user_profiles_protect_admin_flag_trigger
  before insert or update on public.user_profiles
  for each row execute function public.user_profiles_protect_admin_flag();

create table if not exists public.workspace_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.workspace_admins enable row level security;

do $$ begin
  create policy "workspace_admins_select_own"
    on public.workspace_admins for select
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

drop policy if exists "workspace_admins_insert_own" on public.workspace_admins;

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, username)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        username = coalesce(public.user_profiles.username, excluded.username),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_trade_engine on auth.users;

create trigger on_auth_user_created_trade_engine
  after insert on auth.users
  for each row execute function public.handle_new_auth_user_profile();

create or replace function public.is_workspace_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    coalesce(
      exists(select 1 from public.workspace_admins where user_id = check_user_id)
      or exists(select 1 from public.user_profiles where id = check_user_id and is_admin = true),
      false
    );
$$;

create or replace function public.list_workspace_users()
returns table (
  id uuid,
  email text,
  username text,
  is_admin boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select
    profiles.id,
    profiles.email,
    profiles.username,
    profiles.is_admin,
    profiles.created_at,
    profiles.updated_at
  from public.user_profiles as profiles
  order by profiles.created_at desc;
end;
$$;

revoke all on function public.list_workspace_users() from public;
grant execute on function public.list_workspace_users() to authenticated;

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

create table if not exists public.user_review_templates (
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
    'user_select_option_additions',
    'user_review_templates'
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
