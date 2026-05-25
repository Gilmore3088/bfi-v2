# Bank Fee Index v2 — Database Migrations

This directory holds the canonical schema for bfi-v2. The v1 history under
`feeschedule-hub/supabase/migrations/` is read-only reference and must not be
re-applied here.

## Policy

- **Forward-only.** No down migrations, no rollback files. Recovery is by
  `pg_restore` from a backup, not by reversing a migration.
- **Dated.** Every file is `YYYYMMDDHHMMSS_short_name.sql`. Lexical order is
  application order.
- **Immutable once applied.** Past migrations are never edited. If a past
  migration was wrong, a new migration fixes it.
- **One concern per migration.** A schema change and the data backfill it
  needs live in separate, sequential files so each can be reasoned about and
  rolled forward independently.
- **Idempotent where cheap.** Use `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`,
  and guarded DDL where it does not obscure intent.

## Files

| File | Purpose | Destructive? |
|---|---|---|
| `20260525000000_baseline.sql` | v2 canonical schema. 12 tables, indexes, FKs, check constraints. | No |
| `20260525000001_dedup_v1_fees_verified.sql` | One-time cleanup: collapse 281 duplicate `fees_verified` rows that block the natural-key uniqueness constraint. | **YES — deletes rows.** |

## Application order

### Fresh environment (staging, preview, local)

Apply baseline only.

```bash
npm run db:migrate
# or
node scripts/apply-migration.mjs supabase/migrations/20260525000000_baseline.sql
```

The dedup migration is a no-op on an empty DB but will create the snapshot
and archive tables empty. It is safe but unnecessary; skip it.

### Carried-forward production DB

The v1 DB already has the canonical tables under their v1 names plus the 281
fees_verified collisions. Apply in this order:

1. **Take a full `pg_dump`.** Verify it restores to a scratch DB.
2. Apply `20260525000001_dedup_v1_fees_verified.sql` against staging.
   Confirm: 1,347 → 1,066 rows, 281 in `fees_verified_dedup_archive`.
3. Operator sign-off on staging numbers.
4. Apply step 2 to prod inside the maintenance window.
5. Apply `20260525000000_baseline.sql` only after staging has been rebuilt
   from a fresh prod snapshot and the baseline is confirmed to match the
   schema reality.

> The baseline is authoritative for fresh provisioning. On a carried-forward
> DB it is reference, not executable — running `CREATE TABLE institutions`
> against an existing `institutions` table will fail. Use a separate
> rename / table-restructure migration to converge the prod shape onto the
> baseline shape once that work is scoped.

## Tooling

- `scripts/apply-migration.mjs` — Uses the `postgres` client against
  `DATABASE_URL`. Bypasses Supabase CLI's `db push` which has been blocked
  by 403 errors against this project (see operational lessons in repo root).
- `npm run db:migrate` — Applies every file in this directory whose filename
  is not already in the `schema_migrations` table, in lexical order.
- `npm run db:ping` — `SELECT 1` round-trip against the configured DB.

## schema_migrations

A single tracking table records what has been applied:

```sql
CREATE TABLE schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    checksum    TEXT NOT NULL
);
```

This is created by `apply-migration.mjs` on first run if absent. Checksums
are sha256 of file contents; a mismatch on a previously-applied file aborts
the run rather than silently re-applying.

## When to add a new migration

- Schema change: new table, new column, new index, new constraint.
- Data backfill that must run exactly once.
- Cutover script that transforms v1 data into v2 shape.

For ad-hoc data fixes the operator runs in psql, prefer a migration anyway —
the repo is the audit log.
