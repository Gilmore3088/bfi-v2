import { getMarketIndex } from "@/lib/queries";
import { formatAmount, formatCount } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminMarketPage() {
  const rows = await getMarketIndex();
  const categories = rows.length;
  const withData = rows.filter((r) => r.fee_count > 0).length;
  const totalObservations = rows.reduce((s, r) => s + r.fee_count, 0);

  return (
    <main className="px-8 py-6 max-w-7xl">
      <header className="mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
          Admin / Market
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Market Index</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
          Aggregate fee distributions across all verified institutions, joined
          on taxonomy. Empty rows appear until Atlas + Darwin populate
          fees_verified.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Categories" value={formatCount(categories)} sub="taxonomy rows" />
        <StatCard
          label="With verified data"
          value={formatCount(withData)}
          sub={`${categories ? Math.round((withData / categories) * 100) : 0}% of taxonomy`}
        />
        <StatCard
          label="Verified observations"
          value={formatCount(totalObservations)}
          sub="fees_verified rows"
        />
        <StatCard
          label="Pipeline status"
          value={totalObservations > 0 ? "Live" : "Awaiting"}
          sub={totalObservations > 0 ? "fees flowing" : "M1 backfill pending"}
        />
      </section>

      {totalObservations === 0 ? (
        <EmptyHero
          title="No verified fees yet"
          body="Market Index lights up once Atlas extracts fees_raw and Darwin promotes them into fees_verified. The 49 taxonomy categories below show the eventual shape of the page."
        />
      ) : null}

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-admin-surface-2)]">
            <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
              <Th className="text-left">Category</Th>
              <Th className="text-left">Family</Th>
              <Th className="text-left">Tier</Th>
              <Th className="text-right">Institutions</Th>
              <Th className="text-right">Observations</Th>
              <Th className="text-right">P25</Th>
              <Th className="text-right">Median</Th>
              <Th className="text-right">P75</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.category}
                className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
              >
                <Td className="font-medium">{r.display_name}</Td>
                <Td className="text-[var(--color-admin-text-muted)]">{r.family}</Td>
                <Td>
                  <span className="text-[10px] uppercase tracking-wide text-[var(--color-admin-text-dim)]">
                    {r.tier}
                  </span>
                </Td>
                <Td className="text-right tabular-nums">{formatCount(r.institution_count)}</Td>
                <Td className="text-right tabular-nums">{formatCount(r.fee_count)}</Td>
                <Td className="text-right tabular-nums">{formatAmount(r.p25)}</Td>
                <Td className="text-right tabular-nums font-semibold">{formatAmount(r.median)}</Td>
                <Td className="text-right tabular-nums">{formatAmount(r.p75)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
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

function EmptyHero({ title, body }: { title: string; body: string }) {
  return (
    <div className="admin-card p-5 mb-6 border-dashed">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
        Empty state
      </div>
      <div className="text-sm font-semibold mb-1">{title}</div>
      <p className="text-xs text-[var(--color-admin-text-muted)]">{body}</p>
    </div>
  );
}
