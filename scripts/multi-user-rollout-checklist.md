# Trade Engine Multi-User Rollout Checklist

## 1) Run schema updates
1. Run [`scripts/supabase.sql`](./supabase.sql).
2. Run [`scripts/supabase-multi-user-migration.sql`](./supabase-multi-user-migration.sql).

## 2) Create backup snapshot first
```sql
select public.trade_engine_backup_snapshot('before_multi_user_rollout');
```

## 3) Assign your existing workspace to admin/owner account
```sql
select public.trade_engine_assign_legacy_data_to_admin('<YOUR_ADMIN_USER_UUID>'::uuid);
```

Or one-shot by email (recommended):
```sql
select * from public.trade_engine_run_owner_migration('you@example.com');
```

## 4) Verify owner/admin flags
```sql
select id, email, username, is_admin from public.user_profiles order by created_at asc;
select * from public.workspace_admins;
```

## 5) Validate data isolation
1. Sign in as admin account: confirm existing Library, Collections, trades, notes, screenshots, templates, and settings are present.
2. Create a brand-new user account.
3. Sign in as the new account and verify:
   - Workspace loads neutral template scaffolds only.
   - No admin records appear in Library, trades, journal, reviews, playbooks, settings.
4. Add data as the new user, then sign back into admin:
   - New user data must not appear in admin account.
5. Sign out/in between both users on the same machine:
   - No cross-user local fallback import should occur.

## 6) Rollback path
If needed, restore from backup tables created by `trade_engine_backup_snapshot` (`backup_*` tables filtered by `backup_snapshot`).
