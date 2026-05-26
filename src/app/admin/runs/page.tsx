import Link from "next/link";
import { sql } from "@/lib/db";
import { formatCount, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = {
  run_id: string;
  agent: string;
  target_state: string | null;
  status: string;
  items_processed: number;
  items_failed: number;
  cost_cents: number;
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
};

const AGENTS = ["magellan", "atlas", "darwin", "knox", "hamilton"];
const STATUSES = ["started", "in_progress", "succeeded", "failed", "skipped"];

async function getRuns(opts: { agent?: string; status?: string }): Promise<Row[]> {
  type DBRow = {
    run_id: string;
    agent: string;
    target_state: string | null;
    status: string;
    items_processed: number;
    items_failed: number;
    cost_cents: number;
    started_at: string;
    ended_at: string | null;
    duration_sec: string | null;
  };
  let where = sql`started_at > now() - interval '30 days'`;
  if (opts.agent && AGENTS.includes(opts.agent)) {
    where = sql`${where} AND agent = ${opts.agent}`;
  }
  if (opts.status && STATUSES.includes(opts.status)) {
    where = sql`${where} AND status = ${opts.status}`;
  }
  try {
    const rows = await sql<DBRow[]>`
      SELECT run_id, agent, target_state, status,
             items_processed, items_failed, cost_cents,
             started_at::text AS started_at,
             ended_at::text   AS ended_at,
             EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))::text AS duration_sec
      FROM agent_runs
      WHERE ${where}
      ORDER BY started_at DESC
      LIMIT 300
    `;
    return rows.map((r) => ({
      ...r,
      duration_sec: r.duration_sec ? Number(r.duration_sec) : null,
    }));
  } catch {
    return [];
  }
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 1) return "<1s";
  if (sec < 60) return `${sec.toFixed(0)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatCostCents(c: number): string {
  if (!c) return "$0.00";
  return `$${(c / 100).toFixed(2)}`;
}

export default async function AdminRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const rows = await getRuns({ agent: sp.agent, status: sp.status });

  return (
    <main className="px-10 py-10 max-w-[1500px] mx-auto space-y-8">
      <header>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
          Observability
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Run history</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-2 max-w-2xl">
          Every agent run from the last 30 days. Click a row to inspect events and
          payloads.
        </p>
      </header>

      <form className="flex flex-wrap items-center gap-3" method="GET" action="/admin/runs">
        <select
          name="agent"
          defaultValue={sp.agent ?? ""}
          className="bg-[var(--color-admin-elev)] border border-[var(--color-admin-border)] rounded px-3 py-1.5 text-sm"
        >
          <option value="">All agents</option>
          {AGENTS.map((a) => (<option key={a} value={a}>{a}</option>))}
        </select>
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          className="bg-[var(--color-admin-elev)] border border-[var(--color-admin-border)] rounded px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <button
          type="submit"
          className="bg-[var(--color-accent,#d97706)] text-white px-4 py-1.5 text-sm font-semibold rounded"
        >
          Filter
        </button>
        {(sp.agent || sp.status) && (
          <Link
            href="/admin/runs"
            className="text-xs text-[var(--color-admin-text-muted)] hover:underline"
          >
            Clear
          </Link>
        )}
        <div className="ml-auto text-xs text-[var(--color-admin-text-dim)]">
          {formatCount(rows.length)} runs shown
        </div>
      </form>

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-admin-surface-2)]">
            <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
              <th className="px-4 py-2.5 text-left font-semibold">Agent</th>
              <th className="px-4 py-2.5 text-left font-semibold">State</th>
              <th className="px-4 py-2.5 text-left font-semibold">Status</th>
              <th className="px-4 py-2.5 text-right font-semibold">Processed</th>
              <th className="px-4 py-2.5 text-right font-semibold">Failed</th>
              <th className="px-4 py-2.5 text-right font-semibold">Cost</th>
              <th className="px-4 py-2.5 text-left font-semibold">Started</th>
              <th className="px-4 py-2.5 text-right font-semibold">Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--color-admin-text-dim)] text-sm">
                  No runs in this window.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.run_id}
                  className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
                >
                  <td className="px-4 py-2.5 capitalize">
                    <Link href={`/admin/runs/${r.run_id}`} className="font-medium hover:underline">
                      {r.agent}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {r.target_state ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(r.items_processed)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r.items_failed > 0 ? (
                      <span className="text-rose-400">{r.items_failed}</span>
                    ) : (
                      <span className="text-[var(--color-admin-text-dim)]">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCostCents(r.cost_cents)}</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-admin-text-muted)]">{timeAgo(r.started_at)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">{formatDuration(r.duration_sec)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: string }): React.ReactElement {
  const palette: Record<string, string> = {
    started: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    in_progress: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    succeeded: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    failed: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    skipped: "bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-dim)] border-[var(--color-admin-border)]",
  };
  const cls =
    palette[status] ?? "bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)] border-[var(--color-admin-border)]";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}
