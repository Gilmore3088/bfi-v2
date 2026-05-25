import { getDataQualitySnapshot } from "@/lib/queries";
import { formatCount, formatPct, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminDataQualityPage() {
  const snapshot = await getDataQualitySnapshot();
  const populated = snapshot.filter((s) => s.row_count > 0).length;
  const totalRows = snapshot.reduce((s, t) => s + t.row_count, 0);
  const mostRecent = snapshot
    .map((s) => s.last_write_at)
    .filter((d): d is string => !!d)
    .sort()
    .pop();

  return (
    <main className="px-8 py-6 max-w-7xl">
      <header className="mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
          Admin / Data Quality
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Data Quality</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
          Trust scorecard across the seven v2 tables that feed Hamilton and the
          Market Index. Row counts, last-write timestamps, and a populated
          percentage where one applies.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Tables tracked"
          value={`${populated} / ${snapshot.length}`}
          sub="with at least 1 row"
        />
        <StatCard label="Total rows" value={formatCount(totalRows)} sub="across all tables" />
        <StatCard
          label="Most recent write"
          value={mostRecent ? timeAgo(mostRecent) : "—"}
          sub="any tracked table"
        />
        <StatCard
          label="Pipeline state"
          value={populated >= snapshot.length - 1 ? "Healthy" : "Backfilling"}
          sub={`${snapshot.length - populated} tables empty`}
        />
      </section>

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-admin-surface-2)]">
            <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
              <Th className="text-left">Table</Th>
              <Th className="text-right">Rows</Th>
              <Th className="text-left">Last write</Th>
              <Th className="text-right">Populated %</Th>
              <Th className="text-left">Note</Th>
            </tr>
          </thead>
          <tbody>
            {snapshot.map((t) => (
              <tr
                key={t.table}
                className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
              >
                <Td className="font-medium font-mono text-xs">{t.table}</Td>
                <Td className="text-right tabular-nums">{formatCount(t.row_count)}</Td>
                <Td className="text-[var(--color-admin-text-muted)]">
                  {t.last_write_at ? timeAgo(t.last_write_at) : "—"}
                </Td>
                <Td className="text-right tabular-nums">
                  {t.populated_pct === null ? "—" : formatPct(t.populated_pct)}
                </Td>
                <Td className="text-[var(--color-admin-text-muted)] text-xs">{t.note}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-card p-5 mt-6 border-dashed">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
          How to read this
        </div>
        <p className="text-xs text-[var(--color-admin-text-muted)]">
          Healthy = institutions, taxonomy, fees_raw, fees_verified, fed_data,
          call_reports, and reports all show recent writes. fees_raw must lead
          fees_verified by 1–2 hours under normal Atlas → Darwin → Knox flow.
          A stale last_write_at on any row signals an agent stuck or
          rate-limited.
        </p>
      </div>
    </main>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="admin-card p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-[var(--color-admin-text-dim)] mt-1 font-mono">{sub}</div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>;
}
