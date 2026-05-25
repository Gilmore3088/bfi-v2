import { getRecentLeads } from "@/lib/queries";
import { formatCount, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLeadsPage() {
  const leads = await getRecentLeads(100);
  const byStatus = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <main className="px-8 py-6 max-w-7xl">
      <header className="mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
          Admin / Leads
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
          Inbound demand from gated downloads, Hamilton report previews, and
          the public site contact form.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total" value={formatCount(leads.length)} sub="last 100" />
        <StatCard label="New" value={formatCount(byStatus.new ?? 0)} sub="needs first touch" />
        <StatCard label="Contacted" value={formatCount(byStatus.contacted ?? 0)} sub="in motion" />
        <StatCard
          label="Qualified"
          value={formatCount(byStatus.qualified ?? 0)}
          sub="sales-ready"
        />
        <StatCard
          label="Converted"
          value={formatCount(byStatus.converted ?? 0)}
          sub="closed-won"
        />
      </section>

      {leads.length === 0 ? (
        <EmptyHero
          title="No leads yet"
          body="Leads accumulate from /api/leads (public form), Hamilton report gating, and consumer-side conversion CTAs. Once a submission lands it appears here ordered by created_at desc."
        />
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-admin-surface-2)]">
              <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                <Th className="text-left">Email</Th>
                <Th className="text-left">Company</Th>
                <Th className="text-left">Source</Th>
                <Th className="text-right">Score</Th>
                <Th className="text-left">Status</Th>
                <Th className="text-left">Created</Th>
                <Th className="text-left">Last touch</Th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr
                  key={l.id}
                  className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
                >
                  <Td className="font-medium">{l.email}</Td>
                  <Td className="text-[var(--color-admin-text-muted)]">{l.company ?? "—"}</Td>
                  <Td className="text-[var(--color-admin-text-muted)]">{l.source ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{l.score}</Td>
                  <Td>
                    <StatusPill status={l.status} />
                  </Td>
                  <Td className="text-[var(--color-admin-text-muted)]">{timeAgo(l.created_at)}</Td>
                  <Td className="text-[var(--color-admin-text-muted)]">
                    {l.last_touched_at ? timeAgo(l.last_touched_at) : "—"}
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
    new: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    contacted: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    qualified: "bg-violet-500/10 text-violet-400 border-violet-500/30",
    converted: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    rejected: "bg-rose-500/10 text-rose-400 border-rose-500/30",
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
