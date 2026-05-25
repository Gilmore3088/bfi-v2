# CMO — Bank Fee Index v2

**Owner:** CMO
**Status:** Locked v1.0 · 2026-05-25
**Scope:** Brand strategy, positioning, messaging architecture, voice. Source of truth for marketing copy across v2.

---

## 1. Positioning

**Bank Fee Index is the Bloomberg Terminal for bank and credit union fee intelligence.**

We are the only research authority publishing structured, verified, peer-comparable fee data across 4,000+ U.S. financial institutions — with an AI analyst that turns that data into consulting-grade reports on demand.

We are not a dashboard. We are not a directory. We are not a rate-comparison site. We are the standard.

## 2. Brand Promise

**Every number traces to a source. Every claim earns its confidence. Every report reads like it cost $15,000.**

What the customer can count on:

- **Accuracy** — fees pulled from primary documents, classified by taxonomy, adversarially reviewed before they are published.
- **Comparability** — apples-to-apples across charter, asset tier, and Federal Reserve district.
- **Authority** — analysis that holds up in a boardroom, a regulator meeting, or a pricing-committee debate.

## 3. Audience Pillars

### Bank Executives (C-suite, VP Pricing, VP Retail)
- **Job to be done:** Defend or change a fee schedule with evidence; benchmark against the right peer set before board prep, regulator review, or repricing cycles.
- **Emotional driver:** Don't get caught flat-footed. The board will ask "where are we vs. peers?" and the answer needs to be instant and unimpeachable.
- **Decisive value prop:** Peer-set benchmarking at the asset-tier and district level, delivered as a McKinsey-grade brief — not a CSV.

### Financial Analysts and Consultants
- **Job to be done:** Build the deck. Cite the number. Stand behind the methodology.
- **Emotional driver:** Look smarter than the room. Be the source the partner trusts.
- **Decisive value prop:** A research platform whose outputs they can drop into client work with attribution — and an AI analyst (Hamilton) that drafts the first ten pages so they can focus on the last five.

### Consumers
- **Job to be done:** Understand what a bank is going to charge me, and whether it's normal.
- **Emotional driver:** Don't feel ripped off. Don't feel stupid.
- **Decisive value prop:** Plain-English guides backed by the same data the executives are using — free, ad-supported, written like a column, not a comparison chart.

## 4. Messaging Architecture

### Tagline candidates

1. *The national authority on bank fees.*
2. *Fee intelligence, on demand.*
3. *Know what banks charge. Know why it matters.*

**Winner: "The national authority on bank fees."** It claims the category, signals institutional weight, and works for both audiences without modification.

### Hero headline (marketing site, B2B framing)

> **The national authority on bank fees.**
> Verified fee data across 4,000+ institutions. Peer benchmarks at the tier and district level. McKinsey-grade reports on demand.

### Product pillar headlines

- **Market Intelligence** — *See where every fee sits, against any peer set.*
- **Hamilton Reports** — *A senior analyst on your team, available in ninety seconds.*
- **Peer Benchmarking** — *Your fees vs. the right peer group — not a generic average.*

### Boilerplate

**B2B (for press, About page, sales decks):**
> Bank Fee Index is the national authority on bank and credit union fee intelligence. We collect, verify, and publish structured fee data across 4,000+ U.S. financial institutions, and pair it with Hamilton — an AI research analyst that produces consulting-grade benchmarking, competitive, and regulatory reports on demand. Banks, credit unions, and the consultants who serve them use Bank Fee Index to defend pricing decisions, prepare board materials, and stay ahead of regulatory scrutiny.

**Consumer (for footer, About page, press for consumer-press):**
> Bank Fee Index publishes plain-English guides to bank and credit union fees, drawn from the same research database used by industry analysts. We help everyday consumers understand what their bank charges, how it compares, and what they can do about it.

## 5. Voice and Tone

**We sound like:** A senior research analyst at a top-tier firm. Direct, confident, evidence-led. We make claims and back them. We use numbers without apology and language without filler.

**Reference voices:** The Economist's Free Exchange column. McKinsey Insights briefs. Matt Levine when he is being serious. The Financial Times when it covers regulation.

**We never sound like:** A SaaS landing page. A startup blog. A vendor pitch. A finance influencer. A chatbot. We do not say "unlock," "empower," "revolutionize," "AI-powered," "next-generation," or "game-changer." We do not use exclamation points. We do not hedge with "could potentially help you possibly consider."

**Sentence discipline:** Lead with the claim. Support with the number. Stop.

> Wrong: *Our AI-powered platform could help you potentially gain insights into peer fee benchmarks.*
> Right: *Your overdraft fee is $35. The median for $1B–$10B community banks in the Atlanta district is $32. You are 9% above peer.*

## 6. Launch Narrative (v2)

**Format chosen: a single 900-word essay published to the blog on launch day, repurposed into a launch email and a Product Hunt blurb.**

### Title

**"We rebuilt Bank Fee Index from scratch. Here's what changed."**

### Arc

1. **Open with a number.** *Last year, U.S. banks collected $7.7 billion in overdraft fees. Nobody could tell you what the median overdraft fee actually was, across charters, by asset tier, by Federal Reserve district. We could — but the system that produced the answer was, frankly, held together with duct tape.*
2. **Acknowledge what v1 got right.** The data is good. The taxonomy is right. The aesthetic is right. Those survive.
3. **Acknowledge what v1 got wrong.** Too many moving parts. Cron jobs that silently died. A research analyst (Hamilton) whose reports read like data dumps. The product was correct but not yet trustworthy at the operational level.
4. **Introduce v2.** Five agents, single-responsibility, owner-operable. Seven nav items, down from fourteen. Hamilton, rewritten, producing reports that read like they came from a partner — because the prompt scaffolding now demands it.
5. **Show, don't tell.** Embed a sample Hamilton report. Show the Market page with a real peer benchmark.
6. **Close on the promise.** *We are the national authority on bank fees. That is a claim, and we intend to earn it every day. Every number on this site traces to a source. Every report earns its confidence. If we ever fall short of that, tell us — we will fix it.*

### Repurpose

- **Launch email** (to existing v1 list): 250-word version, leads with "we rebuilt it," links to essay and to the live Market page.
- **Product Hunt blurb:** *Bank Fee Index v2 is live. Verified fee data on 4,000+ U.S. banks and credit unions, peer benchmarks by asset tier and Fed district, and an AI analyst that writes McKinsey-grade reports in ninety seconds. Free for consumers. $2,500/mo for Pro.*

## 7. Hamilton's Voice

**Hamilton speaks in the third person ("Bank Fee Index analysis shows…") in published reports, and in the first person ("I looked at 1,247 institutions in your peer set…") in interactive chat.**

**Tone:** Senior McKinsey partner briefing a client CEO. Calm, declarative, opinionated. Leads with the finding, supports with the evidence, ends with the implication. Never apologetic. Never breathlessly enthusiastic.

**Reference voice:** A composite of an FT Lex columnist (sharp, brief, opinion-bearing) and a McKinsey associate partner (structured, evidence-led, "so what" oriented).

**Signature moves:**
- Opens reports with a single bold claim ("Your overdraft fee is the highest in your peer set by $4.")
- Uses "so-what" callouts — labeled, visually distinct, one sentence each.
- Cites confidence intervals when they matter, omits them when they would be noise.
- Never says "as an AI." Never apologizes for being a model. He is the analyst on the page; the implementation is invisible.

**Hamilton never:** speculates beyond the data, predicts dollar revenue impact without a stated assumption, uses hedge words ("might," "could potentially"), refuses to take a position when the data supports one.

## 8. First 5 Marketing Assets (First 30 Days)

1. **Launch essay** — *"We rebuilt Bank Fee Index from scratch"* (blog, 900 words, ships with v2).
2. **The 2026 Overdraft Fee Report** — first published Hamilton report, free, gated by email. The flagship piece of evidence that the platform is real. Distributed to press list and v1 email list.
3. **Marketing site rewrite** — homepage, /product, /hamilton, /pricing. Three days of design work. Replaces the v1 splash.
4. **"How peer benchmarking actually works" explainer** — 600-word methodology piece, links from every Pro pricing page. Builds trust with analysts and consultants who need to defend the numbers internally.
5. **Outbound sequence to 50 named accounts** — VPs of Retail and Pricing at the top 50 community/regional banks by assets. Three-email sequence: launch announcement, free benchmark report on their institution, 15-minute call ask. Hand-personalized; no automation tone.

---

— CMO
