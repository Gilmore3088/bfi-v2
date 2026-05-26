import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { formatCount, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunDetail = {
  run_id: string;
  agent: string;
  target_state: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  items_processed: number;
  items_failed: number;
  cost_cents: number;
  trigger_source: string | null;
  error: string | null;
};

type EventRow = {
  id: number;
  status: string;
  created_at: string;
  payload: Record<string, unknown> | null;
  error: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getRun(runId: string): Promise<RunDetail | null> {
  try {
    const rows = await sql<RunDetail[]>`
      SELECT run_id, agent, target_state, status,
             started_at::text AS started_at,
             ended_at::text   AS ended_at,
             items_processed, items_failed, cost_cents,
             trigger_source, error
      FROM agent_runs WHERE run_id = ${runId} LIMIT 1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function getEvents(runId: string): Promise<EventRow[]> {
  try {
    return await sql<EventRow[]>`
      SELECT id, status, created_at::text AS created_at, payload, error
      FROM agent_events WHERE run_id = ${runId}
      ORDER BY created_at DESC
      LIMIT 500
    `;
  } catch {
    return [];
  }
}

async function getPatternStats(runId: string, agent: string): Promise<{ key: string; count: number; ok: number }[]> {
  if (agent !== "magellan") return [];
  try {
    const rows = await sql<{ key: string; count: string; ok: string }[]>`
      SELECT
        COALESCE(payload->>'pattern_key', payload->>'key', '(unknown)') AS key,
        COUNT(*)::text AS count,
        COUNT(*) FILTER (WHERE status = 'succeeded')::text AS ok
      FROM agent_events
      WHERE run_id = ${runId} AND agent = 'magellan'
      GROUP BY key
      ORDER BY count DESC
      LIMIT 20
    `;
    return rows.map((r) => ({
      key: r.key,
      count: Number(r.count),
      ok: Number(r.ok),
    }));
  } catch {
    return [];
  }
}

async function getDarwinCosts(runId: string, agent: string): Promise<{ raw_id: string; cost: number; fees: number }[]> {
  if (agent !== "darwin") return [];
  try {
    const rows = await sql<{ raw_id: string; cost: string; fees: string }[]>`
      SELECT
        COALESCE(payload->>'fees_raw_id', '(unknown)') AS raw_id,
        COALESCE(SUM((payload->>'cost_cents')::int), 0)::text AS cost,
        COUNT(*)::text AS fees
      FROM agent_events
      WHERE run_id = ${runId} AND agent = 'darwin'
      GROUP BY raw_id
      ORDER BY cost DESC
      LIMIT 20
    `;
    return rows.map((r) => ({
      raw_id: r.raw_id,
      cost: Number(r.cost),
      fees: Number(r.fees),
    }));
  } catch {
    return [];
  }
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const sec = (end - start) / 1000;
  if (sec < 1) return "<1s";
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  if (!UUID_RE.test(runId)) notFound();

  const run = await getRun(runId);
  if (!run) notFound();

  const [events, patterns, costs] = await Promise.all([
    getEvents(runId),
    getPatternStats(runId, run.agent),
    getDarwinCosts(runId, run.agent),
  ]);

  return (
    <main className="px-10 py-10 max-w-[1500px] mx-auto space-y-8">
      <header>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
          <Link href="/admin/runs" className="hover:underline">Admin / Runs</Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight capitalize">
          {run.agent}
          {run.target_state && (
            <span className="ml-3 text-base font-mono text-[var(--color-admin-text-muted)]">
              {run.target_state}
            </span>
          )}
        </h1>
        <p className="text-xs text-[var(--color-admin-text-dim)] font-mono mt-1 break-all">
          {run.run_id}
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Status" value={run.status.replace("_", " ")} />
        <Stat label="Processed" value={formatCount(run.items_processed)} />
        <Stat label="Failed" value={formatCount(run.items_failed)} tone={run.items_failed > 0 ? "rose" : "neutral"} />
        <Stat label="Cost" value={`$${(run.cost_cents / 100).toFixed(2)}`} />
        <Stat label="Duration" value={formatDuration(run.started_at, run.ended_at)} />
      </section>

      {run.error && (
        <section className="admin-card p-4 border border-rose-500/30">
          <div className="text-[10px] uppercase tracking-[0.18em] text-rose-400 font-semibold mb-2">
            Error
          </div>
          <pre className="text-xs font-mono text-rose-300 whitespace-pre-wrap">{run.error}</pre>
        </section>
      )}

      {patterns.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold tracking-tight mb-3">
            Top patterns (Magellan)
          </h2>
          <div className="admin-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-admin-surface-2)]">
                <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                  <th className="px-4 py-2.5 text-left font-semibold">Pattern key</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Attempts</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Hits</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Success rate</th>
                </tr>
              </thead>
              <tbody>
                {patterns.map((p, i) => (
                  <tr key={i} className="border-t border-[var(--color-admin-border)]">
                    <td className="px-4 py-2 font-mono text-xs break-all">{p.key}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.count}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.ok}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.count > 0 ? `${((p.ok / p.count) * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {costs.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold tracking-tight mb-3">
            Cost breakdown by raw doc (Darwin)
          </h2>
          <div className="admin-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-admin-surface-2)]">
                <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                  <th className="px-4 py-2.5 text-left font-semibold">fees_raw_id</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Events</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Cost (cents)</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((c, i) => (
                  <tr key={i} className="border-t border-[var(--color-admin-border)]">
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/raw/${c.raw_id}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {c.raw_id}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.fees}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold tracking-tight mb-3">
          Events ({events.length})
        </h2>
        {events.length === 0 ? (
          <div className="admin-card p-5 border-dashed">
            <p className="text-xs text-[var(--color-admin-text-muted)]">
              This run has no recorded events yet.
            </p>
          </div>
        ) : (
          <div className="admin-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-admin-surface-2)]">
                <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                  <th className="px-4 py-2.5 text-left font-semibold w-32">Status</th>
                  <th className="px-4 py-2.5 text-left font-semibold w-40">When</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Payload</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    className="border-t border-[var(--color-admin-border)] align-top"
                  >
                    <td className="px-4 py-2 capitalize text-xs">
                      <span className="font-mono">{e.status}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--color-admin-text-muted)]">
                      {timeAgo(e.created_at)}
                    </td>
                    <td className="px-4 py-2">
                      {e.error && (
                        <div className="text-[11px] text-rose-400 font-mono mb-1 whitespace-pre-wrap">
                          {e.error}
                        </div>
                      )}
                      {e.payload && (
                        <pre className="text-[10px] font-mono text-[var(--color-admin-text-muted)] whitespace-pre-wrap break-all max-w-[920px]">
                          {JSON.stringify(e.payload, null, 0)}
                        </pre>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({
  label, value, tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "rose";
}): React.ReactElement {
  const cls = tone === "rose" ? "text-rose-400" : "";
  return (
    <div className="admin-card p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
