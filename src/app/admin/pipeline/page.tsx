import { sql } from "@/lib/db";
import { formatCount } from "@/lib/format";
import { PipelineTriggerForm } from "./trigger-form";
import { LiveActivity } from "@/components/live-activity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PipelineState = {
  institutions: number;
  institutionsWithUrl: number;
  urlsDiscovered: number;
  rawFetched: number;
  feesVerified: number;
  feesAutoApproved: number;
  reportsGenerated: number;
  byState: { state_code: string; count: number }[];
};

async function loadPipelineState(): Promise<PipelineState> {
  const [row] = await sql<{
    institutions: string;
    with_url: string;
    discovered: string;
    raw: string;
    verified: string;
    auto: string;
    reports: string;
  }[]>`
    SELECT
      (SELECT COUNT(*)::text FROM institutions) AS institutions,
      (SELECT COUNT(*)::text FROM institutions WHERE website_url IS NOT NULL) AS with_url,
      (SELECT COUNT(*)::text FROM institution_urls WHERE is_active) AS discovered,
      (SELECT COUNT(*)::text FROM fees_raw) AS raw,
      (SELECT COUNT(*)::text FROM fees_verified) AS verified,
      (SELECT COUNT(*)::text FROM fees_verified WHERE review_status='auto_approved') AS auto,
      (SELECT COUNT(*)::text FROM reports) AS reports
  `;
  const byState = await sql<{ state_code: string; count: number }[]>`
    SELECT state_code, COUNT(*)::int AS count
    FROM institutions GROUP BY state_code ORDER BY count DESC, state_code LIMIT 15
  `;
  return {
    institutions: Number(row.institutions),
    institutionsWithUrl: Number(row.with_url),
    urlsDiscovered: Number(row.discovered),
    rawFetched: Number(row.raw),
    feesVerified: Number(row.verified),
    feesAutoApproved: Number(row.auto),
    reportsGenerated: Number(row.reports),
    byState,
  };
}

export default async function PipelinePage() {
  const state = await loadPipelineState();

  const stages = [
    {
      n: 1,
      agent: "Magellan",
      role: "URL Discovery",
      input: { label: "Institutions w/ website", value: state.institutionsWithUrl },
      output: { label: "Active fee URLs", value: state.urlsDiscovered },
      cmd: "python3 -m agents.magellan run --limit N",
      writes: "institution_urls, agent_events",
    },
    {
      n: 2,
      agent: "Atlas",
      role: "Crawl + R2",
      input: { label: "Discovered URLs", value: state.urlsDiscovered },
      output: { label: "Raw schedules stored", value: state.rawFetched },
      cmd: "python3 -m agents.atlas run --limit N",
      writes: "fees_raw, R2 bucket",
    },
    {
      n: 3,
      agent: "Darwin",
      role: "LLM Classifier",
      input: { label: "Raw schedules", value: state.rawFetched },
      output: { label: "Verified fees", value: state.feesVerified },
      cmd: "python3 -m agents.darwin drain --limit N",
      writes: "fees_verified (auto_approved ≥0.90)",
    },
    {
      n: 4,
      agent: "Knox",
      role: "Adversarial Review",
      input: { label: "Verified fees", value: state.feesVerified },
      output: { label: "Auto-approved", value: state.feesAutoApproved },
      cmd: "python3 -m agents.knox review --limit N",
      writes: "agent_events (flag findings)",
    },
    {
      n: 5,
      agent: "Hamilton",
      role: "LLM Analyst",
      input: { label: "Verified fees", value: state.feesVerified },
      output: { label: "Reports", value: state.reportsGenerated },
      cmd: "python3 -m agents.hamilton generate --type {institution|category|peer}",
      writes: "reports (markdown + cost_cents)",
    },
  ];

  return (
    <main className="px-8 py-6 max-w-6xl">
      <header className="mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
          End-to-end pipeline
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
          Five agents in a directed graph. Each stage reads from the previous stage&apos;s output table.
          Live counts pulled directly from staging Postgres.
        </p>
      </header>

      <section className="admin-card p-5 mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-4">
          Stage diagram
        </div>
        <div className="space-y-3">
          {stages.map((s, i) => (
            <div key={s.agent} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center w-12 flex-shrink-0">
                <div className="rounded-full w-10 h-10 flex items-center justify-center bg-[var(--color-admin-elev)] border border-[var(--color-admin-border)] text-sm font-bold tabular">
                  {s.n}
                </div>
                {i < stages.length - 1 && (
                  <div className="w-px flex-1 bg-[var(--color-admin-border)] my-1 min-h-[20px]" />
                )}
              </div>
              <div className="flex-1 admin-card p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <span className="text-base font-bold">{s.agent}</span>
                    <span className="text-xs text-[var(--color-admin-text-muted)] ml-2">{s.role}</span>
                  </div>
                  <code className="text-[10px] text-[var(--color-admin-text-dim)] font-mono">{s.writes}</code>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)]">In</div>
                    <div className="font-bold tabular">{formatCount(s.input.value)}</div>
                    <div className="text-[10px] text-[var(--color-admin-text-muted)]">{s.input.label}</div>
                  </div>
                  <div className="text-center self-center text-[var(--color-admin-text-dim)]">→</div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)]">Out</div>
                    <div className="font-bold tabular">{formatCount(s.output.value)}</div>
                    <div className="text-[10px] text-[var(--color-admin-text-muted)]">{s.output.label}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--color-admin-border)] text-[10px] font-mono text-[var(--color-admin-text-muted)]">
                  $ {s.cmd}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-card p-5 mb-6">
        <LiveActivity />
      </section>

      <section className="admin-card p-5 mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-3">
          Trigger pipeline by state
        </div>
        <p className="text-sm text-[var(--color-admin-text-muted)] mb-4">
          Pick a state. The orchestrator will ingest institutions from FDIC, then run Magellan
          → Atlas → Darwin → Knox in sequence on that subset. Hamilton runs on demand afterward.
        </p>
        <PipelineTriggerForm currentTotals={state} />
      </section>

      <section className="admin-card p-5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-3">
          Institutions by state (top 15)
        </div>
        {state.byState.length === 0 ? (
          <div className="text-sm text-[var(--color-admin-text-muted)]">
            No institutions seeded. Run the ingest above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)] border-b border-[var(--color-admin-border)]">
                <th className="py-2">State</th>
                <th className="py-2 text-right">Institutions</th>
              </tr>
            </thead>
            <tbody>
              {state.byState.map((s) => (
                <tr key={s.state_code} className="border-b border-[var(--color-admin-border)]/40 last:border-0">
                  <td className="py-2 font-mono">{s.state_code}</td>
                  <td className="py-2 text-right tabular">{formatCount(s.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
