import Link from "next/link";
import type { Metadata } from "next";
import { ConsumerShell } from "@/components/consumer-chrome";
import {
  getSiteCounts,
  getCategorySnapshot,
  getRecentInstitutions,
} from "@/lib/queries";
import { formatCount, formatAmount } from "@/lib/format";
import { slugify } from "@/lib/slug";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: `${SITE.tagline}`,
  description: SITE.description,
  alternates: { canonical: "/" },
};

export default async function Home() {
  const [counts, categories, recent] = await Promise.all([
    getSiteCounts(),
    getCategorySnapshot(),
    getRecentInstitutions(8),
  ]);

  const spotlight = categories
    .filter((c) => c.tier === "spotlight" && c.median !== null)
    .slice(0, 6);

  return (
    <ConsumerShell>
      <main>
        <section className="mx-auto max-w-6xl px-6 pt-20 pb-16">
          <div
            className="text-[11px] uppercase tracking-[0.22em] mb-6"
            style={{ color: "var(--color-consumer-accent)" }}
          >
            Bank Fee Index · v2
          </div>
          <h1 className="serif text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] max-w-4xl">
            The national authority on bank fees.
          </h1>
          <p
            className="mt-6 text-lg md:text-xl leading-relaxed max-w-2xl"
            style={{ color: "var(--color-consumer-ink-muted)" }}
          >
            Verified fee data, sourced from primary documents, structured
            against a 49-category taxonomy, and refreshed when institutions
            publish. Free for consumers. Built for analysts.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/methodology"
              className="px-5 py-3 text-sm font-medium border rounded-sm"
              style={{
                borderColor: "var(--color-consumer-rule)",
                color: "var(--color-consumer-ink)",
              }}
            >
              How we collect this data
            </Link>
            <Link
              href="/admin"
              className="px-5 py-3 text-sm font-medium rounded-sm text-white"
              style={{ background: "var(--color-consumer-rule)" }}
            >
              Pro for institutions
            </Link>
          </div>
        </section>

        <section
          className="border-y"
          style={{ borderColor: "var(--color-consumer-border)" }}
        >
          <div className="mx-auto max-w-6xl px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8">
            <Stat
              label="Institutions with verified fees"
              value={formatCount(counts.verifiedInstitutions)}
            />
            <Stat
              label="Total roster (banks + CUs)"
              value={formatCount(counts.totalInstitutions)}
            />
            <Stat
              label="Verified fee observations"
              value={formatCount(counts.totalFees)}
            />
            <Stat
              label="Fee categories"
              value={formatCount(counts.categories)}
            />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <SectionHeader
            eyebrow="Spotlight categories"
            title="What the typical institution charges"
            sub="National medians across verified observations. Click any category for distribution, top and bottom institutions, and methodology."
          />
          {spotlight.length === 0 ? (
            <EmptyState
              title="Coverage in progress"
              body="Spotlight medians publish once we have at least one verified observation in each category. Subscribe below to be notified at first publication."
            />
          ) : (
            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {spotlight.map((c) => (
                <Link
                  key={c.category}
                  href={`/fees/${c.category}`}
                  className="consumer-card p-6 hover:shadow-sm transition-shadow"
                >
                  <div
                    className="text-[10px] uppercase tracking-[0.18em] mb-3"
                    style={{ color: "var(--color-consumer-ink-dim)" }}
                  >
                    {c.family.replaceAll("_", " ")}
                  </div>
                  <div className="serif text-2xl font-semibold mb-3">
                    {c.displayName}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <div className="tabular text-3xl font-semibold">
                      {formatAmount(c.median)}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--color-consumer-ink-dim)" }}
                    >
                      national median · n={formatCount(c.count)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section
          className="border-t"
          style={{ borderColor: "var(--color-consumer-border)" }}
        >
          <div className="mx-auto max-w-6xl px-6 py-16 grid md:grid-cols-2 gap-10">
            <div>
              <SectionHeader
                eyebrow="Latest coverage"
                title="Institutions recently verified"
                sub="The frontier of the index. Each entry has been sourced from a primary fee schedule, classified against the taxonomy, and reviewed."
              />
              <ul className="mt-6 divide-y consumer-rule" style={{ borderColor: "var(--color-consumer-border)" }}>
                {recent.length === 0 ? (
                  <li className="py-4 text-sm" style={{ color: "var(--color-consumer-ink-dim)" }}>
                    No verified institutions yet. Coverage begins with this launch.
                  </li>
                ) : (
                  recent.map((r) => {
                    const charterPath = r.charter_type === "credit_union" ? "credit-unions" : "banks";
                    return (
                      <li key={r.id} className="py-3 flex items-baseline justify-between">
                        <Link
                          href={`/${charterPath}/${slugify(r.name)}`}
                          className="text-sm hover:underline"
                        >
                          {r.name}
                        </Link>
                        <span
                          className="text-xs uppercase tracking-[0.14em]"
                          style={{ color: "var(--color-consumer-ink-dim)" }}
                        >
                          {r.state_code} ·{" "}
                          {r.charter_type === "credit_union" ? "CU" : "Bank"}
                        </span>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>

            <div>
              <SectionHeader
                eyebrow="Honesty about coverage"
                title="What this site does and does not yet know"
                sub=""
              />
              <p
                className="mt-6 text-base leading-relaxed"
                style={{ color: "var(--color-consumer-ink-muted)" }}
              >
                The full U.S. depository roster runs to roughly 8,700
                institutions. The verified subset is far smaller — the number
                in the top strip is the number with at least one source-cited
                fee in the database today. We tell you that number, not the
                number we wish we had. Coverage expands as the Atlas crawler
                drains its backlog.
              </p>
              <p
                className="mt-4 text-base leading-relaxed"
                style={{ color: "var(--color-consumer-ink-muted)" }}
              >
                If you spot an institution whose data we have wrong, tell us.
                That feedback is what built the parts of v1 that survived.
              </p>
              <div className="mt-6">
                <Link
                  href="/methodology"
                  className="text-sm underline"
                  style={{ color: "var(--color-consumer-accent)" }}
                >
                  Read the methodology
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </ConsumerShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tabular text-3xl md:text-4xl font-semibold">{value}</div>
      <div
        className="mt-2 text-xs uppercase tracking-[0.14em]"
        style={{ color: "var(--color-consumer-ink-dim)" }}
      >
        {label}
      </div>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <div>
      <div
        className="text-[11px] uppercase tracking-[0.18em]"
        style={{ color: "var(--color-consumer-accent)" }}
      >
        {eyebrow}
      </div>
      <h2 className="serif text-3xl md:text-4xl font-semibold tracking-tight mt-2">
        {title}
      </h2>
      {sub ? (
        <p
          className="mt-3 text-base leading-relaxed max-w-2xl"
          style={{ color: "var(--color-consumer-ink-muted)" }}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="consumer-card mt-8 p-8 text-center"
      style={{ color: "var(--color-consumer-ink-muted)" }}
    >
      <div className="serif text-xl font-semibold mb-2 text-[color:var(--color-consumer-ink)]">
        {title}
      </div>
      <p className="text-sm max-w-xl mx-auto">{body}</p>
    </div>
  );
}
