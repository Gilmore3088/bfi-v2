import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { sql } from "@/lib/db";
import { agentProcs } from "@/lib/agent-procs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_ROOT = path.resolve(process.cwd());

async function summarizeStage(stage: string, state: string): Promise<string> {
  try {
    switch (stage) {
      case "ingest": {
        const [r] = await sql<{ banks: string; cus: string }[]>`
          SELECT
            COUNT(*) FILTER (WHERE charter_type='bank')::text AS banks,
            COUNT(*) FILTER (WHERE charter_type='credit_union')::text AS cus
          FROM institutions WHERE state_code=${state}
        `;
        return `${r.banks} banks · ${r.cus} CUs in ${state}`;
      }
      case "magellan": {
        const [r] = await sql<{ urls: string }[]>`
          SELECT COUNT(*)::text AS urls FROM institution_urls
          WHERE is_active AND institution_id IN (SELECT id FROM institutions WHERE state_code=${state})
        `;
        return `${r.urls} active fee URLs found`;
      }
      case "atlas": {
        const [r] = await sql<{ raw: string }[]>`
          SELECT COUNT(*)::text AS raw FROM fees_raw
          WHERE institution_id IN (SELECT id FROM institutions WHERE state_code=${state})
        `;
        return `${r.raw} raw schedules stored`;
      }
      case "darwin": {
        const [r] = await sql<{ verified: string; approved: string }[]>`
          SELECT
            COUNT(*)::text AS verified,
            COUNT(*) FILTER (WHERE review_status='auto_approved')::text AS approved
          FROM fees_verified
          WHERE institution_id IN (SELECT id FROM institutions WHERE state_code=${state})
        `;
        return `${r.verified} verified · ${r.approved} auto-approved`;
      }
      case "knox": {
        const [r] = await sql<{ events: string }[]>`
          SELECT COUNT(*)::text AS events FROM agent_events WHERE agent='knox'
        `;
        return `${r.events} review events emitted`;
      }
    }
  } catch (e) {
    return e instanceof Error ? e.message : "summary unavailable";
  }
  return "";
}
const ALLOWED_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

type StageEvent = {
  index: number;
  status: "running" | "ok" | "fail";
  detail?: string;
};

function emit(controller: ReadableStreamDefaultController, evt: StageEvent) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(evt) + "\n"));
}

function runWhitelisted(
  binary: "node" | "python3",
  args: string[],
  registerAs?: string,
): Promise<{ ok: boolean; tail: string; canceled?: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn(binary, args, {
      cwd: REPO_ROOT,
      env: process.env,
    });
    if (registerAs) agentProcs().set(registerAs, proc);
    let out = "";
    let err = "";
    let canceled = false;
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code, signal) => {
      if (registerAs) agentProcs().delete(registerAs);
      const tail = (out + err)
        .split("\n")
        .filter(Boolean)
        .slice(-1)[0] ?? "";
      canceled = signal === "SIGTERM" || signal === "SIGKILL";
      resolve({ ok: code === 0, tail, canceled });
    });
    proc.on("error", (e) => {
      if (registerAs) agentProcs().delete(registerAs);
      resolve({ ok: false, tail: e.message });
    });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const state = String(body.state || "").toUpperCase();
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 200));

  if (!ALLOWED_STATES.has(state)) {
    return new Response(
      JSON.stringify({ error: "state must be a 2-letter US state code" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const limitStr = String(limit);

  const stream = new ReadableStream({
    async start(controller) {
      const stages: Array<{
        key: "ingest" | "magellan" | "atlas" | "darwin" | "knox";
        name: string;
        run: () => Promise<{ ok: boolean; tail: string }>;
      }> = [
        {
          key: "ingest",
          name: "Ingest FDIC",
          run: () => runWhitelisted("node", ["scripts/ingest-state.mjs", state], "ingest"),
        },
        {
          key: "magellan",
          name: "Magellan",
          run: () =>
            runWhitelisted("python3", [
              "-m", "agents.magellan", "run", "--state", state, "--limit", limitStr,
            ], "magellan"),
        },
        {
          key: "atlas",
          name: "Atlas",
          run: () =>
            runWhitelisted("python3", [
              "-m", "agents.atlas", "run", "--limit", limitStr,
            ], "atlas"),
        },
        {
          key: "darwin",
          name: "Darwin",
          run: () =>
            runWhitelisted("python3", [
              "-m", "agents.darwin", "drain", "--limit", limitStr,
            ], "darwin"),
        },
        {
          key: "knox",
          name: "Knox",
          run: () =>
            runWhitelisted("python3", [
              "-m", "agents.knox", "review", "--limit", limitStr,
            ], "knox"),
        },
      ];

      for (let i = 0; i < stages.length; i++) {
        emit(controller, { index: i, status: "running", detail: stages[i].name });
        const result = await stages[i].run();
        const summary = result.ok
          ? await summarizeStage(stages[i].key, state)
          : result.tail.substring(0, 140);
        emit(controller, {
          index: i,
          status: result.ok ? "ok" : "fail",
          detail: summary,
        });
        if (!result.ok) break;
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache",
    },
  });
}
