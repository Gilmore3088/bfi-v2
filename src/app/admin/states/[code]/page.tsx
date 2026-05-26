import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { stateName, allStateCodes } from "@/lib/states";
import { formatAmount, formatAssets, formatCount } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ code: string }> };

type StateSummary = {
  institutions: number;
  urls: number;
  verified: number;
  verified_inst: number;
};

type TopInstitution = {
  id: number;
  name: string;
  city: string | null;
  asset_size: number | null;
  charter_type: string;
  has_url: boolean;
  verified_fees: number;
};

type CategoryBreakdownRow = {
  category: string;
  display_name: string;
  family: string;
  fee_count: number;
};

type KnowledgePatternRow = {
  key: string;
  kind: string;
  hit_count: number;
  miss_count: number;
  success_rate: number;
};

async function getStateSummary(code: string): Promise<StateSummary> {
  try {
    const [r] = await sql<{
      institutions: string;
      urls: string;
      verified: string;
      verified_inst: string;
    }[]>`
      SELECT
        (SELECT COUNT(*)::text FROM institutions WHERE state_code = ${code})            AS institutions,
        (SELECT COUNT(*)::text FROM institution_urls iu
           JOIN institutions i ON i.id = iu.institution_id
           WHERE i.state_code = ${code} AND iu.is_active)                               AS urls,
        (SELECT COUNT(*)::text FROM fees_verified fv
           JOIN institutions i ON i.id = fv.institution_id
           WHERE i.state_code = ${code}
             AND fv.superseded_by IS NULL
             AND fv.review_status IN ('approved','auto_approved'))                      AS verified,
        (SELECT COUNT(DISTINCT fv.institution_id)::text FROM fees_verified fv
           JOIN institutions i ON i.id = fv.institution_id
           WHERE i.state_code = ${code}
             AND fv.superseded_by IS NULL
             AND fv.review_status IN ('approved','auto_approved'))                      AS verified_inst
    `;
    return {
      institutions: Number(r?.institutions ?? 0),
      urls: Number(r?.urls ?? 0),
      verified: Number(r?.verified ?? 0),
      verified_inst: Number(r?.verified_inst ?? 0),
    };
  } catch {
    return { institutions: 0, urls: 0, verified: 0, verified_inst: 0 };
  }
}

async function getTopInstitutions(code: string): Promise<TopInstitution[]> {
  type Row = {
    id: number;
    name: string;
    city: string | null;
    asset_size: string | null;
    charter_type: string;
    has_url: boolean;
    verified_fees: string;
  };
  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      SELECT
        i.id, i.name, i.city, i.charter_type,
        i.asset_size::text AS asset_size,
        EXISTS (
          SELECT 1 FROM institution_urls iu
          WHERE iu.institution_id = i.id AND iu.is_active
        ) AS has_url,
        COALESCE((
          SELECT COUNT(*)::text FROM fees_verified fv
          WHERE fv.institution_id = i.id
            AND fv.superseded_by IS NULL
            AND fv.review_status IN ('approved','auto_approved')
        ), '0') AS verified_fees
      FROM institutions i
      WHERE i.state_code = ${code}
      ORDER BY i.asset_size DESC NULLS LAST
      LIMIT 20
    `;
  } catch {
    rows = [];
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    asset_size: r.asset_size ? Number(r.asset_size) : null,
    charter_type: r.charter_type,
    has_url: r.has_url,
    verified_fees: Number(r.verified_fees),
  }));
}

async function getCategoryBreakdown(code: string): Promise<CategoryBreakdownRow[]> {
  type Row = {
    category: string;
    display_name: string;
    family: string;
    fee_count: string;
  };
  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      SELECT
        t.category,
        t.display_name,
        t.family,
        COUNT(fv.id)::text AS fee_count
      FROM taxonomy t
      LEFT JOIN fees_verified fv
        ON fv.fee_category = t.category
       AND fv.superseded_by IS NULL
       AND fv.review_status IN ('approved','auto_approved')
       AND fv.institution_id IN (
         SELECT id FROM institutions WHERE state_code = ${code}
       )
      GROUP BY t.category, t.display_name, t.family
      HAVING COUNT(fv.id) > 0
      ORDER BY COUNT(fv.id) DESC
      LIMIT 12
    `;
  } catch {
    rows = [];
  }
  return rows.map((r) => ({
    category: r.category,
    display_name: r.display_name,
    family: r.family,
    fee_count: Number(r.fee_count),
  }));
}

async function getKnowledgePatterns(code: string): Promise<KnowledgePatternRow[]> {
  type Row = {
    key: string;
    kind: string;
    hit_count: string;
    miss_count: string;
    success_rate: string;
  };
  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      SELECT key, kind, hit_count::text, miss_count::text, success_rate::text
      FROM v_agent_pattern_success
      WHERE agent = 'magellan'
        AND state_code = ${code}
      ORDER BY attempts DESC, success_rate DESC
      LIMIT 8
    `;
  } catch {
    rows = [];
  }
  return rows.map((r) => ({
    key: r.key,
    kind: r.kind,
    hit_count: Number(r.hit_count),
    miss_count: Number(r.miss_count),
    success_rate: Number(r.success_rate),
  }));
}

export default async function StateDetailPage({ params }: Params) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const name = stateName(code);
  if (!name) notFound();

  const [summary, top, categories, patterns] = await Promise.all([
    getStateSummary(code),
    getTopInstitutions(code),
    getCategoryBreakdown(code),
    getKnowledgePatterns(code),
  ]);

  const coveragePct =
    summary.institutions > 0 ? summary.verified_inst / summary.institutions : 0;
  const maxCategoryCount = Math.max(1, ...categories.map((c) => c.fee_count));

  return (
    <main className="px-10 py-10 max-w-[1400px] mx-auto space-y-12">
      <header>
        <Link
          href="/admin/states"
          className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] hover:text-[var(--color-admin-accent)] transition-colors"
        >
          &larr; Admin / States
        </Link>
        <div className="flex items-baseline gap-3 mt-2">
          <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
          <span className="text-lg text-[var(--color-admin-text-dim)] tabular-nums">{code}</span>
        </div>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-2 max-w-2xl">
          Coverage detail for {name}. Hero metrics, the largest institutions,
          a category breakdown of verified fees, and what Magellan has learned
          about discovery patterns specific to this state.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Institutions" value={formatCount(summary.institutions)} sub="seeded roster" />
        <StatCard label="Discovered URLs" value={formatCount(summary.urls)} sub="active fee-page URLs" />
        <StatCard label="Verified fees" value={formatCount(summary.verified)} sub="approved + auto-approved" />
        <StatCard
          label="Coverage"
          value={`${(coveragePct * 100).toFixed(0)}%`}
          sub={`${formatCount(summary.verified_inst)} / ${formatCount(summary.institutions)} institutions`}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 admin-card p-6">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
                Largest 20 by asset size
              </div>
              <h2 className="text-lg font-semibold tracking-tight">Top institutions</h2>
            </div>
          </div>
          {top.length === 0 ? (
            <EmptyHero
              title="No institutions in roster"
              body={`No institutions for ${name} are present in the seed table yet.`}
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-[var(--color-admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-admin-surface-2)]">
                  <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                    <Th className="text-left">Institution</Th>
                    <Th className="text-left">City</Th>
                    <Th className="text-left">Charter</Th>
                    <Th className="text-right">Assets</Th>
                    <Th className="text-center">URL</Th>
                    <Th className="text-right">Verified fees</Th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
                    >
                      <Td className="font-medium">{row.name}</Td>
                      <Td className="text-[var(--color-admin-text-muted)]">
                        {row.city ?? "-"}
                      </Td>
                      <Td>
                        <span className="text-[10px] uppercase tracking-wide text-[var(--color-admin-text-dim)]">
                          {row.charter_type === "credit_union" ? "CU" : "Bank"}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums">{formatAssets(row.asset_size)}</Td>
                      <Td className="text-center">
                        <span
                          className={
                            row.has_url
                              ? "text-[var(--color-admin-accent)]"
                              : "text-[var(--color-admin-text-dim)]"
                          }
                        >
                          {row.has_url ? "Y" : "N"}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums font-semibold">
                        {formatCount(row.verified_fees)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="admin-card p-6">
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
              By taxonomy
            </div>
            <h2 className="text-lg font-semibold tracking-tight">Category breakdown</h2>
          </div>
          {categories.length === 0 ? (
            <EmptyHero
              title="No verified fees yet"
              body={`No fees have been verified for institutions in ${name}.`}
            />
          ) : (
            <ul className="space-y-2.5">
              {categories.map((c) => {
                const pct = (c.fee_count / maxCategoryCount) * 100;
                return (
                  <li key={c.category}>
                    <div className="flex items-baseline justify-between text-xs mb-1">
                      <span className="font-medium truncate pr-2">{c.display_name}</span>
                      <span className="tabular-nums text-[var(--color-admin-text-muted)]">
                        {formatCount(c.fee_count)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-sm bg-[var(--color-admin-surface-2)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-admin-accent)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="admin-card p-6">
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
            Magellan agent knowledge layer
          </div>
          <h2 className="text-lg font-semibold tracking-tight">
            Learned discovery patterns for {name}
          </h2>
          <p className="text-xs text-[var(--color-admin-text-muted)] mt-1 max-w-2xl">
            URL patterns Magellan has tried in this state, ranked by attempts.
            Empty until the discovery agent runs against {name} with target_state set.
          </p>
        </div>
        {patterns.length === 0 ? (
          <EmptyHero
            title="No patterns recorded"
            body="Magellan has not logged hit/miss telemetry for this state yet."
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-[var(--color-admin-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-admin-surface-2)]">
                <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                  <Th className="text-left">Pattern</Th>
                  <Th className="text-left">Kind</Th>
                  <Th className="text-right">Hits</Th>
                  <Th className="text-right">Misses</Th>
                  <Th className="text-right">Success</Th>
                </tr>
              </thead>
              <tbody>
                {patterns.map((p) => (
                  <tr
                    key={`${p.kind}:${p.key}`}
                    className="border-t border-[var(--color-admin-border)]"
                  >
                    <Td className="font-mono text-[12px]">{p.key}</Td>
                    <Td className="text-[var(--color-admin-text-muted)]">{p.kind}</Td>
                    <Td className="text-right tabular-nums">{formatCount(p.hit_count)}</Td>
                    <Td className="text-right tabular-nums">{formatCount(p.miss_count)}</Td>
                    <Td className="text-right tabular-nums font-semibold">
                      {(p.success_rate * 100).toFixed(0)}%
                    </Td>
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

// Pre-generate static paths for every known US state so direct visits to
// /admin/states/FL etc. resolve cleanly. dynamicParams stays true for
// fall-through on lowercase / unknown inputs.
export function generateStaticParams() {
  return allStateCodes().map((code) => ({ code }));
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
