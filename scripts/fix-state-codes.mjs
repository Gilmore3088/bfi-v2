#!/usr/bin/env node
// One-time data fix: state_code should be the HQ state, not the service state.
//
// The previous ingest (using FDIC /locations?STALP=FL) marked banks like Chase,
// BofA, Wells Fargo with state_code='FL' even though they're HQ'd in OH, NC, SD.
// This script:
//   1. Adds institutions.hq_state if missing
//   2. Looks up the real HQ STALP from FDIC for each bank with a CERT (via rssd_id reverse lookup)
//   3. Sets institutions.state_code = real HQ state
//   4. Leaves state_presence tracking to a follow-up migration
//
// Idempotent.

import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

async function main() {
  console.log("Adding hq_state column if missing...");
  await sql`
    ALTER TABLE institutions
    ADD COLUMN IF NOT EXISTS hq_state CHAR(2)
  `;

  // Get all banks with rssd_id (those came from FDIC)
  const banks = await sql`
    SELECT id, name, state_code, rssd_id
    FROM institutions
    WHERE charter_type='bank' AND rssd_id IS NOT NULL
  `;
  console.log(`Checking HQ state for ${banks.length} banks via FDIC...`);

  // Batch lookup HQ state by RSSD
  const rssdToState = new Map();
  for (let i = 0; i < banks.length; i += 100) {
    const chunk = banks.slice(i, i + 100);
    const rssds = chunk.map(b => b.rssd_id).filter(Boolean);
    const url = new URL("https://api.fdic.gov/banks/institutions");
    url.searchParams.set("filters", `FED_RSSD:(${rssds.join(" OR ")})`);
    url.searchParams.set("fields", "FED_RSSD,STALP");
    url.searchParams.set("limit", "1000");
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) {
      console.warn(`  FDIC batch ${i} failed: ${resp.status}`);
      continue;
    }
    const data = await resp.json();
    for (const row of data.data || []) {
      const d = row.data;
      if (d.FED_RSSD && d.STALP) rssdToState.set(String(d.FED_RSSD), d.STALP);
    }
  }
  console.log(`  Got HQ state for ${rssdToState.size} of ${banks.length}`);

  let updated = 0;
  let mismatches = 0;
  let mergedDups = 0;
  for (const b of banks) {
    const realHq = rssdToState.get(b.rssd_id);
    if (!realHq) continue;
    if (realHq !== b.state_code) mismatches++;
    // If the (name, realHq) row already exists, this is a duplicate created by
    // the FL ingest pulling banks that were already seeded in their HQ state.
    // Delete the FL duplicate; keep the canonical HQ row.
    const existing = await sql`
      SELECT id FROM institutions
      WHERE name = ${b.name} AND state_code = ${realHq} AND id <> ${b.id}
      LIMIT 1
    `;
    if (existing.length > 0) {
      await sql`DELETE FROM institutions WHERE id = ${b.id}`;
      mergedDups++;
      continue;
    }
    await sql`
      UPDATE institutions
      SET hq_state = ${realHq},
          state_code = ${realHq},
          updated_at = now()
      WHERE id = ${b.id}
    `;
    updated++;
  }
  console.log(`Updated ${updated} banks (mismatches corrected: ${mismatches}, duplicates removed: ${mergedDups})`);

  // CUs: HQ state from NCUA = STATE column (already correct, just backfill hq_state)
  const cus = await sql`UPDATE institutions SET hq_state = state_code WHERE charter_type='credit_union' AND hq_state IS NULL RETURNING id`;
  console.log(`Backfilled hq_state for ${cus.length} CUs (already correct)`);

  // Report
  const fl = await sql`
    SELECT charter_type, COUNT(*)::int AS c
    FROM institutions WHERE state_code='FL'
    GROUP BY charter_type ORDER BY charter_type
  `;
  console.log("\nFL after correction (HQ-based):");
  for (const r of fl) console.log(`  ${r.charter_type}: ${r.c}`);

  await sql.end();
}

main().catch(e => { console.error("fix failed:", e.message); process.exit(1); });
