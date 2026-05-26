import { getOpsHeroStats, getPipelineStageStats, getTodayMetrics } from "@/lib/queries";
import { HeroStats } from "@/components/dashboard/hero-stats";
import { PipelineFlow } from "@/components/dashboard/pipeline-flow";
import { TodayMetricsCard } from "@/components/dashboard/today-metrics";
import { LiveActivity } from "@/components/live-activity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminDashboard() {
  const [hero, stages, today] = await Promise.all([
    getOpsHeroStats(),
    getPipelineStageStats(),
    getTodayMetrics(),
  ]);

  return (
    <main className="px-10 py-10 max-w-[1400px] mx-auto space-y-12">
      <header>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
          Operator command center
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-2 max-w-2xl">
          Live state of the Bank Fee Index pipeline. Track the full flow from
          institution roster through to published reports.
        </p>
      </header>

      <HeroStats stats={hero} />

      <PipelineFlow stages={stages} />

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 admin-card-lift p-8">
          <LiveActivity />
        </div>
        <div>
          <TodayMetricsCard metrics={today} />
        </div>
      </section>
    </main>
  );
}
