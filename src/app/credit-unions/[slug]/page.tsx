import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InstitutionProfile } from "@/components/institution-profile";
import { getInstitutionBySlug } from "@/lib/queries";

export const revalidate = 86400;

type Params = { slug: string };

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { slug } = await params;
  const data = await getInstitutionBySlug(slug, "credit_union");
  if (!data) {
    return {
      title: "Credit union not found",
      robots: { index: false, follow: false },
    };
  }
  const verified = data.lastVerifiedAt
    ? new Date(data.lastVerifiedAt).toLocaleDateString()
    : "pending";
  const title = `${data.institution.name} fees — full schedule`;
  const description = `Verified fee schedule for ${data.institution.name} (${data.institution.state_code}). ${data.fees.length} categories on record. Last verified ${verified}.`;
  const canonical = `/credit-unions/${slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "article" },
    twitter: { card: "summary", title, description },
  };
}

export default async function CreditUnionPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const data = await getInstitutionBySlug(slug, "credit_union");
  if (!data) notFound();
  return <InstitutionProfile data={data} charterPath="credit-unions" slug={slug} />;
}
