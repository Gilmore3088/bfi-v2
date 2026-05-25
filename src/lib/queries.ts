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
