# Darwin

Third of the Bank Fee Index v2 five-agent fleet. Darwin classifies raw fee
content into the canonical 49-category taxonomy and writes `fees_verified`
rows.

See `docs/team/TECHNICAL_ARCHITECT.md` section 3 for the full contract.

## Contract

- **Input:** `fees_raw` rows with no matching `fees_verified` row
- **Output:** `fees_verified` rows (`review_status='auto_approved'` when
  confidence is at or above 0.90; `'pending'` otherwise)
- **Schedule:** continuous drain (cron every 5 minutes in M1, can be
  promoted to a warm Modal worker later)
- **Idempotency:** `UNIQUE(institution_id, canonical_fee_key) WHERE
  superseded_by IS NULL`
- **Price-change history:** when a new amount arrives for an existing live
  `(institution_id, canonical_fee_key)`, the old row's `superseded_by` is
  set to the new row id
- **Failure:** per-row try/except with rollback; the batch continues. A
  failing row emits an `agent_events` row with `status='failed'`.

## Taxonomy whitelist

49 canonical categories across 9 families, frozen in `darwin/taxonomy.py`
as a tuple. The data-analyst audit (2026-05-25) found 91 distinct
categories in v1 production -- the whitelist exists to stop that drift
from leaking into v2. Classifications outside the whitelist are NOT
inserted into `fees_verified` (the FK to `taxonomy` would fail); they are
recorded as `agent_events` with `status='skipped'` and a
`reason='off_taxonomy'` payload, for Knox or a human to adjudicate.

## Stub mode

Darwin runs in stub mode automatically when:

- `ANTHROPIC_API_KEY` is not set, OR
- the `anthropic` SDK is not installed, OR
- the CLI is invoked with `--dry-run`, OR
- `DATABASE_URL` is not set (DB writes stubbed too)

In stub mode the classifier returns a deterministic fake result keyed off
simple keyword matches, at confidence `0.50` (so nothing auto-promotes),
and logs `STUB: would call Claude`. This lets the rest of the pipeline be
exercised end-to-end without burning Claude quota.

## Local run

```bash
cd agents/darwin
pip install -e .[dev]

# Stub mode (no API key needed)
python -m darwin drain --dry-run

# Verbose
python -m darwin drain --limit 10 -v

# Live mode (requires ANTHROPIC_API_KEY + DATABASE_URL set in .env.local)
python -m darwin drain --limit 50
```

## Tests

```bash
cd agents/darwin
python -m pytest tests/
```

Tests cover:

- 49-category whitelist enforcement (size, families, off-taxonomy rejection)
- Stub-mode classifier behavior (deterministic, low-confidence)
- JSON parsing of mocked Claude responses
- Off-taxonomy classifications flagged correctly
- Auto-promotion rule (>=0.90 in-taxonomy only)
- Price-change-history pattern (`superseded_by` chain via `_amounts_differ`)

No DB connection is required to run the test suite.

## Modal integration (M1)

Darwin will be wired into `agents/modal_app.py` as one `@app.function` with
`schedule=Cron("*/5 * * * *")` plus one `@app.web_endpoint` for the
admin `POST /agents/darwin/reclassify` action. The drain function calls
`darwin.agent.drain(limit=200)` and exits. Modal handles retries.

## Architecture notes

- `taxonomy.py` is the single source of truth for the 49 categories. Keep
  it in lockstep with `src/lib/taxonomy.ts` and the `taxonomy` Postgres
  table seed.
- `classifier.py` is the only module that touches Anthropic. Injecting a
  mock `client` makes unit tests fully offline.
- `agent.py` owns the DB transactions and the `superseded_by` chain.
- All writes go through a single per-row transaction so a partial batch
  failure does not corrupt the verified set.
