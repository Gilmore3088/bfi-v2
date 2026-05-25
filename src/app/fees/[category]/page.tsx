import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { ConsumerShell } from "@/components/consumer-chrome";
import { getCategoryFees } from "@/lib/queries";
import { formatAmount, formatCount } from "@/lib/format";
import { slugify } from "@/lib/slug";
import { absoluteUrl } from "@/lib/site";

export const revalidate = 86400;

type Params = { category: string };

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { category } = await params;
  const data = await getCategoryFees(category);
  if (!data) {
    return { title: "Fee category not found", robots: { index: false, follow: false } };
  }
  const median = data.stats?.median ? formatAmount(data.stats.median) : null;
  const description = median
    ? `National median ${median} across ${formatCount(data.stats?.count ?? 0)} verified observations. Distribution, top and bottom institutions, and methodology.`
    : `Distribution, top and bottom institutions, and methodology for ${data.displayName} on the Bank Fee Index.`;
  return {
    title: `${data.displayName} fees — national index`,
    description: description.slice(0, 155),
    alternates: { canonical: `/fees/${category}` },
    openGraph: {
      title: `${data.displayName} fees — Bank Fee Index`,
      description: description.slice(0, 200),
      url: `/fees/${category}`,
      type: "article",
    },
    twitter: { card: "summary", title: `${data.displayName} fees`, description },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category } = await params;
  const data = await getCategoryFees(category);
  if (!data) notFound();

  const datasetLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${data.displayName} fees — Bank Fee Index`,
    description:
      data.description ??
      `Verified ${data.displayName} fees across U.S. depository institutions, classified against the Bank Fee Index taxonomy.`,
    url: absoluteUrl(`/fees/${category}`),
    keywords: [data.family, "bank fees", "credit union fees", data.displayName],
    creator: { "@type": "Organization", name: "Bank Fee Index" },
    license: absoluteUrl("/methodology"),
  };

  return (
    <ConsumerShell>
      <Script
        id={`ld-ds-${category}`}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetLd) }}
      />
      <main className="mx-auto max-w-5xl px-6 py-16">
        <nav
          className="text-xs uppercase tracking-[0.16em] mb-6"
          style={{ color: "var(--color-consumer-ink-dim)" }}
        >
          <Link href="/" className="hover:underline">Home</Link>
          <span> / </span>
          <span>Fees</span>
          <span> / </span>
          <span>{data.displayName}</span>
        </nav>

        <header>
          <div
            className="text-[11px] uppercase tracking-[0.22em] mb-3"
            style={{ color: "var(--color-consumer-accent)" }}
          >
            {data.family.replaceAll("_", " ")}
          </div>
          <h1 className="serif text-5xl font-semibold tracking-tight leading-[1.05]">
            {data.displayName} fees — National Bank Fee Index
          </h1>
          {data.description ? (
            <p
              className="mt-5 text-lg leading-relaxed max-w-2xl"
              style={{ color: "var(--color-consumer-ink-muted)" }}
            >
              {data.description}
            </p>
          ) : null}
        </header>

        {data.stats ? (
          <section className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-6 consumer-card p-6">
            <Stat label="Median" value={formatAmount(data.stats.median)} />
            <Stat label="25th percentile" value={formatAmount(data.stats.p25)} />
            <Stat label="75th percentile" value={formatAmount(data.stats.p75)} />
            <Stat label="Verified observations" value={formatCount(data.stats.count)} />
          </section>
        ) : (
          <section
            className="mt-10 consumer-card p-8"
            style={{ color: "var(--color-consumer-ink-muted)" }}
          >
            <div className="serif text-xl font-semibold text-[color:var(--color-consumer-ink)] mb-2">
              No verified observations yet
            </div>
            <p className="text-sm max-w-xl">
              Distribution statistics publish once we have at least one
              verified, source-cited fee in this category. Coverage expands
              daily as Atlas drains the crawl backlog.
            </p>
          </section>
        )}

        {data.topInstitutions.length > 0 ? (
          <section className="mt-16 grid md:grid-cols-2 gap-8">
            <ExtremesList
              title="Highest in the index"
              rows={data.topInstitutions}
            />
            <ExtremesList
              title="Lowest in the index"
              rows={data.bottomInstitutions}
            />
          </section>
        ) : null}

        <section
          className="mt-16 consumer-card p-8"
          style={{ background: "var(--color-consumer-accent-soft)" }}
        >
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <div
                className="text-[11px] uppercase tracking-[0.18em] mb-2"
                style={{ color: "var(--color-consumer-accent)" }}
              >
                For institutions
              </div>
              <div className="serif text-2xl font-semibold">
                See how your institution sits on {data.displayName}, against
                the peer set you actually compete in.
              </div>
            </div>
            <div className="flex justify-end">
              <Link
                href="/admin"
                className="px-5 py-3 text-sm font-medium rounded-sm text-white"
                style={{ background: "var(--color-consumer-rule)" }}
              >
                Pro for institutions
              </Link>
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
      <div
        className="text-[10px] uppercase tracking-[0.16em] mb-1"
        style={{ color: "var(--color-consumer-ink-dim)" }}
      >
        {label}
      </div>
      <div className="tabular text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ExtremesList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: number; name: string; charter_type: string; amount: number }>;
}) {
  return (
    <div>
      <h2 className="serif text-2xl font-semibold mb-4">{title}</h2>
      <ul className="divide-y" style={{ borderColor: "var(--color-consumer-border)" }}>
        {rows.map((r) => {
          const charterPath = r.charter_type === "credit_union" ? "credit-unions" : "banks";
          return (
            <li key={r.id} className="py-3 flex items-baseline justify-between">
              <Link
                href={`/${charterPath}/${slugify(r.name)}`}
                className="text-sm hover:underline"
              >
                {r.name}
              </Link>
              <span className="tabular text-sm font-medium">
                {formatAmount(r.amount)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
