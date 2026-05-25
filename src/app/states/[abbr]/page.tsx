import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { ConsumerShell } from "@/components/consumer-chrome";
import { getStateInstitutions } from "@/lib/queries";
import { stateName } from "@/lib/states";
import { formatAssets, formatCount } from "@/lib/format";
import { slugify } from "@/lib/slug";
import { absoluteUrl } from "@/lib/site";

export const revalidate = 86400;

type Params = { abbr: string };

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { abbr } = await params;
  const name = stateName(abbr);
  if (!name) {
    return { title: "State not found", robots: { index: false, follow: false } };
  }
  return {
    title: `${name} banks and credit unions — fee schedules`,
    description: `Fee schedules and verified bank fee data for institutions chartered or operating in ${name}.`,
    alternates: { canonical: `/states/${abbr.toUpperCase()}` },
  };
}

export default async function StatePage({ params }: { params: Promise<Params> }) {
  const { abbr } = await params;
  const name = stateName(abbr);
  if (!name) notFound();
  const upper = abbr.toUpperCase();
  const institutions = await getStateInstitutions(upper);

  const banks = institutions.filter((i) => i.charter_type === "bank");
  const cus = institutions.filter((i) => i.charter_type === "credit_union");

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      {
        "@type": "ListItem",
        position: 2,
        name: name,
        item: absoluteUrl(`/states/${upper}`),
      },
    ],
  };

  return (
    <ConsumerShell>
      <Script
        id={`ld-bc-state-${upper}`}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <main className="mx-auto max-w-5xl px-6 py-16">
        <nav
          className="text-xs uppercase tracking-[0.16em] mb-6"
          style={{ color: "var(--color-consumer-ink-dim)" }}
        >
          <Link href="/" className="hover:underline">Home</Link>
          <span> / </span>
          <span>{name}</span>
        </nav>

        <header>
          <div
            className="text-[11px] uppercase tracking-[0.22em] mb-3"
            style={{ color: "var(--color-consumer-accent)" }}
          >
            State coverage
          </div>
          <h1 className="serif text-5xl font-semibold tracking-tight leading-[1.05]">
            {name} — banks and credit unions
          </h1>
          <p
            className="mt-4 text-base"
            style={{ color: "var(--color-consumer-ink-muted)" }}
          >
            {formatCount(institutions.length)} institutions in {name}.
            {" "}
            {formatCount(institutions.filter((i) => i.feeCount > 0).length)} have verified fee data.
          </p>
        </header>

        {institutions.length === 0 ? (
          <section
            className="mt-12 consumer-card p-8"
            style={{ color: "var(--color-consumer-ink-muted)" }}
          >
            <div className="serif text-xl font-semibold text-[color:var(--color-consumer-ink)] mb-2">
              No institutions on file
            </div>
            <p className="text-sm max-w-xl">
              We have not yet ingested institutions chartered in {name}. The
              FDIC and NCUA rosters refresh quarterly; this page will populate
              automatically.
            </p>
          </section>
        ) : (
          <>
            <Block title="Banks" rows={banks} path="banks" />
            <Block title="Credit unions" rows={cus} path="credit-unions" />
          </>
        )}
      </main>
    </ConsumerShell>
  );
}

function Block({
  title,
  rows,
  path,
}: {
  title: string;
  rows: Array<{
    id: number;
    name: string;
    state_code: string;
    asset_size: number | null;
    feeCount: number;
  }>;
  path: "banks" | "credit-unions";
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="serif text-2xl font-semibold mb-4">{title}</h2>
      <div
        className="consumer-card overflow-hidden"
        style={{ borderColor: "var(--color-consumer-border)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr
              className="text-[10px] uppercase tracking-[0.14em] text-left"
              style={{ color: "var(--color-consumer-ink-dim)" }}
            >
              <th className="px-4 py-3 font-semibold">Institution</th>
              <th className="px-4 py-3 font-semibold text-right">Assets</th>
              <th className="px-4 py-3 font-semibold text-right">Verified fees</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-t"
                style={{ borderColor: "var(--color-consumer-border)" }}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/${path}/${slugify(r.name)}`}
                    className="hover:underline"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right tabular">
                  {formatAssets(r.asset_size)}
                </td>
                <td className="px-4 py-3 text-right tabular">
                  {r.feeCount > 0 ? r.feeCount : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
