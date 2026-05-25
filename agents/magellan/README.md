# Magellan

Fee-schedule URL discovery agent. First of the bfi-v2 five-agent fleet.

## Purpose

For each institution in the `institutions` table that does not yet have an
active row in `institution_urls`, Magellan generates likely fee-schedule URL
candidates from known site patterns, probes them over HTTP, and records the
findings. High-confidence hits are upserted into `institution_urls`; every run
also writes a row into `agent_events`.

## Contract

See `/docs/team/TECHNICAL_ARCHITECT.md` section 3.

- **Input**: `SELECT id FROM institutions WHERE NOT EXISTS (SELECT 1 FROM institution_urls WHERE institution_id = institutions.id AND is_active)`
- **Output**: `institution_urls` upserts + `agent_events` rows
- **Schedule (Modal)**: `Cron("0 6 * * *")` (02:00 ET)
- **Idempotency**: `UNIQUE(institution_id, url)` with `ON CONFLICT DO NOTHING`
- **Failure**: Isolated per-institution; emits `agent_events` with `status='failed'`

## Run locally

```bash
# Stub mode against the 22 SPEC.md seed institutions (no DB writes if
# DATABASE_URL is unset or psycopg2 is unavailable).
python -m magellan run --seed

# Drain the live queue (requires DATABASE_URL in .env.local).
python -m magellan run --limit 50

# Probe but don't write to the DB.
python -m magellan run --seed --dry-run -v
```

## Install

```bash
cd agents/magellan
pip install -e ".[dev]"
```

## Test

```bash
cd agents/magellan
python -m pytest tests/
```

Unit tests cover candidate generation deterministically; no network calls.

## Modal integration (M2)

A future `agents/modal_app.py` will mount this package and expose:

- `@app.function(schedule=Cron("0 6 * * *"))` calling `magellan.agent.run()`
- `@app.web_endpoint(label="magellan-trigger")` for manual fires from the
  admin UI

## M1 scope notes

- Pattern-based discovery only; sitemap parsing and link scanning are not yet
  implemented (deferred to M2).
- Search-engine fallback (SerpAPI) is intentionally not wired up. The agent
  logs `STUB: would call X` if any external dependency is missing rather than
  blocking the run.
- HEAD then GET probe with bounded concurrency (default 8); 10s timeout.
