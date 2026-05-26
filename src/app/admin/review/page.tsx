import Link from "next/link";
import { sql } from "@/lib/db";
import { ReviewQueueTable, type ReviewRow } from "./queue-table";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Counts = {
  pending: number;
  flagged: number;
  auto_approved: number;
  approved: number;
  rejected: number;
};

type Filter = "pending" | "flagged" | "auto_approved" | "all";

const FILTER_LABELS: Record<Filter, string> = {
  pending: "Pending",
  flagged: "Flagged",
  auto_approved: "Auto-approved",
  all: "All open",
};

async function getCounts(): Promise<Counts> {
  try {
    const [r] = await sql<{
      pending: string; flagged: string; auto_approved: string;
      approved: string; rejected: string;
    }[]>`
      SELECT
        COUNT(*) FILTER (WHERE review_status='pending')::text       AS pending,
        COUNT(*) FILTER (WHERE review_status='flagged')::text       AS flagged,
        COUNT(*) FILTER (WHERE review_status='auto_approved')::text AS auto_approved,
        COUNT(*) FILTER (WHERE review_status='approved')::text      AS approved,
        COUNT(*) FILTER (WHERE review_status='rejected')::text      AS rejected
      FROM fees_verified
      WHERE superseded_by IS NULL
    `;
    return {
      pending: Number(r?.pending ?? 0),
      flagged: Number(r?.flagged ?? 0),
      auto_approved: Number(r?.auto_approved ?? 0),
      approved: Number(r?.approved ?? 0),
      rejected: Number(r?.rejected ?? 0),
    };
  } catch {
    return { pending: 0, flagged: 0, auto_approved: 0, approved: 0, rejected: 0 };
  }
}

async function getRows(filter: Filter, limit = 200): Promise<ReviewRow[]> {
  type Row = {
    id: number;
    institution_id: number;
    institution_name: string;
    state_code: string | null;
    fee_category: string;
    fee_name: string | null;
    amount: string | null;
    frequency: string | null;
    confidence: string | null;
    review_status: string;
    knox_findings: string;
    created_at: string;
  };

  let statusClause;
  if (filter === "pending") statusClause = sql`fv.review_status = 'pending'`;
  else if (filter === "flagged") statusClause = sql`fv.review_status = 'flagged'`;
  else if (filter === "auto_approved") statusClause = sql`fv.review_status = 'auto_approved'`;
  else statusClause = sql`fv.review_status IN ('pending','flagged','auto_approved')`;

  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      SELECT
        fv.id, fv.institution_id, i.name AS institution_name, i.state_code,
        fv.fee_category, fv.fee_name,
        fv.amount::text AS amount,
        fv.frequency,
        fv.confidence::text AS confidence,
        fv.review_status,
        COALESCE((
          SELECT COUNT(*)::text
          FROM agent_events ae
          WHERE ae.agent='knox'
            AND ae.payload->>'fees_verified_id' = fv.id::text
            AND ae.status IN ('failed','skipped')
        ), '0') AS knox_findings,
        fv.created_at::text AS created_at
      FROM fees_verified fv
      JOIN institutions i ON i.id = fv.institution_id
      WHERE fv.superseded_by IS NULL
        AND ${statusClause}
      ORDER BY fv.created_at DESC
      LIMIT ${limit}
    `;
  } catch {
    return [];
  }
  return rows.map((r) => ({
    id: r.id,
    institution_id: r.institution_id,
    institution_name: r.institution_name,
    state_code: r.state_code,
    fee_category: r.fee_category,
    fee_name: r.fee_name,
    amount: r.amount ? Number(r.amount) : null,
    frequency: r.frequency,
    confidence: r.confidence ? Number(r.confidence) : null,
    review_status: r.review_status,
    knox_findings: Number(r.knox_findings ?? 0),
    created_at: r.created_at,
  }));
}

export default async function AdminReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const filter: Filter = (
    sp.status === "flagged" || sp.status === "auto_approved" || sp.status === "all"
      ? sp.status
      : "pending"
  ) as Filter;

  const [counts, rows] = await Promise.all([getCounts(), getRows(filter)]);

  const filterPills: Filter[] = ["pending", "flagged", "auto_approved", "all"];

  return (
    <main className="px-10 py-10 max-w-[1400px] mx-auto space-y-8">
      <header>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
          Human-in-the-loop
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Review queue</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-2 max-w-2xl">
          Adjudicate fees Darwin/Knox could not auto-approve. Approve to publish, reject
          to drop. Click a row to see the source evidence side-by-side with Darwin&rsquo;s
          extraction.
        </p>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatTile label="Pending"        value={counts.pending}        tone="amber" />
        <StatTile label="Flagged"        value={counts.flagged}        tone="rose"  />
        <StatTile label="Auto-approved"  value={counts.auto_approved}  tone="emerald" />
        <StatTile label="Approved"       value={counts.approved}       tone="neutral" />
        <StatTile label="Rejected"       value={counts.rejected}       tone="neutral" />
      </section>

      <section>
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {filterPills.map((f) => {
            const active = f === filter;
            const count =
              f === "pending" ? counts.pending :
              f === "flagged" ? counts.flagged :
              f === "auto_approved" ? counts.auto_approved :
              counts.pending + counts.flagged + counts.auto_approved;
            return (
              <Link
                key={f}
                href={`/admin/review?status=${f}`}
                className={
                  "px-3 py-1.5 text-xs rounded-full border transition-colors " +
                  (active
                    ? "bg-[var(--color-admin-accent-soft)] border-[var(--color-admin-accent)] text-[var(--color-admin-accent)] font-semibold"
                    : "border-[var(--color-admin-border)] text-[var(--color-admin-text-muted)] hover:bg-[var(--color-admin-surface-2)]")
                }
              >
                {FILTER_LABELS[f]}
                <span className="ml-2 tabular-nums opacity-70">{count.toLocaleString()}</span>
              </Link>
            );
          })}
        </div>

        <ReviewQueueTable rows={rows} />
      </section>
    </main>
  );
}

function StatTile({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "rose" | "emerald" | "neutral";
}) {
  const accent: Record<typeof tone, string> = {
    amber: "text-amber-400",
    rose: "text-rose-400",
    emerald: "text-emerald-400",
    neutral: "text-[var(--color-admin-text-muted)]",
  };
  return (
    <div className="admin-card p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-1.5">
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${accent[tone]}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
