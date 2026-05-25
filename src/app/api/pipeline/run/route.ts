import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_ROOT = path.resolve(process.cwd());
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
): Promise<{ ok: boolean; tail: string }> {
  return new Promise((resolve) => {
    const proc = spawn(binary, args, {
      cwd: REPO_ROOT,
      env: process.env,
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      const tail = (out + err)
        .split("\n")
        .filter(Boolean)
        .slice(-1)[0] ?? "";
      resolve({ ok: code === 0, tail });
    });
    proc.on("error", (e) => resolve({ ok: false, tail: e.message }));
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
        name: string;
        run: () => Promise<{ ok: boolean; tail: string }>;
      }> = [
        {
          name: "Ingest FDIC",
          run: () => runWhitelisted("node", ["scripts/ingest-state.mjs", state]),
        },
        {
          name: "Magellan",
          run: () =>
            runWhitelisted("python3", [
              "-m", "agents.magellan", "run", "--limit", limitStr,
            ]),
        },
        {
          name: "Atlas",
          run: () =>
            runWhitelisted("python3", [
              "-m", "agents.atlas", "run", "--limit", limitStr,
            ]),
        },
        {
          name: "Darwin",
          run: () =>
            runWhitelisted("python3", [
              "-m", "agents.darwin", "drain", "--limit", limitStr,
            ]),
        },
        {
          name: "Knox",
          run: () =>
            runWhitelisted("python3", [
              "-m", "agents.knox", "review", "--limit", limitStr,
            ]),
        },
      ];

      for (let i = 0; i < stages.length; i++) {
        emit(controller, { index: i, status: "running", detail: stages[i].name });
        const result = await stages[i].run();
        emit(controller, {
          index: i,
          status: result.ok ? "ok" : "fail",
          detail: result.tail.substring(0, 140),
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
