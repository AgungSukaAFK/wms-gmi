-- ============================================================
-- PURGE DATA TRANSAKSI (bukan reset skema)
-- ============================================================
-- Menghapus SEMUA baris data transaksi (Delivery, Item Transfer, Share Stock,
-- Planning Supply, Job Costing, MR, PR, PO, Receive Item, Stock Out Project,
-- SO Reguler, Request Stok, Approval Templates, Notifikasi, Histori Stok)
-- serta semua akun user KECUALI yang memiliki role 'moderator'.
--
-- TETAP DIPERTAHANKAN (tidak disentuh sama sekali):
--   barang, stock, cabang, vendors, customers,
--   roles, role_permissions, mr_level_auto_rules,
--   akun user dengan role 'moderator'
--
-- Tabel & struktur TIDAK dihapus (no DROP TABLE) — hanya isi barisnya.
-- Urutan DELETE di bawah sudah dihitung mengikuti graph foreign key
-- (child sebelum parent) supaya tidak kena FK violation.
--
-- CARA PAKAI:
--   1. WAJIB backup dulu (pg_dump / snapshot VPS) sebelum menjalankan ini
--      di database production. Operasi ini TIDAK BISA di-undo.
--   2. Uji dulu di Supabase local (supabase db reset lalu jalankan file ini)
--      untuk memastikan tidak ada error FK sebelum dijalankan di VPS.
--   3. Jalankan seluruh file ini via SQL editor Supabase VPS (atau psql).
-- ============================================================

BEGIN;

-- --- 1. Stock Out Project (SPB) — level terdalam dulu ---
DELETE FROM public.spb_invoice_details;
DELETE FROM public.spb_invoice;
DELETE FROM public.spb_do_details;
DELETE FROM public.spb_do;
DELETE FROM public.spb_po_details;
DELETE FROM public.spb_po;
DELETE FROM public.return_spb_details;
DELETE FROM public.return_spb;
DELETE FROM public.spb_details;
DELETE FROM public.spb;

-- --- 2. SO Reguler ---
DELETE FROM public.do_reguler_items;
DELETE FROM public.do_reguler;

-- --- 3. Receive Item ---
DELETE FROM public.receive_items;
DELETE FROM public.receives;

-- --- 4. Job Costing ---
DELETE FROM public.job_costing_items;
DELETE FROM public.job_costing;

-- --- 5. Delivery ---
DELETE FROM public.delivery_items;
DELETE FROM public.deliveries;

-- --- 6. Item Transfer (IT) ---
DELETE FROM public.item_transfer_items;
DELETE FROM public.item_transfers;

-- --- 7. Planning Supply & Share Stock ---
DELETE FROM public.planning_supplies;
DELETE FROM public.mr_sharestock_allocations;

-- --- 8. Request Stok ---
DELETE FROM public.stock_setting_requests;

-- --- 9. PO ---
DELETE FROM public.po_items;
DELETE FROM public.pos;

-- --- 10. PR ---
DELETE FROM public.pr_items;
DELETE FROM public.prs;

-- --- 11. MR ---
DELETE FROM public.mr_freeze_reports;
DELETE FROM public.mr_items;
DELETE FROM public.mrs;

-- --- 12. Approval Templates ---
DELETE FROM public.approval_template_steps;
DELETE FROM public.approval_templates;

-- --- 13. Notifikasi & Histori Stok ---
DELETE FROM public.notifications;
DELETE FROM public.stock_movements;

-- --- 14. Akun user, KECUALI role 'moderator' ---
-- Cascade otomatis ke public.profiles, public.user_roles,
-- public.user_signatures, dan tabel internal auth (identities, sessions, dst)
-- karena semua FK tsb didefinisikan ON DELETE CASCADE ke auth.users(id).
DELETE FROM auth.users
WHERE id NOT IN (
  SELECT ur.user_id
  FROM public.user_roles ur
  JOIN public.roles r ON ur.role_id = r.id
  WHERE r.name = 'moderator'
);

COMMIT;

-- ============================================================
-- QUERY VERIFIKASI PASCA-DEPLOY
-- Jalankan setelah COMMIT di atas untuk memastikan hasilnya sesuai.
-- Semua angka di bawah HARUS 0, kecuali baris barang/stock/master/moderator.
-- ============================================================

SELECT 'spb' t, count(*) FROM public.spb
UNION ALL SELECT 'spb_details', count(*) FROM public.spb_details
UNION ALL SELECT 'spb_po', count(*) FROM public.spb_po
UNION ALL SELECT 'spb_do', count(*) FROM public.spb_do
UNION ALL SELECT 'spb_invoice', count(*) FROM public.spb_invoice
UNION ALL SELECT 'return_spb', count(*) FROM public.return_spb
UNION ALL SELECT 'do_reguler', count(*) FROM public.do_reguler
UNION ALL SELECT 'receives', count(*) FROM public.receives
UNION ALL SELECT 'job_costing', count(*) FROM public.job_costing
UNION ALL SELECT 'deliveries', count(*) FROM public.deliveries
UNION ALL SELECT 'item_transfers', count(*) FROM public.item_transfers
UNION ALL SELECT 'planning_supplies', count(*) FROM public.planning_supplies
UNION ALL SELECT 'mr_sharestock_allocations', count(*) FROM public.mr_sharestock_allocations
UNION ALL SELECT 'stock_setting_requests', count(*) FROM public.stock_setting_requests
UNION ALL SELECT 'pos', count(*) FROM public.pos
UNION ALL SELECT 'prs', count(*) FROM public.prs
UNION ALL SELECT 'mrs', count(*) FROM public.mrs
UNION ALL SELECT 'approval_templates', count(*) FROM public.approval_templates
UNION ALL SELECT 'notifications', count(*) FROM public.notifications
UNION ALL SELECT 'stock_movements', count(*) FROM public.stock_movements
ORDER BY 1;

-- Data yang HARUS tetap ada (bukan 0):
SELECT 'barang' t, count(*) FROM public.barang
UNION ALL SELECT 'stock', count(*) FROM public.stock
UNION ALL SELECT 'cabang', count(*) FROM public.cabang
UNION ALL SELECT 'vendors', count(*) FROM public.vendors
UNION ALL SELECT 'customers', count(*) FROM public.customers
UNION ALL SELECT 'roles', count(*) FROM public.roles
UNION ALL SELECT 'mr_level_auto_rules', count(*) FROM public.mr_level_auto_rules
ORDER BY 1;

-- Cek akun yang tersisa (harus cuma moderator)
SELECT p.email, r.name AS role
FROM public.profiles p
JOIN public.user_roles ur ON ur.user_id = p.id
JOIN public.roles r ON r.id = ur.role_id
ORDER BY p.email;
