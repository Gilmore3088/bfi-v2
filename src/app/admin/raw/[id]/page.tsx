import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { formatAmount, formatPct, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RAW_TEXT_PREVIEW_BYTES = 5 * 1024;

type RawDocDetail = {
  id: number;
  institution_id: number;
  institution_name: string | null;
  state_code: string | null;
  source_url: string;
  r2_key: string;
  extracted_at: string;
  extractor_version: string | null;
  content_hash: string | null;
  raw_text: string | null;
  text_bytes: number;
};

type VerifiedRow = {
  id: number;
  fee_category: string;
  fee_name: string | null;
  amount: number | null;
  frequency: string | null;
  confidence: number | null;
  review_status: string;
};

async function getRawDoc(id: number): Promise<RawDocDetail | null> {
  try {
    const rows = await sql<RawDocDetail[]>`
      SELECT
        fr.id,
        fr.institution_id,
        i.name             AS institution_name,
        i.state_code       AS state_code,
        fr.source_url,
        fr.r2_key,
        fr.extracted_at,
        fr.extractor_version,
        fr.content_hash,
        fr.raw_text,
        COALESCE(octet_length(fr.raw_text), 0) AS text_bytes
      FROM fees_raw fr
      LEFT JOIN institutions i ON i.id = fr.institution_id
      WHERE fr.id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function getFeesForRaw(rawId: number): Promise<VerifiedRow[]> {
  try {
    return await sql<VerifiedRow[]>`
      SELECT id, fee_category, fee_name, amount, frequency, confidence, review_status
      FROM fees_verified
      WHERE fees_raw_id = ${rawId}
      ORDER BY fee_category ASC
    `;
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default async function RawDocDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    notFound();
  }

  const doc = await getRawDoc(id);
  if (!doc) {
    notFound();
  }

  const fees = await getFeesForRaw(id);

  const preview =
    doc.raw_text && doc.raw_text.length > 0
      ? doc.raw_text.slice(0, RAW_TEXT_PREVIEW_BYTES)
      : "";
  const truncated = (doc.raw_text?.length ?? 0) > RAW_TEXT_PREVIEW_BYTES;

  const encodedKey = encodeURIComponent(doc.r2_key);
  const openHref = `/api/raw/${encodedKey}`;
  const downloadHref = `/api/raw/${encodedKey}?download=1`;

  return (
    <main className="px-8 py-6 max-w-7xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
            <Link href="/admin/raw" className="hover:underline">
              Admin / Raw Docs
            </Link>
            <span> / #{doc.id}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {doc.institution_name ?? `Institution #${doc.institution_id}`}
            {doc.state_code ? (
              <span className="ml-2 text-[var(--color-admin-text-muted)] text-base font-medium">
                {doc.state_code}
              </span>
            ) : null}
          </h1>
          <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
            Raw fee schedule captured by Atlas, persisted in R2.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <a
            href={openHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 border border-[var(--color-admin-border)] rounded hover:bg-[var(--color-admin-surface-2)] transition-colors"
          >
            Open original
          </a>
          <a
            href={downloadHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 border border-[var(--color-admin-border)] rounded hover:bg-[var(--color-admin-surface-2)] transition-colors"
          >
            Download
          </a>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-4">
        <section className="col-span-12 lg:col-span-3">
          <div className="admin-card p-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-3">
              Metadata
            </div>
            <dl className="space-y-3 text-xs">
              <Meta label="Institution">
                <Link
                  href={`/admin/raw?institution=${doc.institution_id}`}
                  className="hover:underline"
                >
                  {doc.institution_name ?? `#${doc.institution_id}`}
                </Link>
              </Meta>
              <Meta label="Source URL">
                <a
                  href={doc.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all hover:underline text-[var(--color-admin-text)]"
                >
                  {doc.source_url}
                </a>
              </Meta>
              <Meta label="R2 key">
                <span className="break-all font-mono text-[11px]">{doc.r2_key}</span>
              </Meta>
              <Meta label="Extracted">{timeAgo(doc.extracted_at)}</Meta>
              <Meta label="Text size">{formatBytes(doc.text_bytes)}</Meta>
              {doc.extractor_version ? (
                <Meta label="Extractor">
                  <span className="font-mono">{doc.extractor_version}</span>
                </Meta>
              ) : null}
              {doc.content_hash ? (
                <Meta label="Content hash">
                  <span className="font-mono text-[10px] break-all">
                    {doc.content_hash}
                  </span>
                </Meta>
              ) : null}
            </dl>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-6">
          <div className="admin-card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-admin-border)] flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)]">
                Raw text preview
              </div>
              <div className="text-[10px] text-[var(--color-admin-text-dim)] font-mono">
                {preview
                  ? `${formatBytes(preview.length)} of ${formatBytes(doc.text_bytes)}`
                  : "no text indexed"}
              </div>
            </div>
            {preview ? (
              <pre className="px-4 py-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-[640px] overflow-auto font-mono text-[var(--color-admin-text-muted)]">
                {preview}
                {truncated ? (
                  <span className="block mt-3 text-[var(--color-admin-text-dim)]">
                    [...truncated; open original for full document]
                  </span>
                ) : null}
              </pre>
            ) : (
              <div className="px-4 py-6 text-xs text-[var(--color-admin-text-muted)]">
                No raw_text indexed for this document. Use the &ldquo;Open
                original&rdquo; button above to render the source HTML/PDF from
                R2.
              </div>
            )}
          </div>
        </section>

        <section className="col-span-12 lg:col-span-3">
          <div className="admin-card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-admin-border)] flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)]">
                Fees from this doc
              </div>
              <div className="text-[10px] text-[var(--color-admin-text-dim)] font-mono">
                {fees.length}
              </div>
            </div>
            {fees.length === 0 ? (
              <div className="px-4 py-6 text-xs text-[var(--color-admin-text-muted)]">
                No fees_verified rows trace back to this doc yet.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-admin-border)]">
                {fees.map((f) => (
                  <li key={f.id} className="px-4 py-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate" title={f.fee_category}>
                        {f.fee_category}
                      </span>
                      <span className="tabular-nums shrink-0">
                        {formatAmount(f.amount)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--color-admin-text-muted)]">
                      <span className="truncate">
                        {f.fee_name ?? "—"}
                        {f.frequency ? ` · ${f.frequency}` : ""}
                      </span>
                      <span className="tabular-nums shrink-0">
                        {f.confidence !== null ? formatPct(f.confidence) : "—"}
                      </span>
                    </div>
                    <div className="mt-1">
                      <StatusPill status={f.review_status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
        {label}
      </dt>
      <dd className="text-[var(--color-admin-text)]">{children}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    flagged: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    auto_approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    rejected: "bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-dim)] border-[var(--color-admin-border)]",
  };
  const cls =
    palette[status] ?? "bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)] border-[var(--color-admin-border)]";
  return (
    <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}
