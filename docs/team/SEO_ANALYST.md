# SEO Analyst — Bank Fee Index v2

**Status:** Draft v0.1 · 2026-05-25
**Scope:** Organic search strategy for bankfeeindex.com post-v2 cutover
**Premise:** v1 has near-zero organic footprint. v2 ships with a defensible programmatic SEO moat from day one — 4,000 institutions × 49 fee categories × 12 Fed districts × 50 states is an addressable surface area most competitors cannot match.

## 1. Search opportunity sizing

Bank fee search demand is bimodal: a small set of high-intent head terms (mostly transactional, dominated by NerdWallet/Bankrate) and a very long tail of institution-specific and consumer-frustration queries that are under-served.

| Term | Est. US monthly volume | Difficulty | Intent | Why we can win |
|---|---:|---|---|---|
| `bank fees` | 14k | High | Informational | Pillar — beatable with data depth, not blogspam |
| `overdraft fees` | 27k | High | Informational | Real distributional data (P25/median/P75 by tier) |
| `chase overdraft fee` | 6.6k | Medium | Transactional | Programmatic page per institution × per category |
| `wire transfer fee bank of america` | 2.4k | Medium | Transactional | Same — sourced, dated, exact |
| `credit union vs bank fees` | 1.9k | Medium | Comparison | We own the charter-segmented data |
| `average bank fees 2026` | 1.3k | Low-Med | Editorial | Refresh annually; canonical national index |
| `monthly maintenance fee waiver` | 1.1k | Medium | How-to | Consumer guides with cited waiver thresholds |
| `nsf fee` | 8.1k | Medium | Informational | Pair w/ overdraft, differentiated taxonomy |
| `[bank name] fee schedule` | ~50–500 each, ~4,000 institutions | Low individually | Transactional | Tail dominance — no aggregator covers all 4k |
| `compare [bank A] vs [bank B] fees` | Long tail | Low | Comparison | Programmatic comparison axis |

Conservative addressable demand: **150k–400k monthly organic sessions at maturity** (18–24 months), assuming we capture ~5–10% of long-tail institution and comparison queries plus secondary rankings on 10–20 head terms.

The structural advantage: our data is sourced and dated. NerdWallet's "Chase overdraft fee" article is a guess unless an editor remembers to update it. Ours updates whenever Atlas re-crawls. That is a freshness signal Google can detect via `dateModified` and a trust signal humans can verify via a "Sourced from Chase fee schedule, last verified [date]" footer.

## 2. Programmatic SEO architecture

Four primary programmatic axes plus a small editorial hub.

### 2.1 Institution pages — `/banks/[slug]` and `/credit-unions/[slug]`

URL: `bankfeeindex.com/banks/jpmorgan-chase`, `bankfeeindex.com/credit-unions/navy-federal`

~4,000 pages. Each renders:
- H1: "JPMorgan Chase Fees — Full Schedule (Updated [date])"
- Fee table across all 49 categories present for that institution, with amount, source URL, verified date
- Peer comparison block: how this institution sits vs national median for its asset tier and charter
- Maturity badge (number of approved observations, freshness)
- "What this means" — Hamilton-generated 200-word summary (cached, refreshed monthly)
- Structured data: `FinancialProduct`, `Organization`, `BreadcrumbList`

Charter split (`/banks/` vs `/credit-unions/`) gives a clean topical hub for each charter and lets internal linking reinforce charter-specific authority.

### 2.2 Category pages — `/fees/[category]`

URL: `bankfeeindex.com/fees/overdraft`, `.../fees/wire-domestic-outgoing`

49 pages. Each renders:
- H1: "Overdraft Fees — National Bank Fee Index"
- Hero stats: median, P25, P75, count of institutions, last refresh
- Distribution chart (Recharts on server via static export to image, plus interactive client component)
- Breakdown by charter (banks vs credit unions) and by asset tier
- Top 10 highest and lowest institutions (each row links to institution page → builds internal link graph)
- "How [category] fees work" — editorial intro, 400–600 words, FAQ schema
- Methodology block linking to the master methodology page

### 2.3 Comparison pages — `/compare/[a]-vs-[b]`

URL: `bankfeeindex.com/compare/jpmorgan-chase-vs-bank-of-america`

Combinatorially infinite. **Do not generate all pairs.** Generate on-demand with these gates:
- Both institutions have ≥10 approved fees
- Slug pair is requested or sits in a curated allowlist
- Canonical form: alphabetical, hyphenated. `/compare/bank-of-america-vs-jpmorgan-chase` 301s to the alphabetical canonical
- `noindex` until the page has at least 30 sourced data points across both sides

Seed list: top 200 institutions × top 200 institutions filtered to within-tier pairs ≈ 4,000 indexable pages at launch. Expand based on Search Console impressions.

### 2.4 District and state pages — `/districts/[id]` and `/states/[abbr]`

12 Fed districts + 50 states + DC = 63 pages. Each:
- Median fees for the region across all 49 categories
- Top institutions by asset size in the region
- Fed Beige Book commentary excerpts (we already ingest this in v1)
- Internal links to constituent institution pages

States are higher-volume search targets than Fed districts; Fed districts are an analyst-facing convention. Prioritize state pages for SEO and keep district pages for editorial cross-referencing.

### 2.5 Educational hub — `/guides/[slug]`

20–40 hand-authored long-form guides. Examples:
- `/guides/how-to-avoid-overdraft-fees`
- `/guides/credit-union-vs-bank-fees`
- `/guides/wire-transfer-fees-explained`
- `/guides/business-checking-fees-guide`

These are the link magnets. Programmatic pages convert traffic; guides earn the backlinks that make programmatic pages rank.

### 2.6 Dedup and canonical strategy

- Trailing-slash policy: no trailing slash, enforced in `next.config.ts`
- Lowercase slugs, hyphenated, generated from a single `slugify()` helper
- `<link rel="canonical">` on every page pointing to its self-canonical
- Comparison pages: alphabetical canonical, redirect non-canonical orderings
- Institution pages with `?tier=` or `?district=` filters: canonical points to the bare URL
- `noindex` on filtered Market views; `index` on the canonical Market page only

## 3. Technical SEO checklist — Next.js 16 App Router

- **Server components by default.** Pages that need data should fetch in the RSC, not client-side. Eliminates hydration-dependent indexing risk.
- **Metadata API.** Each route exports `generateMetadata()` from its `page.tsx`. Title format: `"[Page Title] — Bank Fee Index"`. Description ≤155 chars, includes the primary keyword and a number.
- **`sitemap.ts`** — generate four sitemaps via the App Router's sitemap convention, indexed from `sitemap.xml`:
  - `sitemap-institutions.xml` (~4k URLs, chunked at 10k limit if needed)
  - `sitemap-categories.xml` (49 URLs)
  - `sitemap-comparisons.xml` (curated allowlist)
  - `sitemap-guides.xml`
  Set `lastModified` to the most recent verified fee date for that entity.
- **`robots.ts`** — allow all bots, disallow `/admin`, `/api/v1/`, `/_next/`, `/compare/*?` query strings.
- **Structured data** (JSON-LD in server components):
  - `Organization` (sitewide, in root layout)
  - `FinancialProduct` on institution pages
  - `Article` + `FAQPage` on guides
  - `BreadcrumbList` everywhere
  - `Dataset` on category pages (we publish data — claim the dataset markup)
- **Core Web Vitals targets.** LCP < 2.0s, INP < 200ms, CLS < 0.05. Tailwind v4 + Geist font swap + server components make this achievable without effort if we keep client JS minimal.
- **ISR strategy.** Institution and category pages: `revalidate = 86400` (daily). Comparison pages: on-demand revalidation triggered when either side's data changes. Guides: static. Trigger revalidation from Atlas/Darwin via `BFI_REVALIDATE_TOKEN`.
- **No JS-rendered content for indexable pages.** All primary content in the SSR/RSC payload. Client components only for interactive charts and filters, never for the headline data.
- **Image optimization.** Use `next/image` for any institution logos or chart exports; `priority` only on LCP image.

## 4. Content strategy

**Three pillars, mapped to the data:**
1. **Fee transparency** (institution + category programmatic pages — the moat)
2. **Consumer guidance** (how-to guides; the link bait)
3. **Industry intelligence** (Hamilton-derived editorial — the authority signal)

**Cadence:**
- Programmatic pages refresh whenever underlying data refreshes (automatic via ISR)
- 1 long-form guide per week for the first 6 months (24 total), then 2/month
- 1 monthly pulse post derived from Hamilton's monthly index movement report
- 1 quarterly state-of-bank-fees report (PR-worthy, gated for email capture)

**Hamilton report repurposing:** every Pro report Hamilton generates gets a redacted, anonymized public companion — the methodology and aggregate findings without subscriber-specific peer data. This compounds: Pro subscribers get the premium artifact, public gets the SEO-ranking summary, both link to each other.

## 5. First 90 days SEO plan

**Weeks 1–2 (post-cutover):** Technical foundation. Sitemaps, robots, metadata, structured data, GSC and Bing Webmaster Tools verified. Submit sitemaps. Index ~100 seed institution pages and all 49 category pages.

**Weeks 3–4:** Internal linking pass. Every institution page links to its category pages and its state page. Every category page links to top 10 institutions. Breadcrumbs everywhere. Publish 4 cornerstone guides (overdraft, NSF, wire transfers, monthly maintenance).

**Weeks 5–8:** Scale programmatic. Push institution coverage from 100 → 1,000 as Atlas/Darwin drain the backlog. Launch state pages (50). Launch curated comparison set (top 200 within-tier pairs). Publish 4 more guides.

**Weeks 9–12:** Authority + measurement. First quarterly report shipped as gated PDF + ungated HTML summary. HARO/Qwoted responses for any banking-fee journalist query (3–5/week). Outreach to 20 personal-finance bloggers with the data set as a free reference. First Search Console review: which programmatic pages are getting impressions but not clicks? Iterate titles and meta descriptions on the top 50.

**Targets by day 90:** 5,000+ pages indexed, 500+ ranking in top 100, first top-10 ranking on at least one institution-specific transactional query.

## 6. Backlink strategy

Realistic, prioritized:

1. **Data citation outreach.** Personal-finance journalists (NerdWallet, Bankrate, WSJ Personal Finance, Kiplinger) need stats. Email 50/quarter with the latest quarterly report and an offer to be a named source. Expect 3–5 high-DA backlinks per quarter.
2. **HARO / Qwoted / Help A B2B Writer.** James responds personally as "Founder, Bank Fee Index" to any query touching bank fees, credit union fees, or consumer banking trends. 1–2 placements per week is achievable.
3. **Original research as link bait.** Quarterly report. State-of-overdraft-fees annual. "Cheapest big bank for [category]" listicles based on our own data — these get re-cited because the data is verifiable.
4. **Partnership swaps.** Credit union leagues, state banking associations, financial-literacy nonprofits often link to data resources. 1 partnership per month.
5. **Skip:** paid link-building, guest post farms, PBNs, anything that smells like 2014. The data moat does the work.

Backlink target: DR 40 by month 12, DR 55 by month 24.

## 7. Tooling stack

**Use:**
- **Google Search Console** — non-negotiable. Index coverage, query data, Core Web Vitals.
- **Bing Webmaster Tools** — free, 5% of search, takes an hour to set up.
- **Ahrefs** ($249/mo Standard plan) — pick one of Ahrefs or Semrush; Ahrefs has the better backlink index. Use it for rank tracking (start with 200 tracked keywords), competitor backlink monitoring, content-gap analysis.
- **Plausible Analytics** — already in v1 stack. Keep it. GA4 is overkill and a privacy liability.
- **Schema.org validator + Rich Results Test** — every template tested before launch.
- **Sitebulb** ($35/mo) — quarterly technical crawl. Catches the issues GSC won't surface.

**Skip:**
- Semrush (Ahrefs covers it)
- Moz (legacy)
- Surfer SEO / Clearscope (content optimization tools — we have data, not blog spam)
- Paid rank trackers beyond Ahrefs' built-in
- Any "AI SEO writer" — Hamilton is already our AI writer and his output is grounded; generic AI content hurts more than helps

**Monthly tooling spend at maturity:** ~$300. Negligible against the data-collection cost we're already absorbing.

---

— SEO Analyst
