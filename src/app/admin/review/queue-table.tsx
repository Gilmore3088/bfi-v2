"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export type ReviewRow = {
  id: number;
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  fee_category: string;
  fee_name: string | null;
  amount: number | null;
  frequency: string | null;
  confidence: number | null;
  review_status: string;
  knox_findings: number;
  created_at: string;
};

export function ReviewQueueTable({ rows }: { rows: ReviewRow[] }): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});

  async function act(id: number, action: "approve" | "reject"): Promise<void> {
    setBusyId(id);
    setErrors((p) => {
      const n = { ...p }; delete n[id]; return n;
    });
    try {
      const r = await fetch(`/api/review/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({ message: `HTTP ${r.status}` }));
        setErrors((p) => ({ ...p, [id]: j.message ?? "failed" }));
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setErrors((p) => ({ ...p, [id]: e instanceof Error ? e.message : "failed" }));
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="admin-card p-8 border-dashed text-center">
        <div className="text-sm font-semibold mb-1">No fees in this view</div>
        <p className="text-xs text-[var(--color-admin-text-muted)]">
          Try a different filter, or wait for Darwin/Knox to produce new candidates.
        </p>
      </div>
    );
  }

  return (
    <div className="admin-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-admin-surface-2)]">
          <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
            <th className="px-4 py-2.5 text-left font-semibold">Institution</th>
            <th className="px-4 py-2.5 text-left font-semibold">Category</th>
            <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
            <th className="px-4 py-2.5 text-left font-semibold">Frequency</th>
            <th className="px-4 py-2.5 text-right font-semibold">Confidence</th>
            <th className="px-4 py-2.5 text-center font-semibold">Knox</th>
            <th className="px-4 py-2.5 text-left font-semibold">Status</th>
            <th className="px-4 py-2.5 text-right font-semibold">Decide</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const busy = busyId === r.id || pending;
            const err = errors[r.id];
            return (
              <tr
                key={r.id}
                className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/institutions/${r.institution_id}`}
                    className="font-medium hover:underline"
                  >
                    {r.institution_name}
                  </Link>
                  {r.state_code && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)]">
                      {r.state_code}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/review/${r.id}`}
                    className="text-[var(--color-admin-text-muted)] hover:text-[var(--color-admin-text)] hover:underline"
                  >
                    {r.fee_category}
                  </Link>
                  {r.fee_name && (
                    <div className="text-[11px] text-[var(--color-admin-text-dim)] truncate max-w-[260px]">
                      {r.fee_name}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.amount != null ? `$${r.amount.toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-3 text-[var(--color-admin-text-muted)]">
                  {r.frequency ?? "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : "—"}
                </td>
                <td className="px-4 py-3 text-center">
                  {r.knox_findings > 0 ? (
                    <span
                      className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/30 tabular-nums"
                      title={`${r.knox_findings} Knox finding(s) attached to this fee`}
                    >
                      {r.knox_findings}
                    </span>
                  ) : (
                    <span className="text-[var(--color-admin-text-dim)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={r.review_status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-2">
                    <Link
                      href={`/admin/review/${r.id}`}
                      className="text-[11px] px-2 py-1 rounded border border-[var(--color-admin-border)] text-[var(--color-admin-text-muted)] hover:bg-[var(--color-admin-surface-2)]"
                    >
                      Detail
                    </Link>
                    <button
                      disabled={busy}
                      onClick={() => act(r.id, "approve")}
                      className="text-[11px] px-3 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-40 font-semibold"
                    >
                      ✓ Approve
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => act(r.id, "reject")}
                      className="text-[11px] px-3 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 disabled:opacity-40 font-semibold"
                    >
                      ✗ Reject
                    </button>
                  </div>
                  {err && (
                    <div className="text-[10px] text-rose-400 mt-1 text-right">{err}</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: string }): React.ReactElement {
  const palette: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    flagged: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    auto_approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    rejected: "bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-dim)] border-[var(--color-admin-border)]",
  };
  const cls =
    palette[status] ?? "bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)] border-[var(--color-admin-border)]";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}
