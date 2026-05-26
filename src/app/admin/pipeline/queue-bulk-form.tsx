"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

type RowState = {
  state: string;
  stage: string;
  status: "queued" | "running" | "ok" | "fail";
  detail?: string;
};

export function PipelineQueueBulkForm(): React.ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set(["FL"]));
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RowState[]>([]);
  const router = useRouter();

  function toggle(s: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function fire(): Promise<void> {
    if (running || selected.size === 0) return;
    setRunning(true);
    const orderedStates = Array.from(selected);
    setRows(orderedStates.flatMap((state) =>
      ["ingest", "magellan", "atlas", "darwin", "knox"].map((stage) => ({
        state, stage, status: "queued" as const,
      })),
    ));

    try {
      const resp = await fetch("/api/pipeline/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ states: orderedStates, limit: 200 }),
      });
      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => "");
        setRows((prev) =>
          prev.map((r, i) => (i === 0 ? { ...r, status: "fail", detail: text || `HTTP ${resp.status}` } : r)),
        );
        return;
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as { state: string; stage: string; status: "running" | "ok" | "fail"; detail?: string };
            setRows((prev) =>
              prev.map((r) =>
                r.state === evt.state && r.stage === evt.stage
                  ? { ...r, status: evt.status, detail: evt.detail }
                  : r,
              ),
            );
          } catch {
            // ignore
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRows((prev) => prev.map((r, i) => (i === 0 ? { ...r, status: "fail", detail: msg } : r)));
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-1">
            Selected
          </div>
          <div className="text-sm">
            {selected.size === 0 ? (
              <span className="text-[var(--color-admin-text-dim)]">none — click states below</span>
            ) : (
              <span className="font-mono">{Array.from(selected).join(", ")}</span>
            )}
          </div>
        </div>
        <button
          onClick={fire}
          disabled={running || selected.size === 0}
          className="bg-[var(--color-accent,#d97706)] text-white px-4 py-1.5 text-sm font-semibold rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? "Running…" : `Run all selected (${selected.size})`}
        </button>
      </div>

      <div className="grid grid-cols-10 gap-1 mb-6">
        {STATES.map((s) => {
          const active = selected.has(s);
          return (
            <button
              key={s}
              onClick={() => toggle(s)}
              disabled={running}
              className={
                "px-2 py-1.5 text-xs font-mono border rounded transition-colors " +
                (active
                  ? "bg-[var(--color-admin-accent-soft)] border-[var(--color-admin-accent)] text-[var(--color-admin-accent)]"
                  : "border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)]")
              }
            >
              {s}
            </button>
          );
        })}
      </div>

      {rows.length > 0 && (
        <div className="border border-[var(--color-admin-border)] rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-admin-surface-2)]">
              <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
                <th className="px-3 py-2 text-left font-semibold">State</th>
                <th className="px-3 py-2 text-left font-semibold">Stage</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-left font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const color =
                  r.status === "ok" ? "#10b981" :
                  r.status === "fail" ? "#ef4444" :
                  r.status === "running" ? "#d97706" :
                  "var(--color-admin-text-dim)";
                const icon =
                  r.status === "ok" ? "✓" :
                  r.status === "fail" ? "✗" :
                  r.status === "running" ? "⋯" : "○";
                return (
                  <tr
                    key={i}
                    className="border-t border-[var(--color-admin-border)]"
                  >
                    <td className="px-3 py-2 font-mono">{r.state}</td>
                    <td className="px-3 py-2 capitalize">{r.stage}</td>
                    <td className="px-3 py-2" style={{ color }}>
                      <span className="mr-1.5">{icon}</span>
                      {r.status}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-admin-text-muted)] font-mono truncate max-w-[420px]">
                      {r.detail ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
