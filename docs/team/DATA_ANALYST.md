# Data Analyst Audit — Bank Fee Index v2 Migration

**Date:** 2026-05-25
**DB:** Supabase Postgres (same instance carried into v2)
**Method:** Direct queries against production `DATABASE_URL`. 94 tables inspected.

## Executive summary

The data is **salvageable, but only a thin slice is customer-grade**. Reference data (institutions, Fed indicators, Call Reports) is broad and reasonably fresh. The fee corpus that actually drives the product is small (1,347 verified rows across only 610 of 8,750 institutions, none `approved`), contaminated by 281 duplicate rows across 208 collision groups, and frozen — the pipeline has not written a new `fees_raw` row in over 30 days and the last `agent_runs` row is from 2026-04-08. The 147-dupe figure in SPEC.md is now closer to **281 extra rows in 208 collision groups** under the natural key `(institution_id, canonical_fee_key, variant_type)`; the dupes must be collapsed before any uniqueness migration can land. v2 can adopt institutions + financials + Fed data wholesale, must hand-curate fees_verified down to a clean seed, and should reject the 124K-row `extracted_fees` legacy table outright.

---

## 1. Table inventory (94 tables)

Top tables by mass:

| Table | Rows | Status |
|---|---:|---|
| `extracted_fees` (legacy) | 124,246 | **Reject** — superseded by `fees_raw`/`fees_verified` |
| `fees_raw` | 103,529 | Keep, but frozen 33 days |
| `branch_deposits` | 76,727 | Keep (FDIC SOD reference) |
| `agent_run_results` | 77,334 | Drop with old fleet |
| `extracted_fees_promote_backup_20260418` | 55,075 | Drop (backup snapshot) |
| `fed_economic_indicators` | 49,013 | Keep |
| `institution_financials` | 38,949 | Keep |
| `fee_snapshots` | 38,505 | Keep (history) |
| `jobs` | 35,999 | Drop (old worker queue) |
| `agent_events` | 35,068 | Drop with old fleet |
| `fee_reviews` | 26,786 | Evaluate (review history) |
| `extracted_fees_dedup_backup_20260418` | 24,963 | Drop |
| `fee_reviews_dedup_backup_20260418` | 16,620 | Drop |
| `crawl_results` | 11,346 | Keep |
| `crawl_targets` | 8,750 | Keep (institutions master) |
| `roomba_log` | 6,210 | Drop |
| **`fees_verified`** | **1,347** | **Keep with cleanup** |
| `hamilton_*` (7 tables) | ~83 total | Decide per table |
| `users` | 14 | Keep (mostly test) |
| `subscriptions` | 0 | Drop |

There are 24 wholly empty tables (e.g., `analysis_results`, `discovery_cache`, `hamilton_scenarios`, `agent_lessons`, `org_members`, `wave_runs`, `canary_runs`) — most are scaffolding for shipped-but-never-used features. They should not migrate.

Three explicit `*_backup_20260418` tables (~97K rows) are dedupe snapshots from the April 18 cleanup that never got dropped. **Reject all three.**

---

## 2. Institutions (`crawl_targets`)

| Metric | Value |
|---|---:|
| Total institutions | **8,750** |
| Banks | 4,331 |
| Credit unions | 4,419 |
| With `fee_schedule_url` populated | 4,673 (53%) |
| Last `last_success_at` ≤ 90 days | 4,161 (48%) |
| Never crawled successfully | 4,388 (50%) |
| Institutions with any `fees_verified` row | **610 (7.0%)** |
| Latest successful crawl | 2026-04-21 (34 days ago) |

Charter × tier (most concentrated at the small end):

| Tier | Banks | Credit Unions |
|---|---:|---:|
| super_regional | 12 | 0 |
| large_regional | 37 | 2 |
| regional | 106 | 19 |
| community_large | 884 | 444 |
| community_mid | 1,427 | 571 |
| community_small | 1,865 | 3,383 |

**Interpretation:** the institution master is a strong asset and migrates cleanly. Half the rows have no URL and have never produced a fee — these are still useful inventory for Magellan to drain in v2 (they are the discovery backlog). The 12 super-regional banks all have URLs and most have crawled successfully.

---

## 3. Fees data quality

### fees_verified (1,347 rows)

- **Review status:** 100% `verified`. **Zero rows are `approved`.** The "approval gate" was never closed; v1 admin UI shows pending/approved/rejected but the data shows only `verified`. Either rename the field or treat `verified` as the new terminal status.
- **Confidence:**
  - ≥ 0.90 high: **1,274 (94.6%)**
  - 0.75–0.90: 70 (5.2%)
  - < 0.75: 3 (0.2%)
  - average: **0.943**
- **Taxonomy coverage:** 100% of rows have a `canonical_fee_key` and `fee_category`. 91 distinct categories present — **more than the 49-category taxonomy expects.** Drift has crept in.

### Duplicates (the 147 figure in SPEC)

The diagnostic against the intended natural key:

```sql
SELECT institution_id, canonical_fee_key, variant_type, COUNT(*) c
FROM fees_verified
GROUP BY 1,2,3 HAVING COUNT(*) > 1;
```

| Grouping | Collision groups | Extra rows |
|---|---:|---:|
| `(institution_id, canonical_fee_key, variant_type)` | **208** | **281** |
| `(institution_id, fee_category)` | 208 | 281 |
| `(fee_raw_id)` (same raw row promoted twice) | 142 | 148 |

The 142 fee_raw_id collisions closely match the "147" in SPEC — the original count was likely measured at one point in time and has grown slightly. **The current blocker is 208 collision groups / 281 redundant rows under the canonical key.** Fix SQL in §8.

### fees_raw (103,529 rows)

- Spans 3,952 distinct institutions
- Latest row: **2026-04-21** (33 days stale)
- Rows in last 30 days: **0**
- Rows in last 7 days: **0**

**Interpretation:** the raw extraction layer has been silent since the Modal cron went dark. Of 103K raw rows only 1,347 (1.3%) made it to verified — Darwin promote pass has barely run on this data.

---

## 4. Taxonomy coverage

Every `fees_verified` row is keyed against the canonical taxonomy. However, the count of distinct categories present (**91**) exceeds the 49-category taxonomy in `src/lib/fee-taxonomy.ts`. Sample of top categories:

| Category | Rows |
|---|---:|
| counter_check | 249 |
| od_daily_cap | 146 |
| card_replacement | 89 |
| nsf | 66 |
| account_research | 63 |
| bill_pay | 57 |
| stop_payment | 44 |
| rush_card | 44 |
| safe_deposit_box | 35 |
| deposited_item_return | 33 |
| monthly_maintenance | 26 |
| card_foreign_txn | 24 |
| paper_statement | 24 |

Notable: only **26 institutions out of 610** have a `monthly_maintenance` fee captured. That is the most-asked-about fee in the product, and the v1 corpus has barely 0.3% institutional coverage on it. v2 must rebuild this from scratch via the seed-institution loop.

Action item for v2: re-key fees_verified against the canonical 49-category list during migration; route the extra 42 categories to either consolidation, drop, or taxonomy v3 amendment (`refactor-clean` candidate).

---

## 5. Fed and Call Report data

| Dataset | Rows | Coverage | Latest | Notes |
|---|---:|---|---|---|
| `fed_beige_book` | 134 | 12 districts | January 2026 | Single release loaded; minimal historical depth |
| `fed_economic_indicators` (FRED) | 49,013 | 35 series | 2026-04-17 | Last fetched 2026-04-21; stale by ~5 weeks |
| `institution_financials` (Call Reports) | 38,949 | 8,696 institutions (99%!) | 2025-12-31 | Last fetched 2026-04-06 (49 days stale) |
| `branch_deposits` (FDIC SOD) | 76,727 | broad | — | Reference data, low refresh need |
| `institution_complaints` (CFPB) | 4,483 | — | — | Keep |

**Interpretation:** the financial reference layer is the strongest part of the dataset. Call Reports cover 99% of institutions through Q4 2025 — that alone supports the Hamilton "institution profile" report flow on its own without any fee data. FRED is broad but the 2026-04-17 cutoff means anything time-sensitive will look stale. Beige Book has only the January 2026 release loaded — that is a single-release snapshot, not a corpus.

Migration: bring all four tables forward intact. Schedule FRED re-pull during cutover so charts read current.

---

## 6. Users, leads, reports — what to preserve

- **14 users**: 2 system accounts (admin, analyst), 11 `jlgilmore2+*@gmail.com` test/comp accounts marked `premium active`, and **1 real external account: `heydavidbressler@gmail.com`** (created 2026-04-09, status active). That is the only paying-shaped customer record.
- **6 leads** (latest 2026-04-07). Small but real.
- **0 subscriptions** in the `subscriptions` table (Stripe records live elsewhere).
- **11 Hamilton reports** + 17 conversations + 36 messages — all generated by the operator, no external usage.

**Recommendation:** seed v2 fresh. Carry forward only `heydavidbressler@gmail.com`, the 6 leads, and a hand-picked sample of Hamilton reports as reference artifacts. The 11 test-suffix premium accounts should not migrate.

---

## 7. Orphans, legacy, dead data

- **FK integrity is clean.** Zero orphan rows in `fees_verified` or `fees_raw` against `crawl_targets`.
- **`extracted_fees` (124,246 rows)** is the legacy pre-`fees_raw` table. Latest row 2026-04-08. SPEC slates it for drop — confirmed safe.
- **Three `*_backup_20260418` tables (~97K rows)** are dedupe snapshots from the April 18 cleanup. Drop.
- **`agent_runs`** last started 2026-04-08; 0 activity in last 30 days. Drop with the 51-state fleet.
- **`crawl_runs` has 3 zombie rows** (`status='running'`, started 2026-04-20/21/22, `completed_at` null). Reset or drop on cutover.
- **`agent_events_2026_04`** partition holds 24,563 events from the dead fleet — drop with old infrastructure.

---

## 8. Migration recommendation

### Migrate (keep as-is)

- `crawl_targets` (8,750) — full
- `institution_financials` (38,949)
- `branch_deposits`, `demographics`, `market_concentration`, `institution_complaints`
- `fed_beige_book`, `fed_economic_indicators`, `fed_content`, `beige_book_themes`, `reg_articles`
- `fee_snapshots` (history is worth preserving even if frozen)
- `leads` (6 rows)
- Selected `users` (1 + system accounts)

### Migrate after cleanup

- **`fees_verified`** — collapse 281 dupes first (SQL below), re-key against canonical 49-category taxonomy, decide whether to drop the 3 rows below 0.75 confidence
- **`fees_raw`** — keep all 103K rows; treat as Darwin's drain backlog in v2

### Reject (do not migrate)

- `extracted_fees` (124K) — legacy, superseded
- All `*_backup_20260418` tables (97K)
- All `agent_*` tables tied to the 51-state fleet: `agent_runs`, `agent_run_results`, `agent_events*`, `agent_auth_log*`, `agent_health_rollup`, `agent_registry`, `agent_messages`, `agent_budgets`, `agent_lessons`, `wave_runs`, `wave_state_runs`, `state_*`
- `jobs`, `ops_jobs`, `roomba_log`, `pipeline_runs`, `canary_runs`, `shadow_outputs`, `upload_jobs`, `workers_last_run`
- 11 `+N@gmail.com` test users; the 11 hamilton_* test reports
- 24 wholly empty tables

### Resolve the 281 duplicate `fees_verified` rows

Keep the row with the highest extraction_confidence per `(institution_id, canonical_fee_key, variant_type)` group, breaking ties by most recent `created_at`, then add the uniqueness constraint:

```sql
BEGIN;

-- 1. Snapshot before mutation
CREATE TABLE fees_verified_predupe_20260525 AS
  SELECT * FROM fees_verified;

-- 2. Delete the losers
WITH ranked AS (
  SELECT
    fee_verified_id,
    ROW_NUMBER() OVER (
      PARTITION BY institution_id, canonical_fee_key, COALESCE(variant_type,'')
      ORDER BY extraction_confidence DESC NULLS LAST,
               created_at DESC,
               fee_verified_id DESC
    ) AS rn
  FROM fees_verified
)
DELETE FROM fees_verified
WHERE fee_verified_id IN (SELECT fee_verified_id FROM ranked WHERE rn > 1);

-- 3. Verify zero collisions remain
SELECT COUNT(*) FROM (
  SELECT 1 FROM fees_verified
  GROUP BY institution_id, canonical_fee_key, COALESCE(variant_type,'')
  HAVING COUNT(*) > 1
) t;  -- expect 0

-- 4. Add the constraint
CREATE UNIQUE INDEX CONCURRENTLY ux_fees_verified_natural
  ON fees_verified (institution_id, canonical_fee_key, COALESCE(variant_type,''));

COMMIT;
```

Expected result: 1,347 → **1,066 rows**.

### Schema migrations

49 migrations recorded in `schema_migrations`; ~55 files in `supabase/migrations/`. The gap (6–8 files) matches the SPEC's "8 unapplied" figure. v2 should **squash to a fresh baseline** rather than try to replay the pending ones — most reference the dead fleet (`pg_cron_review_dispatcher`, `agent_health_rollup*`, `lineage_graph_*`).

---

## 9. Trust scores

How much of each dataset would I personally vouch for in a customer-facing McKinsey-grade report:

| Dataset | Rows | Trust score | Reasoning |
|---|---:|---:|---|
| `crawl_targets` (institutions) | 8,750 | **92%** | FDIC/NCUA-sourced, accurate names/states/assets; URL field is half-populated |
| `institution_financials` (Call Reports) | 38,949 | **88%** | 99% institutional coverage through Q4 2025, regulator-sourced; stale by 49 days but Q1 2026 won't release until May |
| `fed_economic_indicators` | 49,013 | **85%** | FRED is canonical; freshness lag (5 weeks) is the only risk |
| `fed_beige_book` | 134 | **60%** | Only one release loaded — not a corpus, can't trend |
| `branch_deposits` (SOD) | 76,727 | **80%** | FDIC-canonical but annual; vintage matters |
| `fees_verified` | 1,347 | **45%** | After dedupe and taxonomy re-key, **70%**. Pre-cleanup, would not ship. Sparse coverage (610 of 8,750 institutions), 0 approved status, 281 dupes, taxonomy drift to 91 categories. |
| `fees_raw` | 103,529 | **55%** | Volume is there; quality unverified until Darwin re-runs. Stale 33 days. |
| `users` | 14 | **20%** | 1 real customer, 11 test accounts; effectively start fresh |

**Headline:** the institutional and financial reference layers are publication-grade. The fee corpus — the actual product — needs cleanup before it can ship to a paying executive, and the pipeline needs a restart before new data can flow.

---

— Data Analyst
