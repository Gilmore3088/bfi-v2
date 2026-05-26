import { sql } from "@/lib/db";
import { getPipelineStageStats, type AgentName } from "@/lib/queries";
import { PipelineTriggerForm } from "./trigger-form";
import { PipelineQueueBulkForm } from "./queue-bulk-form";
import { LiveActivity } from "@/components/live-activity";
import { StageCard } from "@/components/dashboard/stage-card";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadInstitutionCount(): Promise<number> {
  try {
    const [r] = await sql<{ c: string }[]>`SELECT COUNT(*)::text AS c FROM institutions`;
    return Number(r?.c ?? 0);
  } catch {
    return 0;
  }
}

const STAGE_META: {
  agent: AgentName;
  n: number;
  title: string;
  description: string;
  inputLabel: string;
  outputLabel: string;
  writes: string;
}[] = [
  {
    agent: "magellan",
    n: 1,
    title: "Magellan · Discover URLs",
    description: "Searches each institution's website for the fee-schedule landing page or PDF link.",
    inputLabel: "Institutions with a website",
    outputLabel: "Active fee URLs",
    writes: "institution_urls",
  },
  {
    agent: "atlas",
    n: 2,
    title: "Atlas · Crawl + Store",
    description: "Fetches each discovered URL, normalizes HTML/PDF, and stores the raw artifact in R2.",
    inputLabel: "Discovered URLs",
    outputLabel: "Raw schedules captured",
    writes: "fees_raw, R2",
  },
  {
    agent: "darwin",
    n: 3,
    title: "Darwin · LLM Classify",
    description: "Runs Claude on each raw schedule to extract structured fees and confidence scores.",
    inputLabel: "Raw schedules",
    outputLabel: "Verified fees",
    writes: "fees_verified",
  },
  {
    agent: "knox",
    n: 4,
    title: "Knox · Adversarial Review",
    description: "Audits Darwin output, auto-approves high-confidence rows (≥0.90), flags the rest.",
    inputLabel: "Verified fees",
    outputLabel: "Auto-approved",
    writes: "agent_events, fees_verified.review_status",
  },
  {
    agent: "hamilton",
    n: 5,
    title: "Hamilton · LLM Analyst",
    description: "Generates institution/category/peer research reports from approved fee data. On demand.",
    inputLabel: "Verified fees",
    outputLabel: "Reports published",
    writes: "reports",
  },
];

export default async function PipelinePage() {
  const [stages, instCount] = await Promise.all([
    getPipelineStageStats(),
    loadInstitutionCount(),
  ]);
  const statsByAgent = new Map(stages.map((s) => [s.agent, s]));

  return (
    <main className="px-10 py-10 max-w-[1400px] mx-auto space-y-12">
      <header>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
          End-to-end tracker
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Pipeline</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-2 max-w-2xl">
          Trigger a state-scoped run and watch each stage drain. Every counter is
          live from staging Postgres.
        </p>
      </header>

      <section className="admin-card-lift p-8">
        <div className="flex items-baseline justify-between mb-2 gap-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Run a state</h2>
            <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
              Ingest from FDIC, then Magellan → Atlas → Darwin → Knox in sequence.
              Hamilton runs separately after the queue is approved.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)] font-semibold">
              Roster
            </div>
            <div className="text-2xl font-bold tabular mt-1">{instCount.toLocaleString()}</div>
            <div className="text-[11px] text-[var(--color-admin-text-muted)]">institutions seeded</div>
          </div>
        </div>
        <div className="mt-6">
          <PipelineTriggerForm currentTotals={{ institutions: instCount }} />
        </div>
      </section>

      <section className="admin-card-lift p-8">
        <div className="mb-2">
          <h2 className="text-lg font-semibold tracking-tight">Queue multiple states</h2>
          <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
            Pick states to drain in sequence. Each state runs ingest → Magellan → Atlas →
            Darwin → Knox before moving to the next.
          </p>
        </div>
        <div className="mt-6">
          <PipelineQueueBulkForm />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Stages</h2>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold">
            5 agents · sequential
          </div>
        </div>
        {STAGE_META.map((meta) => {
          const s = statsByAgent.get(meta.agent);
          return (
            <StageCard
              key={meta.agent}
              n={meta.n}
              title={meta.title}
              description={meta.description}
              inputLabel={meta.inputLabel}
              inputValue={s?.inputCount ?? 0}
              outputLabel={meta.outputLabel}
              outputValue={s?.outputCount ?? 0}
              lastRunAt={s?.lastRunAt ?? null}
              lastStatus={s?.lastStatus ?? null}
              throughputPerMin={s?.throughputPerMin ?? null}
              writes={meta.writes}
            />
          );
        })}
      </section>

      <section className="admin-card-lift p-8">
        <LiveActivity />
      </section>
    </main>
  );
}
