"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type CategoryOption = { category: string; display_name: string };

type InstitutionHit = {
  id: number;
  name: string;
  slug: string;
  state_code: string | null;
  charter_type: string | null;
};

type ReportType = "institution" | "category" | "peer";

type ProgressEvent =
  | { step: "started"; type: string; target: string }
  | { step: "querying-db" }
  | { step: "calling-claude" }
  | { step: "stdout"; line: string }
  | { step: "done"; report_id: string | null; ok: boolean }
  | { step: "error"; message: string };

type StepKey = "started" | "querying-db" | "calling-claude" | "done";

const STEP_LABELS: Record<StepKey, string> = {
  started: "Validating request",
  "querying-db": "Querying pipeline data",
  "calling-claude": "Calling Claude (Hamilton)",
  done: "Report ready",
};

export function GenerateForm({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const [reportType, setReportType] = useState<ReportType>("institution");
  const [institution, setInstitution] = useState<InstitutionHit | null>(null);
  const [category, setCategory] = useState<string>("");
  const [peers, setPeers] = useState<InstitutionHit[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [steps, setSteps] = useState<Record<StepKey, "idle" | "running" | "ok" | "fail">>({
    started: "idle",
    "querying-db": "idle",
    "calling-claude": "idle",
    done: "idle",
  });
  const [error, setError] = useState<string | null>(null);
  const [tail, setTail] = useState<string[]>([]);

  const valid = useMemo(() => {
    if (reportType === "institution") return !!institution;
    if (reportType === "category") return !!category;
    if (reportType === "peer") return !!institution && peers.length > 0;
    return false;
  }, [reportType, institution, category, peers]);

  function markStep(k: StepKey, s: "running" | "ok" | "fail") {
    setSteps((prev) => ({ ...prev, [k]: s }));
  }

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    setTail([]);
    setSteps({
      started: "running",
      "querying-db": "idle",
      "calling-claude": "idle",
      done: "idle",
    });

    const target =
      reportType === "category"
        ? category
        : institution?.slug ?? "";
    const peersArg =
      reportType === "peer" ? peers.map((p) => p.slug).join(",") : "";

    try {
      const res = await fetch("/api/hamilton/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: reportType, target, peers: peersArg }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        setError(text || `HTTP ${res.status}`);
        markStep("started", "fail");
        setSubmitting(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let succeeded = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as ProgressEvent;
            applyEvent(evt);
            if (evt.step === "done" && evt.ok) succeeded = true;
          } catch {
            // ignore
          }
        }
      }
      if (succeeded) {
        setTimeout(() => router.push("/admin/hamilton"), 600);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      markStep("started", "fail");
    } finally {
      setSubmitting(false);
    }
  }

  function applyEvent(evt: ProgressEvent) {
    switch (evt.step) {
      case "started":
        markStep("started", "ok");
        markStep("querying-db", "running");
        break;
      case "querying-db":
        markStep("querying-db", "running");
        break;
      case "calling-claude":
        markStep("querying-db", "ok");
        markStep("calling-claude", "running");
        break;
      case "stdout":
        setTail((t) => [...t.slice(-9), evt.line]);
        break;
      case "done":
        markStep("calling-claude", "ok");
        markStep("done", evt.ok ? "ok" : "fail");
        break;
      case "error":
        setError(evt.message);
        setSteps((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next) as StepKey[]) {
            if (next[k] === "running") next[k] = "fail";
          }
          return next;
        });
        break;
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Report type">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TypeCard
            active={reportType === "institution"}
            label="Institution"
            description="Deep dive on a single bank or credit union."
            onClick={() => setReportType("institution")}
          />
          <TypeCard
            active={reportType === "category"}
            label="Category"
            description="Market analysis across one fee category."
            onClick={() => setReportType("category")}
          />
          <TypeCard
            active={reportType === "peer"}
            label="Peer benchmark"
            description="Benchmark one institution against up to 5 peers."
            onClick={() => setReportType("peer")}
          />
        </div>
      </Section>

      {(reportType === "institution" || reportType === "peer") && (
        <Section
          title={reportType === "peer" ? "Primary institution" : "Institution"}
        >
          <InstitutionPicker
            value={institution}
            onChange={setInstitution}
            placeholder="Search by name or city..."
          />
        </Section>
      )}

      {reportType === "category" && (
        <Section title="Category">
          <CategoryPicker
            categories={categories}
            value={category}
            onChange={setCategory}
          />
        </Section>
      )}

      {reportType === "peer" && (
        <Section title={`Peer institutions (${peers.length}/5)`}>
          <PeerMultiPicker
            peers={peers}
            setPeers={setPeers}
            exclude={institution?.id}
          />
        </Section>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!valid || submitting}
          className="px-5 py-2.5 text-sm font-semibold rounded-md bg-[var(--color-admin-accent)] text-[var(--color-admin-accent-fg,white)] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {submitting ? "Generating..." : "Generate report"}
        </button>
        {!valid && (
          <span className="text-xs text-[var(--color-admin-text-dim)]">
            Pick a subject to continue.
          </span>
        )}
      </div>

      {(submitting || error || steps.done !== "idle") && (
        <Section title="Progress">
          <ol className="space-y-2">
            {(Object.keys(STEP_LABELS) as StepKey[]).map((k) => (
              <StepRow key={k} label={STEP_LABELS[k]} state={steps[k]} />
            ))}
          </ol>
          {tail.length > 0 && (
            <div className="mt-3 max-h-40 overflow-y-auto rounded border border-[var(--color-admin-border)] bg-[var(--color-admin-surface-2)] p-2 font-mono text-[11px] text-[var(--color-admin-text-muted)]">
              {tail.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap break-words">
                  {l}
                </div>
              ))}
            </div>
          )}
          {error && (
            <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] mb-2">
        {title}
      </div>
      {children}
    </section>
  );
}

function TypeCard({
  active,
  label,
  description,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-lg border transition-colors ${
        active
          ? "border-[var(--color-admin-accent)] bg-[var(--color-admin-accent-soft)]"
          : "border-[var(--color-admin-border)] bg-[var(--color-admin-surface)] hover:bg-[var(--color-admin-surface-2)]"
      }`}
    >
      <div className="text-sm font-semibold mb-1">{label}</div>
      <div className="text-xs text-[var(--color-admin-text-muted)] leading-snug">
        {description}
      </div>
    </button>
  );
}

function StepRow({
  label,
  state,
}: {
  label: string;
  state: "idle" | "running" | "ok" | "fail";
}) {
  let icon: React.ReactNode = (
    <div className="size-4 rounded-full border border-[var(--color-admin-border)]" />
  );
  if (state === "running")
    icon = <Loader2 size={14} className="animate-spin text-sky-400" />;
  if (state === "ok")
    icon = <CheckCircle2 size={14} className="text-emerald-400" />;
  if (state === "fail")
    icon = <AlertCircle size={14} className="text-rose-400" />;
  return (
    <li className="flex items-center gap-2 text-xs">
      {icon}
      <span
        className={
          state === "idle"
            ? "text-[var(--color-admin-text-dim)]"
            : "text-[var(--color-admin-text-muted)]"
        }
      >
        {label}
      </span>
    </li>
  );
}

function InstitutionPicker({
  value,
  onChange,
  placeholder,
}: {
  value: InstitutionHit | null;
  onChange: (v: InstitutionHit | null) => void;
  placeholder: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<InstitutionHit[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?type=institution&q=${encodeURIComponent(term)}&limit=8`,
        );
        if (!res.ok) return;
        const data = await res.json();
        setHits(data.institutions ?? []);
      } catch {
        setHits([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-[var(--color-admin-border)] bg-[var(--color-admin-surface)]">
        <div>
          <div className="text-sm font-medium">{value.name}</div>
          <div className="text-[11px] text-[var(--color-admin-text-dim)]">
            {[value.state_code, value.charter_type].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[var(--color-admin-text-dim)] hover:text-[var(--color-admin-text)] transition-colors"
          aria-label="Clear selection"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--color-admin-border)] bg-[var(--color-admin-surface)]">
        <Search size={14} className="text-[var(--color-admin-text-dim)]" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-admin-text-dim)]"
        />
      </div>
      {open && hits.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-[var(--color-admin-border)] bg-[var(--color-admin-surface)] shadow-lg">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => {
                onChange(h);
                setQ("");
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-admin-surface-2)] transition-colors"
            >
              <div className="font-medium">{h.name}</div>
              <div className="text-[11px] text-[var(--color-admin-text-dim)]">
                {[h.state_code, h.charter_type].filter(Boolean).join(" · ")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: CategoryOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return categories.slice(0, 50);
    return categories
      .filter(
        (c) =>
          c.category.toLowerCase().includes(term) ||
          c.display_name.toLowerCase().includes(term),
      )
      .slice(0, 50);
  }, [q, categories]);

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--color-admin-border)] bg-[var(--color-admin-surface)] mb-2">
        <Search size={14} className="text-[var(--color-admin-text-dim)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter categories..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-admin-text-dim)]"
        />
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border border-[var(--color-admin-border)] bg-[var(--color-admin-surface)]">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--color-admin-text-dim)]">
            No categories match.
          </div>
        ) : (
          filtered.map((c) => (
            <button
              key={c.category}
              type="button"
              onClick={() => onChange(c.category)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                value === c.category
                  ? "bg-[var(--color-admin-accent-soft)] text-[var(--color-admin-accent)]"
                  : "hover:bg-[var(--color-admin-surface-2)]"
              }`}
            >
              <div className="font-medium">{c.display_name}</div>
              <div className="text-[11px] text-[var(--color-admin-text-dim)] font-mono">
                {c.category}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function PeerMultiPicker({
  peers,
  setPeers,
  exclude,
}: {
  peers: InstitutionHit[];
  setPeers: (next: InstitutionHit[]) => void;
  exclude?: number;
}) {
  const add = useCallback(
    (h: InstitutionHit | null) => {
      if (!h) return;
      if (h.id === exclude) return;
      if (peers.find((p) => p.id === h.id)) return;
      if (peers.length >= 5) return;
      setPeers([...peers, h]);
    },
    [peers, setPeers, exclude],
  );
  const remove = (id: number) => setPeers(peers.filter((p) => p.id !== id));

  return (
    <div className="space-y-2">
      {peers.length < 5 && (
        <InstitutionPicker
          value={null}
          onChange={add}
          placeholder="Add a peer institution..."
        />
      )}
      {peers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {peers.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[var(--color-admin-surface-2)] text-xs"
            >
              {p.name}
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="text-[var(--color-admin-text-dim)] hover:text-[var(--color-admin-text)]"
                aria-label={`Remove ${p.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
