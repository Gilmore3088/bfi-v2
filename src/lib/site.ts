/**
 * Site-wide constants. Single source of truth for canonical URLs, names,
 * and metadata defaults. Reference everywhere instead of inlining strings.
 */
export const SITE = {
  name: "Bank Fee Index",
  tagline: "The national authority on bank fees.",
  description:
    "Verified fee data across U.S. banks and credit unions. Peer benchmarks by asset tier and Federal Reserve district. Hamilton reports on demand.",
  url:
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://bankfeeindex.com",
  twitter: "@bankfeeindex",
  organization: {
    legalName: "Bank Fee Index",
    founderName: "James Gilmore",
  },
} as const;

export function absoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const base = SITE.url.replace(/\/$/, "");
  const rel = path.startsWith("/") ? path : `/${path}`;
  return `${base}${rel}`;
}
