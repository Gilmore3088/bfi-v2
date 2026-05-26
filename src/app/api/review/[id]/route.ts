import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["approve", "reject"]);
const REVIEWER_DEFAULT = "admin";

type Body = { action?: string; note?: string; reviewer?: string };

/**
 * POST /api/review/[id]
 *
 * Body: { action: 'approve' | 'reject', note?: string, reviewer?: string }
 *
 * Sets fees_verified.review_status accordingly and stamps reviewed_by /
 * reviewed_at. Also writes an agent_events row tagged as a manual review
 * so the action appears on /admin/runs and the live activity feed.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json(
      { status: "error", message: "invalid id" },
      { status: 400 },
    );
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const action = String(body.action || "").toLowerCase();
  if (!ACTIONS.has(action)) {
    return NextResponse.json(
      { status: "error", message: "action must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  const reviewer = (body.reviewer || REVIEWER_DEFAULT).slice(0, 64);
  const note = body.note ? String(body.note).slice(0, 2000) : null;
  const newStatus = action === "approve" ? "approved" : "rejected";

  try {
    const updated = await sql<{ id: number; institution_id: number; fee_category: string }[]>`
      UPDATE fees_verified
         SET review_status = ${newStatus},
             reviewed_by   = ${reviewer},
             reviewed_at   = now()
       WHERE id = ${id}
       RETURNING id, institution_id, fee_category
    `;
    if (updated.length === 0) {
      return NextResponse.json(
        { status: "error", message: "fee not found" },
        { status: 404 },
      );
    }
    const fee = updated[0];

    // Create a one-row agent_run + event so reviews show up in run history.
    // agent_events.agent CHECK constraint only allows the 5 pipeline agents;
    // we attribute manual review to 'knox' since Knox owns the review domain.
    const runRows = await sql<{ run_id: string }[]>`
      INSERT INTO agent_runs (agent, status, trigger_source, ended_at, items_processed)
      VALUES ('knox', 'succeeded', 'manual', now(), 1)
      RETURNING run_id
    `;
    const runId = runRows[0]?.run_id;
    if (runId) {
      const payload = {
        kind: "review",
        reviewer,
        action,
        note,
        fees_verified_id: fee.id,
        institution_id: fee.institution_id,
        fee_category: fee.fee_category,
      };
      await sql`
        INSERT INTO agent_events (agent, run_id, status, payload, created_at)
        VALUES ('knox', ${runId}, 'succeeded', ${sql.json(payload)}, now())
      `;
    }

    return NextResponse.json({ status: "ok", id: fee.id, review_status: newStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : "review failed";
    return NextResponse.json(
      { status: "error", message },
      { status: 500 },
    );
  }
}
