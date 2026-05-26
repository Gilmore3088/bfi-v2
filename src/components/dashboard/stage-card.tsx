import { ArrowRight } from "lucide-react";
import { formatCount, timeAgo } from "@/lib/format";

type StageCardProps = {
  n: number;
  title: string;
  description: string;
  inputLabel: string;
  inputValue: number;
  outputLabel: string;
  outputValue: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  throughputPerMin: number | null;
  writes: string;
};

function statusPill(status: string | null) {
  if (status === "running")
    return { label: "Running", className: "bg-[var(--color-status-ok)]/15 text-[var(--color-status-ok)]" };
  if (status === "failed")
    return { label: "Failed", className: "bg-[var(--color-status-err)]/15 text-[var(--color-status-err)]" };
  if (status === "succeeded")
    return { label: "Idle", className: "bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)]" };
  return { label: "Never run", className: "bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-dim)]" };
}

export function StageCard(props: StageCardProps) {
  const pill = statusPill(props.lastStatus);
  const running = props.lastStatus === "running";

  return (
    <div className={`admin-card-lift p-8 ${running ? "ring-2 ring-[var(--color-status-ok)]/30" : ""}`}>
      <div className="flex items-start gap-6">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[var(--color-admin-surface-2)] border border-[var(--color-admin-border)] flex items-center justify-center text-base font-bold tabular">
          {props.n}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1 gap-4">
            <h3 className="text-lg font-semibold tracking-tight">{props.title}</h3>
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full ${pill.className}`}>
              {pill.label}
            </span>
          </div>
          <p className="text-sm text-[var(--color-admin-text-muted)] mb-6">
            {props.description}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] items-center gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)] font-semibold">
                Input
              </div>
              <div className="text-2xl font-bold tabular mt-1">{formatCount(props.inputValue)}</div>
              <div className="text-[11px] text-[var(--color-admin-text-muted)] mt-0.5">{props.inputLabel}</div>
            </div>
            <ArrowRight size={18} className="text-[var(--color-admin-text-dim)] hidden sm:block" strokeWidth={1.5} />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)] font-semibold">
                Output
              </div>
              <div className="text-2xl font-bold tabular mt-1">{formatCount(props.outputValue)}</div>
              <div className="text-[11px] text-[var(--color-admin-text-muted)] mt-0.5">{props.outputLabel}</div>
            </div>
            <div className="sm:text-right">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)] font-semibold">
                Last run
              </div>
              <div className="text-sm font-medium mt-1 tabular">
                {props.lastRunAt ? timeAgo(props.lastRunAt) : "—"}
              </div>
              <div className="text-[11px] text-[var(--color-admin-text-muted)] mt-0.5 tabular">
                {props.throughputPerMin !== null ? `${props.throughputPerMin.toFixed(1)}/min` : "no throughput"}
              </div>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-[var(--color-admin-border)] flex items-center justify-between text-[11px] text-[var(--color-admin-text-dim)]">
            <span className="uppercase tracking-wider font-semibold">Writes</span>
            <code className="font-mono">{props.writes}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
