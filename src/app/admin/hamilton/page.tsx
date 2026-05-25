import { getHamiltonReports } from "@/lib/queries";
import { formatCount, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminHamiltonPage() {
  const reports = await getHamiltonReports(50);
  const queued = reports.filter((r) => r.status === "queued").length;
  const running = reports.filter((r) => r.status === "running").length;
  const succeeded = reports.filter((r) => r.status === "succeeded").length;
  const failed = reports.filter((r) => r.status === "failed").length;
  const totalCost = reports.reduce((s, r) => s + r.cost_cents, 0);

  return (
    <main className="px-8 py-6 max-w-7xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
            Admin / Hamilton
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Hamilton Reports</h1>
          <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
            McKinsey-grade research output. Reports queue here and stream their
            markdown into R2.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="px-4 py-2 text-sm rounded border border-[var(--color-admin-border)] bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)] cursor-not-allowed"
          title="Report generation will be wired in M1"
        >
          Generate report
        </button>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total reports" value={formatCount(reports.length)} sub="all kinds" />
        <StatCard label="Queued" value={formatCount(queued)} sub="awaiting Hamilton" />
        <StatCard label="Running" value={formatCount(running)} sub="streaming now" />
        <StatCard label="Succeeded" value={formatCount(succeeded)} sub="markdown ready" />
        <StatCard
          label="Spend (cents)"
          value={formatCount(totalCost)}
          sub={`${failed} failed`}
        />
      </section>

      {reports.length === 0 ? (
        <EmptyHero
          title="No reports generated yet"
          body="Hamilton produces benchmarking, MSA, regional, and state-level analyses. Once the first report is requested it will appear in the table below with status, cost, and a link to the markdown output."
        />
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-admin-surface-2)]">
              <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                <Th className="text-left">Kind</Th>
                <Th className="text-left">Subject</Th>
                <Th className="text-left">Status</Th>
                <Th className="text-right">Cost (¢)</Th>
                <Th className="text-left">Created</Th>
                <Th className="text-left">Completed</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
                >
                  <Td className="font-medium">{r.kind}</Td>
                  <Td className="text-[var(--color-admin-text-muted)]">
                    {r.subject_institution_name ?? r.subject_category ?? "—"}
                  </Td>
                  <Td>
                    <StatusPill status={r.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatCount(r.cost_cents)}</Td>
                  <Td className="text-[var(--color-admin-text-muted)]">{timeAgo(r.created_at)}</Td>
                  <Td className="text-[var(--color-admin-text-muted)]">
                    {r.completed_at ? timeAgo(r.completed_at) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    queued: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    running: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    succeeded: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    failed: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  };
  const cls =
    palette[status] ?? "bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)]";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}

function EmptyHero({ title, body }: { title: string; body: string }) {
  return (
    <div className="admin-card p-5 border-dashed">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
        Empty state
      </div>
      <div className="text-sm font-semibold mb-1">{title}</div>
      <p className="text-xs text-[var(--color-admin-text-muted)]">{body}</p>
    </div>
  );
}
