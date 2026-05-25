#!/usr/bin/env node
// Seeds a fresh v2 Supabase database with:
//   1. The canonical 49-category taxonomy
//   2. The 22 SPEC.md M1 seed institutions
//
// Usage:
//   node scripts/seed-fresh.mjs            (uses DATABASE_URL from .env.local)
//   DATABASE_URL=... node scripts/seed-fresh.mjs
//
// Idempotent: ON CONFLICT DO NOTHING on taxonomy.category and
// (name, state_code) on institutions.

import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set. Aborting.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

// -----------------------------------------------------------------------------
// Canonical 49-category taxonomy
// -----------------------------------------------------------------------------

const SPOTLIGHT = new Set([
  "monthly_maintenance",
  "overdraft",
  "nsf",
  "atm_non_network",
  "card_foreign_txn",
  "wire_domestic_outgoing",
]);

const CORE = new Set([
  "minimum_balance",
  "early_closure",
  "paper_statement",
  "card_replacement",
  "wire_intl_outgoing",
  "cashiers_check",
  "stop_payment",
  "late_payment",
  "safe_deposit_box",
]);

const EXTENDED = new Set([
  "dormant_account",
  "od_protection_transfer",
  "od_line_of_credit",
  "atm_international",
  "rush_card",
  "wire_domestic_incoming",
  "wire_intl_incoming",
  "money_order",
  "check_printing",
  "bill_pay",
  "mobile_deposit",
  "coin_counting",
  "notary_fee",
  "loan_origination",
  "appraisal_fee",
]);

function tierFor(category) {
  if (SPOTLIGHT.has(category)) return "spotlight";
  if (CORE.has(category)) return "core";
  if (EXTENDED.has(category)) return "extended";
  return "comprehensive";
}

const FAMILIES = {
  "Account Maintenance": [
    "monthly_maintenance", "minimum_balance", "early_closure",
    "dormant_account", "account_research", "paper_statement", "estatement_fee",
  ],
  "Overdraft & NSF": [
    "overdraft", "nsf", "continuous_od", "od_protection_transfer",
    "od_line_of_credit", "od_daily_cap", "nsf_daily_cap",
  ],
  "ATM & Card": [
    "atm_non_network", "atm_international", "card_replacement",
    "rush_card", "card_foreign_txn", "card_dispute",
  ],
  "Wire Transfers": [
    "wire_domestic_outgoing", "wire_domestic_incoming",
    "wire_intl_outgoing", "wire_intl_incoming",
  ],
  "Check Services": [
    "cashiers_check", "money_order", "check_printing", "stop_payment",
    "counter_check", "check_cashing", "check_image",
  ],
  "Digital & Electronic": [
    "ach_origination", "ach_return", "bill_pay", "mobile_deposit", "zelle_fee",
  ],
  "Cash & Deposit": [
    "coin_counting", "cash_advance", "deposited_item_return", "night_deposit",
  ],
  "Account Services": [
    "notary_fee", "safe_deposit_box", "garnishment_levy",
    "legal_process", "account_verification", "balance_inquiry",
  ],
  "Lending Fees": [
    "late_payment", "loan_origination", "appraisal_fee",
  ],
};

function titlecase(s) {
  return s.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// -----------------------------------------------------------------------------
// 22 M1 seed institutions (from SPEC.md)
// -----------------------------------------------------------------------------

const INSTITUTIONS = [
  // Banks
  { name: "JPMorgan Chase Bank, National Association", state_code: "OH", charter_type: "bank", asset_size_tier: "super_regional", fed_district: 4 },
  { name: "Bank of America, National Association", state_code: "NC", charter_type: "bank", asset_size_tier: "super_regional", fed_district: 5 },
  { name: "BMO Bank National Association", state_code: "IL", charter_type: "bank", asset_size_tier: "large_regional", fed_district: 7 },
  { name: "Charles Schwab Bank, SSB", state_code: "TX", charter_type: "bank", asset_size_tier: "large_regional", fed_district: 11 },
  { name: "BOKF, National Association", state_code: "OK", charter_type: "bank", asset_size_tier: "regional", fed_district: 10 },
  { name: "First National Bank of Pennsylvania", state_code: "PA", charter_type: "bank", asset_size_tier: "regional", fed_district: 3 },
  { name: "Amarillo National Bank", state_code: "TX", charter_type: "bank", asset_size_tier: "community_large", fed_district: 11 },
  { name: "Centier Bank", state_code: "IN", charter_type: "bank", asset_size_tier: "community_large", fed_district: 7 },
  { name: "Sturgis Bank & Trust Company", state_code: "MI", charter_type: "bank", asset_size_tier: "community_mid", fed_district: 7 },
  { name: "Clear Mountain Bank", state_code: "WV", charter_type: "bank", asset_size_tier: "community_mid", fed_district: 5 },
  { name: "Bank of York", state_code: "SC", charter_type: "bank", asset_size_tier: "community_small", fed_district: 5 },
  { name: "The Peshtigo National Bank", state_code: "WI", charter_type: "bank", asset_size_tier: "community_small", fed_district: 7 },
  // Credit unions
  { name: "Navy Federal Credit Union", state_code: "VA", charter_type: "credit_union", asset_size_tier: "large_regional", fed_district: 5 },
  { name: "State Employees' Federal Credit Union", state_code: "NC", charter_type: "credit_union", asset_size_tier: "large_regional", fed_district: 5 },
  { name: "Pentagon Federal Credit Union", state_code: "VA", charter_type: "credit_union", asset_size_tier: "regional", fed_district: 5 },
  { name: "SchoolsFirst Federal Credit Union", state_code: "CA", charter_type: "credit_union", asset_size_tier: "regional", fed_district: 12 },
  { name: "Teachers Federal Credit Union", state_code: "NY", charter_type: "credit_union", asset_size_tier: "community_large", fed_district: 2 },
  { name: "ESL Federal Credit Union", state_code: "NY", charter_type: "credit_union", asset_size_tier: "community_large", fed_district: 2 },
  { name: "Brightstar Federal Credit Union", state_code: "FL", charter_type: "credit_union", asset_size_tier: "community_mid", fed_district: 6 },
  { name: "Brazos Valley Schools Federal Credit Union", state_code: "TX", charter_type: "credit_union", asset_size_tier: "community_mid", fed_district: 11 },
  { name: "OC Federal Credit Union", state_code: "OH", charter_type: "credit_union", asset_size_tier: "community_small", fed_district: 4 },
  { name: "Bowater Employees Federal Credit Union", state_code: "TN", charter_type: "credit_union", asset_size_tier: "community_small", fed_district: 6 },
];

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

async function main() {
  console.log("Seeding taxonomy...");
  let taxonomyCount = 0;
  for (const [family, categories] of Object.entries(FAMILIES)) {
    for (const category of categories) {
      const result = await sql`
        INSERT INTO taxonomy (category, family, tier, display_name)
        VALUES (${category}, ${family}, ${tierFor(category)}, ${titlecase(category)})
        ON CONFLICT (category) DO NOTHING
        RETURNING category
      `;
      if (result.length > 0) taxonomyCount++;
    }
  }
  console.log(`  inserted ${taxonomyCount} taxonomy entries`);

  console.log("Seeding institutions...");
  let instCount = 0;
  for (const inst of INSTITUTIONS) {
    const result = await sql`
      INSERT INTO institutions (name, state_code, charter_type, asset_size_tier, fed_district)
      VALUES (${inst.name}, ${inst.state_code}, ${inst.charter_type}, ${inst.asset_size_tier}, ${inst.fed_district})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) instCount++;
  }
  console.log(`  inserted ${instCount} institutions`);

  const counts = await sql`
    SELECT
      (SELECT COUNT(*) FROM taxonomy)::int AS taxonomy_total,
      (SELECT COUNT(*) FROM institutions)::int AS institutions_total
  `;
  console.log(`\nFinal state: ${counts[0].taxonomy_total} taxonomy / ${counts[0].institutions_total} institutions`);

  await sql.end();
}

main().catch(err => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
