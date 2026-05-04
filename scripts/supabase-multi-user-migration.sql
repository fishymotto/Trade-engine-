-- Trade Engine: Safe migration helper for multi-user rollout
-- Run this after scripts/supabase.sql.
-- Non-destructive: this script only creates backup snapshots and optional migration helpers.

-- Ensure admin columns/tables exist for idempotent reruns.
alter table public.user_profiles add column if not exists is_admin boolean not null default false;
alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;

create table if not exists public.workspace_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.workspace_admins enable row level security;
alter table public.workspace_admins force row level security;

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
  backup_constraint record;
  has_user_id_column boolean;
  has_id_column boolean;
  source_columns text;
  source_select text;
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

    -- Keep defaults/identity metadata but avoid PK/UNIQUE constraints so snapshots are rerunnable.
    execute format(
      'create table if not exists public.%I (like public.%I including defaults including generated including identity including comments);',
      backup_table,
      t
    );

    -- If a prior version created backup tables with PK/UNIQUE constraints, remove them.
    for backup_constraint in
      select conname
        from pg_constraint
       where conrelid = format('public.%I', backup_table)::regclass
         and contype in ('p', 'u')
    loop
      execute format(
        'alter table public.%I drop constraint if exists %I;',
        backup_table,
        backup_constraint.conname
      );
    end loop;

    execute format(
      'alter table public.%I add column if not exists backup_snapshot text not null default ''manual'';',
      backup_table
    );
    execute format(
      'alter table public.%I add column if not exists backed_up_at timestamptz not null default now();',
      backup_table
    );

    -- Lock down backup tables so client roles cannot read cross-user snapshots.
    execute format('alter table public.%I enable row level security;', backup_table);
    execute format('alter table public.%I force row level security;', backup_table);
    execute format('revoke all on table public.%I from public;', backup_table);

    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon;', backup_table);
    end if;

    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated;', backup_table);
    end if;

    select exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = backup_table
         and column_name = 'user_id'
    )
      into has_user_id_column;

    select exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = backup_table
         and column_name = 'id'
    )
      into has_id_column;

    if has_user_id_column then
      begin
        execute format(
          'create policy %I on public.%I for select using (auth.uid() = user_id);',
          backup_table || '_select_own',
          backup_table
        );
      exception when duplicate_object then null; end;
    elsif has_id_column then
      begin
        execute format(
          'create policy %I on public.%I for select using (auth.uid() = id);',
          backup_table || '_select_own',
          backup_table
        );
      exception when duplicate_object then null; end;
    end if;

    -- Ensure inserts are stable even if source schema evolves over time.
    select
      string_agg(format('%I', attname), ', ' order by attnum),
      string_agg(format('src.%I', attname), ', ' order by attnum)
      into source_columns, source_select
      from pg_attribute
     where attrelid = format('public.%I', t)::regclass
       and attnum > 0
       and not attisdropped;

    if source_columns is null or source_select is null then
      continue;
    end if;

    execute format(
      'insert into public.%I (%s, backup_snapshot, backed_up_at)
       select %s, $1::text as backup_snapshot, now() as backed_up_at
         from public.%I src;',
      backup_table,
      source_columns,
      source_select,
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

-- Restrict migration helpers to trusted backend roles only.
do $$
begin
  revoke all on function public.trade_engine_backup_snapshot(text) from public;
  revoke all on function public.trade_engine_assign_legacy_data_to_admin(uuid) from public;
  revoke all on function public.trade_engine_assign_legacy_data_to_admin_by_email(text) from public;
  revoke all on function public.trade_engine_run_owner_migration(text, text) from public;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.trade_engine_backup_snapshot(text) from anon;
    revoke all on function public.trade_engine_assign_legacy_data_to_admin(uuid) from anon;
    revoke all on function public.trade_engine_assign_legacy_data_to_admin_by_email(text) from anon;
    revoke all on function public.trade_engine_run_owner_migration(text, text) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.trade_engine_backup_snapshot(text) from authenticated;
    revoke all on function public.trade_engine_assign_legacy_data_to_admin(uuid) from authenticated;
    revoke all on function public.trade_engine_assign_legacy_data_to_admin_by_email(text) from authenticated;
    revoke all on function public.trade_engine_run_owner_migration(text, text) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.trade_engine_backup_snapshot(text) to service_role;
    grant execute on function public.trade_engine_assign_legacy_data_to_admin(uuid) to service_role;
    grant execute on function public.trade_engine_assign_legacy_data_to_admin_by_email(text) to service_role;
    grant execute on function public.trade_engine_run_owner_migration(text, text) to service_role;
  end if;
end;
$$;

-- 3) Always-on history snapshots for blob tables (prevents unrecoverable overwrites).
create table if not exists public.trade_engine_blob_history (
  id bigint generated always as identity primary key,
  table_name text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  data text not null,
  data_hash text not null,
  source_updated_at timestamptz not null,
  captured_at timestamptz not null default now(),
  capture_reason text not null default 'trigger'
);

create index if not exists trade_engine_blob_history_lookup_idx
  on public.trade_engine_blob_history (table_name, user_id, captured_at desc);

create unique index if not exists trade_engine_blob_history_dedupe_idx
  on public.trade_engine_blob_history (table_name, user_id, data_hash, source_updated_at);

alter table public.trade_engine_blob_history enable row level security;
alter table public.trade_engine_blob_history force row level security;

do $$
begin
  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'trade_engine_blob_history'
       and policyname = 'trade_engine_blob_history_select_own'
  ) then
    create policy "trade_engine_blob_history_select_own"
      on public.trade_engine_blob_history
      for select
      using (auth.uid() = user_id);
  end if;
end;
$$;

grant select on public.trade_engine_blob_history to authenticated;

create or replace function public.trade_engine_capture_blob_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_hash text;
begin
  if new.user_id is null or new.data is null then
    return new;
  end if;

  new_hash := md5(new.data);

  -- Skip noisy duplicates in rapid autosave bursts.
  if exists (
    select 1
      from public.trade_engine_blob_history history
     where history.table_name = tg_table_name
       and history.user_id = new.user_id
       and history.data_hash = new_hash
       and history.captured_at >= now() - interval '15 minutes'
  ) then
    return new;
  end if;

  insert into public.trade_engine_blob_history (
    table_name,
    user_id,
    data,
    data_hash,
    source_updated_at,
    captured_at,
    capture_reason
  )
  values (
    tg_table_name,
    new.user_id,
    new.data,
    new_hash,
    coalesce(new.updated_at, now()),
    now(),
    case when tg_op = 'INSERT' then 'insert' else 'update' end
  )
  on conflict (table_name, user_id, data_hash, source_updated_at) do nothing;

  -- Keep a rolling history window per table/user to control storage growth.
  delete from public.trade_engine_blob_history old_history
   where old_history.id in (
     select history.id
       from (
         select id,
                row_number() over (
                  partition by table_name, user_id
                  order by captured_at desc, id desc
                ) as rn
           from public.trade_engine_blob_history
          where table_name = tg_table_name
            and user_id = new.user_id
       ) history
      where history.rn > 250
   );

  return new;
end;
$$;

do $$
declare
  t text;
  trigger_name text;
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
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    trigger_name := format('%s_capture_history_trg', t);

    execute format(
      'drop trigger if exists %I on public.%I;',
      trigger_name,
      t
    );

    execute format(
      'create trigger %I
         after insert or update of data, updated_at
         on public.%I
         for each row
         execute function public.trade_engine_capture_blob_history();',
      trigger_name,
      t
    );
  end loop;
end;
$$;

-- 3b) Guard against catastrophic blob shrink on the most sensitive tables.
create or replace function public.trade_engine_prevent_catastrophic_blob_shrink()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_len integer;
  new_len integer;
  old_ts timestamptz;
  new_ts timestamptz;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.data is null or new.data is null then
    return new;
  end if;

  old_len := length(old.data);
  new_len := length(new.data);
  old_ts := coalesce(old.updated_at, to_timestamp(0));
  new_ts := coalesce(new.updated_at, now());

  -- Allow normal edits. Intervene only on extreme shrink events that are usually stale-cache clobbers.
  if old_len >= 4000
     and new_len <= greatest(300, (old_len * 0.20)::int)
     and new_ts < old_ts + interval '30 days' then
    new.data := old.data;
    new.updated_at := old.updated_at;
  end if;

  return new;
end;
$$;

do $$
declare
  t text;
  trigger_name text;
  guarded_tables text[] := array[
    'user_journal_pages',
    'user_trade_reviews',
    'user_trade_tag_overrides'
  ];
begin
  foreach t in array guarded_tables loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    trigger_name := format('%s_prevent_catastrophic_shrink_trg', t);

    execute format(
      'drop trigger if exists %I on public.%I;',
      trigger_name,
      t
    );

    execute format(
      'create trigger %I
         before update of data, updated_at
         on public.%I
         for each row
         execute function public.trade_engine_prevent_catastrophic_blob_shrink();',
      trigger_name,
      t
    );
  end loop;
end;
$$;

create or replace function public.trade_engine_seed_blob_history(seed_reason text default 'manual_seed')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  inserted_count integer;
  total_inserted integer := 0;
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
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    execute format(
      'with inserted as (
         insert into public.trade_engine_blob_history (
           table_name, user_id, data, data_hash, source_updated_at, captured_at, capture_reason
         )
         select %L::text,
                src.user_id,
                src.data,
                md5(src.data),
                coalesce(src.updated_at, now()),
                now(),
                %L::text
           from public.%I src
         on conflict (table_name, user_id, data_hash, source_updated_at) do nothing
         returning 1
       )
       select count(*)::int from inserted;',
      t,
      seed_reason,
      t
    )
    into inserted_count;

    total_inserted := total_inserted + coalesce(inserted_count, 0);
  end loop;

  return total_inserted;
end;
$$;

create or replace function public.trade_engine_restore_blob_from_history(
  target_table text,
  target_user_id uuid,
  history_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot record;
  allowed_tables text[] := array[
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
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  if target_table is null or not (target_table = any(allowed_tables)) then
    raise exception 'unsupported target_table: %', target_table;
  end if;

  select *
    into snapshot
    from public.trade_engine_blob_history
   where id = history_id
     and table_name = target_table
     and user_id = target_user_id
   limit 1;

  if snapshot is null then
    return false;
  end if;

  execute format(
    'insert into public.%I (user_id, data, updated_at)
     values ($1::uuid, $2::text, now())
     on conflict (user_id) do update
       set data = excluded.data,
           updated_at = excluded.updated_at;',
    target_table
  )
  using target_user_id, snapshot.data;

  return true;
end;
$$;

do $$
begin
  revoke all on function public.trade_engine_capture_blob_history() from public;
  revoke all on function public.trade_engine_prevent_catastrophic_blob_shrink() from public;
  revoke all on function public.trade_engine_seed_blob_history(text) from public;
  revoke all on function public.trade_engine_restore_blob_from_history(text, uuid, bigint) from public;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.trade_engine_capture_blob_history() from anon;
    revoke all on function public.trade_engine_prevent_catastrophic_blob_shrink() from anon;
    revoke all on function public.trade_engine_seed_blob_history(text) from anon;
    revoke all on function public.trade_engine_restore_blob_from_history(text, uuid, bigint) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.trade_engine_capture_blob_history() from authenticated;
    revoke all on function public.trade_engine_prevent_catastrophic_blob_shrink() from authenticated;
    revoke all on function public.trade_engine_seed_blob_history(text) from authenticated;
    revoke all on function public.trade_engine_restore_blob_from_history(text, uuid, bigint) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.trade_engine_seed_blob_history(text) to service_role;
    grant execute on function public.trade_engine_restore_blob_from_history(text, uuid, bigint) to service_role;
  end if;
end;
$$;

-- 4) Recommended run order:
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
