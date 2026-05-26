import Link from "next/link";
import { sql } from "@/lib/db";
import { formatAssets, formatCount } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = {
  id: number;
  name: string;
  state_code: string;
  charter_type: string;
  asset_size: number | null;
  city: string | null;
  has_url: boolean;
  raw_count: number;
  verified_count: number;
};

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

async function getInstitutions(opts: {
  q?: string;
  state?: string;
  charter?: string;
  limit: number;
}): Promise<Row[]> {
  type DBRow = {
    id: number;
    name: string;
    state_code: string;
    charter_type: string;
    asset_size: string | null;
    city: string | null;
    has_url: boolean;
    raw_count: string;
    verified_count: string;
  };

  const q = opts.q?.trim();
  const state = opts.state?.toUpperCase();
  const charter = opts.charter === "bank" || opts.charter === "credit_union" ? opts.charter : null;

  let where = sql`1=1`;
  if (q) where = sql`${where} AND i.name ILIKE ${"%" + q + "%"}`;
  if (state) where = sql`${where} AND i.state_code = ${state}`;
  if (charter) where = sql`${where} AND i.charter_type = ${charter}`;

  try {
    const rows = await sql<DBRow[]>`
      SELECT
        i.id, i.name, i.state_code, i.charter_type,
        i.asset_size::text AS asset_size, i.city,
        EXISTS (
          SELECT 1 FROM institution_urls iu
          WHERE iu.institution_id = i.id AND iu.is_active
        ) AS has_url,
        COALESCE((SELECT COUNT(*)::text FROM fees_raw fr
                    WHERE fr.institution_id = i.id), '0') AS raw_count,
        COALESCE((SELECT COUNT(*)::text FROM fees_verified fv
                    WHERE fv.institution_id = i.id
                      AND fv.superseded_by IS NULL
                      AND fv.review_status IN ('approved','auto_approved')),
                 '0') AS verified_count
      FROM institutions i
      WHERE ${where}
      ORDER BY i.asset_size DESC NULLS LAST
      LIMIT ${opts.limit}
    `;
    return rows.map((r) => ({
      ...r,
      asset_size: r.asset_size ? Number(r.asset_size) : null,
      raw_count: Number(r.raw_count),
      verified_count: Number(r.verified_count),
    }));
  } catch {
    return [];
  }
}

async function getTotal(): Promise<number> {
  try {
    const [r] = await sql<{ c: string }[]>`SELECT COUNT(*)::text AS c FROM institutions`;
    return Number(r?.c ?? 0);
  } catch {
    return 0;
  }
}

export default async function AdminInstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; charter?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const state = sp.state ?? "";
  const charter = sp.charter ?? "";

  const [rows, total] = await Promise.all([
    getInstitutions({ q, state, charter, limit: 250 }),
    getTotal(),
  ]);

  return (
    <main className="px-10 py-10 max-w-[1500px] mx-auto space-y-8">
      <header>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
          Roster
        </div>
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Institutions</h1>
            <p className="text-sm text-[var(--color-admin-text-muted)] mt-2">
              {formatCount(total)} banks and credit unions in the BFI roster. Showing top
              {" "}
              {formatCount(rows.length)} by asset size.
            </p>
          </div>
        </div>
      </header>

      <form className="flex flex-wrap items-center gap-3" method="GET" action="/admin/institutions">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name…"
          className="bg-[var(--color-admin-elev)] border border-[var(--color-admin-border)] rounded px-3 py-1.5 text-sm w-72"
        />
        <select
          name="state"
          defaultValue={state}
          className="bg-[var(--color-admin-elev)] border border-[var(--color-admin-border)] rounded px-3 py-1.5 text-sm font-mono"
        >
          <option value="">All states</option>
          {STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <select
          name="charter"
          defaultValue={charter}
          className="bg-[var(--color-admin-elev)] border border-[var(--color-admin-border)] rounded px-3 py-1.5 text-sm"
        >
          <option value="">All charters</option>
          <option value="bank">Banks</option>
          <option value="credit_union">Credit unions</option>
        </select>
        <button
          type="submit"
          className="bg-[var(--color-accent,#d97706)] text-white px-4 py-1.5 text-sm font-semibold rounded"
        >
          Filter
        </button>
        {(q || state || charter) && (
          <Link
            href="/admin/institutions"
            className="text-xs text-[var(--color-admin-text-muted)] hover:underline"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-admin-surface-2)]">
            <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
              <th className="px-4 py-2.5 text-left font-semibold">Name</th>
              <th className="px-4 py-2.5 text-left font-semibold">State</th>
              <th className="px-4 py-2.5 text-left font-semibold">Charter</th>
              <th className="px-4 py-2.5 text-right font-semibold">Assets</th>
              <th className="px-4 py-2.5 text-center font-semibold">URL?</th>
              <th className="px-4 py-2.5 text-right font-semibold">Raw docs</th>
              <th className="px-4 py-2.5 text-right font-semibold">Verified fees</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--color-admin-text-dim)] text-sm">
                  No institutions match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/institutions/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.city && (
                      <div className="text-[11px] text-[var(--color-admin-text-dim)]">{r.city}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.state_code}</td>
                  <td className="px-4 py-2.5 text-[var(--color-admin-text-muted)] text-xs">
                    {r.charter_type === "bank" ? "Bank" : "Credit union"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatAssets(r.asset_size)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {r.has_url ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        yes
                      </span>
                    ) : (
                      <span className="text-[10px] text-[var(--color-admin-text-dim)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatCount(r.raw_count)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatCount(r.verified_count)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
