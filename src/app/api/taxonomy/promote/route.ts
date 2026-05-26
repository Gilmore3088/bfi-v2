import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors agents/darwin/taxonomy.py CANONICAL_CATEGORIES.
const CANONICAL_CATEGORIES = new Set<string>([
  "monthly_maintenance", "minimum_balance", "early_closure", "dormant_account",
  "account_research", "paper_statement", "estatement_fee",
  "overdraft", "nsf", "continuous_od", "od_protection_transfer",
  "od_line_of_credit", "od_daily_cap", "nsf_daily_cap",
  "atm_non_network", "atm_international", "card_replacement", "rush_card",
  "card_foreign_txn", "card_dispute",
  "wire_domestic_outgoing", "wire_domestic_incoming", "wire_intl_outgoing",
  "wire_intl_incoming",
  "cashiers_check", "money_order", "check_printing", "stop_payment",
  "counter_check", "check_cashing", "check_image",
  "ach_origination", "ach_return", "bill_pay", "mobile_deposit", "zelle_fee",
  "coin_counting", "cash_advance", "deposited_item_return", "night_deposit",
  "notary_fee", "safe_deposit_box", "garnishment_levy", "legal_process",
  "account_verification", "balance_inquiry",
  "late_payment", "loan_origination", "appraisal_fee",
]);

type Body = {
  fees_verified_id?: number;
  new_category?: string;
  reviewer?: string;
};

/**
 * POST /api/taxonomy/promote
 *
 * Body: { fees_verified_id: number, new_category: string, reviewer?: string }
 *
 * Re-categorizes an unmapped fees_verified row by updating its
 * fee_category, canonical_fee_key, fee_family, and review_status. Writes
 * an agent_events audit row attributed to Knox (the review-domain agent).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const id = Number(body.fees_verified_id);
  const newCategory = String(body.new_category || "").trim();
  const reviewer = (body.reviewer || "admin").slice(0, 64);

  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json(
      { status: "error", message: "invalid fees_verified_id" },
      { status: 400 },
    );
  }
  if (!CANONICAL_CATEGORIES.has(newCategory)) {
    return NextResponse.json(
      { status: "error", message: "new_category must be one of the 49 canonical categories" },
      { status: 400 },
    );
  }

  try {
    const [existing] = await sql<{
      id: number;
      fee_category: string;
      institution_id: number;
      fee_name: string | null;
    }[]>`
      SELECT id, fee_category, institution_id, fee_name
      FROM fees_verified WHERE id = ${id}
    `;
    if (!existing) {
      return NextResponse.json(
        { status: "error", message: "fee not found" },
        { status: 404 },
      );
    }
    if (existing.fee_category !== "_unmapped") {
      return NextResponse.json(
        { status: "error", message: "only _unmapped rows can be promoted" },
        { status: 400 },
      );
    }

    const [family] = await sql<{ family: string }[]>`
      SELECT family FROM taxonomy WHERE category = ${newCategory}
    `;

    const updated = await sql<{ id: number }[]>`
      UPDATE fees_verified
         SET fee_category      = ${newCategory},
             canonical_fee_key = ${newCategory},
             fee_family        = ${family?.family ?? null},
             review_status     = 'pending',
             reviewed_by       = ${reviewer},
             reviewed_at       = now()
       WHERE id = ${id}
       RETURNING id
    `;
    if (updated.length === 0) {
      return NextResponse.json(
        { status: "error", message: "update failed" },
        { status: 500 },
      );
    }

    // Audit trail: log promotion under knox (review-domain agent).
    const [run] = await sql<{ run_id: string }[]>`
      INSERT INTO agent_runs (agent, status, trigger_source, ended_at, items_processed)
      VALUES ('knox', 'succeeded', 'manual', now(), 1)
      RETURNING run_id
    `;
    if (run?.run_id) {
      await sql`
        INSERT INTO agent_events (agent, run_id, status, payload)
        VALUES (
          'knox',
          ${run.run_id},
          'succeeded',
          ${sql.json({
            kind: "unmapped_promotion",
            fees_verified_id: id,
            institution_id: existing.institution_id,
            fee_name: existing.fee_name,
            from_category: "_unmapped",
            to_category: newCategory,
            reviewer,
          })}::jsonb
        )
      `;
    }

    return NextResponse.json({ status: "ok", id, new_category: newCategory });
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
}
