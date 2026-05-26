-- =============================================================================
-- Data Cleaning Pipeline
-- =============================================================================
-- Date:    2026-05-25
-- Adds:
--   1. `_unmapped` placeholder category in taxonomy so Darwin can persist the
--      long tail of fees that don't map to the 49 canonical categories without
--      violating the fee_category FK.
--   2. Evidence-verification + amount-bounds columns on fees_verified so
--      Knox / human review can see whether the Claude-supplied evidence_quote
--      actually exists in the source document and whether the amount falls
--      inside the per-category sanity bounds.
--   3. Partial index on the unmapped rows for the admin review queue.
-- =============================================================================

INSERT INTO taxonomy (category, family, tier, display_name, description)
VALUES (
  '_unmapped',
  'Unmapped',
  'comprehensive',
  'Unmapped (review)',
  'Fees Darwin identified but could not map to the 49 canonical categories. Awaiting human curation.'
) ON CONFLICT (category) DO NOTHING;

ALTER TABLE fees_verified
  ADD COLUMN IF NOT EXISTS evidence_quote TEXT,
  ADD COLUMN IF NOT EXISTS evidence_in_source BOOLEAN,
  ADD COLUMN IF NOT EXISTS amount_in_bounds BOOLEAN,
  ADD COLUMN IF NOT EXISTS amount_bound_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_fees_verified_unmapped
  ON fees_verified (fee_category) WHERE fee_category = '_unmapped';
