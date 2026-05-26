import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const REPO_ROOT = path.resolve(process.cwd());
const ALLOWED_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

type QueueEvent = {
  state: string;
  stage: string;
  status: "running" | "ok" | "fail";
  detail?: string;
};

function emit(controller: ReadableStreamDefaultController, evt: QueueEvent): void {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(evt) + "\n"));
}

function runWhitelisted(
  binary: "node" | "python3",
  args: string[],
): Promise<{ ok: boolean; tail: string }> {
  return new Promise((resolve) => {
    const proc = spawn(binary, args, { cwd: REPO_ROOT, env: process.env });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      const tail = (out + err).split("\n").filter(Boolean).slice(-1)[0] ?? "";
      resolve({ ok: code === 0, tail });
    });
    proc.on("error", (e) => resolve({ ok: false, tail: e.message }));
  });
}

async function summarize(stage: string, state: string): Promise<string> {
  try {
    if (stage === "ingest") {
      const [r] = await sql<{ c: string }[]>`
        SELECT COUNT(*)::text AS c FROM institutions WHERE state_code = ${state}
      `;
      return `${r.c} institutions in ${state}`;
    }
    if (stage === "magellan") {
      const [r] = await sql<{ c: string }[]>`
        SELECT COUNT(*)::text AS c FROM institution_urls iu
        JOIN institutions i ON i.id = iu.institution_id
        WHERE i.state_code = ${state} AND iu.is_active
      `;
      return `${r.c} active fee URLs`;
    }
    if (stage === "atlas") {
      const [r] = await sql<{ c: string }[]>`
        SELECT COUNT(*)::text AS c FROM fees_raw fr
        JOIN institutions i ON i.id = fr.institution_id
        WHERE i.state_code = ${state}
      `;
      return `${r.c} raw schedules`;
    }
    if (stage === "darwin") {
      const [r] = await sql<{ c: string }[]>`
        SELECT COUNT(*)::text AS c FROM fees_verified fv
        JOIN institutions i ON i.id = fv.institution_id
        WHERE i.state_code = ${state}
      `;
      return `${r.c} verified fees`;
    }
  } catch (e) {
    return e instanceof Error ? e.message : "summary failed";
  }
  return "";
}

/**
 * POST /api/pipeline/queue
 *
 * Body: { states: ['FL','AL',...], limit?: number }
 *
 * Streams NDJSON events of shape:
 *   { state, stage, status, detail? }
 *
 * Runs the per-state pipeline sequentially: ingest, magellan, atlas,
 * darwin, knox. Stops a state at the first failed stage and moves on.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const states = Array.isArray(body.states)
    ? Array.from(
        new Set(
          (body.states as unknown[])
            .map((s) => String(s || "").toUpperCase())
            .filter((s) => ALLOWED_STATES.has(s)),
        ),
      )
    : [];
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 200));

  if (states.length === 0) {
    return new Response(
      JSON.stringify({ error: "states must be a non-empty array of 2-letter state codes" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const limitStr = String(limit);

  const stream = new ReadableStream({
    async start(controller) {
      for (const state of states) {
        const stages: { key: string; run: () => Promise<{ ok: boolean; tail: string }> }[] = [
          { key: "ingest",   run: () => runWhitelisted("node", ["scripts/ingest-state.mjs", state]) },
          { key: "magellan", run: () => runWhitelisted("python3", ["-m", "agents.magellan", "run", "--state", state, "--limit", limitStr]) },
          { key: "atlas",    run: () => runWhitelisted("python3", ["-m", "agents.atlas", "run", "--limit", limitStr]) },
          { key: "darwin",   run: () => runWhitelisted("python3", ["-m", "agents.darwin", "drain", "--limit", limitStr]) },
          { key: "knox",     run: () => runWhitelisted("python3", ["-m", "agents.knox", "review", "--limit", limitStr]) },
        ];
        for (const stage of stages) {
          emit(controller, { state, stage: stage.key, status: "running" });
          const result = await stage.run();
          const detail = result.ok
            ? await summarize(stage.key, state)
            : result.tail.substring(0, 140);
          emit(controller, {
            state,
            stage: stage.key,
            status: result.ok ? "ok" : "fail",
            detail,
          });
          if (!result.ok) break;
        }
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
