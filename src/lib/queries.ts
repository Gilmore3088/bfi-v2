import { sql } from "@/lib/db";
import { slugify } from "@/lib/slug";

/**
 * Public-site DB queries. Read-only. Every function tolerates empty
 * coverage gracefully (returns null or [] instead of throwing) because
 * most institutions in v2 launch with no verified fee data yet.
 *
 * Slugs: institutions has no slug column. We derive a slug from name at
 * query time. To resolve a slug we fetch a candidate set by state or
 * fuzzy filter and match in TypeScript. Cheaper than scanning 4k rows
 * once we index by state; acceptable for v2 scaffold.
 */

export type InstitutionRow = {
  id: number;
  name: string;
  state_code: string;
  charter_type: "bank" | "credit_union";
  asset_size: number | null;
  asset_size_tier: string | null;
  fed_district: number | null;
  city: string | null;
  website_url: string | null;
};

export type VerifiedFee = {
  id: number;
  fee_category: string;
  fee_name: string | null;
  amount: number | null;
  frequency: string | null;
  conditions: string | null;
  confidence: number | null;
  reviewed_at: string | null;
  created_at: string;
};

export type CategoryStat = {
  category: string;
  median: number | null;
  p25: number | null;
  p75: number | null;
  count: number;
};

export type InstitutionDetail = {
  institution: InstitutionRow;
  fees: VerifiedFee[];
  lastVerifiedAt: string | null;
};

/**
 * Resolve a slug to an institution row. Returns null if no match.
 * Charter-scoped via the `charter` arg so /banks/foo doesn't collide
 * with /credit-unions/foo.
 */
export async function getInstitutionBySlug(
  slug: string,
  charter: "bank" | "credit_union",
): Promise<InstitutionDetail | null> {
  let rows: InstitutionRow[];
  try {
    rows = await sql<InstitutionRow[]>`
      SELECT id, name, state_code, charter_type, asset_size, asset_size_tier,
             fed_district, city, website_url
      FROM institutions
      WHERE charter_type = ${charter}
      ORDER BY asset_size DESC NULLS LAST
      LIMIT 5000
    `;
  } catch {
    return null;
  }
  const match = rows.find((r) => slugify(r.name) === slug);
  if (!match) return null;

  let fees: VerifiedFee[] = [];
  try {
    fees = await sql<VerifiedFee[]>`
    SELECT id, fee_category, fee_name, amount, frequency, conditions,
           confidence, reviewed_at, created_at
    FROM fees_verified
    WHERE institution_id = ${match.id}
      AND superseded_by IS NULL
      AND review_status IN ('approved', 'auto_approved')
    ORDER BY fee_category ASC
  `;
  } catch {
    fees = [];
  }

  const lastVerifiedAt = fees.reduce<string | null>((acc, f) => {
    const t = f.reviewed_at ?? f.created_at;
    if (!acc) return t;
    return new Date(t) > new Date(acc) ? t : acc;
  }, null);

  return { institution: match, fees, lastVerifiedAt };
}

/**
 * Distribution stats and notable institutions for a fee category.
 * Returns null when there is no verified data for the category.
 */
export async function getCategoryFees(category: string): Promise<{
  category: string;
  displayName: string;
  family: string;
  description: string | null;
  stats: CategoryStat | null;
  topInstitutions: Array<{ id: number; name: string; charter_type: string; amount: number }>;
  bottomInstitutions: Array<{ id: number; name: string; charter_type: string; amount: number }>;
} | null> {
  let taxonomy: { category: string; family: string; display_name: string; description: string | null }[];
  try {
    taxonomy = await sql<
      { category: string; family: string; display_name: string; description: string | null }[]
    >`
      SELECT category, family, display_name, description
      FROM taxonomy
      WHERE category = ${category}
      LIMIT 1
    `;
  } catch {
    return null;
  }
  if (taxonomy.length === 0) return null;

  let statsRows: { median: string | null; p25: string | null; p75: string | null; count: string }[] = [];
  try {
    statsRows = await sql<
      { median: string | null; p25: string | null; p75: string | null; count: string }[]
    >`
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)::text  AS median,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY amount)::text AS p25,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY amount)::text AS p75,
        COUNT(*)::text AS count
      FROM fees_verified
      WHERE fee_category = ${category}
        AND superseded_by IS NULL
        AND review_status IN ('approved', 'auto_approved')
        AND amount IS NOT NULL
    `;
  } catch {
    statsRows = [];
  }

  const statRow = statsRows[0];
  const count = Number(statRow?.count ?? 0);
  const stats: CategoryStat | null =
    count > 0
      ? {
          category,
          median: statRow?.median ? Number(statRow.median) : null,
          p25: statRow?.p25 ? Number(statRow.p25) : null,
          p75: statRow?.p75 ? Number(statRow.p75) : null,
          count,
        }
      : null;

  let extremes: { id: number; name: string; charter_type: string; amount: string }[] = [];
  let lows: { id: number; name: string; charter_type: string; amount: string }[] = [];
  try {
    extremes = await sql<
      { id: number; name: string; charter_type: string; amount: string }[]
    >`
      SELECT i.id, i.name, i.charter_type, fv.amount::text AS amount
      FROM fees_verified fv
      JOIN institutions i ON i.id = fv.institution_id
      WHERE fv.fee_category = ${category}
        AND fv.superseded_by IS NULL
        AND fv.review_status IN ('approved', 'auto_approved')
        AND fv.amount IS NOT NULL
      ORDER BY fv.amount DESC
      LIMIT 10
    `;
    lows = await sql<
      { id: number; name: string; charter_type: string; amount: string }[]
    >`
      SELECT i.id, i.name, i.charter_type, fv.amount::text AS amount
      FROM fees_verified fv
      JOIN institutions i ON i.id = fv.institution_id
      WHERE fv.fee_category = ${category}
        AND fv.superseded_by IS NULL
        AND fv.review_status IN ('approved', 'auto_approved')
        AND fv.amount IS NOT NULL
      ORDER BY fv.amount ASC
      LIMIT 10
    `;
  } catch {
    /* leave empty */
  }

  const t = taxonomy[0];
  return {
    category,
    displayName: t.display_name,
    family: t.family,
    description: t.description,
    stats,
    topInstitutions: extremes.map((r) => ({ ...r, amount: Number(r.amount) })),
    bottomInstitutions: lows.map((r) => ({ ...r, amount: Number(r.amount) })),
  };
}

/**
 * All institutions in a state, ordered by asset size. Used to render
 * state listing pages and as an SEO internal-link hub.
 */
export async function getStateInstitutions(stateAbbr: string): Promise<
  Array<InstitutionRow & { feeCount: number }>
> {
  const abbr = stateAbbr.toUpperCase();
  let rows: (InstitutionRow & { fee_count: string })[];
  try {
    rows = await sql<
    (InstitutionRow & { fee_count: string })[]
  >`
    SELECT i.id, i.name, i.state_code, i.charter_type, i.asset_size,
           i.asset_size_tier, i.fed_district, i.city, i.website_url,
           COALESCE((
             SELECT COUNT(*)::text FROM fees_verified fv
             WHERE fv.institution_id = i.id
               AND fv.superseded_by IS NULL
               AND fv.review_status IN ('approved', 'auto_approved')
           ), '0') AS fee_count
    FROM institutions i
    WHERE i.state_code = ${abbr}
    ORDER BY i.asset_size DESC NULLS LAST
    LIMIT 500
  `;
  } catch {
    return [];
  }
  return rows.map((r) => ({ ...r, feeCount: Number(r.fee_count) }));
}

/**
 * Light-weight sitewide counts for the homepage. Honest about coverage:
 * we report verified institutions (those with >=1 approved fee) AND the
 * total institution roster, so the hero can show both.
 */
export async function getSiteCounts(): Promise<{
  totalInstitutions: number;
  verifiedInstitutions: number;
  totalFees: number;
  categories: number;
}> {
  let rows: {
    total_institutions: string;
    verified_institutions: string;
    total_fees: string;
    categories: string;
  }[];
  try {
    rows = await sql<
    {
      total_institutions: string;
      verified_institutions: string;
      total_fees: string;
      categories: string;
    }[]
  >`
    SELECT
      (SELECT COUNT(*)::text FROM institutions) AS total_institutions,
      (SELECT COUNT(DISTINCT institution_id)::text FROM fees_verified
        WHERE superseded_by IS NULL
          AND review_status IN ('approved', 'auto_approved')) AS verified_institutions,
      (SELECT COUNT(*)::text FROM fees_verified
        WHERE superseded_by IS NULL
          AND review_status IN ('approved', 'auto_approved')) AS total_fees,
      (SELECT COUNT(*)::text FROM taxonomy) AS categories
  `;
  } catch {
    rows = [];
  }
  const r = rows[0];
  return {
    totalInstitutions: Number(r?.total_institutions ?? 0),
    verifiedInstitutions: Number(r?.verified_institutions ?? 0),
    totalFees: Number(r?.total_fees ?? 0),
    categories: Number(r?.categories ?? 0),
  };
}

/**
 * All categories with verified data, plus median. Used on /methodology
 * and the homepage category strip.
 */
export async function getCategorySnapshot(): Promise<
  Array<{
    category: string;
    displayName: string;
    family: string;
    tier: string;
    median: number | null;
    count: number;
  }>
> {
  let rows: {
    category: string;
    display_name: string;
    family: string;
    tier: string;
    median: string | null;
    count: string;
  }[];
  try {
    rows = await sql<
    {
      category: string;
      display_name: string;
      family: string;
      tier: string;
      median: string | null;
      count: string;
    }[]
  >`
    SELECT
      t.category,
      t.display_name,
      t.family,
      t.tier,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)::text
         FROM fees_verified fv
         WHERE fv.fee_category = t.category
           AND fv.superseded_by IS NULL
           AND fv.review_status IN ('approved', 'auto_approved')
           AND fv.amount IS NOT NULL) AS median,
      (SELECT COUNT(*)::text FROM fees_verified fv
         WHERE fv.fee_category = t.category
           AND fv.superseded_by IS NULL
           AND fv.review_status IN ('approved', 'auto_approved')) AS count
    FROM taxonomy t
    ORDER BY t.tier ASC, t.display_name ASC
  `;
  } catch {
    return [];
  }
  return rows.map((r) => ({
    category: r.category,
    displayName: r.display_name,
    family: r.family,
    tier: r.tier,
    median: r.median ? Number(r.median) : null,
    count: Number(r.count),
  }));
}

/**
 * Recent institutions added to the verified set. Powers the "latest
 * coverage" strip on the home page.
 */
export async function getRecentInstitutions(limit = 8): Promise<
  Array<{ id: number; name: string; charter_type: string; state_code: string }>
> {
  try {
    return await sql<
      { id: number; name: string; charter_type: string; state_code: string }[]
    >`
      SELECT DISTINCT ON (i.id) i.id, i.name, i.charter_type, i.state_code
      FROM fees_verified fv
      JOIN institutions i ON i.id = fv.institution_id
      WHERE fv.superseded_by IS NULL
        AND fv.review_status IN ('approved', 'auto_approved')
      ORDER BY i.id, fv.created_at DESC
      LIMIT ${limit}
    `;
  } catch {
    return [];
  }
}

/**
 * For sitemap generation. Returns charter, slug, and last-verified date.
 */
export async function getSitemapInstitutions(): Promise<
  Array<{ slug: string; charter: string; lastModified: Date }>
> {
  try {
    const rows = await sql<
      { id: number; name: string; charter_type: string; updated_at: string }[]
    >`
      SELECT id, name, charter_type, updated_at
      FROM institutions
      ORDER BY asset_size DESC NULLS LAST
      LIMIT 5000
    `;
    return rows.map((r) => ({
      slug: slugify(r.name),
      charter: r.charter_type,
      lastModified: new Date(r.updated_at),
    }));
  } catch {
    return [];
  }
}

/**
 * For sitemap generation. Returns categories.
 */
export async function getSitemapCategories(): Promise<Array<{ category: string }>> {
  try {
    return await sql<{ category: string }[]>`
      SELECT category FROM taxonomy ORDER BY category ASC
    `;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Admin queries
// ---------------------------------------------------------------------------

export const AGENT_NAMES = ["magellan", "atlas", "darwin", "knox", "hamilton"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export type AgentFleetStatus = {
  agent: AgentName;
  last_run_at: string | null;
  last_status: string | null;
  runs_30d: number;
  successes_30d: number;
  failures_30d: number;
  success_rate: number | null;
  items_processed_30d: number;
  cost_cents_30d: number;
};

/**
 * Per-agent fleet status: last run, success rate over 30 days. Always
 * returns one row per known agent — even if there are zero runs — so the
 * UI can render an empty state per agent without dropping rows.
 */
export async function getAgentFleetStatus(): Promise<AgentFleetStatus[]> {
  type Row = {
    agent: AgentName;
    last_run_at: string | null;
    last_status: string | null;
    runs_30d: string;
    successes_30d: string;
    failures_30d: string;
    items_processed_30d: string;
    cost_cents_30d: string;
  };
  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      WITH last_runs AS (
        SELECT DISTINCT ON (agent)
               agent, started_at AS last_run_at, status AS last_status
        FROM agent_runs
        ORDER BY agent, started_at DESC
      ),
      window_stats AS (
        SELECT
          agent,
          COUNT(*)::text                                                          AS runs_30d,
          COUNT(*) FILTER (WHERE status = 'succeeded')::text                      AS successes_30d,
          COUNT(*) FILTER (WHERE status = 'failed')::text                         AS failures_30d,
          COALESCE(SUM(items_processed), 0)::text                                 AS items_processed_30d,
          COALESCE(SUM(cost_cents), 0)::text                                      AS cost_cents_30d
        FROM agent_runs
        WHERE started_at > now() - interval '30 days'
        GROUP BY agent
      )
      SELECT
        a.agent::text AS agent,
        lr.last_run_at,
        lr.last_status,
        COALESCE(ws.runs_30d, '0')             AS runs_30d,
        COALESCE(ws.successes_30d, '0')        AS successes_30d,
        COALESCE(ws.failures_30d, '0')         AS failures_30d,
        COALESCE(ws.items_processed_30d, '0')  AS items_processed_30d,
        COALESCE(ws.cost_cents_30d, '0')       AS cost_cents_30d
      FROM unnest(ARRAY['magellan','atlas','darwin','knox','hamilton']) AS a(agent)
      LEFT JOIN last_runs   lr ON lr.agent = a.agent
      LEFT JOIN window_stats ws ON ws.agent = a.agent
      ORDER BY a.agent ASC
    `;
  } catch {
    rows = [];
  }

  const out: AgentFleetStatus[] = (
    rows.length > 0
      ? rows
      : AGENT_NAMES.map((agent) => ({
          agent,
          last_run_at: null,
          last_status: null,
          runs_30d: "0",
          successes_30d: "0",
          failures_30d: "0",
          items_processed_30d: "0",
          cost_cents_30d: "0",
        }))
  ).map((r) => {
    const runs = Number(r.runs_30d);
    const successes = Number(r.successes_30d);
    return {
      agent: r.agent,
      last_run_at: r.last_run_at,
      last_status: r.last_status,
      runs_30d: runs,
      successes_30d: successes,
      failures_30d: Number(r.failures_30d),
      success_rate: runs > 0 ? successes / runs : null,
      items_processed_30d: Number(r.items_processed_30d),
      cost_cents_30d: Number(r.cost_cents_30d),
    };
  });

  return out;
}

export type MarketIndexRow = {
  category: string;
  display_name: string;
  family: string;
  tier: string;
  institution_count: number;
  fee_count: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min_amount: number | null;
  max_amount: number | null;
};

/**
 * Per-category aggregate stats joining taxonomy with verified fees.
 * Always returns one row per taxonomy category so the table renders even
 * when fees_verified is empty.
 */
export async function getMarketIndex(): Promise<MarketIndexRow[]> {
  type Row = {
    category: string;
    display_name: string;
    family: string;
    tier: string;
    institution_count: string;
    fee_count: string;
    median: string | null;
    p25: string | null;
    p75: string | null;
    min_amount: string | null;
    max_amount: string | null;
  };
  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      SELECT
        t.category,
        t.display_name,
        t.family,
        t.tier,
        COALESCE((
          SELECT COUNT(DISTINCT fv.institution_id)::text
          FROM fees_verified fv
          WHERE fv.fee_category = t.category
            AND fv.superseded_by IS NULL
            AND fv.review_status IN ('approved', 'auto_approved')
        ), '0') AS institution_count,
        COALESCE((
          SELECT COUNT(*)::text
          FROM fees_verified fv
          WHERE fv.fee_category = t.category
            AND fv.superseded_by IS NULL
            AND fv.review_status IN ('approved', 'auto_approved')
        ), '0') AS fee_count,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)::text
           FROM fees_verified fv
           WHERE fv.fee_category = t.category
             AND fv.superseded_by IS NULL
             AND fv.review_status IN ('approved', 'auto_approved')
             AND fv.amount IS NOT NULL) AS median,
        (SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY amount)::text
           FROM fees_verified fv
           WHERE fv.fee_category = t.category
             AND fv.superseded_by IS NULL
             AND fv.review_status IN ('approved', 'auto_approved')
             AND fv.amount IS NOT NULL) AS p25,
        (SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY amount)::text
           FROM fees_verified fv
           WHERE fv.fee_category = t.category
             AND fv.superseded_by IS NULL
             AND fv.review_status IN ('approved', 'auto_approved')
             AND fv.amount IS NOT NULL) AS p75,
        (SELECT MIN(amount)::text FROM fees_verified fv
           WHERE fv.fee_category = t.category
             AND fv.superseded_by IS NULL
             AND fv.review_status IN ('approved', 'auto_approved')
             AND fv.amount IS NOT NULL) AS min_amount,
        (SELECT MAX(amount)::text FROM fees_verified fv
           WHERE fv.fee_category = t.category
             AND fv.superseded_by IS NULL
             AND fv.review_status IN ('approved', 'auto_approved')
             AND fv.amount IS NOT NULL) AS max_amount
      FROM taxonomy t
      ORDER BY t.tier ASC, t.family ASC, t.display_name ASC
    `;
  } catch {
    return [];
  }
  return rows.map((r) => ({
    category: r.category,
    display_name: r.display_name,
    family: r.family,
    tier: r.tier,
    institution_count: Number(r.institution_count),
    fee_count: Number(r.fee_count),
    median: r.median ? Number(r.median) : null,
    p25: r.p25 ? Number(r.p25) : null,
    p75: r.p75 ? Number(r.p75) : null,
    min_amount: r.min_amount ? Number(r.min_amount) : null,
    max_amount: r.max_amount ? Number(r.max_amount) : null,
  }));
}

export type ReviewQueueRow = {
  id: number;
  institution_id: number;
  institution_name: string;
  fee_category: string;
  fee_name: string | null;
  amount: number | null;
  confidence: number | null;
  review_status: string;
  created_at: string;
};

/**
 * Fees awaiting human review. pending + flagged, newest first.
 */
export async function getReviewQueue(limit = 50): Promise<ReviewQueueRow[]> {
  type Row = {
    id: number;
    institution_id: number;
    institution_name: string;
    fee_category: string;
    fee_name: string | null;
    amount: string | null;
    confidence: string | null;
    review_status: string;
    created_at: string;
  };
  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      SELECT fv.id, fv.institution_id, i.name AS institution_name,
             fv.fee_category, fv.fee_name,
             fv.amount::text AS amount,
             fv.confidence::text AS confidence,
             fv.review_status, fv.created_at
      FROM fees_verified fv
      JOIN institutions i ON i.id = fv.institution_id
      WHERE fv.superseded_by IS NULL
        AND fv.review_status IN ('pending', 'flagged')
      ORDER BY fv.created_at DESC
      LIMIT ${limit}
    `;
  } catch {
    return [];
  }
  return rows.map((r) => ({
    id: r.id,
    institution_id: r.institution_id,
    institution_name: r.institution_name,
    fee_category: r.fee_category,
    fee_name: r.fee_name,
    amount: r.amount ? Number(r.amount) : null,
    confidence: r.confidence ? Number(r.confidence) : null,
    review_status: r.review_status,
    created_at: r.created_at,
  }));
}

export type DataQualityTable = {
  table: string;
  row_count: number;
  last_write_at: string | null;
  populated_pct: number | null;
  note: string;
};

/**
 * Trust scorecard across the v2 tables that feed Hamilton + Market.
 * Reports row count, most-recent write, and a populated-percentage where
 * meaningful (e.g. fees_verified relative to fees_raw, institutions with
 * a website).
 */
export async function getDataQualitySnapshot(): Promise<DataQualityTable[]> {
  type CountRow = { count: string; last_write_at: string | null };

  async function probe(
    table: string,
    query: () => Promise<CountRow[]>,
    note: string,
    populatedPct: number | null = null,
  ): Promise<DataQualityTable> {
    try {
      const rows = await query();
      const r = rows[0];
      return {
        table,
        row_count: Number(r?.count ?? 0),
        last_write_at: r?.last_write_at ?? null,
        populated_pct: populatedPct,
        note,
      };
    } catch {
      return {
        table,
        row_count: 0,
        last_write_at: null,
        populated_pct: null,
        note: `${note} (table unreachable)`,
      };
    }
  }

  // institutions: % with website
  let instPct: number | null = null;
  try {
    const r = await sql<{ pct: string | null }[]>`
      SELECT (
        COUNT(*) FILTER (WHERE website_url IS NOT NULL AND website_url <> '')::float
        / NULLIF(COUNT(*), 0)
      )::text AS pct
      FROM institutions
    `;
    instPct = r[0]?.pct ? Number(r[0].pct) : null;
  } catch {
    instPct = null;
  }

  const [institutions, taxonomy, feesRaw, feesVerified, fedData, callReports, reports] =
    await Promise.all([
      probe(
        "institutions",
        () =>
          sql<CountRow[]>`SELECT COUNT(*)::text AS count, MAX(updated_at)::text AS last_write_at FROM institutions`,
        "seed roster of bank + credit union institutions",
        instPct,
      ),
      probe(
        "taxonomy",
        () =>
          sql<CountRow[]>`SELECT COUNT(*)::text AS count, NULL::text AS last_write_at FROM taxonomy`,
        "fee category reference set (49 expected)",
      ),
      probe(
        "fees_raw",
        () =>
          sql<CountRow[]>`SELECT COUNT(*)::text AS count, MAX(extracted_at)::text AS last_write_at FROM fees_raw`,
        "Atlas extractor output, pre-verification",
      ),
      probe(
        "fees_verified",
        () =>
          sql<CountRow[]>`SELECT COUNT(*)::text AS count, MAX(created_at)::text AS last_write_at FROM fees_verified`,
        "Darwin/Knox approved fees that drive the index",
      ),
      probe(
        "fed_data",
        () =>
          sql<CountRow[]>`SELECT COUNT(*)::text AS count, MAX(created_at)::text AS last_write_at FROM fed_data`,
        "Federal Reserve macro context (Beige Book, FRED)",
      ),
      probe(
        "call_reports",
        () =>
          sql<CountRow[]>`SELECT COUNT(*)::text AS count, MAX(created_at)::text AS last_write_at FROM call_reports`,
        "FFIEC quarterly call report ingest",
      ),
      probe(
        "reports",
        () =>
          sql<CountRow[]>`SELECT COUNT(*)::text AS count, MAX(created_at)::text AS last_write_at FROM reports`,
        "Hamilton output history",
      ),
    ]);

  return [institutions, taxonomy, feesRaw, feesVerified, fedData, callReports, reports];
}

export type LeadRow = {
  id: number;
  email: string;
  company: string | null;
  source: string | null;
  score: number;
  status: string;
  notes: string | null;
  created_at: string;
  last_touched_at: string | null;
};

export async function getRecentLeads(limit = 50): Promise<LeadRow[]> {
  try {
    return await sql<LeadRow[]>`
      SELECT id, email, company, source, score, status, notes,
             created_at, last_touched_at
      FROM leads
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } catch {
    return [];
  }
}

export type HamiltonReportRow = {
  id: string;
  kind: string;
  status: string;
  subject_institution_id: number | null;
  subject_institution_name: string | null;
  subject_category: string | null;
  cost_cents: number;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function getHamiltonReports(limit = 50): Promise<HamiltonReportRow[]> {
  type Row = {
    id: string;
    kind: string;
    status: string;
    subject_institution_id: number | null;
    subject_institution_name: string | null;
    subject_category: string | null;
    cost_cents: string;
    error: string | null;
    created_at: string;
    completed_at: string | null;
  };
  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      SELECT r.id, r.kind, r.status, r.subject_institution_id,
             i.name AS subject_institution_name,
             r.subject_category, r.cost_cents::text AS cost_cents,
             r.error, r.created_at, r.completed_at
      FROM reports r
      LEFT JOIN institutions i ON i.id = r.subject_institution_id
      ORDER BY r.created_at DESC
      LIMIT ${limit}
    `;
  } catch {
    return [];
  }
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    subject_institution_id: r.subject_institution_id,
    subject_institution_name: r.subject_institution_name,
    subject_category: r.subject_category,
    cost_cents: Number(r.cost_cents),
    error: r.error,
    created_at: r.created_at,
    completed_at: r.completed_at,
  }));
}
