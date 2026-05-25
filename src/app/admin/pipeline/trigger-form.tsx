"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const STAGE_LABELS = [
  "Ingest FDIC banks",
  "Magellan — discover URLs",
  "Atlas — crawl + store raw",
  "Darwin — classify via Claude",
  "Knox — review for issues",
];

type StageState = {
  status: "idle" | "running" | "ok" | "fail";
  detail?: string;
};

export function PipelineTriggerForm({ currentTotals }: { currentTotals: { institutions: number } }) {
  const [state, setState] = useState("FL");
  const [running, setRunning] = useState(false);
  const router = useRouter();
  const [stages, setStages] = useState<StageState[]>(
    STAGE_LABELS.map(() => ({ status: "idle" }))
  );

  async function fire() {
    if (running) return;
    setRunning(true);
    setStages(STAGE_LABELS.map(() => ({ status: "idle" })));

    try {
      const resp = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state, limit: 200 }),
      });

      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => "");
        setStages((prev) =>
          prev.map((s, i) => (i === 0 ? { status: "fail", detail: text || `HTTP ${resp.status}` } : s))
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
            const evt = JSON.parse(line);
            setStages((prev) =>
              prev.map((s, i) =>
                i === evt.index ? { status: evt.status, detail: evt.detail } : s
              )
            );
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (e: unknown) {
      setStages((prev) =>
        prev.map((s, i) =>
          i === 0 ? { status: "fail", detail: e instanceof Error ? e.message : String(e) } : s
        )
      );
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <label className="text-sm text-[var(--color-admin-text-muted)]">State</label>
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          disabled={running}
          className="bg-[var(--color-admin-elev)] border border-[var(--color-admin-border)] rounded px-3 py-1.5 text-sm font-mono"
        >
          {STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          onClick={fire}
          disabled={running}
          className="bg-[var(--color-accent,#d97706)] text-white px-4 py-1.5 text-sm font-semibold rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? "Running…" : `Run pipeline for ${state}`}
        </button>
      </div>

      <div className="space-y-2">
        {STAGE_LABELS.map((label, i) => {
          const s = stages[i];
          const color =
            s.status === "ok" ? "#10b981" :
            s.status === "fail" ? "#ef4444" :
            s.status === "running" ? "#d97706" :
            "var(--color-admin-border)";
          const icon =
            s.status === "ok" ? "✓" :
            s.status === "fail" ? "✗" :
            s.status === "running" ? "⋯" :
            "○";
          return (
            <div
              key={i}
              className="flex items-center gap-3 text-sm border-l-2 pl-3 py-1.5"
              style={{ borderColor: color }}
            >
              <span className="w-5 text-center tabular" style={{ color }}>{icon}</span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)] w-16 flex-shrink-0">
                Stage {i}
              </span>
              <span className="font-medium w-56 flex-shrink-0">{label}</span>
              {s.detail && (
                <span className="text-[var(--color-admin-text-muted)] text-xs font-mono truncate flex-1">
                  {s.detail}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 text-xs text-[var(--color-admin-text-dim)]">
        Currently in DB: {currentTotals.institutions} institutions. Hamilton report is a separate
        action (use /admin/hamilton to generate after pipeline finishes).
      </div>
    </div>
  );
}
