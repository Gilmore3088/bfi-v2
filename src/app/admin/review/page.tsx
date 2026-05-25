import { getReviewQueue } from "@/lib/queries";
import { formatAmount, formatCount, formatPct, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminReviewPage() {
  const rows = await getReviewQueue(100);
  const pending = rows.filter((r) => r.review_status === "pending").length;
  const flagged = rows.filter((r) => r.review_status === "flagged").length;
  const lowConfidence = rows.filter(
    (r) => r.confidence !== null && r.confidence < 0.7,
  ).length;

  return (
    <main className="px-8 py-6 max-w-7xl">
      <header className="mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
          Admin / Review
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
          Human-in-the-loop verification for fees Knox could not auto-approve.
          Approve, reject, or escalate per row.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Pending" value={formatCount(pending)} sub="awaiting first look" />
        <StatCard label="Flagged" value={formatCount(flagged)} sub="needs adjudication" />
        <StatCard
          label="Low confidence"
          value={formatCount(lowConfidence)}
          sub="confidence < 0.70"
        />
      </section>

      {rows.length === 0 ? (
        <EmptyHero
          title="Review queue is clear"
          body="Fees only land here when Darwin/Knox cannot auto-approve them (low extraction confidence or a flagged anomaly). Once extraction begins this queue will grow."
        />
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-admin-surface-2)]">
              <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                <Th className="text-left">Institution</Th>
                <Th className="text-left">Category</Th>
                <Th className="text-left">Fee name</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Confidence</Th>
                <Th className="text-left">Status</Th>
                <Th className="text-left">Created</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
                >
                  <Td className="font-medium">{r.institution_name}</Td>
                  <Td className="text-[var(--color-admin-text-muted)]">{r.fee_category}</Td>
                  <Td className="text-[var(--color-admin-text-muted)]">{r.fee_name ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{formatAmount(r.amount)}</Td>
                  <Td className="text-right tabular-nums">
                    {r.confidence !== null ? formatPct(r.confidence) : "—"}
                  </Td>
                  <Td>
                    <StatusPill status={r.review_status} />
                  </Td>
                  <Td className="text-[var(--color-admin-text-muted)]">{timeAgo(r.created_at)}</Td>
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
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    flagged: "bg-rose-500/10 text-rose-400 border-rose-500/30",
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
