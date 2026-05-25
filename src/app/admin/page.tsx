import { sql } from "@/lib/db";
import { formatCount } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Health =
  | { ok: true; institutions: number; feesVerified: number; urls: number; raw: number; latencyMs: number }
  | { ok: false; error: string };

type AgentRun = {
  agent: string;
  status: string;
  items_processed: number;
  started_at: string;
  ended_at: string | null;
};

async function loadHealth(): Promise<Health> {
  const start = Date.now();
  try {
    const [row] = await sql<{
      institutions: string;
      verified: string;
      urls: string;
      raw: string;
    }[]>`
      SELECT
        (SELECT COUNT(*)::text FROM institutions) AS institutions,
        (SELECT COUNT(*)::text FROM fees_verified) AS verified,
        (SELECT COUNT(*)::text FROM institution_urls WHERE is_active) AS urls,
        (SELECT COUNT(*)::text FROM fees_raw) AS raw
    `;
    return {
      ok: true,
      institutions: Number(row?.institutions ?? 0),
      feesVerified: Number(row?.verified ?? 0),
      urls: Number(row?.urls ?? 0),
      raw: Number(row?.raw ?? 0),
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function loadRecentRuns(): Promise<AgentRun[]> {
  try {
    const rows = await sql<AgentRun[]>`
      SELECT agent, status, items_processed,
             started_at::text AS started_at,
             ended_at::text AS ended_at
      FROM agent_runs ORDER BY started_at DESC LIMIT 8
    `;
    return rows;
  } catch {
    return [];
  }
}

export default async function AdminDashboard() {
  const health = await loadHealth();
  const runs = await loadRecentRuns();

  return (
    <main className="px-8 py-6 max-w-6xl">
      <header className="mb-8">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
          Operator command center
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
          Live state of the v2 vertical slice. Scaffold only — agent telemetry
          arrives with M1.
        </p>
      </header>

      {health.ok ? (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard
            label="Institutions"
            value={formatCount(health.institutions)}
            sub="v3 staging"
          />
          <StatCard
            label="Verified fees"
            value={formatCount(health.feesVerified)}
            sub="fees_verified"
          />
          <StatCard
            label="DB latency"
            value={`${health.latencyMs} ms`}
            sub="Postgres round-trip"
          />
        </section>
      ) : (
        <section className="admin-card p-5 mb-8 border-[var(--color-status-err)]/40">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-status-err)] mb-1">
            Database error
          </div>
          <div className="text-sm font-semibold mb-2">
            Could not reach Postgres.
          </div>
          <pre className="text-xs text-[var(--color-admin-text-muted)] whitespace-pre-wrap font-mono">
            {health.error}
          </pre>
          <p className="text-xs text-[var(--color-admin-text-dim)] mt-3">
            Check DATABASE_URL in .env.local.
          </p>
        </section>
      )}

      {health.ok && (
        <section className="admin-card p-5 mb-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-3">
            Pipeline depth
          </div>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)]">Institutions</div>
              <div className="text-lg font-bold tabular">{formatCount(health.institutions)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)]">Discovered URLs</div>
              <div className="text-lg font-bold tabular">{formatCount(health.urls)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)]">Raw schedules</div>
              <div className="text-lg font-bold tabular">{formatCount(health.raw)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)]">Verified fees</div>
              <div className="text-lg font-bold tabular">{formatCount(health.feesVerified)}</div>
            </div>
          </div>
        </section>
      )}

      <section className="admin-card p-5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-3">
          Recent agent runs
        </div>
        {runs.length === 0 ? (
          <div className="text-sm text-[var(--color-admin-text-muted)]">
            No agent activity yet. Run <code className="text-xs">python3 -m agents.magellan run --limit 22</code> from repo root to seed.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)] border-b border-[var(--color-admin-border)]">
                <th className="py-2">Agent</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Processed</th>
                <th className="py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => (
                <tr key={i} className="border-b border-[var(--color-admin-border)]/40 last:border-0">
                  <td className="py-2 font-medium">{r.agent}</td>
                  <td className="py-2">
                    <span className={
                      r.status === "succeeded" ? "text-[var(--color-status-ok)]" :
                      r.status === "failed" ? "text-[var(--color-status-err)]" :
                      "text-[var(--color-admin-text-muted)]"
                    }>{r.status}</span>
                  </td>
                  <td className="py-2 text-right tabular">{r.items_processed}</td>
                  <td className="py-2 text-[var(--color-admin-text-muted)] font-mono text-xs">{r.started_at.substring(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="admin-card p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold tabular">{value}</div>
      <div className="text-[11px] text-[var(--color-admin-text-dim)] mt-1 font-mono">
        {sub}
      </div>
    </div>
  );
}
