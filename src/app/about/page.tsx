import type { Metadata } from "next";
import Link from "next/link";
import { ConsumerShell } from "@/components/consumer-chrome";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Bank Fee Index is an independent research project publishing verified, source-cited fee data on U.S. banks and credit unions.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <ConsumerShell>
      <main className="mx-auto max-w-3xl px-6 py-20">
        <div
          className="text-[11px] uppercase tracking-[0.22em] mb-6"
          style={{ color: "var(--color-consumer-accent)" }}
        >
          About
        </div>
        <h1 className="serif text-5xl font-semibold tracking-tight leading-[1.05]">
          A research authority on bank and credit union fees.
        </h1>
        <div
          className="prose prose-lg mt-10 leading-relaxed"
          style={{ color: "var(--color-consumer-ink-muted)" }}
        >
          <p className="text-lg">
            {SITE.name} collects, verifies, and publishes structured fee data
            across U.S. depository institutions. The project pairs a quiet,
            single-operator pipeline with a research analyst named Hamilton,
            who turns the raw observations into briefings a bank executive
            would recognize as competitive intelligence.
          </p>
          <p className="text-lg mt-6">
            We are not a directory. We are not a rate-comparison site. We are
            not a dashboard. We are the place a journalist, a CFO, or a
            consumer should be able to look up what an institution charges and
            see the source it came from.
          </p>

          <h2 className="serif text-3xl font-semibold mt-12 mb-4 text-[color:var(--color-consumer-ink)]">
            How we got here
          </h2>
          <p>
            The first version of {SITE.name} shipped in spring 2025. It worked
            until it didn&apos;t — a pipeline failure went unnoticed for
            thirty-three days. v2, launched today, is rebuilt around three
            commitments: honest coverage numbers, operational discipline, and
            alerting that fails loudly.
          </p>
          <p className="mt-4">
            <Link
              href="/methodology"
              className="underline"
              style={{ color: "var(--color-consumer-accent)" }}
            >
              Read how the data is collected
            </Link>
            .
          </p>

          <h2 className="serif text-3xl font-semibold mt-12 mb-4 text-[color:var(--color-consumer-ink)]">
            Who reads this
          </h2>
          <ul className="space-y-2">
            <li>
              <strong>Bank and credit union executives</strong> defending or
              changing a fee schedule with peer-benchmarked evidence.
            </li>
            <li>
              <strong>Financial analysts and consultants</strong> citing
              numbers in client engagements and pitch decks.
            </li>
            <li>
              <strong>Journalists</strong> covering consumer banking trends.
            </li>
            <li>
              <strong>Consumers</strong> who want to understand whether a
              charge they were assessed is normal.
            </li>
          </ul>

          <h2 className="serif text-3xl font-semibold mt-12 mb-4 text-[color:var(--color-consumer-ink)]">
            Independence
          </h2>
          <p>
            {SITE.name} accepts no payment from financial institutions in
            exchange for coverage, ranking, or omission. Pro subscriptions are
            paid by the analysts and executives who read the reports.
            Advertising on consumer pages is clearly labeled and never
            determines what we publish.
          </p>

          <h2 className="serif text-3xl font-semibold mt-12 mb-4 text-[color:var(--color-consumer-ink)]">
            Contact
          </h2>
          <p>
            Editorial corrections, methodology questions, partnership
            inquiries: write to james@bankfeeindex.com. Press queries are
            answered on the record unless explicitly agreed otherwise.
          </p>
        </div>
      </main>
    </ConsumerShell>
  );
}
