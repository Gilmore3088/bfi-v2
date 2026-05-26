import { sql } from "@/lib/db";
import { PromoteRow } from "./promote-row";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_TITLE = "Unmapped fees";

// Pulled from agents/darwin/taxonomy.py — keep in sync with that whitelist.
// Used to populate the "promote to canonical category" dropdown.
const CANONICAL_CATEGORIES: ReadonlyArray<string> = [
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
];

type Row = {
  id: number;
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  fee_name: string | null;
  amount: string | null;
  frequency: string | null;
  conditions: string | null;
  confidence: string | null;
  evidence_quote: string | null;
  created_at: string;
};

async function getRows(): Promise<Row[]> {
  try {
    return await sql<Row[]>`
      SELECT
        fv.id, fv.institution_id, i.name AS institution_name, i.state_code,
        fv.fee_name,
        fv.amount::text AS amount,
        fv.frequency,
        fv.conditions,
        fv.confidence::text AS confidence,
        fv.evidence_quote,
        fv.created_at::text AS created_at
      FROM fees_verified fv
      JOIN institutions i ON i.id = fv.institution_id
      WHERE fv.fee_category = '_unmapped'
        AND fv.superseded_by IS NULL
        AND fv.review_status NOT IN ('approved', 'rejected')
      ORDER BY fv.created_at DESC
      LIMIT 500
    `;
  } catch {
    return [];
  }
}

export default async function UnmappedPage(): Promise<React.ReactElement> {
  const rows = await getRows();

  return (
    <main className="px-10 py-10 max-w-[1400px] mx-auto space-y-6">
      <header>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-admin-text-dim)] font-semibold mb-2">
          Long-tail curation
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{PAGE_TITLE}</h1>
        <p className="text-sm text-[var(--color-admin-text-muted)] mt-2 max-w-2xl">
          Fees Darwin found in the source documents but could not place into the
          49 canonical categories. Promote each to a canonical category to add
          it to the index, or reject it from the review queue.
        </p>
      </header>

      <section className="rounded border border-[var(--color-admin-border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-admin-surface-2)] text-[11px] uppercase tracking-wider text-[var(--color-admin-text-dim)]">
            <tr>
              <th className="text-left px-4 py-3">Institution</th>
              <th className="text-left px-4 py-3">Fee name</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Frequency</th>
              <th className="text-left px-4 py-3">Evidence</th>
              <th className="text-right px-4 py-3">Conf.</th>
              <th className="text-left px-4 py-3">Promote to</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-[var(--color-admin-text-muted)]"
                >
                  No unmapped fees in the queue.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <PromoteRow
                  key={r.id}
                  id={r.id}
                  institutionName={r.institution_name}
                  stateCode={r.state_code}
                  feeName={r.fee_name}
                  amount={r.amount ? Number(r.amount) : null}
                  frequency={r.frequency}
                  evidenceQuote={r.evidence_quote}
                  confidence={r.confidence ? Number(r.confidence) : null}
                  categories={CANONICAL_CATEGORIES}
                />
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
