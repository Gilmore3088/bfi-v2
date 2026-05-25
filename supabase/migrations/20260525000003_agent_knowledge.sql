-- =============================================================================
-- Agent Knowledge Layer
-- =============================================================================
-- Date:    2026-05-25
-- Adds per-state learning for the 5-agent fleet. Magellan is the first
-- consumer; Atlas / Darwin / Knox / Hamilton hooks will follow in later PRs.
--
-- - agent_runs gains target_state for per-state telemetry.
-- - agent_knowledge stores hit/miss counts keyed by (agent, state, kind, key).
-- - v_agent_pattern_success surfaces success rates for the admin dashboard.
-- =============================================================================

ALTER TABLE agent_runs ADD COLUMN target_state CHAR(2);
CREATE INDEX idx_agent_runs_target_state ON agent_runs (target_state, started_at DESC);

CREATE TABLE agent_knowledge (
    id            BIGSERIAL PRIMARY KEY,
    agent         TEXT NOT NULL
                    CHECK (agent IN ('magellan', 'atlas', 'darwin', 'knox', 'hamilton')),
    state_code    CHAR(2),
    key           TEXT NOT NULL,
    kind          TEXT NOT NULL,
    hit_count     INT NOT NULL DEFAULT 0,
    miss_count    INT NOT NULL DEFAULT 0,
    last_hit_at   TIMESTAMPTZ,
    last_miss_at  TIMESTAMPTZ,
    notes         JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent, state_code, kind, key)
);

CREATE INDEX idx_agent_knowledge_agent_state
    ON agent_knowledge (agent, state_code);

CREATE INDEX idx_agent_knowledge_success_rate
    ON agent_knowledge (
        agent,
        state_code,
        (hit_count::float / NULLIF(hit_count + miss_count, 0)) DESC
    );

CREATE OR REPLACE VIEW v_agent_pattern_success AS
SELECT
    agent,
    state_code,
    kind,
    key,
    hit_count,
    miss_count,
    (hit_count + miss_count) AS attempts,
    CASE
        WHEN (hit_count + miss_count) = 0 THEN 0
        ELSE hit_count::float / (hit_count + miss_count)
    END AS success_rate,
    last_hit_at,
    last_miss_at,
    updated_at
FROM agent_knowledge;
