# COO — Operational Runbook for Bank Fee Index v2

**Owner:** James Gilmore (solo operator)
**Audience:** future-me at 7am on a Tuesday when something is broken
**Status:** v0.1 — written alongside SPEC v0.1

The job of this document is to make sure v2 never replays the v1 failure where Modal cron died on April 22 and nobody noticed for 33 days. Everything below is sized for one person with a day job's worth of attention budget.

---

## 1. The "Modal-died-for-33-days" prevention plan

The v1 failure had three compounding causes: (a) no heartbeat from the agents to the app, (b) no external watchdog on the heartbeat, (c) no daily "did anything happen yesterday?" email. We fix all three.

**Heartbeat table.** Every Modal scheduled function writes a row to `agent_heartbeats(agent, run_started_at, run_finished_at, status, rows_written, error)` as its first and last action. Magellan and Atlas write daily; Darwin and Knox write on every drain cycle (at most every 15 min).

**In-app freshness check.** A Vercel cron at 08:00 ET runs `/api/ops/freshness-check`. It queries `agent_heartbeats` and asserts:
- Magellan: last successful run within 26 hours
- Atlas: last successful run within 26 hours
- Darwin: last successful run within 2 hours (continuous)
- Knox: last successful run within 2 hours

If any assertion fails, the route POSTs to a Resend transactional email and to a Healthchecks.io ping URL configured to alarm on missing pings.

**External watchdog.** Healthchecks.io (free tier, 20 checks) holds one check per agent. The Vercel cron pings each check on success. If a check goes silent past its grace window, Healthchecks.io emails and SMSes me. This is the layer that catches the case where Vercel itself is down (the in-app check can't email if the app is dead).

**Threshold for action:** any P1 alert (see §3) means stop other work and triage within 2 hours during waking hours, by next morning otherwise. The 33-day v1 silence is impossible if any one of these three layers fires.

---

## 2. Monitoring stack

| Concern | Tool | Plan | Monthly |
|---|---|---|---|
| Uptime (web + API) | Better Stack (Uptime) | Free 10 monitors | $0 |
| Error tracking (web + serverless) | Sentry | Developer plan | $26 |
| Log aggregation | Axiom | Free 0.5 GB/day | $0 |
| Agent heartbeats / cron watchdog | Healthchecks.io | Hobbyist | $5 |
| LLM spend | Anthropic console + custom daily check | — | $0 |
| DB health | Supabase dashboard + pg_stat queries | included | $0 |
| R2 usage | Cloudflare dashboard + monthly script | included | $0 |
| Transactional alerts | Resend | Free 3K/mo | $0 |
| SMS escalation | Twilio (P1 only) | pay-as-you-go | ~$2 |
| **Total** | | | **~$33/mo** |

Sentry is the load-bearing investment. Everything else is free or near-free. The whole stack is deliberately boring — no Datadog, no PagerDuty, nothing that demands its own runbook.

---

## 3. Alerting policy

Every alert below has a name, condition, severity, channel, and first-response step. P1 wakes me up. P2 is "respond same day." P3 is "look at Monday."

| Name | Condition | Sev | Channel | First response |
|---|---|---|---|---|
| `agent.silent` | Healthchecks.io check missed grace window | P1 | SMS + email | Run §5.1 |
| `db.unreachable` | Better Stack `/api/health/db` failing 3x | P1 | SMS + email | Run §5.5 |
| `web.down` | Better Stack root URL failing 3x | P1 | SMS + email | Check Vercel status, redeploy last green |
| `llm.daycap` | Anthropic spend > $50 in 24h | P1 | Email + auto-pause Hamilton | Inspect `hamilton_runs`, freeze new reports |
| `r2.outage` | Better Stack R2 probe failing 5x | P2 | Email | §5.3 |
| `modal.account` | Modal webhook says payment failed / quota hit | P1 | Email | §5.4 |
| `sentry.spike` | >50 unhandled errors in 10 min | P2 | Email | Open Sentry, find common stack |
| `darwin.backlog` | `fees_raw` unclassified > 5,000 for 6h | P2 | Email | Check Darwin logs, scale Modal container |
| `knox.queue` | Knox review queue > 200 for 24h | P3 | Monday digest | Triage manually |
| `schema.drift` | Nightly `pg_dump --schema-only` diffs from baseline | P2 | Email | §5.2 |
| `db.connections` | `pg_stat_activity` > 80% of pool | P2 | Email | §5.6 |
| `cost.weekly` | Combined infra > $150 in 7 days | P2 | Monday digest | Audit invoices |

All P1/P2 alerts open a GitHub issue automatically via Sentry → GitHub integration so the trail survives.

---

## 4. Cost governance

Real dollar caps with auto-enforcement, not just dashboards.

**Anthropic.** Hard daily cap of $50 in the app layer: `hamilton_runs` table aggregates `cost_cents` per UTC day; the Hamilton API route refuses new runs once the day total ≥ $5000 cents. Magellan and Atlas do not call Anthropic. Darwin uses Haiku and is budgeted at $5/day separately. Anthropic console budget alert set at $300/month soft and $500/month hard via API key rotation.

**Modal.** Team tier is ~$250/mo base. Set Modal usage alert at $400/mo (covers spikes during scale tests). If we exceed $600/mo, something is in a crashloop — kill and investigate.

**Supabase.** Pro tier $25/mo. Watch `db_size_bytes` and `bandwidth` in the project dashboard; alert when DB size crosses 6 GB (Pro limit 8 GB) or bandwidth crosses 200 GB/mo (limit 250).

**R2.** Storage is $0.015/GB/mo, no egress to web. Budget $5/mo; alert if it crosses $15 (would imply runaway crawl writes).

**Vercel.** Pro at $20/mo. Watch function invocations and bandwidth in the dashboard. Alert if function-GB-hours pace > 80% of plan by mid-month.

**Total monthly target: $350–$400.** Anything above $500 is an incident, not an inconvenience.

---

## 5. Incident response runbooks

Each is ~5 steps. Long enough to be useful at 7am, short enough to actually execute.

### 5.1 Agent crashloop

1. Open Modal dashboard → find the agent → view recent runs.
2. If the same exception is repeating, copy the traceback into a GitHub issue.
3. Disable the schedule (`modal app stop bfi-agents` or comment out the schedule decorator).
4. If the cause is a code regression, revert the offending commit; redeploy.
5. If the cause is data (e.g., a malformed PDF), add the institution_id to a `quarantine` table and skip in the agent's input query.

### 5.2 Schema drift

1. Run `scripts/dump-schema.sh` and diff against `db/baseline.sql`.
2. Identify the offending object (table, index, RLS policy).
3. If it was created by Supabase migrations, write a migration to reconcile.
4. If it was created by hand in the SQL editor, capture it as a proper migration file and apply.
5. Never edit prod schema outside a migration. v1's eight unapplied migrations all started this way.

### 5.3 R2 outage

1. Check Cloudflare status page.
2. Atlas writes to R2 with retry + dead-letter to `r2_writes_pending` table — verify the table is filling, not data being lost.
3. If outage > 1 hour, pause Atlas schedule.
4. When R2 recovers, run `scripts/replay-r2-writes.ts` to drain the pending table.
5. Confirm Darwin can read the replayed files.

### 5.4 Modal account issue

1. Check Modal dashboard for billing / quota notices.
2. If payment failed, update card; redeploy schedules (deploys revoke on suspension).
3. If hit web-function cap, this is the v1 bug — confirm Team tier active, count endpoints.
4. If suspended for ToS, contact support and pause all user-facing claims about cron freshness until resolved.
5. While Modal is down, manual fallback: run `python -m bfi.agents.magellan` locally on the seed list.

### 5.5 DB connection exhaustion

1. Run `SELECT count(*), application_name FROM pg_stat_activity GROUP BY application_name;`.
2. Identify the offender — typically a Modal function leaking connections or a Vercel route missing `await sql.end()`.
3. `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = '<offender>' AND state = 'idle';`.
4. Push a fix that uses the Supabase transaction-mode pooler (port 6543) for short-lived queries.
5. Confirm pool capacity returns to baseline.

### 5.6 DB unreachable

1. Check Supabase status page.
2. If only our project, open the project dashboard for paused/restart notices.
3. If pooler is up but direct is down, route reads through pooler temporarily.
4. If full outage, post a maintenance banner on the marketing site.
5. Note RPO impact (see §8).

---

## 6. Weekly Monday review

A single page rendered at `/admin/ops/weekly`. Owner spends 15 minutes on it every Monday at 09:00.

**Headline KPIs (top of page, large numbers):**
- Institutions with fresh fee data (< 90 days)
- `fees_verified` rows added this week
- Hamilton reports generated this week
- Knox queue depth
- Total infrastructure spend, week-over-week

**Leading indicators (mid page):**
- Magellan URL-find success rate (7-day rolling)
- Atlas crawl success rate by content type
- Darwin auto-promote rate (≥ 0.90 confidence)
- Anthropic spend pacing vs. monthly budget

**Anomaly flags (bottom, red if any):**
- Any agent with > 1 failed run in past 7 days
- Schema drift detected since last week
- Sentry issues older than 7 days still open
- Cost line items > 1.2× their 30-day average
- Heartbeat coverage gaps

If the page is all green, close the tab. If anything is red, open a GitHub issue before doing anything else that day.

---

## 7. Vendor failure modes worth memorizing

**Modal.** Failure modes: web-function cap (the v1 killer), missing secrets after redeploy, schedule drift across deploys, regional outages (rare, ~quarterly). SLA is "best effort" — no credits, no guarantees. Treat as flaky-by-design and rely on heartbeats. Support is responsive on Slack.

**Supabase.** Failure modes: connection-pool exhaustion (transaction vs session pooler confusion), planned maintenance restarts (usually < 60s), occasional auth degradation. Pro tier has 99.9% SLA but no credits for solo operators. Backups are daily and 7-day retained on Pro.

**Anthropic.** Failure modes: rate-limit 429s during product spikes, model deprecations (90-day notice), occasional 5xx on Sonnet/Opus. No SLA on standard tier. Always wrap in retry-with-backoff and a circuit breaker. Keep a fallback model configured (Haiku) for Hamilton degraded mode.

**Vercel.** Failure modes: deploy build cache poisoning, edge function cold starts, occasional regional issues. Pro tier 99.99% SLA on the platform; build failures are on you. Roll back via "Promote to Production" on the last green deploy.

**Cloudflare R2.** Failure modes: rare regional unavailability, occasional 503 on PutObject during incidents, eventual consistency on list operations. 99.9% SLA. Egress to web is free; egress to other clouds is not — never copy data out of R2 carelessly.

Lesson from v1: every one of these vendors will fail eventually. Plan for it to happen on a Saturday.

---

## 8. Disaster recovery

**Backups.**
- Postgres: Supabase daily automated backups (7-day retention on Pro). Additionally, weekly `pg_dump` to R2 bucket `bfi-db-backups`, 90-day retention via lifecycle rule.
- R2: source data is replayable from origin URLs, so no R2-to-R2 backup. The `r2_writes_pending` table is the recovery log.
- Secrets: 1Password vault `BFI-v2`. Doppler or Modal-secrets sync from 1Password. Never commit a `.env`.
- Code: GitHub, plus a local clone on the laptop SSD. Tag every prod release.

**Restore procedures.**
- DB restore from Supabase: dashboard → Database → Backups → restore-to-new-project, then update `DATABASE_URL`. Practice this once per quarter.
- DB restore from pg_dump: `pg_restore --clean --no-owner -d $DATABASE_URL backup.dump`. Practice this once per quarter.
- Full app rebuild: `git clone bfi-v2 && pnpm install && vercel link && vercel pull`, then redeploy. Should be < 30 min.

**RTO / RPO targets.**
- RTO (time-to-recovery): 4 hours for web, 24 hours for full agent fleet. Solo operator on weekends may extend RTO to 48 hours; the marketing site stays up.
- RPO (acceptable data loss): 24 hours for `fees_verified` (re-derivable from `fees_raw`), 24 hours for `fees_raw` (re-crawlable), 1 hour for `users` and `hamilton_runs` (not re-derivable).

**DR drill cadence.** Quarterly. One drill = restore the latest backup into a scratch project and confirm Hamilton can run a report against it.

---

— COO
