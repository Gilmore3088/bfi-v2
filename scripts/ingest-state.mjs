#!/usr/bin/env node
// Ingest all FDIC-insured banks + credit unions in a given state into institutions.
//
// Usage:
//   node scripts/ingest-state.mjs FL
//   node scripts/ingest-state.mjs --state=NY
//
// Sources:
//   FDIC BankFind Suite (https://banks.data.fdic.gov/api/institutions)
//   NCUA: https://mapping.ncua.gov/api/CreditUnionDetails/GetByCharterState (fallback to none if unavailable)
//
// Idempotent via UNIQUE (name, state_code).

import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const state =
  (process.argv.find((a) => a.startsWith("--state="))?.split("=")[1] ||
    process.argv[2] ||
    "").toUpperCase();

if (!state.match(/^[A-Z]{2}$/)) {
  console.error("Usage: node scripts/ingest-state.mjs <STATE_CODE>");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

// Asset tier classification (matches v2 schema convention)
function assetTier(assetMillions) {
  if (assetMillions == null) return null;
  const b = assetMillions * 1_000_000;
  if (b >= 250_000_000_000) return "super_regional";
  if (b >= 50_000_000_000) return "large_regional";
  if (b >= 10_000_000_000) return "regional";
  if (b >= 1_000_000_000) return "community_large";
  if (b >= 250_000_000) return "community_mid";
  return "community_small";
}

// Fed district lookup by state (12-district Federal Reserve System)
const FED_DISTRICT = {
  ME:1, NH:1, MA:1, RI:1, VT:1, CT:1,
  NY:2, NJ:2, PR:2, VI:2,
  PA:3, DE:3,
  OH:4, KY:4, WV:4,
  VA:5, MD:5, NC:5, SC:5, DC:5,
  GA:6, FL:6, AL:6, MS:6, TN:6, LA:6,
  WI:7, IA:7, IL:7, IN:7, MI:7,
  MN:9, MT:9, ND:9, SD:9,
  MO:8, AR:8,
  KS:10, NE:10, OK:10, CO:10, WY:10, NM:10,
  TX:11,
  AK:12, AZ:12, CA:12, HI:12, ID:12, NV:12, OR:12, UT:12, WA:12,
};

// -----------------------------------------------------------------------------
// FDIC banks
// -----------------------------------------------------------------------------

async function fetchFdicBanks(stateCode) {
  const url = new URL("https://banks.data.fdic.gov/api/institutions");
  url.searchParams.set("filters", `STALP:${stateCode} AND ACTIVE:1`);
  url.searchParams.set(
    "fields",
    "NAME,CITY,STALP,STNAME,ASSET,CERT,FED_RSSD,WEBADDR,ZIP,RSSDHCR"
  );
  url.searchParams.set("limit", "10000");

  console.log(`Fetching FDIC banks for ${stateCode}...`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`FDIC API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return (data.data || []).map((d) => d.data);
}

async function insertBanks(banks, stateCode) {
  let inserted = 0;
  for (const b of banks) {
    const assets = b.ASSET ? Number(b.ASSET) * 1_000_000 : null; // ASSET is in $K, convert
    const tier = assetTier(b.ASSET ? Number(b.ASSET) / 1_000 : null);
    const website = b.WEBADDR
      ? (b.WEBADDR.startsWith("http") ? b.WEBADDR : `https://${b.WEBADDR.trim()}`)
      : null;
    const r = await sql`
      INSERT INTO institutions
        (name, state_code, charter_type, asset_size, asset_size_tier,
         fed_district, city, website_url, rssd_id)
      VALUES
        (${b.NAME}, ${stateCode}, 'bank', ${assets}, ${tier},
         ${FED_DISTRICT[stateCode] ?? null}, ${b.CITY || null}, ${website},
         ${b.FED_RSSD ? String(b.FED_RSSD) : null})
      ON CONFLICT (name, state_code) DO UPDATE SET
        asset_size = EXCLUDED.asset_size,
        asset_size_tier = EXCLUDED.asset_size_tier,
        city = EXCLUDED.city,
        website_url = COALESCE(institutions.website_url, EXCLUDED.website_url),
        rssd_id = COALESCE(institutions.rssd_id, EXCLUDED.rssd_id),
        updated_at = now()
      RETURNING id
    `;
    if (r.length) inserted++;
  }
  return inserted;
}

// -----------------------------------------------------------------------------
// NCUA credit unions (via FFIEC public CSV; downloaded once and cached)
// -----------------------------------------------------------------------------

async function fetchNcuaCreditUnions(stateCode) {
  // NCUA's bulk CU directory comes from quarterly Call Report data.
  // We use the FOIA CSV published at https://www.ncua.gov/files/publications/analysis/call-report-data-2025-09.zip
  // For simplicity here, fall back to the live CreditUnionFOIA file:
  const url = "https://www.ncua.gov/analysis/Pages/credit-union-corporate-call-report-data.aspx";
  // Without the bulk CSV staged, we skip NCUA in this script.
  // The proper port lands in a separate `ingest-ncua-bulk.mjs`.
  console.log(`NCUA bulk ingest deferred; skipping CUs for ${stateCode} (use ingest-ncua-bulk.mjs)`);
  return [];
}

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

async function main() {
  const before = await sql`SELECT COUNT(*)::int AS c FROM institutions WHERE state_code=${state}`;
  console.log(`Before: ${before[0].c} institutions in ${state}`);

  const banks = await fetchFdicBanks(state);
  console.log(`  FDIC returned ${banks.length} active banks for ${state}`);

  const bankInserted = await insertBanks(banks, state);
  console.log(`  Upserted: ${bankInserted} banks`);

  await fetchNcuaCreditUnions(state);

  const after = await sql`SELECT COUNT(*)::int AS c FROM institutions WHERE state_code=${state}`;
  console.log(`After:  ${after[0].c} institutions in ${state}`);

  const totals = await sql`
    SELECT charter_type, COUNT(*)::int AS c
    FROM institutions WHERE state_code=${state}
    GROUP BY charter_type
  `;
  for (const t of totals) console.log(`  ${t.charter_type}: ${t.c}`);

  await sql.end();
}

main().catch((err) => {
  console.error("Ingest failed:", err.message);
  process.exit(1);
});
