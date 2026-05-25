# Bank Fee Index v2 — Rebuild Spec

**Status:** Draft v0.1 · 2026-05-25
**Owner:** James Gilmore (@Gilmore3088)
**Predecessor:** `feeschedule-hub` (archived; bankfeeindex.com)

## Why rebuild

v1 accumulated enough debt that reviving it costs more than starting clean:

- Modal cron has been silently broken for 33 days (missing `bfi-secrets`, plan-cap mismatch, deployment drift)
- 51-state agent fleet + duplicate discoverer/extractor/ops workers — too many moving parts for one operator
- 14 nav items with ~50% overlap (Market replaces National + Peer + Districts + Categories)
- 147 duplicate `fees_verified` rows blocking a pending uniqueness migration
- 8 unapplied schema migrations on a stale branch
- 19 abandoned `.claude/worktrees/agent-*` directories
- Hamilton conceptually right but implementation overgrown

What survives: **the data, the taxonomy, the design system**. Everything else gets rewritten.

## Goal

A McKinsey-grade fee intelligence product backed by a small, reliable agent fleet. Owner-operable by one person. Recoverable when something breaks. No orphaned services.

## What survives v1

- **Postgres data** — institutions, fees_verified, fees_raw, taxonomy, Fed/Call Report data (~38K rows of financial data)
- **Fee taxonomy** — 49 categories × 9 families × 4 tiers
- **Brand + design system** — dual-brand (cool admin / warm consumer), Geist, Bloomberg/FT aesthetic
- **Agent metaphors** — Darwin, Magellan, Knox, Atlas, Hamilton (rebuilt clean)

## What dies

- 51-state agent fleet
- Standalone discoverer, extractor, ops runners (duplicates of the fleet)
- Knox-vs-human review duplication
- Menu items National, Peer, Categories, Districts (collapse → Market)
- "Explore" section (duplicates Benchmarks + Cmd+K)
- `claude/peaceful-ride-EK68V` and 19 worktree dirs

## Architecture

- **Next.js 16** App Router, fresh repo
- **Supabase Postgres** — same DB, fresh migration baseline (squash applied, drop pending mess)
- **Modal Team tier** — lifts 8-web-function cap (single deploy of 5-agent fleet needs ~10 endpoints)
- **R2** — keep
- **Anthropic API** — Hamilton + Knox

## Agent fleet (5 agents, single-responsibility)

| Agent | Job | Schedule | Notes |
|---|---|---|---|
| **Magellan** | Find fee-schedule URLs for empty institutions | daily 02:00 | Consolidates v1 discoverer + magellan + URL probing |
| **Atlas** | Crawl URLs → R2 → `fees_raw` | daily 03:00 | One entry; routes PDF/HTML/browser internally |
| **Darwin** | Classify `fees_raw` → `fees_verified` w/ taxonomy | continuous drain | Auto-promote ≥0.90 confidence |
| **Knox** | Adversarial review of low-confidence + outliers | continuous | Replaces Knox + human review queue |
| **Hamilton** | LLM analyst → reports | user-triggered | Admin lead-gen + Pro subscriber modes |

**Cut from v1:** state-fleet (51 agents), atlas-dispatch, state-run, run-state-agent, separate discoverer/extractor/ops endpoints.

## Frontend IA (7 items, down from 14)

```
Dashboard       operator command center, job health
Market          unified index (national/peer/district/category as filters)
Hamilton        AI analyst (admin + pro modes)
Leads           sales pipeline
Agents          one page, Darwin/Magellan/Knox/Atlas as tabs
Review          human queue + Knox-flagged as tabs
Data Quality    audit/hygiene scorecard
```

## Repo + cutover

- **New repo:** `Gilmore3088/bfi-v2` (public)
- **DB:** same Supabase, fresh migration baseline
- **v1:** frozen as archive at `bankfeeindex.com`
- **v2 staging:** `bfi-v2.vercel.app` until cutover
- **Cutover:** parallel run — when M1 acceptance passes, flip DNS

## Milestone 1 — "Vertical slice"

End-to-end pipeline + Hamilton on 20 seed institutions. Narrow but complete.

### Seed institutions (22 picked, spread across all 6 asset tiers × 2 charters)

**Banks**
| Tier | Institution | State |
|---|---|---|
| super_regional | JPMorgan Chase | OH |
| super_regional | Bank of America | NC |
| large_regional | BMO Bank | IL |
| large_regional | Charles Schwab Bank | TX |
| regional | BOKF | OK |
| regional | First National Bank of Pennsylvania | PA |
| community_large | Amarillo National Bank | TX |
| community_large | Centier Bank | IN |
| community_mid | Sturgis Bank & Trust | MI |
| community_mid | Clear Mountain Bank | WV |
| community_small | Bank of York | SC |
| community_small | The Peshtigo National Bank | WI |

**Credit Unions**
| Tier | Institution | State |
|---|---|---|
| large_regional | Navy Federal Credit Union | VA |
| large_regional | State Employees' FCU | NC |
| regional | Pentagon Federal Credit Union | VA |
| regional | SchoolsFirst FCU | CA |
| community_large | Teachers FCU | NY |
| community_large | ESL FCU | NY |
| community_mid | Brightstar FCU | FL |
| community_mid | Brazos Valley Schools FCU | TX |
| community_small | OC FCU | OH |
| community_small | Bowater Employees FCU | TN |

### Acceptance criteria

M1 ships when **all** true:

1. Magellan finds fee-schedule URLs for the 20 seed institutions
2. Atlas crawls those URLs into R2 and writes `fees_raw`
3. Darwin classifies `fees_raw` → `fees_verified` using the taxonomy
4. Knox flags low-confidence rows for review
5. Hamilton produces **6 reports**: 3 institution-profile + 3 category-deep-dive
6. Operator dashboard shows live job state (no stale heartbeats)
7. Market page renders against the live DB
8. Whole loop survives a full nightly cron cycle on Modal without manual intervention

### Out of scope for M1

The other 4,000 institutions, public/consumer site, Stripe, Leads UI, Pro subscriber flow, full IA. M2+.

## M2+ (provisional)

- Scale to all 4,000+ institutions
- Public/consumer site
- Stripe + Pro subscriber flow
- Leads page wire-up
- Full IA polish

## Decisions still open

- Hamilton report templates — final markup for the 6 M1 reports
- Modal Team tier purchase timing (before or after Atlas wire-up)
- Whether to migrate v1 `users` table or seed fresh
- Cloudflare/CDN strategy for the gated staging URL

## Risks

- **Schema drift** — same Supabase DB, but v1 schema has cruft. Mitigation: fresh baseline migration that documents the canonical state.
- **Modal Team purchase** — required before deploy; need credit card decision.
- **Hamilton quality** — v1 reports were data dumps. v2 must hit McKinsey bar from M1, not later.
- **"Just one more agent"** — strict 5-agent ceiling. Anything new must replace something.
