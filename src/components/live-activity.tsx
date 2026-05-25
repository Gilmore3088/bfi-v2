"use client";

import { useEffect, useState } from "react";

type ActiveRun = {
  run_id: string;
  agent: string;
  started_at: string;
  target_state: string | null;
  events_succeeded: number;
  events_skipped: number;
  events_failed: number;
};

type RecentEvent = {
  created_at: string;
  agent: string;
  status: string;
  institution_name: string | null;
  found_url: string | null;
  confidence: number | null;
};

export function LiveActivity() {
  const [active, setActive] = useState<ActiveRun[]>([]);
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ts, setTs] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch("/api/agents/live", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (j.error) {
          setError(j.error);
        } else {
          setActive(j.active || []);
          setRecent(j.recent || []);
          setTs(j.ts);
          setError(null);
        }
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  function age(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    return `${Math.floor(ms / 3_600_000)}h`;
  }

  async function cancel(agent: string) {
    if (!confirm(`Cancel ${agent} run? Process is SIGTERM'd and the agent_runs row marked failed.`)) return;
    try {
      const r = await fetch("/api/agents/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent }),
      });
      const j = await r.json();
      if (!r.ok) setError(j.error || `HTTP ${r.status}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)]">
          Live activity {ts > 0 && <span className="ml-2 text-[var(--color-status-ok,#10b981)]">●</span>}
        </div>
        <div className="text-[10px] text-[var(--color-admin-text-dim)]">
          {ts > 0 ? `polled ${age(new Date(ts).toISOString())} ago` : "connecting…"}
        </div>
      </div>

      {error && (
        <div className="text-xs text-[var(--color-status-err,#ef4444)] mb-3">
          poll error: {error}
        </div>
      )}

      <div className="mb-5">
        <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)] mb-2">
          In-progress runs
        </div>
        {active.length === 0 ? (
          <div className="text-sm text-[var(--color-admin-text-muted)]">
            No agents currently running.
          </div>
        ) : (
          <div className="space-y-2">
            {active.map((r) => {
              const total = r.events_succeeded + r.events_skipped + r.events_failed;
              return (
                <div
                  key={r.run_id}
                  className="border border-[var(--color-admin-border)] rounded p-3 text-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-bold uppercase tracking-wider mr-2">{r.agent}</span>
                      {r.target_state && (
                        <span className="text-xs font-mono bg-[var(--color-admin-elev)] px-2 py-0.5 rounded">
                          {r.target_state}
                        </span>
                      )}
                      <span className="text-xs text-[var(--color-admin-text-muted)] ml-2 font-mono">
                        {r.run_id.substring(0, 8)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--color-admin-text-muted)]">
                        running {age(r.started_at)}
                      </span>
                      <button
                        onClick={() => cancel(r.agent)}
                        className="text-xs px-2 py-0.5 rounded border border-[var(--color-status-err,#ef4444)] text-[var(--color-status-err,#ef4444)] hover:bg-[var(--color-status-err,#ef4444)] hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span><span className="font-bold text-[var(--color-status-ok,#10b981)] tabular">{r.events_succeeded}</span> hit</span>
                    <span><span className="font-bold tabular">{r.events_skipped}</span> skip</span>
                    {r.events_failed > 0 && (
                      <span><span className="font-bold text-[var(--color-status-err,#ef4444)] tabular">{r.events_failed}</span> fail</span>
                    )}
                    <span className="text-[var(--color-admin-text-muted)]">·</span>
                    <span className="tabular">{total} processed</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)] mb-2">
          Recent events (last 30)
        </div>
        {recent.length === 0 ? (
          <div className="text-sm text-[var(--color-admin-text-muted)]">No events yet.</div>
        ) : (
          <div className="text-xs space-y-0.5 max-h-80 overflow-y-auto font-mono">
            {recent.map((e, i) => (
              <div key={i} className="flex gap-2 items-baseline border-b border-[var(--color-admin-border)]/30 py-1">
                <span className="text-[var(--color-admin-text-dim)] w-10 flex-shrink-0">
                  {age(e.created_at)}
                </span>
                <span className="text-[var(--color-admin-text-muted)] w-16 flex-shrink-0">
                  {e.agent}
                </span>
                <span
                  className="w-14 flex-shrink-0 font-semibold"
                  style={{
                    color:
                      e.status === "succeeded" ? "var(--color-status-ok, #10b981)" :
                      e.status === "failed" ? "var(--color-status-err, #ef4444)" :
                      "var(--color-admin-text-muted)",
                  }}
                >
                  {e.status}
                </span>
                <span className="flex-1 truncate">
                  {e.institution_name || ""}
                  {e.found_url && (
                    <span className="text-[var(--color-admin-text-muted)] ml-1">
                      → {e.found_url}
                    </span>
                  )}
                  {e.confidence != null && (
                    <span className="text-[var(--color-admin-text-dim)] ml-1">
                      ({Number(e.confidence).toFixed(2)})
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
