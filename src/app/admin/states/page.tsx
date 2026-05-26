import Link from "next/link";
import { sql } from "@/lib/db";
import { US_STATES, stateName } from "@/lib/states";
import { formatCount } from "@/lib/format";
import { StateMap, type StateMapDatum } from "@/components/state-map";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StateRow = {
  state_code: string;
  institutions: number;
  urls: number;
  raw_docs: number;
  verified: number;
  coverage_pct: number;
};

/**
 * Aggregate per-state coverage stats in a single round trip. Joins
 * institutions to urls / raw / verified using LEFT JOINs so states with
 * institutions but no extracted fees still render at zero. Coverage % is
 * defined as institutions with >=1 verified fee divided by institutions.
 */
async function getStateCoverage(): Promise<StateRow[]> {
  type Row = {
    state_code: string;
    institutions: string;
    urls: string;
    raw_docs: string;
    verified: string;
    verified_inst: string;
  };
  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      SELECT
        i.state_code,
        COUNT(DISTINCT i.id)::text                                         AS institutions,
        COUNT(DISTINCT iu.id) FILTER (WHERE iu.is_active)::text            AS urls,
        COUNT(DISTINCT fr.id)::text                                        AS raw_docs,
        COUNT(DISTINCT fv.id) FILTER (
          WHERE fv.superseded_by IS NULL
            AND fv.review_status IN ('approved','auto_approved')
        )::text                                                            AS verified,
        COUNT(DISTINCT fv.institution_id) FILTER (
          WHERE fv.superseded_by IS NULL
            AND fv.review_status IN ('approved','auto_approved')
        )::text                                                            AS verified_inst
      FROM institutions i
      LEFT JOIN institution_urls iu ON iu.institution_id = i.id
      LEFT JOIN fees_raw         fr ON fr.institution_id = i.id
      LEFT JOIN fees_verified    fv ON fv.institution_id = i.id
      WHERE i.state_code IS NOT NULL
      GROUP BY i.state_code
    `;
  } catch {
    rows = [];
  }
  return rows.map((r) => {
    const institutions = Number(r.institutions);
    const verifiedInst = Number(r.verified_inst);
    return {
      state_code: r.state_code,
      institutions,
      urls: Number(r.urls),
      raw_docs: Number(r.raw_docs),
      verified: Number(r.verified),
      coverage_pct: institutions > 0 ? verifiedInst / institutions : 0,
    };
  });
}

export default async function StatesIndexPage() {
  const rows = await getStateCoverage();
  const byCode = new Map(rows.map((r) => [r.state_code, r]));

  // Build map data for every known state code so the choropleth always
  // draws every shape, including zero-coverage states.
  const mapData: StateMapDatum[] = Object.keys(US_STATES).map((code) => {
    const r = byCode.get(code);
    return {
      code,
      verified: r?.verified ?? 0,
      institutions: r?.institutions ?? 0,
    };
  });

  // Sorted table preview: verified desc by default, with state rows for
  // every state (so users can see the empty ones too).
  const tableRows = mapData
    .map((m) => {
      const r = byCode.get(m.code);
      return {
        code: m.code,
        name: stateName(m.code) ?? m.code,
        institutions: r?.institutions ?? 0,
        urls: r?.urls ?? 0,
        raw_docs: r?.raw_docs ?? 0,
        verified: r?.verified ?? 0,
        coverage_pct: r?.coverage_pct ?? 0,
      };
    })
    .sort((a, b) => b.verified - a.verified);

  const previewRows = tableRows.slice(0, 15);
  const totalStates = tableRows.length;
  const statesWithFees = tableRows.filter((r) => r.verified > 0).length;
  const totalInstitutions = tableRows.reduce((s, r) => s + r.institutions, 0);
  const totalVerified = tableRows.reduce((s, r) => s + r.verified, 0);

  return (
    <main className="px-10 py-10 max-w-[1400px] mx-auto space-y-12">
      <header>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
          Admin / States
        </div>
        <h1 className="text-3xl font-bold tracking-tight">State Coverage</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-2 max-w-2xl">
          Fee data depth across all 50 states and DC. Click a state to drill
          into its institutions, category breakdown, and what the Magellan
          discovery agent has learned about it.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="States tracked" value={formatCount(totalStates)} sub="50 + DC" />
        <StatCard
          label="With verified data"
          value={formatCount(statesWithFees)}
          sub={`${totalStates ? Math.round((statesWithFees / totalStates) * 100) : 0}% of states`}
        />
        <StatCard label="Institutions" value={formatCount(totalInstitutions)} sub="across all states" />
        <StatCard label="Verified fees" value={formatCount(totalVerified)} sub="approved + auto-approved" />
      </section>

      <section className="admin-card p-8">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
              Choropleth
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Verified fees by state</h2>
          </div>
          <div className="text-[11px] text-[var(--color-admin-text-dim)] uppercase tracking-[0.15em]">
            sqrt-scaled intensity
          </div>
        </div>
        <StateMap data={mapData} />
      </section>

      <section className="admin-card p-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
              Top 15 by verified fees
            </div>
            <h2 className="text-lg font-semibold tracking-tight">Coverage table</h2>
          </div>
          <div className="text-[11px] text-[var(--color-admin-text-dim)]">
            {totalStates - previewRows.length > 0
              ? `${totalStates - previewRows.length} more below`
              : "all states shown"}
          </div>
        </div>
        <div className="overflow-hidden rounded-md border border-[var(--color-admin-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-admin-surface-2)]">
              <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                <Th className="text-left">State</Th>
                <Th className="text-right">Institutions</Th>
                <Th className="text-right">URLs discovered</Th>
                <Th className="text-right">Raw docs</Th>
                <Th className="text-right">Verified fees</Th>
                <Th className="text-right">Coverage</Th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r) => (
                <tr
                  key={r.code}
                  className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
                >
                  <Td>
                    <Link
                      href={`/admin/states/${r.code}`}
                      className="hover:text-[var(--color-admin-accent)] transition-colors"
                    >
                      <span className="text-[var(--color-admin-text-dim)] tabular-nums mr-2">
                        {r.code}
                      </span>
                      <span className="font-medium">{r.name}</span>
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums">{formatCount(r.institutions)}</Td>
                  <Td className="text-right tabular-nums">{formatCount(r.urls)}</Td>
                  <Td className="text-right tabular-nums">{formatCount(r.raw_docs)}</Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {formatCount(r.verified)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {(r.coverage_pct * 100).toFixed(0)}%
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
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
      <div className="text-[11px] text-[var(--color-admin-text-dim)] mt-1">{sub}</div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>;
}
