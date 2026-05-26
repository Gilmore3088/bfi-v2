import Link from "next/link";
import { sql } from "@/lib/db";
import { formatCount, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RawDocRow = {
  id: number;
  institution_id: number;
  institution_name: string | null;
  source_url: string;
  r2_key: string;
  extracted_at: string;
  text_bytes: number;
  fees_extracted: number;
};

async function getRawDocs(limit = 200): Promise<RawDocRow[]> {
  try {
    return await sql<RawDocRow[]>`
      SELECT
        fr.id,
        fr.institution_id,
        i.name                                AS institution_name,
        fr.source_url,
        fr.r2_key,
        fr.extracted_at,
        COALESCE(octet_length(fr.raw_text), 0) AS text_bytes,
        COALESCE(fv.cnt, 0)                    AS fees_extracted
      FROM fees_raw fr
      LEFT JOIN institutions i ON i.id = fr.institution_id
      LEFT JOIN (
        SELECT fees_raw_id, COUNT(*)::int AS cnt
        FROM fees_verified
        GROUP BY fees_raw_id
      ) fv ON fv.fees_raw_id = fr.id
      ORDER BY fr.extracted_at DESC
      LIMIT ${limit}
    `;
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default async function AdminRawDocsPage() {
  const rows = await getRawDocs(200);

  const totalBytes = rows.reduce((acc, r) => acc + (r.text_bytes ?? 0), 0);
  const totalFees = rows.reduce((acc, r) => acc + (r.fees_extracted ?? 0), 0);

  return (
    <main className="px-8 py-6 max-w-7xl">
      <header className="mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
          Admin / Raw Docs
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Raw Documents</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
          Atlas-captured fee schedules in R2. Each row is one immutable fetch;
          downstream fees_verified rows link back via fees_raw_id.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Documents" value={formatCount(rows.length)} sub="most recent 200" />
        <StatCard label="Fees extracted" value={formatCount(totalFees)} sub="from listed docs" />
        <StatCard label="Total raw text" value={formatBytes(totalBytes)} sub="across listed docs" />
      </section>

      {rows.length === 0 ? (
        <EmptyHero
          title="No raw documents yet"
          body="Atlas hasn't logged any fee-schedule fetches. When a crawl runs and stores an HTML/PDF artifact in R2, it will appear here."
        />
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-admin-surface-2)]">
              <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                <Th className="text-left">Institution</Th>
                <Th className="text-left">Source URL</Th>
                <Th className="text-right">Text size</Th>
                <Th className="text-right">Fees</Th>
                <Th className="text-left">Extracted</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
                >
                  <Td className="font-medium">
                    <Link
                      href={`/admin/raw/${r.id}`}
                      className="hover:underline"
                    >
                      {r.institution_name ?? `Institution #${r.institution_id}`}
                    </Link>
                  </Td>
                  <Td className="text-[var(--color-admin-text-muted)] max-w-[420px] truncate">
                    <span title={r.source_url}>{r.source_url}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{formatBytes(r.text_bytes)}</Td>
                  <Td className="text-right tabular-nums">{formatCount(r.fees_extracted)}</Td>
                  <Td className="text-[var(--color-admin-text-muted)]">{timeAgo(r.extracted_at)}</Td>
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
