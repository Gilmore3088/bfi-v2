"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, Receipt, FileText } from "lucide-react";

type InstitutionHit = {
  id: number;
  name: string;
  slug: string;
  state_code: string | null;
  charter_type: string | null;
};
type FeeHit = {
  id: string;
  fee_category: string;
  amount: string | null;
  institution_name: string | null;
};
type ReportHit = {
  id: string;
  kind: string;
  subject_category: string | null;
  subject_institution_name: string | null;
  created_at: string;
};
type SearchResults = {
  institutions: InstitutionHit[];
  fees: FeeHit[];
  reports: ReportHit[];
};

type FlatResult = {
  key: string;
  group: "institution" | "fee" | "report";
  label: string;
  sublabel: string;
  href: string;
};

const EMPTY: SearchResults = { institutions: [], fees: [], reports: [] };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Global keyboard handler
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      if (modKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    setQuery("");
    setResults(EMPTY);
    setActiveIndex(0);
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&limit=5`,
          { signal: ac.signal },
        );
        if (!res.ok) {
          setResults(EMPTY);
          return;
        }
        const data = (await res.json()) as SearchResults;
        setResults(data);
        setActiveIndex(0);
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setResults(EMPTY);
        }
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  const flat: FlatResult[] = useMemo(() => {
    const out: FlatResult[] = [];
    for (const i of results.institutions) {
      const charter = i.charter_type === "credit_union" ? "credit-unions" : "banks";
      out.push({
        key: `inst-${i.id}`,
        group: "institution",
        label: i.name,
        sublabel: [i.state_code, i.charter_type].filter(Boolean).join(" · "),
        href: `/${charter}/${i.slug}`,
      });
    }
    for (const f of results.fees) {
      out.push({
        key: `fee-${f.id}`,
        group: "fee",
        label: f.fee_category,
        sublabel: [f.institution_name, f.amount ? `$${f.amount}` : null]
          .filter(Boolean)
          .join(" · "),
        href: `/admin/market?category=${encodeURIComponent(f.fee_category)}`,
      });
    }
    for (const r of results.reports) {
      out.push({
        key: `rep-${r.id}`,
        group: "report",
        label: r.subject_institution_name ?? r.subject_category ?? r.kind,
        sublabel: `${r.kind} · ${new Date(r.created_at).toLocaleDateString()}`,
        href: `/admin/hamilton`,
      });
    }
    return out;
  }, [results]);

  const select = useCallback(
    (item: FlatResult) => {
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) select(item);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-24 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="absolute inset-0 backdrop-blur-sm bg-black/60"
        aria-hidden
      />
      <div
        className="relative w-full max-w-[600px] rounded-xl border border-[var(--color-admin-accent)]/40 bg-[var(--color-admin-surface)] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-admin-border)]">
          <Search size={16} className="text-[var(--color-admin-text-dim)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search institutions, fees, reports..."
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-[var(--color-admin-text-dim)]"
          />
          <kbd className="text-[10px] uppercase tracking-wider text-[var(--color-admin-text-dim)] px-1.5 py-0.5 rounded border border-[var(--color-admin-border)]">
            Esc
          </kbd>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {query.trim().length < 2 ? (
            <EmptyState text="Type at least 2 characters to search." />
          ) : loading && flat.length === 0 ? (
            <EmptyState text="Searching..." />
          ) : flat.length === 0 ? (
            <EmptyState text="No results." />
          ) : (
            <ResultsList
              flat={flat}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onSelect={select}
              results={results}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="px-4 py-10 text-center text-xs text-[var(--color-admin-text-dim)]">
      {text}
    </div>
  );
}

function ResultsList({
  flat,
  activeIndex,
  onHover,
  onSelect,
  results,
}: {
  flat: FlatResult[];
  activeIndex: number;
  onHover: (i: number) => void;
  onSelect: (r: FlatResult) => void;
  results: SearchResults;
}) {
  const sections: Array<{
    title: string;
    icon: React.ReactNode;
    items: FlatResult[];
  }> = [];
  let cursor = 0;
  if (results.institutions.length) {
    sections.push({
      title: "Institutions",
      icon: <Building2 size={12} />,
      items: flat.slice(cursor, cursor + results.institutions.length),
    });
    cursor += results.institutions.length;
  }
  if (results.fees.length) {
    sections.push({
      title: "Fees",
      icon: <Receipt size={12} />,
      items: flat.slice(cursor, cursor + results.fees.length),
    });
    cursor += results.fees.length;
  }
  if (results.reports.length) {
    sections.push({
      title: "Reports",
      icon: <FileText size={12} />,
      items: flat.slice(cursor, cursor + results.reports.length),
    });
  }
  return (
    <div className="py-2">
      {sections.map((s) => (
        <div key={s.title} className="mb-1">
          <div className="px-4 py-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-[var(--color-admin-text-dim)]">
            {s.icon}
            <span>{s.title}</span>
          </div>
          {s.items.map((item) => {
            const idx = flat.indexOf(item);
            const active = idx === activeIndex;
            return (
              <button
                key={item.key}
                type="button"
                onMouseEnter={() => onHover(idx)}
                onClick={() => onSelect(item)}
                className={`w-full text-left px-4 py-2 flex items-baseline justify-between gap-3 transition-colors ${
                  active
                    ? "bg-[var(--color-admin-accent-soft)] text-[var(--color-admin-accent)]"
                    : "hover:bg-[var(--color-admin-surface-2)]"
                }`}
              >
                <span className="text-sm font-medium truncate">{item.label}</span>
                <span className="text-[11px] text-[var(--color-admin-text-dim)] truncate">
                  {item.sublabel}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
