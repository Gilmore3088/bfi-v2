# CTO Brief — Bank Fee Index v2 Rebuild

**To:** James Gilmore, Founder
**From:** CTO
**Date:** 2026-05-25
**Re:** Technical strategy for v2 kickoff

---

## 1. Stack endorsement and risk register

The locked stack is correct. Next.js 16 + Supabase + Modal + Anthropic + R2 is the right shape for a solo operator running an AI-heavy data product: each component is managed, has a generous free/low tier, and has a credible escape hatch. Endorsing without modification.

**Top three technical risks for v2:**

1. **Modal as a single point of failure.** v1's 33-day silent cron outage is the dominant signal in this rebuild. Modal is fine infrastructure, but the *operational discipline* around it was the failure. We must treat Modal cron the way SRE teams treat production Postgres: alerted heartbeats, dead-man switches into a third-party monitor, and a Sunday-night smoke test that wakes you up if it fails. No "I'll check the dashboard" — Modal must page us.
2. **Hamilton report quality drift.** Hamilton is the product. If reports look like data dumps, the $2,500/mo tier doesn't exist. The risk is that we ship M1 with passable reports and never raise the bar. We need a hard editorial standard (the Connected FINS PDF) and a rejection test — a Hamilton report that doesn't pass a 30-second "would a McKinsey partner sign this?" check does not ship.
3. **Schema drift between v1 cruft and v2 baseline.** Same DB, fresh migrations is the right call — but the 147 duplicate `fees_verified` rows and 8 unapplied migrations need to be resolved *before* M1 work begins, not in parallel. Otherwise we will rediscover them at the worst moment.

## 2. Build vs buy decisions

| Concern | Decision | Rationale |
|---|---|---|
| **Extraction LLM** | Buy — Anthropic Claude Haiku 4.5 | Already integrated, cheap at scale, batch API available. No reason to self-host. |
| **Browser automation** | Buy — Browserbase or Steel for the ~5% that need stealth; Playwright direct for the rest. | v1's "build Playwright stealth ourselves" path produced 2.4% success on big banks. Pay $0.10/session to skip bot-detection arms race. |
| **PDF extraction** | Build (pdfplumber) for text PDFs; buy (Anthropic vision API) for scanned/messy PDFs. | pdfplumber handles 80% for free. For the rest, vision is cheaper than OCR-pipeline maintenance. |
| **Report rendering** | Build — React Server Components + Tailwind, export to PDF via Playwright. | The design system is a competitive moat. Do not outsource to Carbone/DocRaptor. |
| **Monitoring / uptime** | Buy — Better Stack (or Cronitor) for cron heartbeats; Vercel Analytics for the app. | This is the v1 lesson. ~$30/mo is non-negotiable. |
| **Error tracking** | Buy — Sentry (free tier first, $26/mo when we outgrow it). | Already in env vars. Wire it up properly this time. |

## 3. 90-day roadmap

### M1 — Vertical Slice (days 0–30)

Ship the 22-institution end-to-end loop per SPEC.md. **Acceptance** is the 8 criteria already in SPEC, plus three I'm adding:

- Modal cron has a heartbeat into Better Stack; missed run pages within 15 minutes
- Hamilton's 6 reports are reviewed against the Connected FINS PDF and pass a written editorial rubric
- Schema baseline migration is applied; `fees_verified` has its uniqueness constraint and zero duplicates

### M2 — Scale (days 30–60)

Drain the empty-coverage backlog to 4,000 institutions. **Acceptance:**

- 80% of the ~4,000 institutions have at least one `fees_verified` row in a Spotlight category
- Magellan + Atlas + Darwin nightly loop processes 200+ institutions/night unattended for 14 consecutive days
- Cost per institution stays under $0.40 (extraction + classification + storage)
- Data Quality scorecard hits 70% on coverage maturity

### M3 — Revenue (days 60–90)

Public site live, Stripe + Pro subscription flow, first paying customer. **Acceptance:**

- Public consumer site live at feeinsight.com with 49 category pages and 4,000 institution pages indexed
- Stripe checkout for $2,500/mo Pro tier works end-to-end (test mode + 1 live transaction)
- 3 outbound sales touchpoints (cold report deliveries to target banks) using Hamilton-generated content
- Leads page wired to track conversion

If M3 slips, that's fine — but M1 and M2 cannot slip. Revenue follows reliable data.

## 4. Hiring priorities (next 6 months)

If we can hire one person, hire a **Senior Full-Stack Engineer with strong Python/data-pipeline chops** (~$160–200K or contractor equivalent). Job is to own Atlas + Darwin + the nightly loop so James can own Hamilton, design, and sales. This is the single highest-leverage hire because the pipeline is the most operationally fragile part and the part least benefited by founder attention once it's running.

If we can hire a second, hire a **part-time Editorial Lead / Banking Domain Expert** (10–15 hrs/wk, ex-McKinsey FS analyst or banking-industry journalist) to set the editorial bar on Hamilton output and write the first 12 published reports. This is the difference between a $99/mo data tool and a $2,500/mo intelligence product. Do not hire a designer — the design system is locked and James plus the existing aesthetic discipline are sufficient.

Do *not* hire a second engineer before the editorial lead. The product's defensibility is content quality, not engineering throughput.

## 5. What I would kill from v1 (beyond the existing cut list)

- **The `users` table from v1.** Seed fresh. Migration of a handful of internal accounts is not worth the schema baggage.
- **Skill subsystem in its current form.** The "skills" concept (fee-benchmarking, consumer-guide, etc.) is conceptually right but the v1 implementation is over-abstracted. Collapse into Hamilton report templates with named entry points; no plugin system until we have ≥10 of them.
- **Cmd+K search palette as a top-level feature.** It's a v3 concern. Ship a normal search bar in M1.
- **All `.claude/worktrees/agent-*` references in CI and tooling** — fully sweep, not just delete the directories.

## 6. What I would protect from v1 (at risk of being thrown out)

- **The fee taxonomy.** 49 categories × 9 families × 4 tiers represents real domain work. It is the spine of the product. Do not "simplify" it in M1.
- **The Fed Beige Book / FRED / Call Report data ingestions.** 38K rows of financial context is what makes Hamilton more than a fee aggregator. v2 is at risk of leaving this on the floor because "M1 is just fees." It is not — Hamilton needs this data on day one to clear the McKinsey bar.
- **The Market unified-page concept.** Collapsing National + Peer + Districts + Categories into one filterable view is correct IA. Resist any drift back toward separate pages because "they were easier to build."
- **Dual-brand design system.** Cool admin / warm consumer is a real differentiator. Do not unify them for engineering convenience.
- **Postgres-only commitment.** SQLite is dead. Do not let it crawl back in for "local dev convenience."

---

The rebuild is fundamentally a discipline exercise, not an engineering one. v1 failed from sprawl, not from any single bad technical choice. Hold the 5-agent ceiling, hold the 7-nav ceiling, hold the editorial bar on Hamilton, and the product works.

— CTO
