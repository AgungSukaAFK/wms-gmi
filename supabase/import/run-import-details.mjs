#!/usr/bin/env node
/**
 * WMS Detail Items Import
 * Fills mr_items, pr_items, delivery_items for parents that currently have no items.
 *
 * Run AFTER run-import.mjs has already populated mrs, prs, deliveries, and barang.
 *
 * Safe to re-run: skips any parent that already has items in the DB.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config (same as run-import.mjs) ─────────────────────────
const SUPABASE_URL = "http://127.0.0.1:54331";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 500;
const DEFAULT_TS = "2024-01-01T00:00:00+00:00";

if (!SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── Timestamp helper ─────────────────────────────────────────
function fixTimestamp(val) {
  if (!val || val === "0000-00-00 00:00:00" || val === "0000-00-00")
    return DEFAULT_TS;
  if (!val.includes("+") && !val.includes("Z")) return val + "+00:00";
  return val;
}

// ─── RFC-4180 CSV Parser (identical to run-import.mjs) ────────
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const rows = [];
  let headers = null;
  let pos = 0;
  const len = content.length;

  function parseField() {
    if (pos >= len) return "";
    let field = "";
    if (content[pos] === '"') {
      pos++;
      while (pos < len) {
        if (content[pos] === '"') {
          if (content[pos + 1] === '"') {
            field += '"';
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          field += content[pos++];
        }
      }
    } else {
      while (
        pos < len &&
        content[pos] !== "," &&
        content[pos] !== "\n" &&
        content[pos] !== "\r"
      ) {
        field += content[pos++];
      }
    }
    return field;
  }

  function parseLine() {
    const fields = [];
    while (pos < len && content[pos] !== "\n" && content[pos] !== "\r") {
      fields.push(parseField());
      if (pos < len && content[pos] === ",") pos++;
      else break;
    }
    if (pos < len && content[pos] === "\r") pos++;
    if (pos < len && content[pos] === "\n") pos++;
    return fields;
  }

  while (pos < len) {
    const fields = parseLine();
    if (fields.length === 0 || (fields.length === 1 && !fields[0])) continue;
    if (!headers) {
      headers = fields.map((h) => h.replace(/^"|"$/g, "").trim());
    } else {
      const row = {};
      headers.forEach((h, i) => {
        let val = (fields[i] ?? "").replace(/^"|"$/g, "").trim();
        if (val === "NULL" || val === "\\N" || val === "") val = null;
        row[h] = val;
      });
      rows.push(row);
    }
  }
  return rows;
}

// ─── Paginated fetch ──────────────────────────────────────────
async function fetchAll(table, columns) {
  const allRows = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetchAll(${table}): ${error.message}`);
    allRows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

// ─── Batch insert (no conflict key needed — PK is auto-gen) ───
async function batchInsert(table, rows, label) {
  if (rows.length === 0) {
    console.log(`  ⏭️  ${label}: 0 rows, skipping`);
    return 0;
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      console.error(`\n  ❌ ${label} batch error at row ${i}:`, error.message);
      console.error(
        `     Sample row:`,
        JSON.stringify(batch[0]).substring(0, 200),
      );
    } else {
      inserted += batch.length;
    }
    process.stdout.write(`\r  ✅ ${label}: ${inserted}/${rows.length}`);
  }
  console.log();
  return inserted;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log("\n🔧 WMS Detail Items Import");
  console.log("═".repeat(55));

  // ─── Step 1: Build lookup maps from parent CSVs ───────────
  console.log("\n📂 Step 1: Building lookup maps from CSV files...");

  // old part_id → part_number  (from tb_barang.csv)
  const rawBarang = parseCSV(path.join(__dirname, "tb_barang.csv"));
  const oldPartIdToPartNumber = {};
  rawBarang.forEach((r) => {
    if (r.part_id && r.part_number)
      oldPartIdToPartNumber[r.part_id] = r.part_number;
  });

  // old mr_id → mr_kode  (from tb_material_request.csv)
  const rawMR = parseCSV(path.join(__dirname, "tb_material_request.csv"));
  const oldMrIdToKode = {};
  rawMR.forEach((r) => {
    if (r.mr_id && r.mr_kode) oldMrIdToKode[r.mr_id] = r.mr_kode;
  });

  // old pr_id → pr_kode  (from tb_purchase_request.csv)
  const rawPR = parseCSV(path.join(__dirname, "tb_purchase_request.csv"));
  const oldPrIdToKode = {};
  rawPR.forEach((r) => {
    if (r.pr_id && r.pr_kode) oldPrIdToKode[r.pr_id] = r.pr_kode;
  });

  // old dlv_id → dlv_kode  (from tb_delivery.csv)
  const rawDelivery = parseCSV(path.join(__dirname, "tb_delivery.csv"));
  const oldDlvIdToKode = {};
  rawDelivery.forEach((r) => {
    if (r.dlv_id && r.dlv_kode) oldDlvIdToKode[r.dlv_id] = r.dlv_kode;
  });

  console.log(
    `  📦 ${Object.keys(oldPartIdToPartNumber).length} barang mappings`,
  );
  console.log(`  📝 ${Object.keys(oldMrIdToKode).length} MR mappings`);
  console.log(`  📋 ${Object.keys(oldPrIdToKode).length} PR mappings`);
  console.log(`  🚚 ${Object.keys(oldDlvIdToKode).length} delivery mappings`);

  // ─── Step 2: Fetch current Supabase IDs ───────────────────
  console.log("\n🔍 Step 2: Fetching current DB IDs from Supabase...");

  const dbBarang = await fetchAll("barang", "id, part_number");
  const partNumberToNewId = {};
  dbBarang.forEach((b) => {
    partNumberToNewId[b.part_number] = b.id;
  });

  const dbMrs = await fetchAll("mrs", "id, mr_kode");
  const mrKodeToNewId = {};
  dbMrs.forEach((m) => {
    mrKodeToNewId[m.mr_kode] = m.id;
  });

  const dbPrs = await fetchAll("prs", "id, pr_kode");
  const prKodeToNewId = {};
  dbPrs.forEach((p) => {
    prKodeToNewId[p.pr_kode] = p.id;
  });

  const dbDeliveries = await fetchAll("deliveries", "id, dlv_kode");
  const dlvKodeToNewId = {};
  dbDeliveries.forEach((d) => {
    dlvKodeToNewId[d.dlv_kode] = d.id;
  });

  console.log(`  📦 ${dbBarang.length} barang in DB`);
  console.log(`  📝 ${dbMrs.length} mrs in DB`);
  console.log(`  📋 ${dbPrs.length} prs in DB`);
  console.log(`  🚚 ${dbDeliveries.length} deliveries in DB`);

  // ─── Resolver helpers ─────────────────────────────────────
  // Resolve old part_id to new Supabase part_id.
  // Falls back to csvPartNumber in case old ID lookup fails.
  function resolvePartId(oldPartId, csvPartNumber) {
    const pn = oldPartIdToPartNumber[oldPartId] || csvPartNumber;
    return pn && partNumberToNewId[pn] ? partNumberToNewId[pn] : null;
  }

  function resolveMrNewId(oldMrId) {
    const kode = oldMrIdToKode[oldMrId];
    return kode ? (mrKodeToNewId[kode] ?? null) : null;
  }

  function resolvePrNewId(oldPrId) {
    const kode = oldPrIdToKode[oldPrId];
    return kode ? (prKodeToNewId[kode] ?? null) : null;
  }

  function resolveDlvNewId(oldDlvId) {
    const kode = oldDlvIdToKode[oldDlvId];
    return kode ? (dlvKodeToNewId[kode] ?? null) : null;
  }

  // ─── Step 3: Find which parents already have items ────────
  console.log("\n🔍 Step 3: Checking for pre-existing items...");

  const existingMrItems = await fetchAll("mr_items", "mr_id");
  const mrIdsWithItems = new Set(existingMrItems.map((r) => r.mr_id));

  const existingPrItems = await fetchAll("pr_items", "pr_id");
  const prIdsWithItems = new Set(existingPrItems.map((r) => r.pr_id));

  const existingDlvItems = await fetchAll("delivery_items", "dlv_id");
  const dlvIdsWithItems = new Set(existingDlvItems.map((r) => r.dlv_id));

  console.log(
    `  mr_items:       ${mrIdsWithItems.size} parent MRs already have items`,
  );
  console.log(
    `  pr_items:       ${prIdsWithItems.size} parent PRs already have items`,
  );
  console.log(
    `  delivery_items: ${dlvIdsWithItems.size} parent deliveries already have items`,
  );

  // ─── Step 4: Import mr_items ──────────────────────────────
  console.log("\n📝 Step 4: Importing mr_items...");
  const rawDtlMR = parseCSV(path.join(__dirname, "dtl_material_request.csv"));
  const mrItemRows = [];
  let mrSkipped = 0;

  for (const r of rawDtlMR) {
    const newMrId = resolveMrNewId(r.mr_id);
    if (!newMrId) {
      mrSkipped++;
      continue;
    }
    // Skip parents that already have items — don't overwrite
    if (mrIdsWithItems.has(newMrId)) continue;

    const newPartId = resolvePartId(r.part_id, r.dtl_mr_part_number);
    if (!newPartId) {
      mrSkipped++;
      console.warn(
        `  ⚠️  mr_items: cannot resolve part_id ${r.part_id} / "${r.dtl_mr_part_number}" — skipped`,
      );
      continue;
    }

    mrItemRows.push({
      mr_id: newMrId,
      part_id: newPartId,
      part_number: r.dtl_mr_part_number ?? "",
      part_name: r.dtl_mr_part_name ?? "",
      satuan: r.dtl_mr_satuan ?? "Ea",
      prioritas: r.dtl_mr_prioritas ?? null,
      qty_request: parseInt(r.dtl_mr_qty_request, 10) || 0,
      qty_received: parseInt(r.dtl_mr_qty_received, 10) || 0,
      created_at: fixTimestamp(r.created_at),
      updated_at: fixTimestamp(r.updated_at),
    });
  }

  if (mrSkipped > 0)
    console.log(`  ⚠️  ${mrSkipped} mr_items skipped (ID not resolved)`);
  await batchInsert("mr_items", mrItemRows, "mr_items");

  // ─── Step 5: Import pr_items ──────────────────────────────
  console.log("\n📋 Step 5: Importing pr_items...");
  const rawDtlPR = parseCSV(path.join(__dirname, "dtl_purchase_request.csv"));
  const prItemRows = [];
  let prSkipped = 0;

  for (const r of rawDtlPR) {
    const newPrId = resolvePrNewId(r.pr_id);
    if (!newPrId) {
      prSkipped++;
      continue;
    }
    if (prIdsWithItems.has(newPrId)) continue;

    const newMrId = resolveMrNewId(r.mr_id);
    if (!newMrId) {
      prSkipped++;
      console.warn(
        `  ⚠️  pr_items: cannot resolve mr_id ${r.mr_id} for PR ${r.pr_id} — skipped`,
      );
      continue;
    }

    const newPartId = resolvePartId(r.part_id, r.dtl_pr_part_number);
    if (!newPartId) {
      prSkipped++;
      console.warn(
        `  ⚠️  pr_items: cannot resolve part_id ${r.part_id} / "${r.dtl_pr_part_number}" — skipped`,
      );
      continue;
    }

    prItemRows.push({
      pr_id: newPrId,
      mr_id: newMrId,
      part_id: newPartId,
      part_number: r.dtl_pr_part_number ?? "",
      part_name: r.dtl_pr_part_name ?? "",
      satuan: r.dtl_pr_satuan ?? "Ea",
      qty: parseInt(r.dtl_pr_qty, 10) || 0,
      created_at: fixTimestamp(r.created_at),
      updated_at: fixTimestamp(r.updated_at),
    });
  }

  if (prSkipped > 0)
    console.log(`  ⚠️  ${prSkipped} pr_items skipped (ID not resolved)`);
  await batchInsert("pr_items", prItemRows, "pr_items");

  // ─── Step 6: Import delivery_items ───────────────────────
  console.log("\n🚚 Step 6: Importing delivery_items...");
  const rawDtlDlv = parseCSV(path.join(__dirname, "dtl_delivery.csv"));
  const dlvItemRows = [];
  let dlvSkipped = 0;

  for (const r of rawDtlDlv) {
    const newDlvId = resolveDlvNewId(r.dlv_id);
    if (!newDlvId) {
      dlvSkipped++;
      continue;
    }
    if (dlvIdsWithItems.has(newDlvId)) continue;

    const newPartId = resolvePartId(r.part_id, r.dtl_dlv_part_number);
    if (!newPartId) {
      dlvSkipped++;
      console.warn(
        `  ⚠️  delivery_items: cannot resolve part_id ${r.part_id} / "${r.dtl_dlv_part_number}" — skipped`,
      );
      continue;
    }

    // Note: qty_rejected and receive_note columns do not exist in delivery_items schema — skipped.
    dlvItemRows.push({
      dlv_id: newDlvId,
      part_id: newPartId,
      part_number: r.dtl_dlv_part_number ?? "",
      part_name: r.dtl_dlv_part_name ?? "",
      satuan: r.dtl_dlv_satuan ?? "Ea",
      qty_on_delivery: parseInt(r.qty_on_delivery, 10) || 0,
      qty_delivered: parseInt(r.qty_delivered, 10) || 0,
      qty_pending: parseInt(r.qty_pending, 10) || 0,
      created_at: fixTimestamp(r.created_at),
      updated_at: fixTimestamp(r.updated_at),
    });
  }

  if (dlvSkipped > 0)
    console.log(`  ⚠️  ${dlvSkipped} delivery_items skipped (ID not resolved)`);
  await batchInsert("delivery_items", dlvItemRows, "delivery_items");

  // ─── Summary ──────────────────────────────────────────────
  console.log("\n" + "═".repeat(55));
  console.log("✅ DETAIL IMPORT COMPLETE!");
  console.log("═".repeat(55));

  for (const t of ["mr_items", "pr_items", "delivery_items"]) {
    const { count } = await supabase
      .from(t)
      .select("*", { count: "exact", head: true });
    console.log(`  ${t.padEnd(20)} → ${count} rows`);
  }
  console.log("═".repeat(55) + "\n");
}

main().catch((err) => {
  console.error("\n💥 Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
