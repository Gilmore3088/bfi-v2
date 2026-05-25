# Atlas

Atlas is the **fee-schedule crawler** in the Bank Fee Index v2 agent fleet. It is the I/O boundary between the public web and the v2 Postgres schema:

```
institution_urls  ─▶  Atlas  ─▶  R2 (raw HTML/PDF)
                         └────▶  fees_raw (rows for Darwin to classify)
```

Atlas does **not** classify, canonicalize, or call any LLM. That is Darwin's job. Atlas only fetches bytes, hashes them, stores them, and writes a row.

## Contract

| Aspect | Value |
|---|---|
| **Input** | `institution_urls` where `is_active = TRUE` and no `fees_raw` row in the last 24h |
| **Output** | One R2 object per fetch + one `fees_raw` row per fetch |
| **R2 key** | `raw/{institution_id}/{YYYY-MM-DD}/{sha256}.{html|pdf}` |
| **Idempotency** | `UNIQUE (institution_id, content_hash)` on `fees_raw` — same content within the freshness window is a no-op |
| **Schedule** | Daily 03:00 ET (Modal cron, M2) |
| **Failure mode** | Per-URL try/except; one bad URL never fails the run |
| **STUB mode** | If any of `R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET` is missing, uploads are logged and skipped; rows still go to `fees_raw` with the would-be key |

M1 scope is HTTP + minimal HTML/PDF text extraction. Playwright/browser automation for JS-rendered or bot-protected sites is deferred to M2.

## Running

```bash
# From the bfi-v2 repo root:
python -m agents.atlas run --help

# Local smoke test against the built-in demo URLs, no DB writes:
DATABASE_URL=postgres://... python -m agents.atlas run --seed --dry-run -v

# Real run against the next 50 stale URLs:
DATABASE_URL=postgres://... python -m agents.atlas run --limit 50 -v
```

The CLI prints a JSON summary on exit:

```json
{
  "targets": 50,
  "fetched": 47,
  "stored": 47,
  "inserted": 42,
  "skipped": 5,
  "failed": 3,
  "stub_uploads": 0,
  "errors": ["http 503 institution=412 url=https://..."]
}
```

Exit code is `0` if `failed == 0`, else `1`.

## Tests

```bash
cd agents/atlas
python -m pytest tests/ -v
```

Tests are network-free; HTTP responses are mocked via `respx` and R2 is exercised in STUB mode.

## Modal integration (M2)

Atlas will be wired into `agents/modal_app.py` as:

```python
@app.function(image=atlas_image, schedule=Cron("0 7 * * *"), secrets=[...])
def atlas_cron():
    AtlasAgent().run(limit=500)
```

and a `@app.web_endpoint(method="POST")` for admin-triggered single-institution recrawls from `/admin/agents/atlas`.

## Environment

| Var | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Postgres DSN for target selection + inserts | Yes |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | R2 upload credentials | No (STUB mode if missing) |

No Anthropic key is read here. Atlas never calls an LLM.
