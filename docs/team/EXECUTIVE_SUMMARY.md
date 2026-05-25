# bfi-v2 Rebuild — Executive Summary

**Date:** 2026-05-25
**Author:** Synthesis of 9 founding-team briefs (CTO, Technical Architect, Data Analyst, CMO, GTM, SEO, Web Developer, COO, Ops Manager)
**Status:** Day 0 of v2 rebuild

---

## TL;DR

v1 is salvageable in data, broken in operation, sprawled in product. The team converged on the same answer from nine angles: **collapse the surface, fix the silence, hold the ceilings, sell from the data.**

The rebuild is a discipline exercise, not an engineering one.

---

## What the team agrees on

1. **5 agents / 7 nav items / 12 DB tables — these are ceilings, not targets.** Anything new must replace something. CTO, TA, and Ops Manager all baked this into their briefs unprompted.

2. **The "33-day silence" failure mode is the #1 ops risk.** COO's three-layer alerting (heartbeat table → Vercel cron freshness → external Healthchecks.io watchdog) is the concrete fix. Without an external watchdog, the same failure recurs.

3. **Hamilton voice and quality is a brand-level concern, not a feature.** CMO defined the voice (FT Lex × McKinsey associate, third-person in reports, first-person in chat). Ops Manager defined the QA gate. CTO flagged "Hamilton quality drift" as a top-3 technical risk.

4. **Sell the data, not the platform.** GTM's first-10-customers plan uses live peer-delta from the DB as the entire pitch. Cold emails merge real fee gaps for the prospect. Marketing pages should also surface real comparisons — not screenshots, real queries.

5. **Public site = top of funnel.** SEO Analyst's programmatic architecture (~4k institution pages + 49 category pages + comparison pages + state/district pages) is also the lead-magnet. CMO's "annual State of U.S. Bank Fees report" is the category-defining content asset that feeds it.

---

## Hard truths from the Data Analyst audit

The data is **better than the pipeline state suggests, but worse than v1's UI implies.**

| Dataset | Trust score | Notes |
|---|---|---|
| `crawl_targets` (institutions) | 92% | 8,750 institutions, well-typed, FDIC/NCUA matched |
| Call Reports | 88% | Q4 2025 through 99% coverage |
| FRED | 85% | 35 series, 49K rows |
| `fees_verified` | 45% (70% post-cleanup) | 1,347 rows, **zero `approved`**, 208 dup groups, taxonomy drift |
| `users` | 20% | 1 real customer + 11 test accounts |

**Implications:**
- Don't claim "fee data on 4,000 institutions" yet. Claim "fee data on 610 institutions" (7%) and treat the M2 mandate as filling that gap.
- The fees_verified review gate never closed in v1. v2 must auto-promote ≥0.90 confidence on day 1 or the queue clogs again.
- Taxonomy drift (91 actual categories vs 49 canonical) means Darwin's classifier needs a strict whitelist on day 1.

---

## Conflicts surfaced + how I'm calling them

### 1. Pricing: $2,500/mo (v1) vs $25K ACV / $48K Enterprise (GTM)

**GTM wins.** $2,500/mo posture was an MVP guess. GTM's research-driven ICP ($1B–$25B mid-market banks, 900 institutions, $18–40K WTP) supports the uplift. CMO's "Bloomberg Terminal for bank fees" positioning is consistent — Bloomberg is not a $2.5K/mo product.

**Decision:** Free / Pro $24K ACV ($2K/mo if paid annually) / Enterprise $48K ACV. Hold the $2,500/mo monthly anchor for SMB. Add Enterprise above for consultancies/IBs.

### 2. First hire: Engineer (CTO) vs no-hire-yet (GTM/CMO motion is solo)

**CTO wins on sequencing, GTM is right that founder does sales.** First hire is a senior full-stack/Python engineer to own the pipeline. Founder runs sales. Editorial lead is hire #2 (part-time, ex-McKinsey FS or banking journalist) — already in CTO's list, just slotted #2 not #1.

### 3. Public site: marketing-led (CMO) vs programmatic-SEO-first (SEO)

**Both. Not a conflict in practice.** CMO's launch essay + annual report are the brand anchors. SEO's programmatic pages are the indexable scale. Architecture: marketing pages live at `/`, `/about`, `/methodology`, `/reports` (curated); programmatic at `/banks/[slug]`, `/fees/[category]`, `/compare/[a]-vs-[b]`. Hamilton's public-companion reports feed both surfaces.

### 4. Modal Team tier — buy now or wait?

**Wait until M1 needs the web-function slots.** Until M2, Modal Starter works if we keep the fleet to ≤8 web functions. TA's contract list comes in at 9 endpoints, so we either trim one (combine Darwin's `darwin_api` and `darwin_drain`?) or upgrade. **Decision: trim to 8, defer Team purchase to M2.**

### 5. Taxonomy: 49 canonical (v1) vs 91 actual (DB)

**Enforce 49.** Data Analyst flagged the drift. Darwin must whitelist against the canonical taxonomy; any classification outside the 49 goes to Knox for review or `needs_taxonomy_review` status. **Decision: v2 ships with 49; any expansion is an explicit product decision, not an emergent one.**

---

## Immediate next 5 moves (this week)

1. **Apply the dedup SQL** from Data Analyst's brief (resolves 1,347 → 1,066 in `fees_verified`, unblocks TA's baseline migration).
2. **Wire the heartbeat alert** (Healthchecks.io free tier) — the single highest-leverage 30-minute task to prevent v1's failure mode from recurring.
3. **Write the schema baseline migration** from TA's 12-table list (TKT-001 through TKT-003). Squash v1's 47 migrations to one canonical file.
4. **Deploy Magellan as a single Modal function** against the 22 seed institutions (TKT-004). Prove the agent fleet pattern works end-to-end on one node before scaling.
5. **Draft the launch essay** ("We rebuilt Bank Fee Index from scratch") and the annual State of U.S. Bank Fees report outline. Both surface the data-as-pitch motion GTM recommended.

---

## What got built in the kickoff session itself

- New repo `Gilmore3088/bfi-v2` (public)
- 9 founding-team briefs (~12k words total) in `docs/team/`
- Next.js 16 + Tailwind v4 + Geist + Postgres scaffold pushed (commit `445b411`)
- Live admin dashboard at `localhost:3002/admin` querying the real Supabase DB (8,750 institutions, 1,347 fees rendered)
- This synthesis

## What is explicitly NOT done

- Schema baseline migration (TA wrote the plan; not yet applied)
- Dedup SQL (Data Analyst wrote it; not yet run)
- Heartbeat alert (COO specced; not yet wired)
- Agent fleet (TA specced contracts; no Magellan/Atlas/Darwin/Knox/Hamilton code yet)
- DNS cutover (v1 still serves `bankfeeindex.com`)
- Modal redeploy (v1 Modal app still dead with missing secret)

---

## Risks the team flagged that I'm carrying forward

| Risk | Owner | Mitigation already in plan |
|---|---|---|
| 33-day silent failure recurrence | COO | 3-layer alerting in M1 |
| Hamilton quality drift | CTO, CMO, Ops Mgr | Editorial QA gate before any report ships |
| Sprawl creep (5/7/12 ceilings) | CTO | "Replace to add" rule documented |
| Curinos or incumbent retaliation | GTM | Anonymized peer reports, NDA optional |
| Schema drift between dev/prod | TA | Shared staging Supabase, no local DB |
| Lead-pipeline blind spot (1 real user) | GTM | First-10-customers plan is the entire month-1 motion |

---

— Synthesized by Claude Opus 4.7, on behalf of the bfi-v2 founding team
