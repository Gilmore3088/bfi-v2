import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { agentProcs } from "@/lib/agent-procs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_AGENTS = new Set([
  "ingest", "magellan", "atlas", "darwin", "knox", "hamilton",
]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const agent = String(body.agent || "").toLowerCase();

  if (!VALID_AGENTS.has(agent)) {
    return Response.json(
      { error: `agent must be one of: ${[...VALID_AGENTS].join(", ")}` },
      { status: 400 },
    );
  }

  const proc = agentProcs().get(agent);
  let killed = false;
  if (proc) {
    try {
      proc.kill("SIGTERM");
      killed = true;
    } catch {
      // proc may already be dead
    }
    agentProcs().delete(agent);
  }

  // Mark any in_progress agent_runs row as failed so the dashboard updates
  let dbMarked = 0;
  if (agent !== "ingest") {
    const r = await sql<{ run_id: string }[]>`
      UPDATE agent_runs
      SET status='failed', ended_at=now(), error='canceled by user'
      WHERE agent=${agent} AND status='in_progress'
      RETURNING run_id
    `;
    dbMarked = r.length;
  }

  return Response.json({
    agent,
    process_killed: killed,
    runs_marked_failed: dbMarked,
  });
}
