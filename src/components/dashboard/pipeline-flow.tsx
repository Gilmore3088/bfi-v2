import { Compass, Globe, GitBranch, ShieldCheck, FileText, ChevronRight } from "lucide-react";
import { formatCount, timeAgo } from "@/lib/format";
import type { PipelineStageStat } from "@/lib/queries";

const AGENT_META: Record<string, { label: string; role: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }> = {
  magellan: { label: "Magellan", role: "Discover", icon: Compass },
  atlas: { label: "Atlas", role: "Crawl", icon: Globe },
  darwin: { label: "Darwin", role: "Classify", icon: GitBranch },
  knox: { label: "Knox", role: "Review", icon: ShieldCheck },
  hamilton: { label: "Hamilton", role: "Analyze", icon: FileText },
};

function statusTone(status: string | null): { ring: string; dot: string; label: string; pulse: boolean } {
  if (status === "running") return { ring: "ring-[var(--color-status-ok)]/45", dot: "bg-[var(--color-status-ok)]", label: "running", pulse: true };
  if (status === "failed") return { ring: "ring-[var(--color-status-err)]/45", dot: "bg-[var(--color-status-err)]", label: "failed", pulse: false };
  if (status === "succeeded") return { ring: "ring-[var(--color-admin-border-strong)]", dot: "bg-[var(--color-status-ok)]", label: "idle", pulse: false };
  return { ring: "ring-[var(--color-admin-border)]", dot: "bg-[var(--color-admin-text-dim)]", label: "never run", pulse: false };
}

export function PipelineFlow({ stages }: { stages: PipelineStageStat[] }) {
  return (
    <section className="admin-card-lift p-8">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">End-to-end pipeline</h2>
          <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
            Five agents, one directed graph. Live counts from staging Postgres.
          </p>
        </div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold">
          Magellan → Hamilton
        </div>
      </div>

      <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
        {stages.map((s, i) => {
          const meta = AGENT_META[s.agent];
          const Icon = meta.icon;
          const tone = statusTone(s.lastStatus);
          return (
            <div key={s.agent} className="flex items-center gap-2 flex-shrink-0">
              <div
                className={`flex flex-col items-center justify-between min-w-[160px] p-5 rounded-xl bg-[var(--color-admin-surface-2)] border border-[var(--color-admin-border)] ring-2 ${tone.ring} ${tone.pulse ? "pulse-ring-ok" : ""}`}
              >
                <div className="flex items-center justify-between w-full mb-3">
                  <div className="w-9 h-9 rounded-lg bg-[var(--color-admin-surface)] flex items-center justify-center border border-[var(--color-admin-border)]">
                    <Icon size={16} strokeWidth={1.75} />
                  </div>
                  <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
                </div>
                <div className="w-full">
                  <div className="text-sm font-semibold">{meta.label}</div>
                  <div className="text-[11px] text-[var(--color-admin-text-dim)] uppercase tracking-wider">
                    {meta.role}
                  </div>
                </div>
                <div className="w-full mt-4 pt-4 border-t border-[var(--color-admin-border)]">
                  <div className="text-2xl font-bold tabular leading-none">
                    {formatCount(s.outputCount)}
                  </div>
                  <div className="text-[11px] text-[var(--color-admin-text-muted)] mt-1.5">
                    {s.lastRunAt ? `last ${timeAgo(s.lastRunAt)}` : "never run"}
                  </div>
                  {s.throughputPerMin !== null && (
                    <div className="text-[10px] text-[var(--color-admin-text-dim)] mt-1 tabular">
                      {s.throughputPerMin.toFixed(1)}/min
                    </div>
                  )}
                </div>
              </div>

              {i < stages.length - 1 && (
                <ChevronRight
                  size={20}
                  className="text-[var(--color-admin-text-dim)] flex-shrink-0"
                  strokeWidth={1.5}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
