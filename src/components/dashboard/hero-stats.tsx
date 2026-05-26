import { Building2, Globe, BadgeCheck, FileText, ArrowUpRight } from "lucide-react";
import { formatCount } from "@/lib/format";
import type { OpsHeroStats } from "@/lib/queries";

type HeroCardProps = {
  label: string;
  value: number;
  deltaToday: number;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  tint: string;
};

function HeroCard({ label, value, deltaToday, icon: Icon, tint }: HeroCardProps) {
  return (
    <div className="admin-card-lift p-8">
      <div className="flex items-center justify-between mb-6">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: tint }}
        >
          <Icon size={18} strokeWidth={1.75} className="text-[var(--color-admin-text)]" />
        </div>
        {deltaToday > 0 && (
          <div className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-status-ok)] bg-[var(--color-status-ok)]/10 px-2 py-1 rounded-full">
            <ArrowUpRight size={12} strokeWidth={2.25} />
            +{formatCount(deltaToday)} today
          </div>
        )}
      </div>
      <div className="text-5xl font-bold tabular tracking-tight leading-none">
        {formatCount(value)}
      </div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mt-4 font-semibold">
        {label}
      </div>
    </div>
  );
}

export function HeroStats({ stats }: { stats: OpsHeroStats }) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <HeroCard
        label="Institutions"
        value={stats.institutions}
        deltaToday={stats.institutionsAddedToday}
        icon={Building2}
        tint="rgba(99, 102, 241, 0.16)"
      />
      <HeroCard
        label="Discovered URLs"
        value={stats.urls}
        deltaToday={stats.urlsAddedToday}
        icon={Globe}
        tint="rgba(56, 189, 248, 0.16)"
      />
      <HeroCard
        label="Verified Fees"
        value={stats.feesVerified}
        deltaToday={stats.feesAddedToday}
        icon={BadgeCheck}
        tint="rgba(74, 222, 128, 0.16)"
      />
      <HeroCard
        label="Reports Generated"
        value={stats.reports}
        deltaToday={stats.reportsAddedToday}
        icon={FileText}
        tint="rgba(215, 90, 58, 0.18)"
      />
    </section>
  );
}
