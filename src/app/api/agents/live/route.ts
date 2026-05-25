import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActiveRun = {
  run_id: string;
  agent: string;
  started_at: string;
  target_state: string | null;
  events_succeeded: number;
  events_skipped: number;
  events_failed: number;
};

type RecentEvent = {
  created_at: string;
  agent: string;
  status: string;
  institution_name: string | null;
  found_url: string | null;
  confidence: number | null;
};

export async function GET() {
  try {
    const active = await sql<ActiveRun[]>`
      SELECT
        ar.run_id,
        ar.agent,
        ar.started_at::text AS started_at,
        ar.target_state,
        COALESCE(SUM(CASE WHEN ae.status='succeeded' THEN 1 ELSE 0 END), 0)::int AS events_succeeded,
        COALESCE(SUM(CASE WHEN ae.status='skipped'   THEN 1 ELSE 0 END), 0)::int AS events_skipped,
        COALESCE(SUM(CASE WHEN ae.status='failed'    THEN 1 ELSE 0 END), 0)::int AS events_failed
      FROM agent_runs ar
      LEFT JOIN agent_events ae ON ae.run_id = ar.run_id
      WHERE ar.status='in_progress'
      GROUP BY ar.run_id, ar.agent, ar.started_at, ar.target_state
      ORDER BY ar.started_at DESC
      LIMIT 5
    `;

    const recent = await sql<RecentEvent[]>`
      SELECT
        ae.created_at::text AS created_at,
        ae.agent,
        ae.status,
        ae.payload->>'institution_name' AS institution_name,
        ae.payload->>'found_url' AS found_url,
        (ae.payload->>'confidence')::numeric AS confidence
      FROM agent_events ae
      WHERE ae.agent IN ('magellan','atlas','darwin','knox','hamilton')
      ORDER BY ae.created_at DESC
      LIMIT 30
    `;

    return Response.json({ active, recent, ts: Date.now() });
  } catch (e: unknown) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
