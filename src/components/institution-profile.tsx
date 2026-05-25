import Link from "next/link";
import Script from "next/script";
import { ConsumerShell } from "@/components/consumer-chrome";
import { NewsletterForm } from "@/components/newsletter-form";
import { formatAmount, formatAssets, formatCount } from "@/lib/format";
import { absoluteUrl } from "@/lib/site";
import type { InstitutionDetail } from "@/lib/queries";

type Props = {
  data: InstitutionDetail;
  charterPath: "banks" | "credit-unions";
  slug: string;
};

export function InstitutionProfile({ data, charterPath, slug }: Props) {
  const { institution, fees, lastVerifiedAt } = data;
  const verifiedDate = lastVerifiedAt
    ? new Date(lastVerifiedAt).toLocaleDateString()
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: `${institution.name} fee schedule`,
    provider: {
      "@type": "Organization",
      name: institution.name,
      address: {
        "@type": "PostalAddress",
        addressRegion: institution.state_code,
        addressLocality: institution.city ?? undefined,
        addressCountry: "US",
      },
      url: institution.website_url ?? undefined,
    },
    url: absoluteUrl(`/${charterPath}/${slug}`),
    description: `Verified fee data for ${institution.name}, sourced from the institution's published fee schedule.`,
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      {
        "@type": "ListItem",
        position: 2,
        name: charterPath === "banks" ? "Banks" : "Credit Unions",
        item: absoluteUrl(`/${charterPath}`),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: institution.name,
        item: absoluteUrl(`/${charterPath}/${slug}`),
      },
    ],
  };

  return (
    <ConsumerShell>
      <Script
        id={`ld-fp-${slug}`}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Script
        id={`ld-bc-${slug}`}
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
          <Link href={`/${charterPath}`} className="hover:underline">
            {charterPath === "banks" ? "Banks" : "Credit unions"}
          </Link>
          <span> / </span>
          <span>{institution.name}</span>
        </nav>

        <header>
          <div
            className="text-[11px] uppercase tracking-[0.22em] mb-3"
            style={{ color: "var(--color-consumer-accent)" }}
          >
            {institution.charter_type === "credit_union" ? "Credit union" : "Bank"}
            {institution.state_code ? ` · ${institution.state_code}` : ""}
            {institution.city ? ` · ${institution.city}` : ""}
          </div>
          <h1 className="serif text-5xl font-semibold tracking-tight leading-[1.05]">
            {institution.name} — fee schedule
          </h1>
          <p
            className="mt-4 text-base"
            style={{ color: "var(--color-consumer-ink-muted)" }}
          >
            {verifiedDate
              ? `Last verified ${verifiedDate}. Data sourced from the institution's published fee disclosures.`
              : "Source documents are on file but no verified fees have been published yet for this institution."}
          </p>
        </header>

        <section className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-6 consumer-card p-6">
          <Meta label="Assets" value={formatAssets(institution.asset_size)} />
          <Meta label="Asset tier" value={institution.asset_size_tier ?? "—"} />
          <Meta
            label="Fed district"
            value={institution.fed_district ? `District ${institution.fed_district}` : "—"}
          />
          <Meta
            label="Verified fees"
            value={formatCount(fees.length)}
          />
        </section>

        <section className="mt-12">
          <h2 className="serif text-2xl font-semibold mb-5">Fees on record</h2>
          {fees.length === 0 ? (
            <div
              className="consumer-card p-6"
              style={{ color: "var(--color-consumer-ink-muted)" }}
            >
              <div className="serif text-xl font-semibold text-[color:var(--color-consumer-ink)] mb-2">
                Fee schedule pending
              </div>
              <p className="text-sm leading-relaxed max-w-xl">
                We have not yet verified any fees for this institution. If you
                have a current fee schedule for {institution.name}, submit a
                correction at james@bankfeeindex.com to request priority
                crawling.
              </p>
            </div>
          ) : (
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
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold text-right">Amount</th>
                    <th className="px-4 py-3 font-semibold">Frequency</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.map((f) => (
                    <tr
                      key={f.id}
                      className="border-t"
                      style={{ borderColor: "var(--color-consumer-border)" }}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/fees/${f.fee_category}`}
                          className="hover:underline"
                          style={{ color: "var(--color-consumer-accent)" }}
                        >
                          {f.fee_category}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{f.fee_name ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular">
                        {formatAmount(f.amount)}
                      </td>
                      <td className="px-4 py-3">{f.frequency ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

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
                Compare {institution.name}&apos;s fees to peers — start a Pro trial.
              </div>
              <p
                className="mt-3 text-sm leading-relaxed"
                style={{ color: "var(--color-consumer-ink-muted)" }}
              >
                Peer benchmarking by asset tier and Federal Reserve district.
                Hamilton reports written like a partner briefing. Single seat
                or unlimited firm access.
              </p>
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

        <section className="mt-16">
          <div className="serif text-2xl font-semibold mb-3">Stay current</div>
          <p
            className="text-sm leading-relaxed max-w-xl mb-4"
            style={{ color: "var(--color-consumer-ink-muted)" }}
          >
            One email a month when {institution.name}&apos;s fees change or
            when we publish a relevant Hamilton report.
          </p>
          <div className="max-w-md">
            <NewsletterForm source={`institution:${slug}`} />
          </div>
        </section>
      </main>
    </ConsumerShell>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-[0.16em] mb-1"
        style={{ color: "var(--color-consumer-ink-dim)" }}
      >
        {label}
      </div>
      <div className="tabular text-base font-semibold">{value}</div>
    </div>
  );
}
