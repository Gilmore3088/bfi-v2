-- =============================================================================
-- Add unique constraint on institutions (name, state_code)
-- =============================================================================
-- Date:   2026-05-25
-- Reason: seed-fresh.mjs uses ON CONFLICT (name, state_code) DO NOTHING for
--         idempotent re-runs. Without this constraint, repeated seeds
--         duplicate every institution. Forward-only.
-- =============================================================================

ALTER TABLE institutions
ADD CONSTRAINT ux_institutions_name_state UNIQUE (name, state_code);
