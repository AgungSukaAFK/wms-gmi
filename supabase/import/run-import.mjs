#!/usr/bin/env node
/**
 * Import script: tb_barang.csv + tb_stock.csv → Supabase (local)
 *
 * Jalankan: node supabase/import/run-import.mjs
 *
 * Requirements: package.json sudah ada @supabase/supabase-js
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (bukan anon key!)
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Config ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY is required. Run: export SUPABASE_SERVICE_ROLE_KEY=<key>");
  process.exit(1);
}

// Use service role to bypass RLS
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BATCH_SIZE = 500; // rows per upsert batch

// --- Proper RFC-4180 CSV parser (handles quoted multiline fields) ---
function parseCSVString(content) {
  const rows = [];
  let headers = null;
  let pos = 0;
  const len = content.length;

  function parseField() {
    if (pos >= len) return "";
    if (content[pos] === '"') {
      // Quoted field
      pos++; // skip opening quote
      let field = "";
      while (pos < len) {
        if (content[pos] === '"') {
          if (content[pos + 1] === '"') {
            field += '"';
            pos += 2;
          } else {
            pos++; // skip closing quote
            break;
          }
        } else {
          field += content[pos++];
        }
      }
      return field;
    } else {
      // Unquoted field
      let field = "";
      while (pos < len && content[pos] !== "," && content[pos] !== "\n") {
        field += content[pos++];
      }
      return field.replace(/\r$/, "");
    }
  }

  function parseLine() {
    const fields = [];
    while (pos < len && content[pos] !== "\n") {
      fields.push(parseField());
      if (pos < len && content[pos] === ",") pos++; // comma
      else break;
    }
    if (pos < len && content[pos] === "\n") pos++; // newline
    return fields;
  }

  while (pos < len) {
    const fields = parseLine();
    if (fields.length === 0 || (fields.length === 1 && !fields[0])) continue;
    if (!headers) {
      headers = fields;
    } else {
      const row = {};
      headers.forEach((h, i) => { row[h] = fields[i] ?? null; });
      rows.push(row);
    }
  }
  return rows;
}

async function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return parseCSVString(content);
}


// --- Batch insert helper (ignoreDuplicates for dirty source data)
async function batchInsert(table, rows, conflictKey) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflictKey, ignoreDuplicates: true });

    if (error) {
      console.error(`  ❌ Batch error at offset ${i}:`, error.message);
      throw error;
    }

    inserted += batch.length;
    process.stdout.write(`\r  ✅ ${inserted}/${rows.length} rows`);
  }
  console.log();
}

// --- Main ---
async function main() {
  console.log("\n🚀 WMS-GMI Import Tool");
  console.log("=".repeat(50));

  // ── STEP 1: Import tb_barang ──────────────────────────
  console.log("\n📦 Step 1/3: Parsing tb_barang.csv...");
  const rawBarang = await parseCSV(path.join(__dirname, "tb_barang.csv"));
  console.log(`  Found ${rawBarang.length} rows`);

  const mappedBarang = rawBarang.map((row) => ({
    part_number: row.part_number,
    part_name: row.part_name,
    part_satuan: row.part_satuan || "Ea",
    // Ignore part_id (auto-generated), part_description, created_at, updated_at
  }));

  console.log("  📤 Inserting barang...");
  await batchInsert("barang", mappedBarang, "part_number");

  // ── STEP 2: Build part_number → id map (paginate, Supabase default limit=1000) ──
  console.log("\n🗺️  Step 2/3: Building part_number → id map...");
  const partNumberToId = {};
  const oldPartIdToNew = {};
  let fetchFrom = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from("barang")
      .select("id, part_number")
      .range(fetchFrom, fetchFrom + PAGE - 1)
      .order("id");
    if (pageErr) throw pageErr;
    if (!page || page.length === 0) break;
    page.forEach((b) => { partNumberToId[b.part_number] = b.id; });
    fetchFrom += page.length;
    if (page.length < PAGE) break;
  }
  console.log(`  Mapped ${Object.keys(partNumberToId).length} parts`);

  // Map old CSV part_id → new db id
  rawBarang.forEach((row) => {
    const newId = partNumberToId[row.part_number];
    if (newId) oldPartIdToNew[row.part_id] = newId;
  });

  // ── STEP 3: Get cabang id map ──────────────────────────
  console.log("\n🏢 Step 3/3: Building cabang location map...");
  const { data: cabangRows, error: cabangErr } = await supabase
    .from("cabang")
    .select("id, nama_cabang");
  if (cabangErr) throw cabangErr;

  const locationToId = {};
  cabangRows.forEach((c) => { locationToId[c.nama_cabang.toUpperCase()] = c.id; });
  console.log(`  Found ${cabangRows.length} locations:`, Object.keys(locationToId).join(", "));

  // ── STEP 4: Import tb_stock ───────────────────────────
  console.log("\n📊 Parsing tb_stock.csv...");
  const rawStock = await parseCSV(path.join(__dirname, "tb_stock.csv"));
  console.log(`  Found ${rawStock.length} rows`);

  const skipped = [];
  const mappedStock = [];

  rawStock.forEach((row) => {
    const newPartId = oldPartIdToNew[row.part_id];
    const cabangId = locationToId[(row.stk_location || "").toUpperCase()];

    if (!newPartId || !cabangId) {
      skipped.push({ part_id: row.part_id, location: row.stk_location });
      return;
    }

    mappedStock.push({
      part_id: newPartId,
      cabang_id: cabangId,
      qty: parseInt(row.stk_qty, 10) || 0,
      min_qty: parseInt(row.stk_min, 10) || 0,
      max_qty: parseInt(row.stk_max, 10) || 0,
    });
  });

  if (skipped.length > 0) {
    console.warn(`  ⚠️  Skipped ${skipped.length} stock rows (part/location not found)`);
  }

  console.log(`  📤 Inserting ${mappedStock.length} stock rows...`);
  await batchInsert("stock", mappedStock, "part_id,cabang_id");

  // ── Summary ────────────────────────────────────────────
  console.log("\n" + "=".repeat(50));
  console.log("✅ Import selesai!");
  console.log(`   Barang : ${mappedBarang.length} rows`);
  console.log(`   Stock  : ${mappedStock.length} rows`);
  if (skipped.length) console.log(`   Skipped: ${skipped.length} rows (no matching part/location)`);
  console.log("=".repeat(50) + "\n");
}

main().catch((err) => {
  console.error("\n💥 Import failed:", err.message);
  process.exit(1);
});
