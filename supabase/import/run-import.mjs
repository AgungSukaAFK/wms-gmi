#!/usr/bin/env node
/**
 * Full WMS Legacy → Supabase Migration Script
 * Imports: cabang, barang, vendors, customers, users, stock, MR, PR, delivery, SPB, SPB details
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────
const SUPABASE_URL = "http://127.0.0.1:54331";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_PASSWORD = "gmi2026";
const BATCH_SIZE = 500;
const DEFAULT_TS = "2024-01-01T00:00:00+00:00";

if (!SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── Location mapping (user-defined) ─────────────────────────
const CABANG_MAP = [
  { nama_cabang: "GMI-JKT", kode_cabang: "JKT", aliases: ["JAKARTA", "HO"] },
  {
    nama_cabang: "GMI-ENIM",
    kode_cabang: "ENIM",
    aliases: ["MUARA ENIM", "TANJUNG ENIM"],
  },
  { nama_cabang: "GMI-BPP", kode_cabang: "BPP", aliases: ["BALIKPAPAN"] },
  { nama_cabang: "GMI-BA", kode_cabang: "BA", aliases: ["SITE BA"] },
  { nama_cabang: "GMI-TAL", kode_cabang: "TAL", aliases: ["SITE TAL"] },
  { nama_cabang: "GMI-MIP", kode_cabang: "MIP", aliases: ["SITE MIP"] },
  { nama_cabang: "GMI-MIFA", kode_cabang: "MIFA", aliases: ["SITE MIFA"] },
  { nama_cabang: "GMI-BIB", kode_cabang: "BIB", aliases: ["SITE BIB"] },
  { nama_cabang: "GMI-AMI", kode_cabang: "AMI", aliases: ["SITE AMI"] },
  { nama_cabang: "GMI-TBG", kode_cabang: "TBG", aliases: ["SITE TABANG"] },
  {
    nama_cabang: "GMI-BCP-PIK",
    kode_cabang: "BCP-PIK",
    aliases: ["SITE BCP+PIK"],
  },
  {
    nama_cabang: "GMI-DIZA",
    kode_cabang: "DIZA",
    aliases: ["SITE DIZA", "SITE DIZE"],
  },
];

// Build reverse lookup: alias → nama_cabang
const aliasToName = {};
CABANG_MAP.forEach((c) => {
  c.aliases.forEach((a) => {
    aliasToName[a.toUpperCase()] = c.nama_cabang;
  });
});

// Role mapping: old role name → new roles.name
const ROLE_MAP = {
  admin: "admin",
  superadmin: "moderator",
  warehouse: "logistik",
  purchasing: "purchasing",
  ppic: "ppic",
  spv: "spv",
  gl_mekanik: "gl",
  manager: "manager",
  logistik: "logistik",
  vendor: "vendor",
  customer: "customer",
  finance: "gl",
  marketing: "admin",
  user: "logistik",
  service: "service",
  manufaktur: "manufaktur",
  pjo: "pjo",
};

// Status mapping for doc_status enum
const STATUS_MAP = {
  pending: "open",
  open: "open",
  approved: "approved",
  closed: "closed",
  partial: "approved",
  rejected: "rejected",
  done: "done",
};
function mapStatus(s) {
  if (!s) return "open";
  return STATUS_MAP[s.toLowerCase()] || "open";
}

// ─── CSV Parser (RFC-4180 compliant) ─────────────────────────
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
    // skip \r\n or \n
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

// ─── Helpers ──────────────────────────────────────────────────
function fixTimestamp(val) {
  if (!val || val === "0000-00-00 00:00:00" || val === "0000-00-00")
    return DEFAULT_TS;
  if (!val.includes("+") && !val.includes("Z")) return val + "+00:00";
  return val;
}

function fixDate(val) {
  if (!val || val === "0000-00-00") return null;
  return val;
}

function clean(val) {
  if (!val) return val;
  return val.replace(/\r/g, "").trim();
}

async function batchUpsert(table, rows, conflictKey, label) {
  if (rows.length === 0) {
    console.log(`  ⏭️  ${label}: 0 rows, skipping`);
    return;
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflictKey, ignoreDuplicates: true });
    if (error) {
      console.error(`\n  ❌ ${label} batch error at ${i}:`, error.message);
      // Log first row of failed batch for debugging
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
}

async function batchInsertOnly(table, rows, label) {
  if (rows.length === 0) {
    console.log(`  ⏭️  ${label}: 0 rows, skipping`);
    return;
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      console.error(`\n  ❌ ${label} batch error at ${i}:`, error.message);
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
}

async function fetchAll(table, columns) {
  const allRows = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    allRows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log("\n🚀 WMS Legacy → Supabase Full Migration");
  console.log("═".repeat(55));

  // ─── STEP 0: Clear auth users ─────────────────────────────
  // NOTE: Run this BEFORE the script to truncate all tables:
  //   psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -c \
  //     "TRUNCATE TABLE return_spb_details, return_spb, spb_invoice_details, spb_invoice,
  //      spb_do_details, spb_do, spb_po_details, spb_po, spb_details, spb,
  //      delivery_items, deliveries, po_items, pos, pr_items, prs, mr_items, mrs,
  //      stock, barang, vendors, customers, user_roles, profiles, role_permissions,
  //      job_costing, cabang RESTART IDENTITY CASCADE;"
  console.log("\n🧹 Step 0: Clearing auth users...");
  const { data: existingUsers } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (existingUsers?.users) {
    for (const u of existingUsers.users) {
      await supabase.auth.admin.deleteUser(u.id);
    }
    console.log(`  🗑️  Deleted ${existingUsers.users.length} auth users`);
  }
  console.log("  ✅ Auth users cleared");

  // ─── STEP 1: Insert cabang ────────────────────────────────
  console.log("\n🏢 Step 1: Inserting cabang locations...");
  const cabangRows = CABANG_MAP.map((c) => ({
    nama_cabang: c.nama_cabang,
    kode_cabang: c.kode_cabang,
    is_active: true,
  }));
  await batchUpsert("cabang", cabangRows, "nama_cabang", "cabang");

  // Fetch back to get IDs
  const { data: dbCabang } = await supabase
    .from("cabang")
    .select("id, nama_cabang");
  const cabangNameToId = {};
  dbCabang.forEach((c) => {
    cabangNameToId[c.nama_cabang] = c.id;
  });

  // Helper: resolve old location string → cabang_id
  function resolveCabangId(locStr) {
    if (!locStr) return cabangNameToId["GMI-JKT"] || 1;
    const key = locStr.toUpperCase().trim();
    const name = aliasToName[key];
    if (name && cabangNameToId[name]) return cabangNameToId[name];
    // Fallback to GMI-JKT
    return cabangNameToId["GMI-JKT"] || 1;
  }
  console.log(`  📍 ${dbCabang.length} cabang ready`);

  // ─── STEP 2: Import barang ────────────────────────────────
  console.log("\n📦 Step 2: Importing barang...");
  const rawBarang = parseCSV(path.join(__dirname, "tb_barang.csv"));
  const barangMap = new Map();
  const oldPartIdToPartNumber = {};
  rawBarang.forEach((r) => {
    if (!r.part_number || !r.part_id) return;
    oldPartIdToPartNumber[r.part_id] = r.part_number;
    if (!barangMap.has(r.part_number)) {
      barangMap.set(r.part_number, {
        part_number: r.part_number,
        part_name: r.part_name || r.part_number,
        part_satuan: r.part_satuan || "Ea",
      });
    }
  });
  const barangRows = Array.from(barangMap.values());
  await batchUpsert("barang", barangRows, "part_number", "barang");

  // Build lookup: part_number → new id (paginated fetch for 15k+ rows)
  const dbBarang = await fetchAll("barang", "id, part_number");
  const partNumberToNewId = {};
  dbBarang.forEach((b) => {
    partNumberToNewId[b.part_number] = b.id;
  });

  // old_part_id → new_part_id
  function resolvePartId(oldPartId) {
    const pn = oldPartIdToPartNumber[oldPartId];
    if (pn && partNumberToNewId[pn]) return partNumberToNewId[pn];
    return null;
  }
  console.log(`  📦 ${dbBarang.length} unique barang ready`);

  // ─── STEP 3: Import vendors ───────────────────────────────
  console.log("\n🏪 Step 3: Importing vendors...");
  const rawVendors = parseCSV(path.join(__dirname, "vendors.csv"));
  const vendorMap = new Map();
  rawVendors.forEach((r) => {
    if (!r.vendor_no) return;
    const vno = clean(r.vendor_no);
    if (!vno || vendorMap.has(vno)) return;
    vendorMap.set(vno, {
      vendor_no: vno,
      vendor_name: clean(r.vendor_name) || vno,
      telephone: clean(r.telephone),
      contact_name: clean(r.contact_name),
      is_active: true,
    });
  });
  await batchUpsert(
    "vendors",
    Array.from(vendorMap.values()),
    "vendor_no",
    "vendors",
  );

  // ─── STEP 4: Import customers ─────────────────────────────
  console.log("\n👥 Step 4: Importing customers...");
  const rawCustomers = parseCSV(path.join(__dirname, "customers.csv"));
  const custNoSet = new Set();
  const custNameSet = new Set();
  const custRows = [];
  rawCustomers.forEach((r) => {
    if (!r.customer_no || !r.customer_name) return;
    const cno = clean(r.customer_no);
    const cname = clean(r.customer_name);
    if (!cno || !cname) return;
    // Skip if we already have this customer_no OR customer_name (both are UNIQUE)
    if (custNoSet.has(cno) || custNameSet.has(cname)) return;
    custNoSet.add(cno);
    custNameSet.add(cname);
    custRows.push({
      customer_no: cno,
      customer_name: cname,
      telephone: clean(r.telephone),
      contact_name: clean(r.contact_name),
      is_active: true,
    });
  });
  await batchUpsert("customers", custRows, "customer_no", "customers");

  // ─── STEP 5: Import users (auth + profiles + roles) ───────
  console.log("\n👤 Step 5: Creating users (auth + profiles + roles)...");
  const rawUsers = parseCSV(path.join(__dirname, "users.csv"));

  // Fetch roles for mapping
  const { data: dbRoles } = await supabase.from("roles").select("id, name");
  const roleNameToId = {};
  dbRoles.forEach((r) => {
    roleNameToId[r.name] = r.id;
  });

  const userOldIdToUuid = {};
  const userNameToUuid = {};
  let userCount = 0;
  const seenEmails = new Set();

  for (const r of rawUsers) {
    if (!r.email || !r.nama) continue;
    const email = r.email.toLowerCase().trim();
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);

    const oldRole = (r.role || "warehouse").toLowerCase().trim();
    const newRoleName = ROLE_MAP[oldRole] || "logistik";
    const roleId = roleNameToId[newRoleName];
    const cabangId = resolveCabangId(r.lokasi);
    const isActive = r.is_active === "1" || r.approval_status === "approved";

    // Create auth user
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          nama: clean(r.nama),
          cabang_id: cabangId,
          role: newRoleName,
          is_active: isActive,
          nrp: clean(r.nrp) || null,
        },
      });

    if (authError) {
      console.error(`\n  ⚠️  User ${email}: ${authError.message}`);
      continue;
    }

    const uuid = authData.user.id;
    if (r.id) userOldIdToUuid[r.id] = uuid;
    userNameToUuid[clean(r.nama)?.toUpperCase()] = uuid;
    userCount++;

    // Assign role
    if (roleId) {
      await supabase
        .from("user_roles")
        .upsert(
          { user_id: uuid, role_id: roleId },
          { onConflict: "user_id,role_id", ignoreDuplicates: true },
        );
    }

    process.stdout.write(`\r  ✅ Users: ${userCount}/${rawUsers.length}`);
  }
  console.log();

  // Helper: resolve a PIC name to UUID (best-effort match)
  function resolveUserUuid(picName) {
    if (!picName) return null;
    const key = picName.toUpperCase().trim();
    if (userNameToUuid[key]) return userNameToUuid[key];
    // Fuzzy match: find any user whose name contains the search string
    for (const [k, v] of Object.entries(userNameToUuid)) {
      if (k.includes(key) || key.includes(k)) return v;
    }
    return null;
  }

  // Get first UUID as fallback
  const fallbackUuid =
    Object.values(userOldIdToUuid)[0] || Object.values(userNameToUuid)[0];

  // ─── STEP 6: Import stock ─────────────────────────────────
  console.log("\n📊 Step 6: Importing stock...");
  const rawStock = parseCSV(path.join(__dirname, "tb_stock.csv"));

  // Deduplicate by (part_id, cabang_id) — sum qty if duplicates
  const stockAgg = new Map();
  let stockSkipped = 0;
  rawStock.forEach((r) => {
    const newPartId = resolvePartId(r.part_id);
    const cabangId = resolveCabangId(r.stk_location);
    if (!newPartId) {
      stockSkipped++;
      return;
    }
    const key = `${newPartId}_${cabangId}`;
    if (stockAgg.has(key)) {
      const existing = stockAgg.get(key);
      existing.qty += parseInt(r.stk_qty, 10) || 0;
    } else {
      stockAgg.set(key, {
        part_id: newPartId,
        cabang_id: cabangId,
        qty: parseInt(r.stk_qty, 10) || 0,
        min_qty: parseInt(r.stk_min, 10) || 0,
        max_qty: parseInt(r.stk_max, 10) || 0,
      });
    }
  });
  const stockRows = Array.from(stockAgg.values());
  if (stockSkipped > 0)
    console.log(`  ⚠️  ${stockSkipped} stock rows skipped (part_id not found)`);
  await batchUpsert("stock", stockRows, "part_id,cabang_id", "stock");

  // ─── STEP 7: Import Material Request (MR) ─────────────────
  console.log("\n📝 Step 7: Importing Material Requests...");
  const rawMR = parseCSV(path.join(__dirname, "tb_material_request.csv"));
  const mrOldIdToKode = {};
  const mrRows = [];
  for (const r of rawMR) {
    if (!r.mr_kode) continue;
    const picUuid = resolveUserUuid(r.mr_pic) || fallbackUuid;
    if (!picUuid) {
      console.error(`  ⚠️  MR ${r.mr_kode}: no user match for "${r.mr_pic}"`);
      continue;
    }
    mrOldIdToKode[r.mr_id] = r.mr_kode;
    mrRows.push({
      mr_kode: r.mr_kode,
      cabang_id: resolveCabangId(r.mr_lokasi),
      mr_pic: clean(r.mr_pic) || "SYSTEM",
      mr_pic_id: picUuid,
      mr_tanggal: fixDate(r.mr_tanggal),
      mr_due_date: fixDate(r.mr_due_date),
      mr_status: mapStatus(r.mr_status),
    });
  }
  await batchUpsert("mrs", mrRows, "mr_kode", "mrs");

  // Fetch MR ID map: mr_kode → new id
  const { data: dbMrs } = await supabase.from("mrs").select("id, mr_kode");
  const mrKodeToNewId = {};
  dbMrs?.forEach((m) => {
    mrKodeToNewId[m.mr_kode] = m.id;
  });
  function resolveMrId(oldMrId) {
    const kode = mrOldIdToKode[oldMrId];
    return kode ? mrKodeToNewId[kode] : null;
  }

  // ─── STEP 8: Import Purchase Request (PR) ──────────────────
  console.log("\n📋 Step 8: Importing Purchase Requests...");
  const rawPR = parseCSV(path.join(__dirname, "tb_purchase_request.csv"));
  const prRows = [];
  for (const r of rawPR) {
    if (!r.pr_kode) continue;
    const picUuid = resolveUserUuid(r.pr_pic) || fallbackUuid;
    if (!picUuid) {
      console.error(`  ⚠️  PR ${r.pr_kode}: no user match for "${r.pr_pic}"`);
      continue;
    }
    prRows.push({
      pr_kode: r.pr_kode,
      cabang_id: resolveCabangId(r.pr_lokasi),
      pr_pic_id: picUuid,
      pr_tanggal: fixDate(r.pr_tanggal) || "2024-01-01",
      pr_status: mapStatus(r.pr_status),
    });
  }
  await batchUpsert("prs", prRows, "pr_kode", "prs");

  // ─── STEP 9: Import Delivery ───────────────────────────────
  console.log("\n🚚 Step 9: Importing Deliveries...");
  const rawDelivery = parseCSV(path.join(__dirname, "tb_delivery.csv"));
  const dlvRows = [];
  for (const r of rawDelivery) {
    if (!r.dlv_kode) continue;
    const newMrId = resolveMrId(r.mr_id);
    const statusMap = {
      delivered: "done",
      open: "open",
      on_delivery: "approved",
      cancelled: "rejected",
    };
    dlvRows.push({
      dlv_kode: r.dlv_kode,
      mr_id: newMrId,
      dari_cabang_id: resolveCabangId(r.dlv_dari_gudang),
      ke_cabang_id: resolveCabangId(r.dlv_ke_gudang),
      ekspedisi: clean(r.dlv_ekspedisi) || "Lainnya",
      jumlah_koli: parseInt(r.dlv_jumlah_koli, 10) || 0,
      pic: clean(r.dlv_pic) || "SYSTEM",
      no_resi: clean(r.dlv_no_resi),
      status: statusMap[(r.dlv_status || "").toLowerCase()] || "open",
    });
  }
  await batchUpsert("deliveries", dlvRows, "dlv_kode", "deliveries");

  // ─── STEP 10: Import SPB ──────────────────────────────────
  console.log("\n📄 Step 10: Importing SPB...");
  const rawSPB = parseCSV(path.join(__dirname, "tb_spb.csv"));
  const spbOldIdToNo = {};
  const spbRows = [];
  for (const r of rawSPB) {
    if (!r.spb_no) continue;
    spbOldIdToNo[r.spb_id] = r.spb_no;
    const gudang = clean(r.spb_gudang);
    const cabangId = resolveCabangId(gudang);
    spbRows.push({
      spb_no: r.spb_no,
      spb_tanggal: fixTimestamp(r.spb_tanggal),
      spb_no_wo: clean(r.spb_no_wo),
      spb_section: clean(r.spb_section),
      spb_pic_gmi: clean(r.spb_pic_gmi),
      spb_pic_ppa: clean(r.spb_pic_ppa),
      spb_kode_unit: clean(r.spb_kode_unit),
      spb_tipe_unit: clean(r.spb_tipe_unit),
      spb_brand: clean(r.spb_brand),
      spb_hm: r.spb_hm ? parseFloat(r.spb_hm) : null,
      spb_problem_remark: clean(r.spb_problem_remark),
      spb_status: r.spb_status || "DONE QUOT",
      spb_gudang: gudang,
      cabang_id: cabangId,
      spb_pic: clean(r.spb_pic),
      spb_is_deleted: r.spb_is_deleted === "1",
    });
  }
  await batchUpsert("spb", spbRows, "spb_no", "spb");

  // Fetch SPB ID map
  const { data: dbSpb } = await supabase.from("spb").select("id, spb_no");
  const spbNoToNewId = {};
  dbSpb?.forEach((s) => {
    spbNoToNewId[s.spb_no] = s.id;
  });
  function resolveSpbId(oldSpbId) {
    const no = spbOldIdToNo[oldSpbId];
    return no ? spbNoToNewId[no] : null;
  }

  // ─── STEP 11: Import SPB Details ──────────────────────────
  console.log("\n📋 Step 11: Importing SPB Details...");
  const rawSPBDetail = parseCSV(path.join(__dirname, "tb_spb_detail.csv"));
  const spbDetailRows = [];
  for (const r of rawSPBDetail) {
    const newSpbId = resolveSpbId(r.spb_id);
    const newPartId = resolvePartId(r.part_id);
    if (!newSpbId || !newPartId) continue;
    spbDetailRows.push({
      spb_id: newSpbId,
      part_id: newPartId,
      dtl_spb_part_number: r.dtl_spb_part_number || "",
      dtl_spb_part_name: r.dtl_spb_part_name || "",
      dtl_spb_part_satuan: r.dtl_spb_part_satuan || "Ea",
      dtl_spb_qty: parseInt(r.dtl_spb_qty, 10) || 0,
      dtl_spb_qty_returned: parseInt(r.dtl_spb_qty_returned, 10) || 0,
    });
  }
  await batchInsertOnly("spb_details", spbDetailRows, "spb_details");

  // ─── SUMMARY ──────────────────────────────────────────────
  console.log("\n" + "═".repeat(55));
  console.log("✅ MIGRATION COMPLETE!");
  console.log("═".repeat(55));

  const tables = [
    "cabang",
    "barang",
    "vendors",
    "customers",
    "stock",
    "mrs",
    "prs",
    "deliveries",
    "spb",
    "spb_details",
  ];
  for (const t of tables) {
    const { count } = await supabase
      .from(t)
      .select("*", { count: "exact", head: true });
    console.log(`  ${t.padEnd(16)} → ${count} rows`);
  }
  const { count: profileCount } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true });
  console.log(`  ${"profiles".padEnd(16)} → ${profileCount} rows`);
  const { count: userRoleCount } = await supabase
    .from("user_roles")
    .select("*", { count: "exact", head: true });
  console.log(`  ${"user_roles".padEnd(16)} → ${userRoleCount} rows`);

  console.log("\n  🔑 Default password for all users: " + DEFAULT_PASSWORD);
  console.log("═".repeat(55) + "\n");
}

main().catch((err) => {
  console.error("\n💥 Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
