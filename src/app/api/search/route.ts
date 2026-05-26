import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { slugify } from "@/lib/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstitutionHit = {
  id: number;
  name: string;
  slug: string;
  state_code: string | null;
  charter_type: string | null;
};

type FeeHit = {
  id: string;
  fee_category: string;
  amount: string | null;
  institution_name: string | null;
};

type ReportHit = {
  id: string;
  kind: string;
  subject_category: string | null;
  subject_institution_name: string | null;
  created_at: string;
};

const ALLOWED_TYPES = new Set(["all", "institution", "fee", "report"]);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const typeRaw = (url.searchParams.get("type") ?? "all").toLowerCase();
  const type = ALLOWED_TYPES.has(typeRaw) ? typeRaw : "all";
  const limitParam = Number(url.searchParams.get("limit") ?? 5);
  const limit = Math.min(20, Math.max(1, Number.isFinite(limitParam) ? limitParam : 5));

  if (q.length < 2) {
    return Response.json({ institutions: [], fees: [], reports: [] });
  }

  const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

  const institutionRows =
    type === "all" || type === "institution"
      ? await sql<{
          id: number;
          name: string;
          state_code: string | null;
          charter_type: string | null;
        }[]>`
          SELECT id, name, state_code, charter_type
          FROM institutions
          WHERE name ILIKE ${pattern}
             OR city ILIKE ${pattern}
          ORDER BY asset_size DESC NULLS LAST
          LIMIT ${limit}
        `.catch(() => [])
      : [];
  const institutions: InstitutionHit[] = institutionRows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: slugify(r.name),
    state_code: r.state_code,
    charter_type: r.charter_type,
  }));

  const fees: FeeHit[] =
    type === "all" || type === "fee"
      ? await sql<FeeHit[]>`
          SELECT fv.id::text AS id,
                 fv.fee_category,
                 fv.amount::text AS amount,
                 i.name AS institution_name
          FROM fees_verified fv
          LEFT JOIN institutions i ON i.id = fv.institution_id
          WHERE fv.fee_category ILIKE ${pattern}
          ORDER BY fv.created_at DESC
          LIMIT ${limit}
        `.catch(() => [])
      : [];

  const reports: ReportHit[] =
    type === "all" || type === "report"
      ? await sql<ReportHit[]>`
          SELECT r.id::text AS id,
                 r.kind,
                 r.subject_category,
                 i.name AS subject_institution_name,
                 r.created_at
          FROM reports r
          LEFT JOIN institutions i ON i.id = r.subject_institution_id
          WHERE COALESCE(r.subject_category, '') ILIKE ${pattern}
             OR COALESCE(i.name, '') ILIKE ${pattern}
          ORDER BY r.created_at DESC
          LIMIT ${limit}
        `.catch(() => [])
      : [];

  return Response.json({ institutions, fees, reports });
}
