-- Trade Engine: Safe migration helper for multi-user rollout
-- Run this after scripts/supabase.sql.
-- Non-destructive: this script only creates backup snapshots and optional migration helpers.

-- Ensure admin columns/tables exist for idempotent reruns.
alter table public.user_profiles add column if not exists is_admin boolean not null default false;

create table if not exists public.workspace_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 1) Backup helper: copies all current rows into backup_* tables with a snapshot label.
create or replace function public.trade_engine_backup_snapshot(snapshot_label text default to_char(now(), 'YYYYMMDD_HH24MISS'))
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  backup_table text;
  tables text[] := array[
    'user_profiles',
    'workspace_admins',
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
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    backup_table := format('backup_%s', t);

    execute format(
      'create table if not exists public.%I (like public.%I including all);',
      backup_table,
      t
    );

    execute format(
      'alter table public.%I add column if not exists backup_snapshot text not null default ''manual'';',
      backup_table
    );
    execute format(
      'alter table public.%I add column if not exists backed_up_at timestamptz not null default now();',
      backup_table
    );

    execute format(
      'insert into public.%I select src.*, $1::text as backup_snapshot, now() as backed_up_at from public.%I src;',
      backup_table,
      t
    )
    using snapshot_label;
  end loop;

  return snapshot_label;
end;
$$;

-- 2) Optional helper: import legacy single-row tables into your admin user account.
--    Use this only if you have old tables like public.trade_sessions/public.journal_pages/etc.
create or replace function public.trade_engine_assign_legacy_data_to_admin(admin_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  mapping record;
  has_data_column boolean;
begin
  if admin_user_id is null then
    raise exception 'admin_user_id is required';
  end if;

  -- Mark admin in profile/admin table.
  insert into public.workspace_admins (user_id)
  values (admin_user_id)
  on conflict (user_id) do nothing;

  update public.user_profiles
     set is_admin = true,
         updated_at = now()
   where id = admin_user_id;

  -- Map legacy table names -> new per-user blob tables.
  for mapping in
    select * from (
      values
        ('trade_sessions', 'user_trade_sessions'),
        ('journal_pages', 'user_journal_pages'),
        ('settings', 'user_settings'),
        ('trade_tag_options', 'user_trade_tag_options'),
        ('trade_tag_overrides', 'user_trade_tag_overrides'),
        ('trade_reviews', 'user_trade_reviews'),
        ('historical_bars', 'user_historical_bars'),
        ('journal_checklist_templates', 'user_journal_checklist_templates'),
        ('workspace_state', 'user_workspace_state'),
        ('trade_tag_catalog', 'user_trade_tag_catalog'),
        ('playbooks', 'user_playbooks'),
        ('library_pages', 'user_library_pages'),
        ('headlines', 'user_headlines'),
        ('select_option_additions', 'user_select_option_additions'),
        ('review_templates', 'user_review_templates')
    ) as m(legacy_table, target_table)
  loop
    if to_regclass(format('public.%I', mapping.legacy_table)) is null then
      continue;
    end if;

    select exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = mapping.legacy_table
         and column_name = 'data'
    )
      into has_data_column;

    if not has_data_column then
      continue;
    end if;

    execute format(
      'insert into public.%I (user_id, data, updated_at)
       select $1::uuid, cast(data as text), coalesce(updated_at, now())
         from public.%I
        where not exists (
          select 1 from public.%I where user_id = $1::uuid
        )
        order by coalesce(updated_at, now()) desc
        limit 1
        on conflict (user_id) do nothing;',
      mapping.target_table,
      mapping.legacy_table,
      mapping.target_table
    )
    using admin_user_id;
  end loop;
end;
$$;

-- 2b) Convenience helper: assign admin by email (no UUID copy/paste needed).
create or replace function public.trade_engine_assign_legacy_data_to_admin_by_email(admin_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_admin_user_id uuid;
begin
  if admin_email is null or btrim(admin_email) = '' then
    raise exception 'admin_email is required';
  end if;

  select users.id
    into resolved_admin_user_id
    from auth.users as users
   where lower(users.email) = lower(btrim(admin_email))
   limit 1;

  if resolved_admin_user_id is null then
    raise exception 'No auth.users record found for email: %', admin_email;
  end if;

  perform public.trade_engine_assign_legacy_data_to_admin(resolved_admin_user_id);
  return resolved_admin_user_id;
end;
$$;

-- 2c) One-shot helper: backup snapshot + assign admin by email in a single call.
create or replace function public.trade_engine_run_owner_migration(
  admin_email text,
  snapshot_label text default 'before_multi_user_rollout'
)
returns table (
  backup_snapshot text,
  admin_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_name text;
  resolved_admin_user_id uuid;
begin
  snapshot_name := public.trade_engine_backup_snapshot(snapshot_label);
  resolved_admin_user_id := public.trade_engine_assign_legacy_data_to_admin_by_email(admin_email);

  return query
  select snapshot_name, resolved_admin_user_id;
end;
$$;

-- 3) Recommended run order:
--    a) run scripts/supabase.sql
--    b) select public.trade_engine_backup_snapshot('before_multi_user');
--    c) select public.trade_engine_assign_legacy_data_to_admin('<YOUR_ADMIN_USER_UUID>'::uuid);
--
--    OR one-shot by email:
--    select * from public.trade_engine_run_owner_migration('you@example.com');
--
-- 4) Verification queries:
--    select id, email, username, is_admin from public.user_profiles order by created_at asc;
--    select * from public.workspace_admins;
--    select user_id, updated_at from public.user_library_pages order by updated_at desc;
--    select user_id, updated_at from public.user_playbooks order by updated_at desc;
