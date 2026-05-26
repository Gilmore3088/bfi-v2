import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { formatAmount, formatAssets, formatPct, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Institution = {
  id: number;
  name: string;
  state_code: string;
  charter_type: string;
  asset_size: number | null;
  asset_size_tier: string | null;
  fed_district: number | null;
  city: string | null;
  website_url: string | null;
  routing_number: string | null;
  rssd_id: string | null;
  created_at: string;
  updated_at: string;
};

type UrlRow = {
  id: number;
  url: string;
  discovery_method: string | null;
  confidence: number | null;
  verified_at: string | null;
  is_active: boolean;
  created_at: string;
};

type RawRow = {
  id: number;
  source_url: string;
  extracted_at: string;
  fees_count: number;
};

type FeeRow = {
  id: number;
  fee_category: string;
  fee_name: string | null;
  amount: number | null;
  frequency: string | null;
  confidence: number | null;
  review_status: string;
  created_at: string;
};

type RunRow = {
  run_id: string;
  agent: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  items_processed: number;
  events: number;
};

async function getInstitution(id: number): Promise<Institution | null> {
  type Row = {
    id: number;
    name: string;
    state_code: string;
    charter_type: string;
    asset_size: string | null;
    asset_size_tier: string | null;
    fed_district: number | null;
    city: string | null;
    website_url: string | null;
    routing_number: string | null;
    rssd_id: string | null;
    created_at: string;
    updated_at: string;
  };
  try {
    const rows = await sql<Row[]>`
      SELECT id, name, state_code, charter_type,
             asset_size::text AS asset_size,
             asset_size_tier, fed_district, city, website_url,
             routing_number, rssd_id,
             created_at::text AS created_at,
             updated_at::text AS updated_at
      FROM institutions WHERE id = ${id} LIMIT 1
    `;
    const r = rows[0];
    if (!r) return null;
    return { ...r, asset_size: r.asset_size ? Number(r.asset_size) : null };
  } catch {
    return null;
  }
}

async function getUrls(id: number): Promise<UrlRow[]> {
  type Row = {
    id: number;
    url: string;
    discovery_method: string | null;
    confidence: string | null;
    verified_at: string | null;
    is_active: boolean;
    created_at: string;
  };
  try {
    const rows = await sql<Row[]>`
      SELECT id, url, discovery_method,
             confidence::text AS confidence,
             verified_at::text AS verified_at,
             is_active,
             created_at::text AS created_at
      FROM institution_urls WHERE institution_id = ${id}
      ORDER BY is_active DESC, created_at DESC
    `;
    return rows.map((r) => ({
      ...r,
      confidence: r.confidence ? Number(r.confidence) : null,
    }));
  } catch {
    return [];
  }
}

async function getRaw(id: number): Promise<RawRow[]> {
  try {
    return await sql<RawRow[]>`
      SELECT fr.id, fr.source_url,
             fr.extracted_at::text AS extracted_at,
             COALESCE((SELECT COUNT(*)::int FROM fees_verified fv WHERE fv.fees_raw_id = fr.id), 0)
               AS fees_count
      FROM fees_raw fr
      WHERE fr.institution_id = ${id}
      ORDER BY fr.extracted_at DESC
      LIMIT 50
    `;
  } catch {
    return [];
  }
}

async function getFees(id: number): Promise<FeeRow[]> {
  type Row = {
    id: number;
    fee_category: string;
    fee_name: string | null;
    amount: string | null;
    frequency: string | null;
    confidence: string | null;
    review_status: string;
    created_at: string;
  };
  try {
    const rows = await sql<Row[]>`
      SELECT id, fee_category, fee_name,
             amount::text AS amount,
             frequency,
             confidence::text AS confidence,
             review_status,
             created_at::text AS created_at
      FROM fees_verified
      WHERE institution_id = ${id} AND superseded_by IS NULL
      ORDER BY fee_category ASC, created_at DESC
    `;
    return rows.map((r) => ({
      ...r,
      amount: r.amount ? Number(r.amount) : null,
      confidence: r.confidence ? Number(r.confidence) : null,
    }));
  } catch {
    return [];
  }
}

async function getRunHistory(id: number): Promise<RunRow[]> {
  // Runs that produced an agent_event referencing this institution.
  try {
    const rows = await sql<{
      run_id: string;
      agent: string;
      status: string;
      started_at: string;
      ended_at: string | null;
      items_processed: number;
      events: string;
    }[]>`
      SELECT ar.run_id, ar.agent, ar.status,
             ar.started_at::text AS started_at,
             ar.ended_at::text   AS ended_at,
             ar.items_processed,
             COUNT(ae.*)::text   AS events
      FROM agent_runs ar
      JOIN agent_events ae ON ae.run_id = ar.run_id
      WHERE ae.payload->>'institution_id' = ${String(id)}
      GROUP BY ar.run_id, ar.agent, ar.status, ar.started_at,
               ar.ended_at, ar.items_processed
      ORDER BY ar.started_at DESC
      LIMIT 25
    `;
    return rows.map((r) => ({ ...r, events: Number(r.events) }));
  } catch {
    return [];
  }
}

export default async function InstitutionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const inst = await getInstitution(id);
  if (!inst) notFound();

  const [urls, raw, fees, runs] = await Promise.all([
    getUrls(id), getRaw(id), getFees(id), getRunHistory(id),
  ]);

  // Group fees by category for display
  const feesByCategory = new Map<string, FeeRow[]>();
  for (const f of fees) {
    const list = feesByCategory.get(f.fee_category) ?? [];
    list.push(f);
    feesByCategory.set(f.fee_category, list);
  }

  return (
    <main className="px-10 py-10 max-w-[1500px] mx-auto space-y-10">
      <header>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
          <Link href="/admin/institutions" className="hover:underline">Admin / Institutions</Link>
          <span> / #{inst.id}</span>
        </div>
        <div className="flex items-baseline justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{inst.name}</h1>
            <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
              {inst.charter_type === "bank" ? "Bank" : "Credit union"}
              {inst.city ? ` · ${inst.city}` : ""}
              {" · "}{inst.state_code}
              {inst.fed_district ? ` · Fed district ${inst.fed_district}` : ""}
            </p>
          </div>
          {inst.website_url && (
            <a
              href={inst.website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded border border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)]"
            >
              Visit website ↗
            </a>
          )}
        </div>
      </header>

      <Section title="Profile">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Assets" value={formatAssets(inst.asset_size)} />
          <Stat label="Tier" value={inst.asset_size_tier ?? "—"} mono />
          <Stat label="RSSD" value={inst.rssd_id ?? "—"} mono />
          <Stat label="Routing #" value={inst.routing_number ?? "—"} mono />
        </div>
      </Section>

      <Section title={`Discovered URLs (${urls.length})`}>
        {urls.length === 0 ? (
          <Empty body="Magellan has not found a fee-schedule URL for this institution yet." />
        ) : (
          <div className="admin-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-admin-surface-2)]">
                <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                  <th className="px-4 py-2.5 text-left font-semibold">URL</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Method</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Confidence</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Verified</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Active</th>
                </tr>
              </thead>
              <tbody>
                {urls.map((u) => (
                  <tr
                    key={u.id}
                    className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50"
                  >
                    <td className="px-4 py-2.5 max-w-[640px]">
                      <a
                        href={u.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] break-all hover:underline"
                      >
                        {u.url}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-admin-text-muted)]">
                      {u.discovery_method ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {u.confidence != null ? formatPct(u.confidence) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-admin-text-muted)]">
                      {u.verified_at ? timeAgo(u.verified_at) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {u.is_active ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          yes
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--color-admin-text-dim)]">no</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Raw docs (${raw.length})`}>
        {raw.length === 0 ? (
          <Empty body="No raw fee schedules captured yet." />
        ) : (
          <div className="admin-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-admin-surface-2)]">
                <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                  <th className="px-4 py-2.5 text-left font-semibold">Source URL</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Captured</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Fees extracted</th>
                </tr>
              </thead>
              <tbody>
                {raw.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50"
                  >
                    <td className="px-4 py-2.5 max-w-[640px]">
                      <Link
                        href={`/admin/raw/${r.id}`}
                        className="font-mono text-[11px] break-all hover:underline"
                      >
                        {r.source_url}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-admin-text-muted)]">
                      {timeAgo(r.extracted_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.fees_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Verified fees (${fees.length})`}>
        {fees.length === 0 ? (
          <Empty body="No verified fees yet." />
        ) : (
          <div className="space-y-4">
            {Array.from(feesByCategory.entries()).map(([category, list]) => (
              <div key={category} className="admin-card overflow-hidden">
                <div className="px-4 py-2.5 bg-[var(--color-admin-surface-2)] border-b border-[var(--color-admin-border)] flex items-center justify-between">
                  <div className="text-xs font-semibold">{category}</div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)]">
                    {list.length} row{list.length === 1 ? "" : "s"}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {list.map((f) => (
                      <tr
                        key={f.id}
                        className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50"
                      >
                        <td className="px-4 py-2 text-[var(--color-admin-text-muted)] text-xs w-1/3">
                          {f.fee_name ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatAmount(f.amount)}
                        </td>
                        <td className="px-4 py-2 text-xs text-[var(--color-admin-text-muted)]">
                          {f.frequency ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs">
                          {f.confidence != null ? formatPct(f.confidence) : "—"}
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-[var(--color-admin-border)] text-[var(--color-admin-text-muted)]">
                            {f.review_status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Link
                            href={`/admin/review/${f.id}`}
                            className="text-[11px] text-[var(--color-admin-text-muted)] hover:underline"
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Run history (${runs.length})`}>
        {runs.length === 0 ? (
          <Empty body="No agent_runs have produced events tagged with this institution_id." />
        ) : (
          <div className="admin-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-admin-surface-2)]">
                <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                  <th className="px-4 py-2.5 text-left font-semibold">Agent</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Started</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Events</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Items</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.run_id}
                    className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50"
                  >
                    <td className="px-4 py-2.5 capitalize">
                      <Link href={`/admin/runs/${r.run_id}`} className="hover:underline">
                        {r.agent}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-admin-text-muted)] capitalize">
                      {r.status}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-admin-text-muted)]">
                      {timeAgo(r.started_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.events}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.items_processed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="admin-card p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
        {label}
      </div>
      <div className={`text-base font-bold ${mono ? "font-mono text-sm" : ""}`}>{value}</div>
    </div>
  );
}

function Empty({ body }: { body: string }): React.ReactElement {
  return (
    <div className="admin-card p-5 border-dashed">
      <p className="text-xs text-[var(--color-admin-text-muted)]">{body}</p>
    </div>
  );
}
