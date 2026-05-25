import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";
import {
  getSitemapInstitutions,
  getSitemapCategories,
} from "@/lib/queries";
import { allStateCodes } from "@/lib/states";

/**
 * Root sitemap. Per the SEO brief we publish four logical sets:
 * institutions, categories, states, and editorial. Next.js' MetadataRoute
 * supports a single sitemap.ts entry; we merge the sets here. If volume
 * exceeds 10k entries we will split into `sitemap-*.ts` route segments.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [institutions, categories] = await Promise.all([
    getSitemapInstitutions().catch(() => []),
    getSitemapCategories().catch(() => []),
  ]);
  const now = new Date();

  const editorial: MetadataRoute.Sitemap = [
    { url: `${SITE.url}/`, lastModified: now, changeFrequency: "daily", priority: 1.0 },
    { url: `${SITE.url}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE.url}/methodology`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/reports`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];

  const institutionUrls: MetadataRoute.Sitemap = institutions.map((i) => ({
    url: `${SITE.url}/${i.charter === "credit_union" ? "credit-unions" : "banks"}/${i.slug}`,
    lastModified: i.lastModified,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const categoryUrls: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${SITE.url}/fees/${c.category}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  const stateUrls: MetadataRoute.Sitemap = allStateCodes().map((abbr) => ({
    url: `${SITE.url}/states/${abbr}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  return [...editorial, ...categoryUrls, ...stateUrls, ...institutionUrls];
}
