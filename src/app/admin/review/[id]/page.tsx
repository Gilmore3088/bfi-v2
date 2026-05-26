import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { ReviewActions } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RAW_TEXT_BYTES = 12 * 1024;

type FeeDetail = {
  id: number;
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  fees_raw_id: number;
  source_url: string;
  r2_key: string;
  raw_text: string | null;
  fee_category: string;
  fee_family: string | null;
  fee_name: string | null;
  amount: number | null;
  frequency: string | null;
  conditions: string | null;
  confidence: number | null;
  canonical_fee_key: string;
  variant_type: string | null;
  review_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type KnoxFinding = {
  created_at: string;
  status: string;
  payload: Record<string, unknown> | null;
  error: string | null;
};

async function getFee(id: number): Promise<FeeDetail | null> {
  type Row = {
    id: number;
    institution_id: number;
    institution_name: string;
    state_code: string | null;
    fees_raw_id: number;
    source_url: string;
    r2_key: string;
    raw_text: string | null;
    fee_category: string;
    fee_family: string | null;
    fee_name: string | null;
    amount: string | null;
    frequency: string | null;
    conditions: string | null;
    confidence: string | null;
    canonical_fee_key: string;
    variant_type: string | null;
    review_status: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
  };
  try {
    const rows = await sql<Row[]>`
      SELECT
        fv.id, fv.institution_id, i.name AS institution_name, i.state_code,
        fv.fees_raw_id,
        fr.source_url, fr.r2_key, fr.raw_text,
        fv.fee_category, fv.fee_family, fv.fee_name,
        fv.amount::text       AS amount,
        fv.frequency, fv.conditions,
        fv.confidence::text   AS confidence,
        fv.canonical_fee_key, fv.variant_type,
        fv.review_status, fv.reviewed_by,
        fv.reviewed_at::text  AS reviewed_at,
        fv.created_at::text   AS created_at
      FROM fees_verified fv
      JOIN institutions i ON i.id = fv.institution_id
      JOIN fees_raw    fr ON fr.id = fv.fees_raw_id
      WHERE fv.id = ${id}
      LIMIT 1
    `;
    const r = rows[0];
    if (!r) return null;
    return {
      ...r,
      amount: r.amount ? Number(r.amount) : null,
      confidence: r.confidence ? Number(r.confidence) : null,
    };
  } catch {
    return null;
  }
}

async function getKnoxFindings(rawId: number, feeId: number): Promise<KnoxFinding[]> {
  try {
    return await sql<KnoxFinding[]>`
      SELECT created_at::text AS created_at, status, payload, error
      FROM agent_events
      WHERE agent = 'knox'
        AND (
          payload->>'fees_verified_id' = ${String(feeId)}
          OR payload->>'fees_raw_id'   = ${String(rawId)}
        )
      ORDER BY created_at DESC
      LIMIT 25
    `;
  } catch {
    return [];
  }
}

function highlightEvidence(rawText: string | null, quote: string | null): React.ReactNode {
  if (!rawText) return <span className="text-[var(--color-admin-text-dim)]">No raw text captured</span>;
  const slice = rawText.slice(0, RAW_TEXT_BYTES);
  if (!quote) return <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{slice}</pre>;
  const idx = slice.toLowerCase().indexOf(quote.toLowerCase());
  if (idx < 0) {
    return (
      <>
        <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-2">
          Evidence quote not found verbatim in raw text
        </div>
        <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{slice}</pre>
      </>
    );
  }
  const before = slice.slice(0, idx);
  const hit = slice.slice(idx, idx + quote.length);
  const after = slice.slice(idx + quote.length);
  return (
    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
      {before}
      <mark className="bg-amber-500/20 text-amber-300 px-0.5 rounded">{hit}</mark>
      {after}
    </pre>
  );
}

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const fee = await getFee(id);
  if (!fee) notFound();

  const findings = await getKnoxFindings(fee.fees_raw_id, fee.id);

  // Darwin stores evidence_quote in payload of its own agent_events row,
  // and may also stash conditions text. Best-effort extraction:
  let evidenceQuote: string | null = null;
  try {
    const rows = await sql<{ payload: Record<string, unknown> | null }[]>`
      SELECT payload FROM agent_events
      WHERE agent='darwin'
        AND payload->>'fees_verified_id' = ${String(fee.id)}
      ORDER BY created_at DESC LIMIT 1
    `;
    const p = rows[0]?.payload;
    if (p && typeof p === "object" && typeof p["evidence_quote"] === "string") {
      evidenceQuote = p["evidence_quote"] as string;
    }
  } catch {
    /* ignore */
  }

  const openHref = `/api/raw/${encodeURIComponent(fee.r2_key)}`;

  return (
    <main className="px-10 py-10 max-w-[1600px] mx-auto space-y-8">
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-1">
            <Link href="/admin/review" className="hover:underline">Admin / Review</Link>
            <span> / #{fee.id}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            <Link href={`/admin/institutions/${fee.institution_id}`} className="hover:underline">
              {fee.institution_name}
            </Link>
            {fee.state_code && (
              <span className="ml-2 text-base text-[var(--color-admin-text-muted)] font-medium">
                {fee.state_code}
              </span>
            )}
          </h1>
          <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
            {fee.fee_category}
            {fee.fee_name ? ` — ${fee.fee_name}` : ""}
            {" · "}captured {timeAgo(fee.created_at)}
          </p>
        </div>
        <ReviewActions
          feeId={fee.id}
          openHref={openHref}
          rawId={fee.fees_raw_id}
          currentStatus={fee.review_status}
        />
      </header>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-7 admin-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-admin-border)] flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold">
              Source text (fees_raw #{fee.fees_raw_id})
            </div>
            <Link
              href={`/admin/raw/${fee.fees_raw_id}`}
              className="text-[11px] text-[var(--color-admin-text-muted)] hover:underline"
            >
              View raw doc →
            </Link>
          </div>
          <div className="p-4 max-h-[640px] overflow-auto">
            {highlightEvidence(fee.raw_text, evidenceQuote)}
          </div>
          <div className="px-4 py-2 border-t border-[var(--color-admin-border)] text-[10px] text-[var(--color-admin-text-dim)] font-mono break-all">
            {fee.source_url}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-4">
          <div className="admin-card p-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-3">
              Darwin&rsquo;s extraction
            </div>
            <dl className="space-y-2.5 text-sm">
              <DL label="Category">{fee.fee_category}</DL>
              {fee.fee_family && <DL label="Family">{fee.fee_family}</DL>}
              {fee.fee_name && <DL label="Fee name">{fee.fee_name}</DL>}
              <DL label="Amount">
                <span className="tabular-nums">{fee.amount != null ? `$${fee.amount.toFixed(2)}` : "—"}</span>
              </DL>
              <DL label="Frequency">{fee.frequency ?? "—"}</DL>
              {fee.conditions && <DL label="Conditions">{fee.conditions}</DL>}
              <DL label="Confidence">
                <span className="tabular-nums">
                  {fee.confidence != null ? `${(fee.confidence * 100).toFixed(0)}%` : "—"}
                </span>
              </DL>
              <DL label="Canonical key">
                <span className="font-mono text-[11px]">{fee.canonical_fee_key}</span>
              </DL>
              {fee.variant_type && (
                <DL label="Variant"><span className="font-mono text-[11px]">{fee.variant_type}</span></DL>
              )}
              <DL label="Status"><span className="font-mono text-[11px]">{fee.review_status}</span></DL>
              {fee.reviewed_by && <DL label="Reviewer">{fee.reviewed_by}</DL>}
              {fee.reviewed_at && <DL label="Reviewed">{timeAgo(fee.reviewed_at)}</DL>}
            </dl>
          </div>

          {evidenceQuote && (
            <div className="admin-card p-5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
                Evidence quote
              </div>
              <blockquote className="border-l-2 border-amber-500/40 pl-3 italic text-sm text-[var(--color-admin-text)]">
                {evidenceQuote}
              </blockquote>
            </div>
          )}

          <div className="admin-card p-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-3">
              Knox findings ({findings.length})
            </div>
            {findings.length === 0 ? (
              <div className="text-xs text-[var(--color-admin-text-dim)]">
                No Knox events attached to this fee or its source doc.
              </div>
            ) : (
              <ul className="space-y-2">
                {findings.map((f, i) => (
                  <li key={i} className="border-l-2 border-[var(--color-admin-border)] pl-3 py-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-mono uppercase">{f.status}</span>
                      <span className="text-[var(--color-admin-text-dim)]">{timeAgo(f.created_at)}</span>
                    </div>
                    {f.error && (
                      <div className="text-[11px] text-rose-400 mt-1 font-mono">{f.error}</div>
                    )}
                    {f.payload && (
                      <pre className="text-[10px] font-mono text-[var(--color-admin-text-muted)] mt-1 whitespace-pre-wrap break-all">
                        {JSON.stringify(f.payload, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function DL({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)] shrink-0">
        {label}
      </dt>
      <dd className="text-right text-[var(--color-admin-text)] min-w-0 break-words">{children}</dd>
    </div>
  );
}
