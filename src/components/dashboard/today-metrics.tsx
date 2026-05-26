import { DollarSign, FileText, BadgeCheck, Target } from "lucide-react";
import { formatCount } from "@/lib/format";
import type { TodayMetrics } from "@/lib/queries";

function MetricRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-[var(--color-admin-border)]/60 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-[var(--color-admin-surface-2)] flex items-center justify-center text-[var(--color-admin-text-muted)]">
          <Icon size={14} strokeWidth={1.75} />
        </div>
        <div className="text-sm text-[var(--color-admin-text-muted)]">{label}</div>
      </div>
      <div className="text-base font-semibold tabular">{value}</div>
    </div>
  );
}

export function TodayMetricsCard({ metrics }: { metrics: TodayMetrics }) {
  const cost = (metrics.costCentsToday / 100).toFixed(2);
  const hitRate = metrics.hitRate === null ? "—" : `${(metrics.hitRate * 100).toFixed(0)}%`;

  return (
    <div className="admin-card-lift p-8 h-full">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-1">
          Today
        </div>
        <h3 className="text-base font-semibold tracking-tight">Operational metrics</h3>
      </div>
      <MetricRow label="Claude API spend"      value={`$${cost}`}                 icon={DollarSign} />
      <MetricRow label="Documents processed"   value={formatCount(metrics.docsToday)}  icon={FileText} />
      <MetricRow label="Fees extracted"        value={formatCount(metrics.feesToday)}  icon={BadgeCheck} />
      <MetricRow label="Magellan hit rate"     value={hitRate}                    icon={Target} />
    </div>
  );
}
