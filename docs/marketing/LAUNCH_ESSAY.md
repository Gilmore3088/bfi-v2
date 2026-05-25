# We rebuilt Bank Fee Index from scratch

*Draft v0.1 · 2026-05-25 · ~900 words · CMO sign-off pending*

---

Last spring, I shipped the first version of Bank Fee Index. The premise was simple and, I still think, correct: nobody had built the national authority on bank and credit union fee data. Bank executives were paying consulting firms five and six figures to produce one-off peer benchmarks. Consumers were left squinting at PDFs to find the overdraft fee. The data existed — in scattered fee schedules across 4,000 institutions — but nobody had assembled it into something an industry could rely on.

So I did. Or, more accurately, I started.

I built a crawler that pulled fee schedules. A taxonomy of 49 fee categories. A research agent named Hamilton that could synthesize the data into McKinsey-grade reports. A peer-benchmarking engine. A consumer-facing index. By late spring, the data was flowing.

Then it stopped flowing. And I didn't notice for thirty-three days.

This is the story of what happened, what I learned, and why Bank Fee Index v2 launches today as a different kind of product.

## What broke

The pipeline ran on a serverless platform that needed a secret token to connect to the database. At some point, the token went stale. The pipeline crashed silently. There was no alert, because I hadn't built one. The dashboard kept showing what it had last seen, which made it look like everything was fine. I shipped feature after feature on top of a dead pipeline.

When I finally noticed — because a customer asked a question I couldn't answer — I had a moment of clarity that founders are supposed to have earlier. The product wasn't broken. *The product was the problem.*

v1 had become an exercise in surface area: fifty-one synthetic agents simulating a fleet, fourteen navigation items that overlapped, a marketing page that promised "fee data on 4,000 institutions" when the real number with verified data was 610. Seven percent.

I had built the thing I'd wanted to demo, not the thing I'd wanted to sell.

## What survived

The data survived. Eight thousand seven hundred institutions in the database, ninety-nine percent of them matched to their FDIC or NCUA filings, four years of Call Report context, a half-decade of FRED economic indicators. That's the real asset. Everything else was scaffolding.

The taxonomy survived. Forty-nine fee categories across nine families, four tiers of importance. Hand-curated, hand-corrected, the thing that lets a bank in Texas and a credit union in Ohio be compared on the same axis.

The design survived. A dual-brand aesthetic — Bloomberg-grade for the institutional product, FT-editorial for the consumer side — that says, before you read a word of copy, that this is a serious place to spend your time.

And the agents survived, conceptually. Magellan to find fee schedules. Atlas to crawl them. Darwin to classify the results against the taxonomy. Knox to question the classifier when it's uncertain. Hamilton to synthesize it all into reports a CFO would read.

What didn't survive: the sprawl.

## What's different in v2

v2 is built on three commitments that v1 broke.

**Honesty about coverage.** When you visit a category page today, you see how many institutions are represented and which ones are missing. We will not claim 4,000 when we have 610. The number will grow — we have a clear plan to reach full coverage by year-end — but we will tell you the number we actually have, not the number we wish we had.

**Operational discipline.** There are five agents in v2, not fifty-one. Seven navigation items, not fourteen. Twelve database tables, not ninety-four. Every one of those numbers is a ceiling, not a target. If we want to add an agent, we have to retire one. The product is now small enough for one person to operate without losing it.

**Alerting that fails loudly.** Three independent layers watch the pipeline. If a job goes silent for more than twenty-six hours, my phone rings. If it goes silent for more than seventy-two, an external watchdog rings my phone again from a different vendor. The thirty-three-day silence will not recur.

## What you get

If you're a bank executive: peer-benchmark dashboards that show where your fees sit relative to the segment you actually compete in, not just "national average." Tier filtering, district filtering, charter type. Hamilton reports written in language a board reads, not a dashboard exports.

If you're a consultant or analyst: programmatic access to the underlying fee data, methodology documentation that holds up to scrutiny, and bespoke Hamilton reports for client engagements.

If you're a consumer: clear, current fee data for the institutions you might bank with, presented without dark patterns, monetized through advertising rather than through your confusion.

If you're a journalist: cite us. We will tell you what we know, what we don't, and where the numbers came from.

## What's next

The first 22 institutions are live today as a vertical-slice proof of the new pipeline. The next 90 days scale us to all 4,000-plus. The first paying Pro subscriber arrives this quarter. The annual *State of U.S. Bank Fees* report ships before year-end as the category-defining artifact.

If you want to follow along, the new site is at bankfeeindex.com. If you want to talk about peer benchmarking for your institution, my calendar is at the bottom of the page.

If you spot an institution whose data we have wrong, tell me. That's the kind of feedback that built the parts of v1 that survived.

— James Gilmore
Founder, Bank Fee Index
