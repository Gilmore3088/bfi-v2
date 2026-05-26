"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  feeId: number;
  rawId: number;
  openHref: string;
  currentStatus: string;
};

export function ReviewActions({ feeId, rawId, openHref, currentStatus }: Props): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(action: "approve" | "reject"): Promise<void> {
    setBusy(action);
    setErr(null);
    try {
      const r = await fetch(`/api/review/${feeId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({ message: `HTTP ${r.status}` }));
        setErr(j.message ?? "failed");
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  }

  const terminal = currentStatus === "approved" || currentStatus === "rejected";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <button
          onClick={() => act("approve")}
          disabled={busy !== null || terminal}
          className="text-xs px-3 py-1.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-40 font-semibold"
        >
          {busy === "approve" ? "Approving…" : "✓ Approve"}
        </button>
        <button
          onClick={() => act("reject")}
          disabled={busy !== null || terminal}
          className="text-xs px-3 py-1.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 disabled:opacity-40 font-semibold"
        >
          {busy === "reject" ? "Rejecting…" : "✗ Reject"}
        </button>
        <Link
          href={`/admin/raw/${rawId}`}
          className="text-xs px-3 py-1.5 rounded border border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)]"
        >
          Re-extract
        </Link>
        <a
          href={openHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 rounded border border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)]"
        >
          Open original
        </a>
      </div>
      {terminal && (
        <div className="text-[11px] text-[var(--color-admin-text-dim)]">
          Already <span className="font-mono">{currentStatus}</span>
        </div>
      )}
      {err && (
        <div className="text-[11px] text-rose-400">{err}</div>
      )}
    </div>
  );
}
