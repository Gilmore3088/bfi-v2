import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/taxonomy/unmapped-count
 *
 * Lightweight count for the sidebar badge. Counts live unmapped fees that
 * still need curation (not approved/rejected).
 */
export async function GET(): Promise<Response> {
  try {
    const [r] = await sql<{ c: string }[]>`
      SELECT COUNT(*)::text AS c
      FROM fees_verified
      WHERE fee_category = '_unmapped'
        AND superseded_by IS NULL
        AND review_status NOT IN ('approved', 'rejected')
    `;
    return Response.json({ unmapped: Number(r?.c ?? 0) });
  } catch (e) {
    return Response.json(
      { unmapped: 0, error: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
}
