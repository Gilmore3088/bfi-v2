#!/usr/bin/env node
// Ingest banks + credit unions operating in a given U.S. state.
//
// Banks: FDIC BankFind Suite — unique CERTs from /locations?STALP=XX
//        (covers HQ'd-in-state AND out-of-state institutions with branches)
// CUs:   NCUA quarterly FOICU.txt from the public call-report ZIP
//
// Usage:
//   node scripts/ingest-state.mjs FL
//   node scripts/ingest-state.mjs --state=NY --skip-cus
//
// Idempotent via UNIQUE (name, state_code).

import postgres from "postgres";
import { config } from "dotenv";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const args = process.argv.slice(2);
const stateArg = args.find((a) => !a.startsWith("--")) || "";
const skipBanks = args.includes("--skip-banks");
const skipCus = args.includes("--skip-cus");
const state = stateArg.toUpperCase();

if (!state.match(/^[A-Z]{2}$/)) {
  console.error("Usage: node scripts/ingest-state.mjs <STATE_CODE>");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

function assetTier(assetThousands) {
  if (assetThousands == null) return null;
  const m = assetThousands; // FDIC ASSET is in thousands ($K)
  if (m >= 250_000_000) return "super_regional";  // $250B+
  if (m >= 50_000_000) return "large_regional";   // $50B+
  if (m >= 10_000_000) return "regional";         // $10B+
  if (m >= 1_000_000) return "community_large";   // $1B+
  if (m >= 250_000) return "community_mid";       // $250M+
  return "community_small";
}

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
// FDIC banks (HQ'd OR with at least one branch in state)
// -----------------------------------------------------------------------------

async function fetchFdicBranchCerts(stateCode) {
  // Get all unique CERTs that have at least one branch in the state
  const url = new URL("https://api.fdic.gov/banks/locations");
  url.searchParams.set("filters", `STALP:${stateCode}`);
  url.searchParams.set("fields", "CERT");
  url.searchParams.set("limit", "10000");

  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`FDIC locations ${resp.status}`);
  const data = await resp.json();
  const certs = new Set();
  for (const row of data.data || []) {
    const c = row.data?.CERT;
    if (c) certs.add(String(c));
  }
  return [...certs];
}

async function fetchFdicInstitutions(certs) {
  // Batch by 100 to stay under URL length limits
  const out = [];
  for (let i = 0; i < certs.length; i += 100) {
    const chunk = certs.slice(i, i + 100);
    const url = new URL("https://api.fdic.gov/banks/institutions");
    url.searchParams.set("filters", `ACTIVE:1 AND CERT:(${chunk.join(" OR ")})`);
    url.searchParams.set(
      "fields",
      "NAME,CITY,STALP,ASSET,CERT,FED_RSSD,WEBADDR,RSSDHCR",
    );
    url.searchParams.set("limit", "1000");
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) throw new Error(`FDIC institutions ${resp.status}`);
    const data = await resp.json();
    for (const row of data.data || []) out.push(row.data);
  }
  return out;
}

async function insertBanks(institutions, stateCode) {
  let inserted = 0;
  for (const b of institutions) {
    const assets = b.ASSET ? Number(b.ASSET) * 1000 : null; // ASSET is in $K
    const tier = assetTier(b.ASSET ? Number(b.ASSET) : null);
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
      RETURNING (xmax = 0) AS inserted
    `;
    if (r.length && r[0].inserted) inserted++;
  }
  return inserted;
}

// -----------------------------------------------------------------------------
// NCUA credit unions (FOICU.txt from quarterly call-report ZIP)
// -----------------------------------------------------------------------------

function ncuaQuarterUrl() {
  // Try current quarter, fall back to previous if needed.
  const now = new Date();
  const month = now.getMonth(); // 0-11
  // NCUA publishes quarter data 2-3 months after quarter-end
  // Q1: Mar 31 -> available ~May/June, Q2: Jun 30 -> Aug/Sep, etc.
  const quarters = ["03", "06", "09", "12"];
  let q = Math.floor(month / 3) - 1;
  let year = now.getFullYear();
  if (q < 0) { q = 3; year--; }
  return `https://www.ncua.gov/files/publications/analysis/call-report-data-${year}-${quarters[q]}.zip`;
}

async function fetchNcuaForState(stateCode) {
  const candidates = [
    ncuaQuarterUrl(),
    "https://www.ncua.gov/files/publications/analysis/call-report-data-2025-09.zip",
    "https://www.ncua.gov/files/publications/analysis/call-report-data-2025-06.zip",
  ];
  const tmp = mkdtempSync(path.join(tmpdir(), "ncua-"));
  const zipPath = path.join(tmp, "data.zip");

  let ok = false;
  for (const url of candidates) {
    console.log(`  trying ${url}...`);
    const resp = await fetch(url, { redirect: "follow" });
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());
      writeFileSync(zipPath, buf);
      console.log(`  downloaded ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
      ok = true;
      break;
    }
  }
  if (!ok) {
    console.warn("  could not fetch any NCUA quarterly file");
    rmSync(tmp, { recursive: true, force: true });
    return [];
  }

  // Extract FOICU.txt
  execSync(`cd ${tmp} && unzip -o data.zip FOICU.txt`, { stdio: "ignore" });
  const text = readFileSync(path.join(tmp, "FOICU.txt"), "utf8");
  rmSync(tmp, { recursive: true, force: true });

  // Parse: header line + CSV rows. State is column 8 (1-indexed).
  const lines = text.split("\n");
  const header = parseCsvLine(lines[0]);
  const idxName = header.indexOf("CU_NAME");
  const idxCity = header.indexOf("CITY");
  const idxState = header.indexOf("STATE");
  const idxRssd = header.indexOf("RSSD");
  const idxCharter = header.indexOf("CU_NUMBER");

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < header.length - 5) continue;
    if (cols[idxState] !== stateCode) continue;
    out.push({
      name: titleCase(cols[idxName]),
      city: cols[idxCity] ? titleCase(cols[idxCity]) : null,
      rssd: cols[idxRssd] || null,
      charter_id: cols[idxCharter] || null,
    });
  }
  return out;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inq = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inq) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inq = false;
      else cur += c;
    } else {
      if (c === '"') inq = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function titleCase(s) {
  if (!s) return s;
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, " ").trim();
}

async function insertCreditUnions(cus, stateCode) {
  let inserted = 0;
  for (const cu of cus) {
    const r = await sql`
      INSERT INTO institutions
        (name, state_code, charter_type, fed_district, city, rssd_id, ncua_charter_id)
      VALUES
        (${cu.name}, ${stateCode}, 'credit_union',
         ${FED_DISTRICT[stateCode] ?? null}, ${cu.city}, ${cu.rssd}, ${cu.charter_id})
      ON CONFLICT (name, state_code) DO UPDATE SET
        city = COALESCE(institutions.city, EXCLUDED.city),
        rssd_id = COALESCE(institutions.rssd_id, EXCLUDED.rssd_id),
        ncua_charter_id = COALESCE(institutions.ncua_charter_id, EXCLUDED.ncua_charter_id),
        updated_at = now()
      RETURNING (xmax = 0) AS inserted
    `;
    if (r.length && r[0].inserted) inserted++;
  }
  return inserted;
}

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

async function main() {
  const before = await sql`SELECT COUNT(*)::int AS c FROM institutions WHERE state_code=${state}`;
  console.log(`Before: ${before[0].c} institutions in ${state}`);

  let bankInserted = 0;
  let cuInserted = 0;

  if (!skipBanks) {
    console.log(`Fetching FDIC unique parent banks for ${state}...`);
    const certs = await fetchFdicBranchCerts(state);
    console.log(`  ${certs.length} unique CERTs have FL branches`);
    const banks = await fetchFdicInstitutions(certs);
    console.log(`  ${banks.length} active institution records returned`);
    bankInserted = await insertBanks(banks, state);
    console.log(`  Inserted (new only): ${bankInserted}`);
  }

  if (!skipCus) {
    console.log(`Fetching NCUA credit unions for ${state}...`);
    try {
      const cus = await fetchNcuaForState(state);
      console.log(`  ${cus.length} CUs in NCUA data for ${state}`);
      cuInserted = await insertCreditUnions(cus, state);
      console.log(`  Inserted (new only): ${cuInserted}`);
    } catch (e) {
      console.warn(`  NCUA ingest failed: ${e.message}`);
    }
  }

  const after = await sql`SELECT charter_type, COUNT(*)::int AS c FROM institutions WHERE state_code=${state} GROUP BY charter_type ORDER BY charter_type`;
  console.log(`\nFinal state: ${state}`);
  for (const r of after) console.log(`  ${r.charter_type}: ${r.c}`);

  await sql.end();
}

// Schema may need ncua_charter_id column. Add it if missing.
async function ensureNcuaColumn() {
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='institutions' AND column_name='ncua_charter_id'
  `;
  if (cols.length === 0) {
    console.log("Adding institutions.ncua_charter_id column...");
    await sql`ALTER TABLE institutions ADD COLUMN ncua_charter_id TEXT`;
  }
}

ensureNcuaColumn().then(main).catch((err) => {
  console.error("Ingest failed:", err.message);
  process.exit(1);
});
