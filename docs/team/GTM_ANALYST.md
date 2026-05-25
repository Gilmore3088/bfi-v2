# GTM Analyst — Bank Fee Index v2

**Status:** Draft v0.1 · 2026-05-25
**Audience:** Founder (solo operator), pre-revenue, post-M1 ship window

The product is McKinsey-grade fee intelligence sitting on a clean 5-agent pipeline. The job of GTM is to convert that asset into recurring revenue against a finite universe (4,000+ U.S. depository institutions). The plan below treats the first 18 months as a hand-sold motion graduating into a self-serve funnel.

---

## 1. Ideal Customer Profile (3 segments, ranked)

### ICP-1: Mid-market & community bank pricing/strategy leaders (highest priority)
- **Firmographic:** U.S. commercial banks, $1B–$25B in assets, 250–2,500 employees. ~900 institutions fit this band. Below $1B they buy aggregated ABA/Crowe surveys; above $25B they have in-house teams + Curinos contracts.
- **Decision-maker:** VP of Retail Deposits, Director of Pricing, Head of Consumer Banking, sometimes CFO at sub-$5B banks.
- **Buying trigger:** Annual pricing committee cycle (Q3-Q4), competitive deposit pressure, post-merger fee harmonization, CFPB Section 1033 / NSF guidance reaction, board-mandated peer review.
- **Willingness-to-pay:** $18K–$40K ACV. They currently pay Curinos $35–60K, Informa/FedFis $15–25K, or live off free ABA tables.
- **Time-to-close:** 45–90 days. Two demos, one procurement review, one security questionnaire.

### ICP-2: Bank/CU strategy consultancies and IB analyst desks
- **Firmographic:** Boutique consultancies serving FIs (Cornerstone Advisors, Capco regional teams, BAI, independents), sell-side equity research desks covering regionals (KBW, Piper Sandler, Janney), neobank/fintech strategy teams.
- **Decision-maker:** Partner / Principal at consultancy; Senior Analyst or Director of Research at IB.
- **Buying trigger:** Client engagement requiring peer benchmarking deliverables; quarterly bank-earnings preview cycle; new market-entry pitches.
- **Willingness-to-pay:** $24K–$60K ACV (multi-seat); plus $5K–$25K per consulting engagement on top.
- **Time-to-close:** 30–60 days. Faster than banks — they buy data to resell insight.

### ICP-3: Credit unions $500M–$10B in assets
- **Firmographic:** ~600 CUs in band. NCUA-regulated, peer-comparison-obsessed (the league system trains them to benchmark).
- **Decision-maker:** CFO, Chief Retail Officer, sometimes CEO at sub-$2B CUs.
- **Buying trigger:** Annual budget/dividend cycle, member-experience initiatives, exam findings on fee disclosures, CUNA/AACUL benchmarking gaps.
- **Willingness-to-pay:** $9K–$18K ACV. Tighter budgets than banks but high peer-data demand.
- **Time-to-close:** 60–120 days. Slower committee culture, more board involvement.

---

## 2. Pricing & packaging

### Validation of v1 $2,500/mo Pro tier
The price is defensible but the packaging is too narrow. $30K/yr against Curinos $50K is a positioning gift, but flat-rate single-seat doesn't capture the consultancy/IB segment. Re-package into three tiers, hold the anchor, add a high-ticket tier above it.

| Tier | Price | Audience | What's included |
|---|---|---|---|
| **Free / Public** | $0 | Consumers, press, junior analysts | National index, 49 categories, single-institution profiles, no peer slicing, no exports, ad-supported, watermarked charts |
| **Pro** | $2,500/mo · $25K/yr (17% annual discount) | One bank, 3 seats | Full peer benchmarking (charter/tier/district), CSV/PDF export, 10 Hamilton reports/mo, Cmd+K search, email alerts on peer fee changes |
| **Enterprise** | $4,500/mo · $48K/yr · custom over 10 seats | Consultancies, IB desks, top-50 banks | Unlimited seats within firm, API access (rate-limited), unlimited Hamilton reports, white-label PDF export, dedicated Slack channel, quarterly office hours |

**Annual vs monthly:** 2 months free on annual prepay (effective 17% discount). Default the pricing page to annual to anchor the larger number; show monthly in a toggle.

**Free trial / freemium:** Skip a time-boxed Pro trial. Instead, lean on a **gated freemium** — the Public tier is the trial, designed to be useful enough to demonstrate authority but pinched enough that any serious user needs Pro. Offer a **14-day Pro Sandbox** keyed to a verified work email (block gmail/yahoo), one-per-domain, with watermarked exports.

**Consulting pricing:**
- **Custom report:** $7,500 flat (one Hamilton-grade deliverable, 2-week turn). Loss-leader to surface buyers.
- **Project engagement:** $25K–$60K (4–8 weeks, scoped pricing/segmentation review).
- **Retainer:** $8K/mo (4 hours analyst time + unlimited Hamilton). Aim to convert 30% of project clients to retainer within 90 days.
- **Avoid hourly billing** — it caps value capture and signals body-shop, not authority.

---

## 3. First 10 customers plan

The first 10 are hand-sold. No paid acquisition until $250K ARR. Channels in priority order:

1. **Targeted cold email to ICP-1 (50 banks)** — pull from FDIC Call Report data already in the DB. Personalize with their actual fee-vs-peer delta in the opening line. Goal: 3 demos/week, close 4 customers.
2. **LinkedIn outbound to ICP-2** — 20 named consultancies, 30 IB analysts covering regionals. Connect → 2-touch DM → demo. Goal: 2 closes.
3. **Founder-led content** — one teardown post per week on LinkedIn + Substack ("This Week in Bank Fees"). Use real pipeline data. Goal: pipeline, not closes — 2 inbound demos/month by month 3.
4. **Conference presence (lurking, not exhibiting)** — BAI Beacon, Bank Director Acquire or Be Acquired, NACUSO. Buy attendee list access; 1:1 coffees. Goal: 2 closes from 2 conferences.
5. **Partner referrals** — see Section 8. Goal: 2 closes from partner intros by month 6.

### Sample copy — Cold email (ICP-1)

> Subject: Your overdraft fee is $7 above the peer median
>
> [First name] — I run Bank Fee Index, a pricing intelligence platform that pulls from every U.S. bank and CU fee schedule. We track [Bank Name]'s overdraft at $35, which is $7 above the median for $2-5B community banks in the St. Louis Fed district. NSF and monthly maintenance sit closer to median; the gap is concentrated in one category.
>
> Worth a 20-minute walk-through of how the peer set is constructed? I'll send the full benchmark report either way.
>
> James / Founder, Bank Fee Index
> [link to a one-page teaser tied to their FDIC cert number]

Personalization is the entire pitch. Each email needs the live delta from the DB — automate the merge from `getPeerIndex()`.

### Sample copy — LinkedIn (ICP-2 consultancy partner)

> Hi [First name] — saw your post on community bank deposit pricing post-1033. We just shipped a benchmarking dataset covering 4,000 institutions, all 49 fee categories, refreshed quarterly. Curinos but priced for boutiques. Worth a look for the [Client Name]-type engagements you mentioned?

Keep it under 60 words. No deck.

---

## 4. Sales motion

**Hybrid, leaning sales-led through year one.** Self-serve checkout exists for Pro at $2,500/mo, but expect 80% of revenue to come from a founder-led demo through month 12. Enterprise is always sales-led.

**Demo flow (30 minutes):**
1. (5 min) Open in their own institution's profile. Show their fee delta vs peers live.
2. (10 min) Walk the Market page filtered to their peer set. Stop on 1-2 actionable outliers.
3. (10 min) Generate a Hamilton report live, send the PDF to their inbox before they leave the call.
4. (5 min) Pricing + next steps. Ask for a 14-day Sandbox commit if not ready to buy.

**Trial conversion mechanics:**
- Day 0: provisioned + welcome email with 3 saved peer sets pre-built.
- Day 3: founder check-in email — "what's the most surprising thing you've found?"
- Day 7: Hamilton report delivered on their institution, gratis.
- Day 12: pricing call booked.
- Day 14: trial ends, auto-quote with annual discount.

Target trial-to-paid: 35%.

---

## 5. Lead capture strategy

**Where on the site:**
- Every public institution profile: "See full peer comparison" CTA → email gate → unlocks a single-institution PDF teaser.
- Hamilton public reports (admin lead-gen mode): email gate at full-report download.
- Site-wide footer: "Get the Monthly Pulse" newsletter.
- `/pricing` page: "Talk to founder" Calendly link above the fold.

**What's gated:** PDF exports, multi-institution CSVs, Hamilton full reports. Charts and headline numbers stay public — authority requires they be free.

**Lead magnet (the killer one):** "The State of U.S. Bank Fees [Year]" — annual report, 30 pages, professionally designed, gated. Should function as the category-defining document the way Mary Meeker's Internet Trends did for VC. This is the single most important marketing artifact.

**CRM stack:**
- **HubSpot Free** through first 50 leads, then HubSpot Sales Hub Starter ($20/seat/mo).
- **Resend** for transactional + drip (already in the stack).
- **Calendly** ($12/mo) for demo booking.
- **Plausible** for site analytics (already in the stack).
- **Notion** for deal notes until lead volume justifies HubSpot pipelines.

Total stack cost <$100/mo through year one.

---

## 6. Conversion funnel targets

Assumes 2,000 unique monthly visitors at month 3, growing to 12,000 by month 12 (driven by SEO on institution profiles + content cadence).

| Stage | Month 3 | Month 6 | Month 12 |
|---|---|---|---|
| Unique visitors / mo | 2,000 | 5,000 | 12,000 |
| Email captures | 80 (4%) | 250 (5%) | 720 (6%) |
| Demo bookings | 8 (10% of captures) | 30 | 90 |
| Pro trials started | 5 | 18 | 55 |
| Paid conversions (Pro+Ent) | 2 | 6 | 18 |
| Cumulative paying customers | 3 | 15 | 50 |
| Cumulative ARR | $75K | $400K | $1.4M |

Visitor-to-paid conversion target: 0.10% month 3 → 0.15% month 12. This is conservative for B2B vertical SaaS.

---

## 7. Top 3 risks to revenue

1. **Curinos / Informa retaliates with a low-tier product.** Monitor: pricing pages quarterly, search win/loss commentary in demos for competitor mentions. Mitigation: out-ship them on Hamilton (LLM-native analysis is the wedge they can't easily copy).
2. **Hamilton report quality slips below the McKinsey bar and the authority positioning collapses.** Monitor: every published report scored against a 10-point rubric before ship; track NPS on report deliveries; if rubric average drops below 8, pause publishing. Mitigation: founder personally reviews every public-facing report through first 12 months.
3. **CFPB rule changes (NSF/overdraft) compress the underlying fee economics and reduce buyer urgency.** Monitor: Federal Register weekly, comment-period filings, bank earnings calls. Mitigation: lean into rule changes as buying triggers ("you need to know where every peer landed post-rule"); reframe product as compliance/disclosure tooling if pricing pressure deepens.

---

## 8. Partnerships worth pursuing

1. **State bankers associations (ICBA, state-level: TBA, IBAT, CBAI, etc.).** They sell research and benchmarking to members and have distribution. Revenue share or co-branded member tier at $1,500/mo.
2. **Core providers (Jack Henry, FIS, Fiserv).** Their bank customers consume pricing intelligence. App-marketplace listing + referral fee (20% Y1 ACV).
3. **Boutique bank consultancies (Cornerstone Advisors, Capital Performance Group, ProBank Austin).** Bundle our data into their engagements, white-label PDF export, 25% rev share on closed referrals.
4. **CUNA Strategic Services / AACUL.** Same model as state bankers, sized for credit unions.
5. **FDIC / NCUA call-report data resellers (S&P, FedFis, BankRegData).** Data-swap partnerships — they get fee data, we get cleaner Call Report joins, no cash changes hands. Lowers our data-acquisition cost and gives a credibility halo.

Pursue partnerships #1, #3, and #5 in the first six months. The others are year-two.

---

— GTM Analyst
