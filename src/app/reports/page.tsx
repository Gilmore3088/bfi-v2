import type { Metadata } from "next";
import { ConsumerShell } from "@/components/consumer-chrome";
import { NewsletterForm } from "@/components/newsletter-form";
import { sql } from "@/lib/db";

export const revalidate = 900;

export const metadata: Metadata = {
  title: "Reports",
  description:
    "Hamilton research reports — public companions to the Pro deliverables. Methodology and aggregate findings, free with a verified email.",
  alternates: { canonical: "/reports" },
};

type PublishedReport = {
  id: string;
  kind: string;
  subject_category: string | null;
  title: string | null;
  created_at: string;
};

async function loadReports(): Promise<PublishedReport[]> {
  try {
    return await sql<PublishedReport[]>`
      SELECT id, kind, subject_category, title, created_at
      FROM reports
      WHERE status = 'published'
      ORDER BY created_at DESC
      LIMIT 24
    `;
  } catch {
    // Table column shape may differ in early M1 — degrade to empty list.
    return [];
  }
}

export default async function ReportsPage() {
  const reports = await loadReports();

  return (
    <ConsumerShell>
      <main className="mx-auto max-w-4xl px-6 py-20">
        <div
          className="text-[11px] uppercase tracking-[0.22em] mb-6"
          style={{ color: "var(--color-consumer-accent)" }}
        >
          Hamilton Reports
        </div>
        <h1 className="serif text-5xl font-semibold tracking-tight leading-[1.05]">
          Research briefings, written like a partner would write them.
        </h1>
        <p
          className="mt-6 text-lg leading-relaxed max-w-2xl"
          style={{ color: "var(--color-consumer-ink-muted)" }}
        >
          Every Pro report Hamilton generates has a public companion: the
          methodology and aggregate findings, without subscriber-specific peer
          data. Read them with a verified email.
        </p>

        <section className="mt-12">
          {reports.length === 0 ? (
            <div className="consumer-card p-8">
              <div className="serif text-2xl font-semibold mb-2">
                The first public report ships at launch.
              </div>
              <p
                className="text-sm leading-relaxed max-w-xl"
                style={{ color: "var(--color-consumer-ink-muted)" }}
              >
                The State of U.S. Bank Fees, 2026 will be the flagship public
                companion. Subscribe to be notified when it publishes.
              </p>
              <div className="mt-5 max-w-md">
                <NewsletterForm source="reports-empty" />
              </div>
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--color-consumer-border)" }}>
              {reports.map((r) => (
                <li key={r.id} className="py-5">
                  <div
                    className="text-[10px] uppercase tracking-[0.18em] mb-1"
                    style={{ color: "var(--color-consumer-ink-dim)" }}
                  >
                    {r.kind}
                    {r.subject_category ? ` · ${r.subject_category}` : ""}
                  </div>
                  <div className="serif text-2xl font-semibold">
                    {r.title ?? "Untitled report"}
                  </div>
                  <div
                    className="mt-1 text-xs"
                    style={{ color: "var(--color-consumer-ink-dim)" }}
                  >
                    Published {new Date(r.created_at).toLocaleDateString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </ConsumerShell>
  );
}
