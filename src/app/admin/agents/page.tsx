import { getAgentFleetStatus, AGENT_NAMES, AgentName } from "@/lib/queries";
import { formatCount, formatPct, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  magellan: "Discovery — finds fee schedule URLs on institution websites",
  atlas: "Extraction — pulls fees_raw from PDFs and HTML pages",
  darwin: "Classification — maps raw fees to taxonomy categories",
  knox: "Verification — promotes high-confidence fees into fees_verified",
  hamilton: "Synthesis — produces McKinsey-grade research reports",
};

export default async function AdminAgentsPage() {
  const fleet = await getAgentFleetStatus();
  const filter = "all"; // placeholder for future tab interactivity
  const visible = filter === "all" ? fleet : fleet.filter((f) => f.agent === filter);

  const totalRuns = fleet.reduce((s, f) => s + f.runs_30d, 0);
  const totalFailures = fleet.reduce((s, f) => s + f.failures_30d, 0);
  const totalCost = fleet.reduce((s, f) => s + f.cost_cents_30d, 0);
  const liveAgents = fleet.filter((f) => f.last_run_at).length;

  return (
    <main className="px-8 py-6 max-w-7xl">
      <header className="mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
          Admin / Agents
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Agent Fleet</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-1">
          Five agents, last 30 days. Cron schedules trigger Modal workers that
          insert rows into agent_runs.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Agents" value={`${liveAgents} / ${fleet.length}`} sub="with a recorded run" />
        <StatCard label="Runs (30d)" value={formatCount(totalRuns)} sub="across all agents" />
        <StatCard label="Failures (30d)" value={formatCount(totalFailures)} sub="status = failed" />
        <StatCard label="Spend (30d ¢)" value={formatCount(totalCost)} sub="cost_cents sum" />
      </section>

      <nav className="flex gap-2 mb-4 text-xs">
        <Tab href="?" label="All" active={true} />
        {AGENT_NAMES.map((a) => (
          <Tab key={a} href={`?agent=${a}`} label={a} active={false} />
        ))}
      </nav>

      {totalRuns === 0 ? (
        <EmptyHero
          title="No agent runs recorded yet"
          body="Once Magellan, Atlas, Darwin, Knox, and Hamilton begin firing on their cron schedules they will insert rows into agent_runs. This page rolls up the last 30 days per agent."
        />
      ) : null}

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-admin-surface-2)]">
            <tr className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
              <Th className="text-left">Agent</Th>
              <Th className="text-left">Role</Th>
              <Th className="text-left">Last run</Th>
              <Th className="text-left">Last status</Th>
              <Th className="text-right">Runs (30d)</Th>
              <Th className="text-right">Success rate</Th>
              <Th className="text-right">Items</Th>
              <Th className="text-right">Cost (¢)</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f) => (
              <tr
                key={f.agent}
                className="border-t border-[var(--color-admin-border)] hover:bg-[var(--color-admin-surface-2)]/50 transition-colors"
              >
                <Td className="font-medium capitalize">{f.agent}</Td>
                <Td className="text-[var(--color-admin-text-muted)] text-xs">
                  {AGENT_DESCRIPTIONS[f.agent]}
                </Td>
                <Td className="text-[var(--color-admin-text-muted)]">
                  {f.last_run_at ? timeAgo(f.last_run_at) : "never"}
                </Td>
                <Td>
                  {f.last_status ? (
                    <StatusPill status={f.last_status} />
                  ) : (
                    <span className="text-[var(--color-admin-text-dim)]">—</span>
                  )}
                </Td>
                <Td className="text-right tabular-nums">{formatCount(f.runs_30d)}</Td>
                <Td className="text-right tabular-nums">
                  {f.success_rate === null ? "—" : formatPct(f.success_rate)}
                </Td>
                <Td className="text-right tabular-nums">{formatCount(f.items_processed_30d)}</Td>
                <Td className="text-right tabular-nums">{formatCount(f.cost_cents_30d)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="admin-card p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-[var(--color-admin-text-dim)] mt-1 font-mono">{sub}</div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>;
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <a
      href={href}
      className={
        "px-3 py-1.5 rounded border text-xs uppercase tracking-wider " +
        (active
          ? "border-[var(--color-admin-accent)] text-[var(--color-admin-text)] bg-[var(--color-admin-surface-2)]"
          : "border-[var(--color-admin-border)] text-[var(--color-admin-text-muted)] hover:text-[var(--color-admin-text)]")
      }
    >
      {label}
    </a>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    started: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    in_progress: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    succeeded: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    failed: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    skipped: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  };
  const cls =
    palette[status] ?? "bg-[var(--color-admin-surface-2)] text-[var(--color-admin-text-muted)]";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}

function EmptyHero({ title, body }: { title: string; body: string }) {
  return (
    <div className="admin-card p-5 mb-6 border-dashed">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-1">
        Empty state
      </div>
      <div className="text-sm font-semibold mb-1">{title}</div>
      <p className="text-xs text-[var(--color-admin-text-muted)]">{body}</p>
    </div>
  );
}
