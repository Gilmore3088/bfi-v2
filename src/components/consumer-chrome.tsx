import Link from "next/link";
import { NewsletterForm } from "./newsletter-form";
import { SITE } from "@/lib/site";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/methodology", label: "Methodology" },
  { href: "/reports", label: "Reports" },
  { href: "/about", label: "About" },
];

export function ConsumerHeader() {
  return (
    <header
      className="border-b"
      style={{ borderColor: "var(--color-consumer-border)" }}
    >
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="serif text-xl font-semibold tracking-tight">
          {SITE.name}
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hover:opacity-70 transition-opacity"
              style={{ color: "var(--color-consumer-ink-muted)" }}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/admin"
            className="px-3 py-1.5 text-xs uppercase tracking-[0.14em] font-medium border rounded-sm"
            style={{
              borderColor: "var(--color-consumer-rule)",
              color: "var(--color-consumer-ink)",
            }}
          >
            Pro for institutions
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function ConsumerFooter() {
  return (
    <footer
      className="mt-24 border-t"
      style={{ borderColor: "var(--color-consumer-border)" }}
    >
      <div className="mx-auto max-w-6xl px-6 py-12 grid gap-10 md:grid-cols-3">
        <div>
          <div className="serif text-lg font-semibold mb-2">{SITE.name}</div>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--color-consumer-ink-muted)" }}
          >
            Verified fee data across U.S. banks and credit unions. Independent.
            Source-cited. Updated as institutions publish.
          </p>
        </div>
        <div className="text-sm">
          <div className="uppercase text-[11px] tracking-[0.16em] font-semibold mb-3">
            Explore
          </div>
          <ul className="space-y-2" style={{ color: "var(--color-consumer-ink-muted)" }}>
            <li>
              <Link href="/fees/overdraft" className="hover:underline">
                Overdraft fees
              </Link>
            </li>
            <li>
              <Link href="/fees/monthly_maintenance" className="hover:underline">
                Monthly maintenance fees
              </Link>
            </li>
            <li>
              <Link href="/fees/wire_domestic_outgoing" className="hover:underline">
                Wire transfer fees
              </Link>
            </li>
            <li>
              <Link href="/methodology" className="hover:underline">
                How we collect this data
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="uppercase text-[11px] tracking-[0.16em] font-semibold mb-3">
            The Monthly Pulse
          </div>
          <p
            className="text-sm mb-3 leading-relaxed"
            style={{ color: "var(--color-consumer-ink-muted)" }}
          >
            One email a month. Notable fee movements, new coverage, and the
            occasional Hamilton report.
          </p>
          <NewsletterForm source="footer" />
        </div>
      </div>
      <div
        className="border-t"
        style={{ borderColor: "var(--color-consumer-border)" }}
      >
        <div className="mx-auto max-w-6xl px-6 py-5 flex flex-wrap items-center justify-between text-xs"
          style={{ color: "var(--color-consumer-ink-dim)" }}
        >
          <div>© {new Date().getFullYear()} {SITE.name}. All rights reserved.</div>
          <div className="flex gap-5">
            <Link href="/methodology" className="hover:underline">
              Methodology
            </Link>
            <Link href="/about" className="hover:underline">
              About
            </Link>
            <Link href="/admin" className="hover:underline">
              Pro
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function ConsumerShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bfi-consumer min-h-screen">
      <ConsumerHeader />
      {children}
      <ConsumerFooter />
    </div>
  );
}
