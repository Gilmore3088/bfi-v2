# Technical Architect — Bank Fee Index v2

**Status:** v0.1 · 2026-05-25
**Scope:** System design for M1 vertical slice (22 seed institutions), forward-compatible to 4,000+.

This document is the concrete build plan. It assumes the SPEC.md decisions are locked: Next.js 16, Supabase Postgres (same DB as v1), Modal Team tier, Anthropic, R2.

---

## 1. Next.js app structure

Single Next.js 16 App Router repo. No monorepo. Python lives under `agents/` because Modal deploys from the same tree.

```
bfi-v2/
  src/
    app/
      (marketing)/                 # public, statically generated
        page.tsx                   # landing
        pricing/page.tsx
      (admin)/                     # session-gated, role >= analyst
        layout.tsx                 # nav + auth check
        dashboard/page.tsx
        market/page.tsx            # unified index (filters via URL)
        market/[category]/page.tsx
        hamilton/page.tsx          # report generator
        hamilton/[reportId]/page.tsx
        leads/page.tsx
        agents/page.tsx            # tabs: darwin | magellan | knox | atlas
        review/page.tsx            # tabs: queue | knox-flagged
        data-quality/page.tsx
      (pro)/                       # session-gated, role = pro|admin
        hamilton/page.tsx
        institutions/[id]/page.tsx
      api/
        v1/
          fees/route.ts            # GET, public-rate-limited
          index/route.ts           # GET, peer filters
          institutions/[id]/route.ts
        agents/
          [agent]/trigger/route.ts # POST, admin-only manual fire
          events/stream/route.ts   # SSE for /agents page
        hamilton/[reportId]/stream/route.ts  # streaming text via ai SDK
        webhooks/stripe/route.ts
        revalidate/route.ts        # ISR purge, token-gated
      actions/                     # server actions (mutations)
        review.ts                  # approve/reject fees
        leads.ts
        hamilton.ts                # createReport(), saveDraft()
        peers.ts                   # save peer sets
    components/
      ui/                          # primitives (Button, Dialog, Table)
      market/                      # MarketTable, DeltaPill, DistChart
      hamilton/                    # ReportHeader, StatCallout, ChartBlock
      agents/                      # AgentTile, EventStream, HealthBadge
    lib/
      db/                          # postgres client + query modules
        client.ts                  # postgres() singleton (TCP, port 6543)
        client-session.ts          # session-mode pool (port 5432) for LISTEN
        institutions.ts
        fees.ts
        market.ts                  # buildMarketIndex(), getPeerIndex()
        hamilton.ts                # report_jobs CRUD
        agents.ts                  # agent_events, agent_health
        leads.ts
      auth/
        session.ts                 # HMAC cookie, getCurrentUser()
        rbac.ts                    # requireRole('admin' | 'analyst' | 'pro')
      taxonomy.ts                  # 49 categories × 9 families (copied from v1)
      fed-districts.ts             # parsePeerFilters(), district SVG paths
      r2.ts                        # putObject/getObject wrappers
      anthropic.ts                 # Claude client, streamText helper
      env.ts                       # Zod-validated process.env
      format.ts                    # formatAmount, timeAgo
  agents/                          # Python — Modal deploys this tree
    modal_app.py                   # single App, 5 web functions + 4 crons
    magellan/run.py
    atlas/run.py
    darwin/run.py
    knox/run.py
    hamilton/run.py                # (Python wrapper around Anthropic for batch jobs)
    shared/
      db.py                        # asyncpg pool
      r2.py
      taxonomy.py                  # mirror of TS taxonomy
      events.py                    # emit_agent_event(agent, status, payload)
  supabase/
    migrations/
      00000000000000_baseline.sql  # squashed v2 baseline (see §2)
      00000000000001_seed.sql
  scripts/
    dev-setup.sh
    apply-migration.mjs            # uses postgres client against DATABASE_URL
    seed-institutions.mjs
  vitest.config.ts
  next.config.ts
  package.json
  pyproject.toml
  README.md
```

**Server vs client policy.** Default Server Component. `"use client"` is allowed only for:
- Interactive primitives (Dialog, Command Palette, DarkModeToggle)
- Charts (Recharts requires DOM)
- Forms with optimistic UI

Client components MUST NOT import from `lib/db/*` — they receive props from a server parent or call a server action. Type/constant modules (`taxonomy.ts`, `fed-districts.ts`) are pure TS, importable by both.

**State.** URL search params own all filter state on Market and Review (charter, tier, district, range, search). Server actions own mutations. React state is only for transient UI (open/closed, hover). No Zustand, no Redux, no Tanstack Query — server components + actions cover it.

---

## 2. DB baseline migration plan

v1 has 55 migrations layered on top of the original schema, including 33 dated `2026-04` to `2026-05` from the reliability wave. v2 squashes to **one baseline** plus tracking.

### Squash strategy

1. Snapshot v1 production schema via `pg_dump --schema-only --no-owner --no-acl`.
2. Strip: `wave_runs`, `wave_state_runs`, `fees_published`, `fees_published_rollback_log`, `roomba_log`, `canary_runs`, `shadow_outputs`, `classification_history`, `classification_cache`, `agent_lessons`, `agent_messages`, `agent_health_rollup`, `agent_auth_log` (+ partitions), `hamilton_digest_runs`, `hamilton_digest_subscriptions`, `institution_dossiers`, `institution_fee_snapshots`, `fee_index_snapshots`, `knox_overrides`, `published_reports`, `report_jobs` (rebuilt below).
3. Resolve the **147-duplicate-fees blocker** before the squash, not after: a single DDL+DML script `scripts/dedupe-fees-verified.sql` that (a) collapses duplicates into the highest-confidence row keyed by `(institution_id, canonical_fee_key)`, (b) inserts losers into a `fees_verified_dedup_archive` table for audit, (c) adds the unique constraint that's been pending. This runs once against staging, validated, then prod, before the baseline migration is applied. The baseline assumes the constraint exists.
4. Write `00000000000000_baseline.sql` containing only the canonical tables below, with the unique constraint baked in.
5. Keep `schema_migrations` tracking table; first row references the baseline.

### Canonical v2 tables

| Table | Purpose | Key columns |
|---|---|---|
| `institutions` | 4,000+ banks/CUs | `id BIGSERIAL PK`, `name TEXT`, `state_code CHAR(2)`, `charter_type TEXT CHECK IN ('bank','credit_union')`, `asset_size NUMERIC`, `asset_size_tier TEXT`, `fed_district SMALLINT`, `city TEXT`, `website_url TEXT`, `routing_number TEXT`, `rssd_id TEXT`, `created_at TIMESTAMPTZ` |
| `institution_urls` | Fee-schedule URLs (Magellan output) | `id BIGSERIAL`, `institution_id FK`, `url TEXT`, `discovery_method TEXT`, `confidence NUMERIC`, `verified_at TIMESTAMPTZ`, `is_active BOOL`, `UNIQUE(institution_id, url)` |
| `fees_raw` | Atlas output, immutable | `id BIGSERIAL`, `institution_id FK`, `source_url TEXT`, `r2_key TEXT`, `extracted_at TIMESTAMPTZ`, `raw_text TEXT`, `raw_payload JSONB`, `extractor_version TEXT` |
| `fees_verified` | Darwin output, append-only with versions | `id BIGSERIAL`, `fees_raw_id FK`, `institution_id FK`, `fee_category TEXT`, `fee_family TEXT`, `fee_name TEXT`, `amount NUMERIC`, `frequency TEXT`, `conditions TEXT`, `confidence NUMERIC`, `canonical_fee_key TEXT`, `review_status TEXT DEFAULT 'pending'`, `reviewed_by TEXT`, `reviewed_at TIMESTAMPTZ`, `superseded_by BIGINT`, `created_at TIMESTAMPTZ`, `UNIQUE(institution_id, canonical_fee_key) WHERE superseded_by IS NULL` |
| `taxonomy` | Reference data (49 × 9 × 4) | `category TEXT PK`, `family TEXT`, `tier TEXT`, `display_name TEXT`, `description TEXT` |
| `fed_data` | Beige Book + FRED rolled up | `id`, `district SMALLINT`, `as_of DATE`, `series TEXT`, `value NUMERIC`, `text TEXT`, `source TEXT` |
| `call_reports` | FFIEC quarterly | `id`, `institution_id FK`, `period DATE`, `total_assets NUMERIC`, `service_charges_deposits NUMERIC`, `nsf_revenue NUMERIC`, ... (~30 cols), `UNIQUE(institution_id, period)` |
| `users` | Auth | `id BIGSERIAL`, `email TEXT UNIQUE`, `password_hash TEXT`, `display_name TEXT`, `role TEXT CHECK IN ('viewer','analyst','admin','pro')`, `stripe_customer_id TEXT`, `subscription_status TEXT`, `created_at TIMESTAMPTZ` — **seed fresh** (decision: don't migrate v1 users; lower risk, ~12 active accounts) |
| `leads` | Sales pipeline | `id`, `email`, `company`, `source`, `score INT`, `notes TEXT`, `status TEXT`, `created_at`, `last_touched_at` |
| `reports` | Hamilton outputs (replaces report_jobs + published_reports) | `id UUID PK`, `kind TEXT`, `subject_institution_id FK NULL`, `subject_category TEXT NULL`, `status TEXT CHECK IN ('queued','running','succeeded','failed')`, `requested_by FK users`, `params JSONB`, `output_r2_key TEXT`, `output_markdown TEXT`, `cost_cents INT`, `created_at`, `completed_at` |
| `agent_events` | Single source of truth for fleet state | `id BIGSERIAL`, `agent TEXT CHECK IN ('magellan','atlas','darwin','knox','hamilton')`, `run_id UUID`, `status TEXT CHECK IN ('started','in_progress','succeeded','failed','skipped')`, `payload JSONB`, `error TEXT`, `created_at TIMESTAMPTZ DEFAULT now()` — **not partitioned in M1**, partition by month at 1M rows |
| `agent_runs` | Run-level rollup (one row per invocation) | `run_id UUID PK`, `agent TEXT`, `started_at`, `ended_at`, `status`, `items_processed INT`, `cost_cents INT` |

### Dropped from v1

`wave_*`, `roomba_log`, `canary_runs`, `shadow_outputs`, `classification_*`, `agent_lessons`, `agent_messages`, `agent_health_rollup`, `agent_auth_log*`, `hamilton_digest_*`, `institution_dossiers`, `institution_fee_snapshots`, `fee_index_snapshots`, `knox_overrides`, `published_reports`, `report_jobs`, `fees_published*`. Functionality either collapses into the 12 canonical tables or was YAGNI.

### RLS

Enabled on `users`, `reports`, `leads`. Disabled on `institutions`, `fees_verified`, `taxonomy`, `fed_data`, `call_reports` (read-public via API). Service-role key bypasses RLS for agents.

---

## 3. Agent fleet contracts

Five agents. One Modal `App`, deployed once. Each agent is one Python module + one Modal `@app.function` for the cron + one `@app.web_endpoint` for manual fire from the `/agents` page.

```
                        +-----------+
                        |institutions|
                        +-----+-----+
                              |
                  (no url)    v        (active url)
              +---------- Magellan ----------+
              |               |              |
              v               v              v
       institution_urls   agent_events     (skip)
              |
              v
            Atlas ----> R2 (raw HTML/PDF) ----> fees_raw
              |
              v
           Darwin ----> fees_verified (review_status='pending'|'auto_approved')
              |
              v
            Knox  ----> updates fees_verified (review_status='flagged'|'approved')
              |
              v
          Hamilton ----> reports (markdown + R2 PDF)
```

### Magellan

- **Input:** `SELECT id FROM institutions WHERE NOT EXISTS (SELECT 1 FROM institution_urls WHERE institution_id = institutions.id AND is_active)`
- **Output:** `INSERT INTO institution_urls (institution_id, url, discovery_method, confidence)`
- **Schedule:** `@app.function(schedule=Cron("0 6 * * *"))` (02:00 ET)
- **Idempotency:** `UNIQUE(institution_id, url)`; upserts with `ON CONFLICT DO NOTHING`. Re-runs are safe.
- **Failure:** Catches per-institution; emits `agent_events` row with `status='failed'`, continues. Run-level status = `succeeded` if ≥80% of items processed.
- **Web endpoint:** `POST /agents/magellan/trigger` → enqueues a single-institution run (admin-only).

### Atlas

- **Input:** `SELECT institution_urls.* WHERE is_active AND (SELECT max(extracted_at) FROM fees_raw WHERE source_url = institution_urls.url) IS NULL OR < now() - interval '30 days'`
- **Output:** R2 object (`raw/{institution_id}/{yyyymmdd}/{hash}.html|pdf`) + `fees_raw` row
- **Schedule:** Cron 03:00 ET
- **Idempotency:** `r2_key` includes content hash; if hash matches the most recent `fees_raw` row for that URL, skip insert.
- **Failure:** 3 retries with exponential backoff inside Modal. After 3 fails, mark URL `is_active=false` if HTTP 404/410.
- **Web endpoint:** `POST /agents/atlas/trigger {institution_id}` for manual recrawl.

### Darwin

- **Input:** `SELECT * FROM fees_raw WHERE id NOT IN (SELECT fees_raw_id FROM fees_verified)`
- **Output:** `fees_verified` rows; auto-promote to `review_status='auto_approved'` when confidence ≥ 0.90
- **Schedule:** Continuous drain — Modal function with `keep_warm=1` polling every 60s, or cron-every-5min in M1.
- **Idempotency:** `UNIQUE(institution_id, canonical_fee_key) WHERE superseded_by IS NULL`. New extraction with different amount → marks old row's `superseded_by` and inserts new (price-change history preserved).
- **Failure:** Per-row; LLM errors logged but don't block the batch.
- **Web endpoint:** `POST /agents/darwin/reclassify {fees_raw_id}` (admin).

### Knox

- **Input:** `SELECT * FROM fees_verified WHERE review_status = 'pending' AND confidence < 0.90` plus outlier detection (z-score > 2 within category)
- **Output:** Updates `review_status` to `flagged` (needs human) or `approved` (Knox confirms)
- **Schedule:** Continuous (every 10 min) after Darwin
- **Idempotency:** Only touches rows in `pending`; transitions are one-way.
- **Failure:** Logs, continues. If Anthropic rate-limited, backs off 5 min.
- **Web endpoint:** None — humans use `/review` UI which calls server actions.

### Hamilton

- **Input:** `reports` row with `status='queued'`
- **Output:** Markdown into `reports.output_markdown`, PDF rendered to R2, status `succeeded`/`failed`
- **Schedule:** User-triggered (no cron). Reports table is the queue.
- **Idempotency:** `reports.id` UUID; if status already `succeeded`, refuse re-run unless `?force=true`.
- **Failure:** Sets `status='failed'`, `error`, retains partial output. Cost circuit breaker: if today's `SUM(cost_cents) > 5000` ($50), refuse new jobs.
- **Web endpoint:** `POST /api/hamilton/{reportId}/stream` — Vercel AI SDK streaming response into browser, persists final markdown to DB on close.

**Cron endpoint count:** 5 web endpoints + 4 crons (Hamilton has no cron) = 9. Within Team tier's 10-endpoint allowance with 1 to spare.

---

## 4. R2 layout

Single bucket `bfi-v2-prod` (plus `bfi-v2-staging`).

```
raw/{institution_id}/{yyyymmdd}/{sha256}.{html|pdf}   # Atlas writes; immutable
reports/{report_id}.pdf                                # Hamilton writes
reports/{report_id}.md                                 # backup of DB copy
exports/{user_id}/{yyyymmdd}/{filename}.csv            # user CSV downloads (24h signed)
backups/db/{yyyymmdd}.sql.gz                           # nightly pg_dump
```

**Lifecycle:**
- `raw/`: transition to Infrequent Access at 90 days; never delete (audit trail).
- `reports/`: never delete.
- `exports/`: delete at 7 days.
- `backups/db/`: keep 30 daily + 12 monthly.

All keys signed for public reads; service-role credentials in Modal + Vercel env.

---

## 5. Observability

**Stack:**
- **Vercel Analytics** for frontend Core Web Vitals.
- **Sentry** for both Next.js and Modal (Python SDK) error capture. `NEXT_PUBLIC_SENTRY_DSN` already in v1 env.
- **Plausible** for product analytics.
- **Modal's built-in logs** for agent stdout; surfaced into `/agents` page via `agent_events` writes.
- **Postgres views** for fleet health: `v_agent_last_run`, `v_fleet_freshness_24h`, `v_extraction_throughput`. Read by Dashboard.

**Metrics (must be on Dashboard):**
- Last successful run per agent (timestamp + age)
- 24h items processed (Magellan URLs found, Atlas pages crawled, Darwin classifications, Knox reviews, Hamilton reports)
- Anthropic spend today (sum `agent_runs.cost_cents`)
- Open review queue depth
- R2 storage growth (weekly)

**Alerts (PagerDuty or email-to-SMS via Resend):**
- Any agent's last successful run > 26h old (cron-broken detector — direct response to v1's 33-day silent failure)
- Anthropic daily spend > $40
- Review queue depth > 500
- Postgres connection errors > 5/min
- Sentry error rate > baseline + 3σ

**Dashboard:** A single Next.js page at `/dashboard`. No Grafana, no Datadog in M1 — those are over-investment for a 1-operator product. Revisit at M3.

---

## 6. Auth + RBAC

Session-based, HMAC-SHA256 signed cookie (same approach as v1, it works). No third-party auth provider in M1.

**Session model:**
- Cookie `bfi_session` = `base64(userId|expiresAt|role).hmac(BFI_COOKIE_SECRET)`
- 24h TTL, sliding window on activity
- `getCurrentUser()` is a cached server function; one DB lookup per request

**Roles:**
| Role | Access |
|---|---|
| `viewer` | Public Market + Hamilton public reports |
| `analyst` | + Review queue, can approve/reject fees |
| `admin` | + Agents page, manual triggers, all DB tables |
| `pro` | Public + Pro Hamilton + saved peer sets (Stripe-gated) |

**`requireRole(role)` server util** runs at the top of every gated page; redirects to `/login` on fail, throws 403 on insufficient privileges.

**Pro gate:** Server action checks `users.subscription_status = 'active'` on every Pro page. Stripe webhook updates this column. No client-side gating — security never lives in the browser.

**Service role:** Modal agents use `SUPABASE_SERVICE_ROLE_KEY` for DB, bypassing RLS. Never expose this in the browser bundle (enforced by `env.ts` Zod schema separating `NEXT_PUBLIC_*` from server keys).

---

## 7. Local dev experience

Goal: clone → working dev server in <10 min, no DB on the laptop.

**`scripts/dev-setup.sh`:**
```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Verify Node 20 and Python 3.12
command -v node >/dev/null && node -v | grep -q "v20" || { echo "Need Node 20"; exit 1; }
python3 --version | grep -q "3.12" || { echo "Need Python 3.12"; exit 1; }

# 2. Install JS deps
npm ci

# 3. Install Python deps (agents)
python3 -m venv .venv
source .venv/bin/activate
pip install -r agents/requirements.txt

# 4. Pull dev env from 1Password (or copy .env.example -> .env.local)
if [ ! -f .env.local ]; then
  if command -v op >/dev/null; then
    op inject -i .env.example -o .env.local
  else
    cp .env.example .env.local
    echo "Fill in .env.local manually"
    exit 1
  fi
fi

# 5. Verify Supabase staging connection
npm run db:ping  # postgres SELECT 1

# 6. Apply any pending migrations
npm run db:migrate

# 7. Seed (idempotent)
npm run db:seed

echo "Ready. Run: npm run dev"
```

Devs hit a shared **staging Supabase project** (separate from prod). No local Postgres. Production access is gated behind a second `.env.prod` that only the owner has.

`npm run dev` runs Next on :3000. Agents run via `modal run agents/modal_app.py::magellan` (no local Modal install needed for frontend-only work).

---

## 8. First-week tasks

Pickable in any order; each is 2-6h of work.

1. **TKT-001** Scaffold Next.js 16 repo with the directory tree in §1. Land empty pages + admin layout + auth stub. Vitest + ESLint configured. **Owner: any.**
2. **TKT-002** Write `scripts/dedupe-fees-verified.sql` and dry-run against staging. Report row counts. Apply if owner approves. Resolves the 147-duplicate blocker.
3. **TKT-003** Author `00000000000000_baseline.sql` from the §2 schema. Apply via `apply-migration.mjs` against staging. Verify all 12 canonical tables exist + the unique constraint holds.
4. **TKT-004** Seed script `scripts/seed-institutions.mjs` populates the 22 SPEC.md institutions if not present. Idempotent.
5. **TKT-005** `lib/db/client.ts` + `lib/db/client-session.ts` (TCP pooler ports 6543/5432). Health-check endpoint `GET /api/health` returns DB ping + R2 ping + Anthropic ping.
6. **TKT-006** `lib/auth/session.ts` + `lib/auth/rbac.ts` ported from v1, adapted to v2 `users` table. `/login` and `/logout` pages. Two seed users (admin, analyst) via env vars.
7. **TKT-007** Modal app skeleton (`agents/modal_app.py`) with 5 stub agents that just emit an `agent_events` row each. Deploy to Modal Team tier. Confirms the 9-endpoint budget works.
8. **TKT-008** Magellan v1 port: read empty-URL institutions, search via Google CSE + heuristic, write `institution_urls`. Run against the 22 seeds.
9. **TKT-009** Atlas: trafilatura/pdfplumber routing on the URLs Magellan found. Write to R2 + `fees_raw`. Verify against 3 seed institutions manually.
10. **TKT-010** Darwin: Claude haiku extraction prompt → `fees_verified` with taxonomy classification + confidence. Auto-promote at ≥0.90.
11. **TKT-011** `/dashboard` page renders the 5 health metrics from §5 against the live tables. No mock data.
12. **TKT-012** `/market` page implements the v1 Market Index Explorer against v2 tables. Two-column Bloomberg layout + delta pills. Filters via URL params.

Tasks 1-7 are mandatory before Week 2. Tasks 8-12 land the M1 pipeline.

---

— Technical Architect
