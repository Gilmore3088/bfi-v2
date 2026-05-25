import { sql } from "@/lib/db";
import { formatCount } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Health =
  | { ok: true; institutions: number; feesVerified: number; latencyMs: number }
  | { ok: false; error: string };

async function loadHealth(): Promise<Health> {
  const start = Date.now();
  try {
    const [institutionsRow, feesRow] = await Promise.all([
      sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM institutions`,
      sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM fees_verified`,
    ]);
    return {
      ok: true,
      institutions: Number(institutionsRow[0]?.count ?? 0),
      feesVerified: Number(feesRow[0]?.count ?? 0),
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function AdminDashboard() {
  const health = await loadHealth();

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

      <section className="admin-card p-5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-2">
          Next up
        </div>
        <ul className="text-sm space-y-1.5 text-[var(--color-admin-text-muted)]">
          <li>· Wire Market page against fees_verified + taxonomy</li>
          <li>· Stand up Magellan + Atlas on the 22 seed institutions</li>
          <li>· First Hamilton report against verified data</li>
        </ul>
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
