import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { agentProcs } from "@/lib/agent-procs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_ROOT = path.resolve(process.cwd());

const ALLOWED_TYPES = new Set(["institution", "category", "peer"]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const PEERS_RE = /^[a-z0-9][a-z0-9,-]{0,400}$/;

type ProgressEvent =
  | { step: "started"; type: string; target: string }
  | { step: "querying-db" }
  | { step: "calling-claude" }
  | { step: "stdout"; line: string }
  | { step: "done"; report_id: string | null; ok: boolean }
  | { step: "error"; message: string };

function emit(controller: ReadableStreamDefaultController, evt: ProgressEvent) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(evt) + "\n"));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const type = String(body.type || "").toLowerCase();
  const target = String(body.target || "").toLowerCase().trim();
  const peersRaw = String(body.peers || "").toLowerCase().trim();

  if (!ALLOWED_TYPES.has(type)) {
    return Response.json(
      { error: "type must be one of: institution, category, peer" },
      { status: 400 },
    );
  }
  if (!SLUG_RE.test(target)) {
    return Response.json(
      { error: "target must be a slug ([a-z0-9-], up to 80 chars)" },
      { status: 400 },
    );
  }
  if (type === "peer" && peersRaw && !PEERS_RE.test(peersRaw)) {
    return Response.json(
      { error: "peers must be comma-separated slugs" },
      { status: 400 },
    );
  }

  const args: string[] = [
    "-m", "agents.hamilton", "generate",
    "--type", type,
    "--target", target,
    "--requested-by", "admin",
  ];
  if (type === "peer" && peersRaw) {
    args.push("--peers", peersRaw);
  }

  const stream = new ReadableStream({
    start(controller) {
      emit(controller, { step: "started", type, target });
      emit(controller, { step: "querying-db" });

      const proc = spawn("python3", args, {
        cwd: REPO_ROOT,
        env: process.env,
      });
      agentProcs().set("hamilton", proc);

      let stdout = "";
      let stderr = "";
      let calledClaude = false;

      proc.stdout.on("data", (d: Buffer) => {
        const text = d.toString();
        stdout += text;
        for (const raw of text.split("\n")) {
          const line = raw.trim();
          if (!line) continue;
          if (!calledClaude && /claude|prompt|sonnet|opus|llm/i.test(line)) {
            calledClaude = true;
            emit(controller, { step: "calling-claude" });
          }
          emit(controller, { step: "stdout", line: line.slice(0, 240) });
        }
      });

      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on("close", (code) => {
        agentProcs().delete("hamilton");
        const combined = stdout + stderr;
        const m = combined.match(/report[_ -]?id[\s:=]+([0-9a-f-]{8,})/i);
        const reportId = m ? m[1] : null;
        if (code === 0) {
          emit(controller, { step: "done", report_id: reportId, ok: true });
        } else {
          const tail = combined.split("\n").filter(Boolean).slice(-3).join(" | ");
          emit(controller, {
            step: "error",
            message: tail.slice(0, 400) || `python3 exited ${code}`,
          });
        }
        controller.close();
      });

      proc.on("error", (e) => {
        agentProcs().delete("hamilton");
        emit(controller, { step: "error", message: e.message });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache",
    },
  });
}
