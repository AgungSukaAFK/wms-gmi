// Generator SQL "link item PO Outstanding -> item PR" berdasarkan referensi
// PR (po_items.ost_pr_ref) hasil import PO, setelah MR & PR diimport.
//
//   node supabase/import/generate_po_pr_link.cjs
//
// Tidak butuh file Excel -- semua data sudah di DB, jadi file kecil dan bisa
// langsung dijalankan di SQL Editor Supabase:
//   po_pr_link_dryrun.sql  -> simulasi (read-only)
//   po_pr_link_apply.sql   -> link + pecah item + status PR (1 transaksi)
//   po_pr_link_verify.sql  -> verifikasi pasca apply (read-only)

const path = require("path");
const fs = require("fs");

const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const write = (f, s) => fs.writeFileSync(path.join(__dirname, f), s);
const today = new Date().toISOString().slice(0, 10);
const head = (judul, isi) => `-- =====================================================================
-- LINK PO OUTSTANDING -> PR: ${judul}
-- Generated: ${today}  |  Generator: supabase/import/generate_po_pr_link.cjs
${isi}
-- =====================================================================

`;

const plan = read("po_pr_link_plan.sqltpl");

write(
  "po_pr_link_dryrun.sql",
  head("DRY-RUN (read-only)", "-- Jalankan seluruh isi file. Tidak mengubah data; hasil = 1 tabel rencana.") +
    plan +
    read("po_pr_link_dryrun_body.sqltpl"),
);
write(
  "po_pr_link_apply.sql",
  head(
    "APPLY (menulis data)",
    "-- Jalankan SETELAH dry-run dicek. 1 transaksi: gagal di tengah = tidak ada\n-- yang berubah. Aman dijalankan ulang (item yang sudah ter-link dilewati).",
  ) +
    "BEGIN;\n\n" +
    plan +
    read("po_pr_link_apply_body.sqltpl"),
);
write(
  "po_pr_link_verify.sql",
  head("VERIFIKASI (read-only)", "-- Jalankan setelah apply. FAIL = link/status tidak konsisten.") +
    plan +
    read("po_pr_link_verify_body.sqltpl"),
);

console.log("OK: po_pr_link_dryrun.sql, po_pr_link_apply.sql, po_pr_link_verify.sql");
