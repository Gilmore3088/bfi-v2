import type { Metadata } from "next";
import { ConsumerShell } from "@/components/consumer-chrome";
import { getSiteCounts } from "@/lib/queries";
import { formatCount } from "@/lib/format";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How Bank Fee Index collects, classifies, and verifies fee data. Sources, taxonomy, review workflow, and an honest accounting of current coverage.",
  alternates: { canonical: "/methodology" },
};

export default async function MethodologyPage() {
  const counts = await getSiteCounts();
  const coveragePct =
    counts.totalInstitutions > 0
      ? Math.round((counts.verifiedInstitutions / counts.totalInstitutions) * 100)
      : 0;

  return (
    <ConsumerShell>
      <main className="mx-auto max-w-3xl px-6 py-20">
        <div
          className="text-[11px] uppercase tracking-[0.22em] mb-6"
          style={{ color: "var(--color-consumer-accent)" }}
        >
          Methodology
        </div>
        <h1 className="serif text-5xl font-semibold tracking-tight leading-[1.05]">
          How the data is collected, classified, and reviewed.
        </h1>
        <p
          className="mt-6 text-lg leading-relaxed"
          style={{ color: "var(--color-consumer-ink-muted)" }}
        >
          Every number on this site traces to a primary source. Below is the
          full chain of custody, the taxonomy that makes one institution&apos;s
          fees comparable to another&apos;s, and a candid statement of where
          coverage stands today.
        </p>

        <div
          className="consumer-card mt-10 p-6"
          style={{ background: "var(--color-consumer-accent-soft)" }}
        >
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold">
            Current coverage
          </div>
          <div className="serif text-3xl font-semibold mt-2">
            {formatCount(counts.verifiedInstitutions)} of {formatCount(counts.totalInstitutions)} institutions
            verified ({coveragePct}%)
          </div>
          <p
            className="mt-3 text-sm leading-relaxed"
            style={{ color: "var(--color-consumer-ink-muted)" }}
          >
            We publish this number on the homepage and refresh it daily. We do
            not claim the full roster as covered until each institution has at
            least one source-cited, classified fee in the verified set.
          </p>
        </div>

        <div className="mt-12 space-y-12 leading-relaxed" style={{ color: "var(--color-consumer-ink-muted)" }}>
          <Section title="1. Sourcing">
            <p>
              Fee data is pulled from primary documents published by the
              institution itself: deposit-account disclosures, fee schedules,
              terms-and-conditions PDFs, and account-comparison pages. We do
              not aggregate from third-party rate sites; we do not infer from
              press releases.
            </p>
            <p className="mt-3">
              The institution roster begins with the FDIC and NCUA quarterly
              call-report filings, joined to FFIEC institution identifiers.
              Every record carries a charter type, state, asset size, and
              Federal Reserve district.
            </p>
          </Section>

          <Section title="2. Crawling and extraction">
            <p>
              An agent named Atlas crawls fee schedules on a rolling cadence
              and stores immutable copies of each artifact (HTML or PDF). The
              raw payload is preserved so any extracted fee can be audited
              back to the byte. Re-crawls do not overwrite previous artifacts;
              they create a new immutable record.
            </p>
          </Section>

          <Section title="3. Classification">
            <p>
              Each extracted fee is classified by an agent named Darwin
              against a taxonomy of 49 categories across 9 families, organized
              into four tiers of importance (spotlight, core, extended,
              comprehensive). The taxonomy is hand-curated and stable; new
              categories are added only after editorial review.
            </p>
            <p className="mt-3">
              Classification confidence is recorded on every row.
              High-confidence results auto-promote into the verified set;
              lower-confidence results are queued for human review.
            </p>
          </Section>

          <Section title="4. Review">
            <p>
              A human reviewer (today, the founder) approves or rejects
              flagged classifications before they appear publicly. Approved
              fees enter the verified table with a reviewer ID and a
              timestamp. Rejected fees are retained in the audit trail but
              never publish.
            </p>
          </Section>

          <Section title="5. Versioning">
            <p>
              When an institution changes a fee, the verified table inserts a
              new row and marks the prior row as superseded. Both rows remain
              queryable, so any analyst can reconstruct an institution&apos;s
              fee history without leaving the platform.
            </p>
          </Section>

          <Section title="6. What we mean by 'verified'">
            <p>
              A &quot;verified&quot; fee has three properties: (a) the source
              document is on file, (b) the classification has been approved by
              a human reviewer or auto-approved at a high confidence
              threshold, and (c) it is the most recent observation for that
              institution and canonical fee key.
            </p>
            <p className="mt-3">
              Anything that does not meet all three conditions does not appear
              in published medians, distributions, or institution profiles.
            </p>
          </Section>

          <Section title="7. Corrections">
            <p>
              If you find an error, write to james@bankfeeindex.com. Confirmed
              corrections are typically published within 48 hours. Larger
              re-classifications are noted in a public changelog.
            </p>
          </Section>
        </div>
      </main>
    </ConsumerShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="serif text-2xl font-semibold text-[color:var(--color-consumer-ink)]">
        {title}
      </h2>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}
