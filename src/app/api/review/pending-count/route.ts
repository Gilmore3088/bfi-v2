import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/review/pending-count
 *
 * Lightweight count for the sidebar badge. Counts fees_verified rows that
 * are non-superseded and still need human attention (pending + flagged).
 */
export async function GET(): Promise<Response> {
  try {
    const [r] = await sql<{ c: string }[]>`
      SELECT COUNT(*)::text AS c
      FROM fees_verified
      WHERE superseded_by IS NULL
        AND review_status IN ('pending', 'flagged')
    `;
    return Response.json({ pending: Number(r?.c ?? 0) });
  } catch (e) {
    return Response.json(
      { pending: 0, error: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
}
