# Operations Manager — Bank Fee Index v2

**Owner:** Operations Manager (initially: James Gilmore, solo)
**Scope:** Day-to-day running of the platform — pipeline health, review queue, report QA, customer support, lead handoff, content publication.
**Companion docs:** `SPEC.md`, `CTO.md`, `CMO.md`

This document is the playbook a human executes to keep BFI v2 running. Every section is a workflow, not a philosophy. When an analyst is hired, this is their onboarding manual.

---

## 1. Daily operator workflow (morning, 15 minutes)

Run every weekday at 08:30 ET. Modal cron fires 02:00–03:00 ET; Darwin/Knox drain continuously overnight. Morning check confirms the loop ran.

1. **Open `/admin` Dashboard.** Confirm four signals are green:
   - Magellan last-run timestamp within 24h
   - Atlas last-run timestamp within 24h, crawl success rate > 70%
   - Darwin queue depth (fees_raw unclassified) trending flat or down
   - Knox queue depth (flagged for review) < 50 items
2. **Open `/admin/agents`.** Click each agent tab. Any red heartbeat (>6h since last beat) → file a CTO ticket, do not self-debug for more than 15 minutes.
3. **Open `/admin/review`.** Note the count. Target: drain to zero by EOD. If > 30 items, block 2× 30-minute review sessions on the calendar.
4. **Open `/admin/data-quality`.** Scan the scorecard for any category that dropped a maturity tier (strong → provisional, provisional → insufficient). Flag in the daily log.
5. **Daily log entry.** Append one line to `docs/ops/daily-log.md`: date, queue counts, anomalies, planned focus.

If any signal fails, the day's first task is restoring the loop. No new work until pipeline is green.

---

## 2. Review queue SOP (Knox-flagged fees)

Target throughput: **40 items/hour** (90 seconds per fee). Knox flags fall into three buckets: low confidence (<0.90), statistical outlier vs peers, or taxonomy ambiguity.

**Per-item decision tree:**

1. **Read the fee row.** Category, amount, institution, source URL, Knox's flag reason.
2. **Open source.** Click through to the R2-stored PDF/HTML snapshot. Locate the line item.
3. **Decide:**
   - **Approve** — fee text matches the extracted value and category. One click, move on.
   - **Re-extract** — text is present but Darwin mis-classified (e.g. NSF vs overdraft confusion). Set correct category, approve. Add a 1-line note if pattern repeats.
   - **Reject** — fee is not actually on the schedule (hallucination), or the source URL no longer resolves to a fee schedule. Mark institution URL stale.
   - **Institution-wide problem** — if three rejects from the same institution in a row, flag the whole institution back to Magellan for URL re-discovery. Use the "Re-queue institution" button.
4. **Hard cases (> 2 minutes).** Park in the "needs second opinion" tab. Batch-review weekly with CTO.

Never infer NSF from overdraft or vice versa. Extract only what is explicitly on the schedule. When in doubt, reject and let Magellan re-run.

---

## 3. Hamilton report QA workflow

No Hamilton report ships to a Pro subscriber without passing this gate. Solo operator wears both author and editor hats — open the report in a separate browser session and read it as a stranger would.

**Pre-flight (Hamilton generates draft):**
1. Verify the **brief** matches the customer request (institution(s), peer set, time window, focal categories).
2. Confirm Hamilton ran against current `fees_verified` snapshot — check the data-freshness footer.

**Editorial checklist (every claim, every chart):**
- [ ] Every dollar figure traces to a `fees_verified` row (spot-check 5 random claims)
- [ ] Every peer comparison cites the segment definition (charter, tier, district)
- [ ] Every chart renders in both light and dark mode
- [ ] Every "so what" callout makes a falsifiable claim, not a hedge
- [ ] Citations list every institution referenced, with `extracted_at` dates
- [ ] No statements about projected future fees ($X by 2027) — pipeline data only
- [ ] Brand voice: editorial confidence, no SaaS-y phrasing, no emojis
- [ ] Cover page has client name, report title, date, "Prepared by Hamilton, Bank Fee Index"
- [ ] PDF export looks correct (page breaks, no orphan headers)

**Sign-off.** Solo operator commits to a one-line approval in `docs/ops/report-ledger.md` with report ID, customer, date, hours spent on QA. Ship via secure link, never email attachment.

Target QA time: **45 minutes per institution-profile report; 90 minutes per category deep-dive**. If QA exceeds 2× target, the report goes back to Hamilton for regeneration — do not patch by hand.

---

## 4. New institution onboarding (customer-requested coverage)

SLA: **5 business days** from request to live in `/admin/market`.

1. **Day 0 — Receive request** (email or in-app form). Capture: institution name, charter, state, customer who requested, deadline.
2. **Day 0 — Seed.** Insert into `institutions` table via `/admin/institutions/new`. Status: `pending_discovery`.
3. **Day 1 — Magellan run.** Trigger a one-off Magellan job scoped to that institution. Monitor in `/admin/agents/magellan`.
4. **Day 2 — Atlas + Darwin.** Once a URL lands, Atlas crawls on the next cron. Darwin classifies. If Atlas fails (bot block, PDF-only), CTO escalation for Playwright stealth path.
5. **Day 3 — Knox review.** Manually drain any Knox flags for this institution that day.
6. **Day 4 — Verify.** Pull up the institution on `/admin/market`. Confirm at least the 6 spotlight categories have values with `strong` or `provisional` maturity.
7. **Day 5 — Notify customer.** Email link to the institution page. Cc into the lead pipeline as a touchpoint.

If the 5-day SLA slips, send the customer a status note before day 5 ends. Never let a deadline pass silently.

---

## 5. Lead handoff (form → close)

Solo founder owns all stages, but each stage has explicit hand-off criteria so a future BD hire slots in cleanly.

| Stage | Owner | Trigger | Action | SLA |
|---|---|---|---|---|
| **Capture** | Website | Form submit on `/pro` or consulting page | Webhook writes to `leads` table, sends Slack ping | Immediate |
| **Qualify** | Ops Mgr | Slack ping | Within 4 business hours: enrich with FDIC/NCUA data, score (asset size, role, fit) | 4h |
| **Outreach** | Ops Mgr | Qualified lead | Personal email referencing their institution's fee position vs peers | 1 business day |
| **Discovery call** | Ops Mgr | Reply received | 30-min call, capture pain + buying authority + timeline in `leads.notes` | Within 3 days |
| **Proposal** | Ops Mgr | Discovery complete | Send Pro subscription link or consulting SOW from template | 2 days post-call |
| **Close** | Ops Mgr | Signed/paid | Provision Pro account or kick off consulting engagement; move lead to `won` | Same day |
| **Onboard** | Ops Mgr | Won | First Hamilton report scheduled within 7 days for new Pro; consulting kickoff within 5 | 7 days |

Every stage logs to `/admin/leads`. No lead older than 14 days without a touchpoint or an explicit `nurture` status.

---

## 6. Content publication checklist

Applies to: Hamilton public reports (lead-gen), consumer guides, blog posts, monthly pulse, district outlooks.

**Pre-publish:**
- [ ] Final QA via Section 3 checklist (for Hamilton output)
- [ ] CMO has signed off on headline + lede (slack message acceptable)
- [ ] OG image generated and inspected on Twitter/LinkedIn preview tools
- [ ] Meta title ≤ 60 chars, meta description ≤ 155 chars, target keyword present once in H1
- [ ] Internal links: at least 2 to related Hamilton reports, 1 to `/pro`
- [ ] All charts have alt text
- [ ] Schema.org `Article` JSON-LD block included

**Publish:**
- [ ] Push to `main`, Vercel ISR revalidates within 60s; confirm live URL
- [ ] Submit URL to Google Search Console
- [ ] Schedule social: LinkedIn (1 post day-of, 1 quote-callout day +3), Twitter/X (thread day-of)
- [ ] Add to monthly newsletter draft in Resend
- [ ] Slack #content channel with the live link

**Post-publish (day +7):**
- [ ] Check Plausible: pageviews, time on page, scroll depth
- [ ] Log to `docs/ops/content-ledger.md` with metrics

---

## 7. Customer support SOP (Pro subscribers)

**Channel:** `support@bankfeeindex.com`, monitored via Front (Gmail acceptable until volume justifies). No Intercom until > 25 Pro subscribers.

**Response targets:**
- Acknowledge: **2 business hours**, during 08:00–18:00 ET
- First substantive response: **1 business day**
- Resolution: **3 business days** for data questions, **5** for feature requests

**Common request playbook:**
- *"This fee looks wrong for [Bank]"* → Open Knox review on that fee, re-verify against source, reply with finding within 24h. If pipeline error, force re-extract.
- *"Can you add [Institution]?"* → Section 4 workflow. Reply with SLA-acknowledgement same day.
- *"Can Hamilton produce [custom analysis]?"* → If covered by existing report templates, schedule and ship. If bespoke, route to consulting pricing conversation.
- *"Cancel my subscription"* → Process via Stripe portal link, send confirmation, schedule a 1-question exit survey email 24h later.

**Escalation.** Anything involving a billing dispute, data accuracy claim from a regulated institution, or press inquiry — escalate to founder same day, do not respond unilaterally.

---

## 8. Weekly Friday close-out (45 minutes, 15:00 ET)

1. **Review queue at zero.** Drain any remaining Knox flags or move to "second opinion" tab.
2. **Data quality scan.** `/admin/data-quality` scorecard — log week-over-week delta in `docs/ops/weekly.md`.
3. **Lead pipeline review.** Every lead touched this week? Any stuck > 14 days? Move stale leads to `nurture`.
4. **Report ledger.** Count reports shipped this week, hours spent, customer satisfaction (informal).
5. **Agent health.** Skim `/admin/agents` history for the week. Any agent failed > 3 times? File CTO ticket.
6. **Content velocity.** One post shipped? Newsletter on schedule?
7. **Inbox zero.** Support, sales, founder inbox all at zero or scheduled.
8. **Next-week plan.** Three priorities, written in `docs/ops/weekly.md`.

Skip nothing. The Friday routine is the operating heartbeat.

---

## 9. Quarterly business review (90 minutes, last Friday of quarter)

Template lives at `docs/ops/qbr-template.md`. Sections:

1. **Pipeline metrics** — fees verified, institutions covered, maturity tier distribution, week-over-week.
2. **Revenue** — Pro MRR, consulting bookings, churn, ARPU. Compare to plan.
3. **Customer wins/losses** — top 3 of each. Verbatim quotes preferred.
4. **Agent reliability** — uptime per agent, incidents, MTTR.
5. **Hamilton report inventory** — reports shipped, average QA time, customer NPS on reports.
6. **Lead funnel** — visits → leads → qualified → proposal → won, conversion at each stage.
7. **Content scorecard** — posts shipped, organic traffic, top performer, bottom performer.
8. **Top 5 lessons** — what we learned that changes how we operate next quarter.
9. **Next quarter priorities** — three, ranked, each with one measurable outcome.

Output is a 6–10 page deck. Founder presents to self (and analyst, when present). Archived in `docs/ops/qbr/YYYY-Q#.md`.

---

## 10. Tooling stack

| Workflow | Tool | Notes |
|---|---|---|
| Pipeline monitoring | `/admin` Dashboard + Agents pages | Built in v2; single source of truth |
| Review queue | `/admin/review` | Keyboard-driven: j/k navigate, a approve, x reject |
| Report QA | `/admin/hamilton` + browser preview | PDF export via the report page |
| Lead pipeline | `/admin/leads` | Custom; do not graduate to HubSpot until > 50 active leads |
| Customer support | Front (or Gmail) on `support@bankfeeindex.com` | Skip Intercom |
| Content calendar | Notion or `docs/ops/content-calendar.md` | Whichever the CMO uses |
| Daily/weekly log | `docs/ops/*.md` in repo | Markdown, committed, dated |
| Status pings | Slack #ops, #content, #leads | Webhooks from agents + forms |
| Email distribution | Resend (already in stack) | Newsletter, transactional, support |
| Analytics | Plausible | Already in stack |
| Billing | Stripe | Portal-driven; no manual invoicing |

Tooling principle: **own as little as possible, integrate with as little as possible**. Every new tool must replace something. Same ceiling rule as the agent fleet.

---

— Operations Manager
