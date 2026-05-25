-- =============================================================================
-- v1 fees_verified Deduplication — DESTRUCTIVE, ONE-TIME
-- =============================================================================
-- Date:    2026-05-25
-- Author:  Data Analyst (audit) + Technical Architect (migration)
--
-- !!! WARNING !!!
-- This migration is DESTRUCTIVE and IRREVERSIBLE in a logical sense. It
-- DELETEs rows from fees_verified. A row-level snapshot is taken first into
-- fees_verified_predupe_20260525, and losing rows are also archived into
-- fees_verified_dedup_archive for the audit trail, but the canonical
-- fees_verified table will lose 281 rows.
--
-- DO NOT APPLY without:
--   1. A verified `pg_dump` of the entire DB taken in the last hour.
--   2. Dry-run on staging with the row counts confirmed (expect
--      1,347 -> 1,066, archive holding 281 rows).
--   3. Sign-off from the operator on the staging numbers.
--
-- This migration must run BEFORE the v2 baseline can be considered
-- consistent on the carried-forward production DB. It resolves the 281-row
-- collision (208 collision groups) that blocked v1's uniqueness migration —
-- see docs/team/DATA_ANALYST.md §3 and §8 for the audit.
--
-- Tie-break rule for survivor selection (highest signal first):
--   1. extraction_confidence DESC NULLS LAST
--   2. created_at DESC
--   3. fee_verified_id DESC
--
-- Natural key: (institution_id, canonical_fee_key, COALESCE(variant_type, ''))
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1. Full snapshot of fees_verified before mutation.
-- This is a heavy belt-and-suspenders backup distinct from the audit archive.
-- Drop it manually once a post-cutover snapshot has been confirmed clean.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fees_verified_predupe_20260525 AS
SELECT * FROM fees_verified;

-- -----------------------------------------------------------------------------
-- Step 2. Audit archive for the losing rows. Stored permanently so we can
-- explain to any auditor exactly which extraction got dropped and why.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fees_verified_dedup_archive (
    LIKE fees_verified INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    archived_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    archive_reason     TEXT NOT NULL,
    survivor_id        BIGINT
);

-- -----------------------------------------------------------------------------
-- Step 3. Identify dedup groups and rank rows within each.
-- The CTE is materialized via INSERT into a temp table so we can use it
-- for both the archive insert and the delete.
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _dedup_ranking ON COMMIT DROP AS
SELECT
    fee_verified_id,
    institution_id,
    canonical_fee_key,
    COALESCE(variant_type, '') AS variant_key,
    ROW_NUMBER() OVER (
        PARTITION BY institution_id, canonical_fee_key, COALESCE(variant_type, '')
        ORDER BY extraction_confidence DESC NULLS LAST,
                 created_at DESC,
                 fee_verified_id DESC
    ) AS rn,
    FIRST_VALUE(fee_verified_id) OVER (
        PARTITION BY institution_id, canonical_fee_key, COALESCE(variant_type, '')
        ORDER BY extraction_confidence DESC NULLS LAST,
                 created_at DESC,
                 fee_verified_id DESC
    ) AS survivor_id
FROM fees_verified;

-- -----------------------------------------------------------------------------
-- Step 4. Archive losers with the survivor pointer recorded.
-- -----------------------------------------------------------------------------
INSERT INTO fees_verified_dedup_archive
SELECT
    fv.*,
    now()                              AS archived_at,
    'v1_to_v2_baseline_dedup_20260525' AS archive_reason,
    r.survivor_id
FROM fees_verified fv
JOIN _dedup_ranking r ON r.fee_verified_id = fv.fee_verified_id
WHERE r.rn > 1;

-- -----------------------------------------------------------------------------
-- Step 5. Delete losers from the live table.
-- -----------------------------------------------------------------------------
DELETE FROM fees_verified
WHERE fee_verified_id IN (
    SELECT fee_verified_id FROM _dedup_ranking WHERE rn > 1
);

-- -----------------------------------------------------------------------------
-- Step 6. Verify zero collisions remain. Aborts the transaction if any
-- group still has more than one row.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    remaining_collisions INT;
    archived_count INT;
    survivors_count INT;
BEGIN
    SELECT COUNT(*) INTO remaining_collisions
    FROM (
        SELECT 1
        FROM fees_verified
        GROUP BY institution_id, canonical_fee_key, COALESCE(variant_type, '')
        HAVING COUNT(*) > 1
    ) t;

    IF remaining_collisions > 0 THEN
        RAISE EXCEPTION 'Dedup failed: % collision groups still present', remaining_collisions;
    END IF;

    SELECT COUNT(*) INTO archived_count FROM fees_verified_dedup_archive;
    SELECT COUNT(*) INTO survivors_count FROM fees_verified;

    RAISE NOTICE 'Dedup complete. survivors=%, archived=%', survivors_count, archived_count;
END
$$;

-- -----------------------------------------------------------------------------
-- Step 7. Add the uniqueness constraint that was blocked by the dupes.
-- After this point, Darwin can no longer insert a duplicate live row; the
-- price-change history pattern (superseded_by) is the only path to a second
-- row for the same natural key.
-- -----------------------------------------------------------------------------
-- NOTE: CONCURRENTLY cannot run inside a transaction. We accept a brief
-- table lock here because the table is small (1,066 rows post-dedup).
CREATE UNIQUE INDEX IF NOT EXISTS ux_fees_verified_natural
    ON fees_verified (institution_id, canonical_fee_key, COALESCE(variant_type, ''));

COMMIT;

-- =============================================================================
-- Post-flight checks to run manually after this migration applies:
--
--   SELECT COUNT(*) FROM fees_verified;                       -- expect 1066
--   SELECT COUNT(*) FROM fees_verified_dedup_archive;         -- expect 281
--   SELECT COUNT(*) FROM fees_verified_predupe_20260525;      -- expect 1347
--
-- Once verified on prod, the operator may drop the snapshot:
--   DROP TABLE fees_verified_predupe_20260525;
-- The audit archive (fees_verified_dedup_archive) is kept indefinitely.
-- =============================================================================
