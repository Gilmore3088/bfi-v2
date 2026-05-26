"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  id: number;
  institutionName: string;
  stateCode: string | null;
  feeName: string | null;
  amount: number | null;
  frequency: string | null;
  evidenceQuote: string | null;
  confidence: number | null;
  categories: ReadonlyArray<string>;
};

export function PromoteRow(props: Props): React.ReactElement {
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<boolean>(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onPromote = (): void => {
    if (!selected) {
      setError("Pick a category");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await fetch("/api/taxonomy/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fees_verified_id: props.id, new_category: selected }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        setError(j.message || "Failed");
        return;
      }
      setDone(true);
      router.refresh();
    });
  };

  if (done) {
    return (
      <tr className="border-t border-[var(--color-admin-border)] opacity-50">
        <td colSpan={8} className="px-4 py-3 text-[var(--color-admin-text-muted)]">
          Promoted to {selected}.
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-[var(--color-admin-border)]">
      <td className="px-4 py-3">
        <div className="font-medium">{props.institutionName}</div>
        {props.stateCode && (
          <div className="text-[11px] text-[var(--color-admin-text-dim)]">
            {props.stateCode}
          </div>
        )}
      </td>
      <td className="px-4 py-3">{props.feeName || "—"}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {props.amount != null ? `$${props.amount.toFixed(2)}` : "—"}
      </td>
      <td className="px-4 py-3 text-[var(--color-admin-text-muted)]">
        {props.frequency || "—"}
      </td>
      <td className="px-4 py-3 max-w-[28ch] text-[12px] text-[var(--color-admin-text-muted)] truncate">
        {props.evidenceQuote || "—"}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {props.confidence != null ? props.confidence.toFixed(2) : "—"}
      </td>
      <td className="px-4 py-3">
        <select
          className="bg-[var(--color-admin-surface)] border border-[var(--color-admin-border)] rounded px-2 py-1 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select category…</option>
          {props.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {error && (
          <div className="text-[11px] text-red-400 mt-1">{error}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onPromote}
          disabled={pending || !selected}
          className="text-sm px-3 py-1 rounded bg-[var(--color-admin-accent)] text-white disabled:opacity-40"
        >
          {pending ? "Promoting…" : "Promote"}
        </button>
      </td>
    </tr>
  );
}
