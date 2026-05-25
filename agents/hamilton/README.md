# Hamilton

LLM research analyst agent. Fifth and final member of the bfi-v2 five-agent
fleet. Produces McKinsey-grade reports from verified fee data on demand.

## Purpose

Three report kinds in M1:

1. **Institution profile** — where one institution sits in its peer set, with
   pricing detail and a single executive "so what" callout.
2. **Category deep-dive** — distribution, outliers, and implication for a
   single canonical fee category across the institutions Bank Fee Index has
   verified.
3. **Peer benchmark** — side-by-side delta analysis of a subject institution
   against a named peer set.

Each report is markdown, persisted to the `reports` table, with cost tracked
per generation and editorial violations surfaced before sign-off.

## Contract

See `/docs/team/TECHNICAL_ARCHITECT.md` section 3 and
`/docs/team/OPERATIONS_MANAGER.md` section 3.

- **Input**: a `reports` row in `status='queued'` (or a CLI invocation)
- **Output**: `reports.output_markdown` + `cost_cents` + an `agent_events` row
- **Schedule**: user-triggered; no cron
- **Idempotency**: per-`report_id`; existing succeeded reports are not
  regenerated unless `force=true`
- **Failure**: sets `status='failed'`, retains partial output, logs error

## Voice

Hamilton's voice is encoded in `prompts.py` and enforced by `check_voice()`
post-generation. Source: `/docs/team/CMO.md` section 7.

- Third person in published reports ("Bank Fee Index analysis shows…")
- FT Lex × McKinsey associate: declarative, opinionated, evidence-led
- Banned words: `unlock`, `AI-powered`, `next-generation`, `leverage`,
  `synergy`, `revolutionize`, `game-changing`, hedge phrases, future-tense
  dollar predictions
- No emojis. Ever.

A draft that contains any banned phrase, first-person marker, or forward-
looking dollar prediction is marked `status='blocked'` instead of
`succeeded`, but it is still persisted so the operator can inspect it.

## Run locally

```bash
# Institution profile (stub mode if ANTHROPIC_API_KEY unset)
python -m hamilton generate --type institution --target jpmorgan-chase

# Category deep-dive
python -m hamilton generate --type category --target overdraft

# Peer benchmark
python -m hamilton generate \
  --type peer \
  --target jpmorgan-chase \
  --peers bank-of-america,wells-fargo,citi

# Dry run — render and validate but skip DB writes
python -m hamilton generate --type institution --target jpmorgan-chase --dry-run -v

# Inspect the rendered body inline
python -m hamilton generate --type category --target overdraft --print-body
```

## Modes

| `ANTHROPIC_API_KEY` | `DATABASE_URL` | Mode | Behavior |
|---|---|---|---|
| set | set | `live` | Real Claude call, real DB writes |
| set | unset | `stub_db` | Real Claude call, "STUB: would insert reports row" |
| unset | set | `stub_llm` | "STUB: would call Claude", real DB writes |
| unset | unset | `stub_full` | Placeholder analytical sections, no DB writes |

## Install

```bash
cd agents/hamilton
pip install -e ".[dev]"
```

## Test

```bash
cd agents/hamilton
python -m pytest tests/
```

Unit tests cover the voice validator (rejects banned words, enforces third
person, flags future predictions) and the data layer (query result shape on
mocked rows). No network calls; no live DB required.

## Cost tracking

Each live generation writes `cost_cents` based on the Anthropic message usage
counters. Sonnet 4.5 pricing as of 2026-05-25: $3 / 1M input, $15 / 1M
output. The daily circuit breaker (5,000 cents = $50) lives in the API
route, not in the agent — see `TECHNICAL_ARCHITECT.md` section 3.

## Templates

Deterministic Jinja2 skeletons (`templates/*.md.j2`) own the structural
content: cover lines, distribution tables, side-by-side tables, citation
footers. Claude fills only the analytical sections (`llm_headline`,
`llm_positioning`, `llm_so_what`, `llm_outliers`, `llm_implication`,
`llm_deltas`). This keeps verifiable data deterministic and lets the QA gate
flag prose problems without re-running the model.

## M1 scope

- Three report kinds only. No conversational mode (deferred to M2).
- Markdown body only; PDF rendering is downstream (Next.js route).
- No `force=true` re-run path yet — duplicate UUIDs upsert in place.
- Cost circuit breaker is enforced by the calling web route, not here.
