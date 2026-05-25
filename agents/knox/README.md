# Knox

Adversarial reviewer for the Bank Fee Index v2 agent fleet. Knox audits
Darwin's classifications and routes problematic rows to the human review
queue.

## Contract

- **Input:** `fees_verified` rows with `review_status IN ('verified', 'needs_review', 'pending', 'auto_approved')` and `superseded_by IS NULL`.
- **Output:** `agent_events` rows (`agent = 'knox'`) describing findings and a suggested action that aligns with the review-queue decision tree (approve / re-extract / reject / institution-wide problem).
- **Schedule:** Continuous, every 10 minutes (Modal cron, see `TECHNICAL_ARCHITECT.md` §3).

## Checks (M1)

| Check                  | Trigger                                                                       | Suggested action       |
| ---------------------- | ----------------------------------------------------------------------------- | ---------------------- |
| `low_confidence`       | `confidence < 0.90`                                                           | `human_review`         |
| `statistical_outlier`  | amount outside `[Q1 - 3*IQR, Q3 + 3*IQR]` for its `(category, charter)` cohort | `human_review`         |
| `off_taxonomy`         | `fee_category` not in the canonical 49                                        | `reclassify_or_reject` |
| `incomplete_extraction`| `amount` or `frequency` missing or zero                                       | `re_extract`           |
| `institution_wide_problem` | ≥3 recent rejects (last 7 days) from the same institution                | `requeue_magellan`     |

## Idempotency

Each `agent_events` row stores a `row_signature` (hash of `amount`,
`fee_category`, `confidence`, `frequency`). Re-running Knox on an
unchanged row is a no-op; if Darwin re-classifies, the signature
changes and a fresh event is emitted.

## Run

```bash
export DATABASE_URL=postgres://...
python -m knox review                 # write events
python -m knox review --dry-run       # compute only, rollback
python -m knox review --limit 100 -v  # smaller pass with debug logs
```

## Tests

```bash
cd agents/knox
pip install -e .[dev]
pytest
```
