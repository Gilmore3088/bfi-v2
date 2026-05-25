-- =============================================================================
-- Bank Fee Index v2 — Squashed Baseline Schema
-- =============================================================================
-- Date:    2026-05-25
-- Author:  Technical Architect
-- Status:  Canonical baseline. Replaces 47+ v1 migrations.
--
-- This file is the single source of truth for the v2 schema. v1 migrations
-- under feeschedule-hub/supabase/migrations/ are read-only history and MUST
-- NOT be re-applied on top of this baseline.
--
-- Application order against the existing production DB:
--   1. 20260525000001_dedup_v1_fees_verified.sql  (one-time cleanup)
--   2. This file (20260525000000_baseline.sql) — IF starting from empty DB.
--
-- On the carried-over production DB the canonical tables already exist under
-- v1 names; this baseline is therefore authoritative for a fresh provision
-- (staging, ephemeral preview envs, local) and definitional for the
-- destructive rename/cleanup migrations that follow.
--
-- Policy: all subsequent migrations are FORWARD-ONLY, dated, and additive.
-- No editing past migration files. No down migrations.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- institutions
-- 4,000+ banks and credit unions. The master record set; populated from
-- FDIC + NCUA call report rosters. Read-public via API.
-- -----------------------------------------------------------------------------
CREATE TABLE institutions (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    state_code      CHAR(2) NOT NULL,
    charter_type    TEXT NOT NULL CHECK (charter_type IN ('bank', 'credit_union')),
    asset_size      NUMERIC(20, 2),
    asset_size_tier TEXT,
    fed_district    SMALLINT CHECK (fed_district BETWEEN 1 AND 12),
    city            TEXT,
    website_url     TEXT,
    routing_number  TEXT,
    rssd_id         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_institutions_state           ON institutions (state_code);
CREATE INDEX idx_institutions_charter         ON institutions (charter_type);
CREATE INDEX idx_institutions_tier            ON institutions (asset_size_tier);
CREATE INDEX idx_institutions_fed_district    ON institutions (fed_district);
CREATE INDEX idx_institutions_assets_desc     ON institutions (asset_size DESC NULLS LAST);

-- -----------------------------------------------------------------------------
-- institution_urls
-- Discovered fee-schedule URLs (Magellan output). One institution can have
-- multiple historical URLs; is_active marks the current crawl target.
-- -----------------------------------------------------------------------------
CREATE TABLE institution_urls (
    id                BIGSERIAL PRIMARY KEY,
    institution_id    BIGINT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    url               TEXT NOT NULL,
    discovery_method  TEXT,
    confidence        NUMERIC(4, 3) CHECK (confidence BETWEEN 0 AND 1),
    verified_at       TIMESTAMPTZ,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (institution_id, url)
);

CREATE INDEX idx_institution_urls_institution ON institution_urls (institution_id);
CREATE INDEX idx_institution_urls_active      ON institution_urls (institution_id) WHERE is_active;

-- -----------------------------------------------------------------------------
-- fees_raw
-- Atlas output. Immutable record of a fetched fee schedule artifact
-- (HTML/PDF) plus any structured extraction. Audit trail; never UPDATE.
-- -----------------------------------------------------------------------------
CREATE TABLE fees_raw (
    id                 BIGSERIAL PRIMARY KEY,
    institution_id     BIGINT NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
    source_url         TEXT NOT NULL,
    r2_key             TEXT NOT NULL,
    extracted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_text           TEXT,
    raw_payload        JSONB,
    extractor_version  TEXT,
    content_hash       TEXT
);

CREATE INDEX idx_fees_raw_institution         ON fees_raw (institution_id);
CREATE INDEX idx_fees_raw_extracted_at        ON fees_raw (extracted_at DESC);
CREATE INDEX idx_fees_raw_source_url          ON fees_raw (source_url);
CREATE UNIQUE INDEX ux_fees_raw_inst_hash     ON fees_raw (institution_id, content_hash) WHERE content_hash IS NOT NULL;

-- -----------------------------------------------------------------------------
-- taxonomy
-- Reference data: 49 fee categories across 9 families and 4 tiers.
-- Mirrored from src/lib/taxonomy.ts; seeded in 20260525000001_seed.sql (TBD).
-- Declared before fees_verified because fees_verified.fee_category FKs to it.
-- -----------------------------------------------------------------------------
CREATE TABLE taxonomy (
    category      TEXT PRIMARY KEY,
    family        TEXT NOT NULL,
    tier          TEXT NOT NULL CHECK (tier IN ('spotlight', 'core', 'extended', 'comprehensive')),
    display_name  TEXT NOT NULL,
    description   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_taxonomy_family ON taxonomy (family);
CREATE INDEX idx_taxonomy_tier   ON taxonomy (tier);

-- -----------------------------------------------------------------------------
-- fees_verified
-- Darwin output. Append-only with versioning: a price change inserts a new
-- row and sets the previous row's superseded_by to preserve history.
-- The unique index enforces one live row per (institution, canonical key).
-- -----------------------------------------------------------------------------
CREATE TABLE fees_verified (
    id                 BIGSERIAL PRIMARY KEY,
    fees_raw_id        BIGINT NOT NULL REFERENCES fees_raw(id) ON DELETE RESTRICT,
    institution_id     BIGINT NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
    fee_category       TEXT NOT NULL REFERENCES taxonomy(category) DEFERRABLE INITIALLY DEFERRED,
    fee_family         TEXT,
    fee_name           TEXT,
    amount             NUMERIC(12, 2),
    frequency          TEXT,
    conditions         TEXT,
    confidence         NUMERIC(4, 3) CHECK (confidence BETWEEN 0 AND 1),
    canonical_fee_key  TEXT NOT NULL,
    variant_type       TEXT,
    review_status      TEXT NOT NULL DEFAULT 'pending'
                         CHECK (review_status IN ('pending', 'auto_approved', 'flagged', 'approved', 'rejected')),
    reviewed_by        TEXT,
    reviewed_at        TIMESTAMPTZ,
    superseded_by      BIGINT REFERENCES fees_verified(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fees_verified_institution      ON fees_verified (institution_id);
CREATE INDEX idx_fees_verified_category         ON fees_verified (fee_category);
CREATE INDEX idx_fees_verified_review_status    ON fees_verified (review_status) WHERE superseded_by IS NULL;
CREATE INDEX idx_fees_verified_created_at       ON fees_verified (created_at DESC);
CREATE INDEX idx_fees_verified_fees_raw         ON fees_verified (fees_raw_id);
CREATE UNIQUE INDEX ux_fees_verified_natural    ON fees_verified
    (institution_id, canonical_fee_key, COALESCE(variant_type, ''))
    WHERE superseded_by IS NULL;

-- -----------------------------------------------------------------------------
-- fed_data
-- Federal Reserve indicators: Beige Book text and FRED economic series,
-- normalized into a single long-format table keyed by district + date + series.
-- -----------------------------------------------------------------------------
CREATE TABLE fed_data (
    id          BIGSERIAL PRIMARY KEY,
    district    SMALLINT CHECK (district BETWEEN 1 AND 12),
    as_of       DATE NOT NULL,
    series      TEXT NOT NULL,
    value       NUMERIC(20, 6),
    text        TEXT,
    source      TEXT NOT NULL CHECK (source IN ('beige_book', 'fred', 'fed_content')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fed_data_series_asof ON fed_data (series, as_of DESC);
CREATE INDEX idx_fed_data_district    ON fed_data (district, as_of DESC);
CREATE INDEX idx_fed_data_source      ON fed_data (source);

-- -----------------------------------------------------------------------------
-- call_reports
-- FFIEC quarterly Call Reports per institution. Drives Hamilton institution
-- profiles and the fee-vs-revenue correlation skill.
-- -----------------------------------------------------------------------------
CREATE TABLE call_reports (
    id                            BIGSERIAL PRIMARY KEY,
    institution_id                BIGINT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    period                        DATE NOT NULL,
    total_assets                  NUMERIC(20, 2),
    total_deposits                NUMERIC(20, 2),
    total_loans                   NUMERIC(20, 2),
    net_income                    NUMERIC(20, 2),
    service_charges_deposits      NUMERIC(20, 2),
    nsf_revenue                   NUMERIC(20, 2),
    overdraft_revenue             NUMERIC(20, 2),
    interchange_revenue           NUMERIC(20, 2),
    noninterest_income            NUMERIC(20, 2),
    noninterest_expense           NUMERIC(20, 2),
    return_on_assets              NUMERIC(8, 4),
    return_on_equity              NUMERIC(8, 4),
    net_interest_margin           NUMERIC(8, 4),
    efficiency_ratio              NUMERIC(8, 4),
    tier1_capital_ratio           NUMERIC(8, 4),
    total_capital_ratio           NUMERIC(8, 4),
    leverage_ratio                NUMERIC(8, 4),
    npa_to_assets                 NUMERIC(8, 4),
    allowance_to_loans            NUMERIC(8, 4),
    employees                     INTEGER,
    branches                      INTEGER,
    raw_payload                   JSONB,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (institution_id, period)
);

CREATE INDEX idx_call_reports_institution   ON call_reports (institution_id);
CREATE INDEX idx_call_reports_period        ON call_reports (period DESC);

-- -----------------------------------------------------------------------------
-- users
-- Auth. Session-cookie based, roles gate admin/analyst/pro features.
-- Seeded fresh in v2 (v1's 14 users do not migrate; ref Data Analyst §6).
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id                    BIGSERIAL PRIMARY KEY,
    email                 TEXT NOT NULL UNIQUE,
    password_hash         TEXT NOT NULL,
    display_name          TEXT,
    role                  TEXT NOT NULL DEFAULT 'viewer'
                            CHECK (role IN ('viewer', 'analyst', 'admin', 'pro')),
    stripe_customer_id    TEXT,
    subscription_status   TEXT CHECK (subscription_status IN ('active', 'past_due', 'canceled', 'trialing', 'incomplete')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at         TIMESTAMPTZ
);

CREATE INDEX idx_users_role          ON users (role);
CREATE INDEX idx_users_subscription  ON users (subscription_status) WHERE subscription_status IS NOT NULL;

-- -----------------------------------------------------------------------------
-- leads
-- Sales pipeline. Inbound interest + outbound prospect tracking.
-- -----------------------------------------------------------------------------
CREATE TABLE leads (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL,
    company         TEXT,
    source          TEXT,
    score           INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'rejected')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_touched_at TIMESTAMPTZ
);

CREATE INDEX idx_leads_status      ON leads (status);
CREATE INDEX idx_leads_created_at  ON leads (created_at DESC);
CREATE INDEX idx_leads_email       ON leads (email);

-- -----------------------------------------------------------------------------
-- reports
-- Hamilton output queue + history. Replaces v1's report_jobs +
-- published_reports. UUID primary key so we can preallocate the ID before
-- the row is written (lets the streaming endpoint return immediately).
-- -----------------------------------------------------------------------------
CREATE TABLE reports (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                     TEXT NOT NULL,
    subject_institution_id   BIGINT REFERENCES institutions(id) ON DELETE SET NULL,
    subject_category         TEXT,
    status                   TEXT NOT NULL DEFAULT 'queued'
                               CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    requested_by             BIGINT REFERENCES users(id) ON DELETE SET NULL,
    params                   JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_r2_key            TEXT,
    output_markdown          TEXT,
    cost_cents               INTEGER NOT NULL DEFAULT 0,
    error                    TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at             TIMESTAMPTZ
);

CREATE INDEX idx_reports_status       ON reports (status);
CREATE INDEX idx_reports_requested_by ON reports (requested_by);
CREATE INDEX idx_reports_created_at   ON reports (created_at DESC);
CREATE INDEX idx_reports_kind         ON reports (kind);

-- -----------------------------------------------------------------------------
-- agent_runs
-- One row per agent invocation (cron firing or manual trigger). Rollup of
-- agent_events for fast Dashboard reads.
-- -----------------------------------------------------------------------------
CREATE TABLE agent_runs (
    run_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent            TEXT NOT NULL
                       CHECK (agent IN ('magellan', 'atlas', 'darwin', 'knox', 'hamilton')),
    status           TEXT NOT NULL DEFAULT 'started'
                       CHECK (status IN ('started', 'in_progress', 'succeeded', 'failed', 'skipped')),
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at         TIMESTAMPTZ,
    items_processed  INTEGER NOT NULL DEFAULT 0,
    items_failed     INTEGER NOT NULL DEFAULT 0,
    cost_cents       INTEGER NOT NULL DEFAULT 0,
    trigger_source   TEXT CHECK (trigger_source IN ('cron', 'manual', 'webhook')),
    error            TEXT
);

CREATE INDEX idx_agent_runs_agent_started ON agent_runs (agent, started_at DESC);
CREATE INDEX idx_agent_runs_status        ON agent_runs (status);
CREATE INDEX idx_agent_runs_started_at    ON agent_runs (started_at DESC);

-- -----------------------------------------------------------------------------
-- agent_events
-- Per-item event log inside an agent_run. Single source of truth for fleet
-- state and the timeline rendered on /agents. Not partitioned in M1;
-- partition by month once we cross 1M rows.
-- -----------------------------------------------------------------------------
CREATE TABLE agent_events (
    id          BIGSERIAL PRIMARY KEY,
    agent       TEXT NOT NULL
                  CHECK (agent IN ('magellan', 'atlas', 'darwin', 'knox', 'hamilton')),
    run_id      UUID NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
    status      TEXT NOT NULL
                  CHECK (status IN ('started', 'in_progress', 'succeeded', 'failed', 'skipped')),
    payload     JSONB,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_events_run_id      ON agent_events (run_id);
CREATE INDEX idx_agent_events_agent_time  ON agent_events (agent, created_at DESC);
CREATE INDEX idx_agent_events_status      ON agent_events (status) WHERE status IN ('failed', 'skipped');
CREATE INDEX idx_agent_events_created_at  ON agent_events (created_at DESC);

-- =============================================================================
-- End of v2 baseline.
-- =============================================================================
