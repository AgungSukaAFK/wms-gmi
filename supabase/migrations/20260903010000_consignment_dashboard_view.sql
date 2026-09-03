-- Migration: Dashboard Consignment (report view)
-- Date: 2026-09-03
-- Description:
--   View gabungan untuk Dashboard Consignment, mengikuti pola v_spb_report
--   (Report SPB): satu baris per item SO Consignment. Saat ini hanya
--   mencakup data yang sudah ada (tahap SO). Kolom-kolom fase berikutnya
--   (cek supply, pengiriman IT, PR/PO GMI, rekonsiliasi) akan ditambahkan
--   dengan `CREATE OR REPLACE VIEW` di migration terpisah begitu tabel
--   pendukungnya dibuat -- untuk saat ini frontend menampilkan kolom
--   tersebut sebagai placeholder kosong.

CREATE OR REPLACE VIEW public.v_consignment_dashboard AS
SELECT
    so.id AS so_id,
    so.so_no,
    so.so_tanggal_input,
    so.tgl_po_email_marketing,
    so.tgl_po_customer,
    so.due_date,
    so.no_po,
    so.site,
    so.customer_id,
    c.customer_name,
    c.customer_no,
    item.id AS item_id,
    item.part_id,
    item.part_number,
    item.part_name,
    item.satuan,
    item.qty,
    item.part_number_customer,
    item.code_item_customer,
    so.created_at,
    so.updated_at
FROM public.consignment_so so
JOIN public.consignment_so_items item ON item.so_id = so.id
LEFT JOIN public.customers c ON c.id = so.customer_id;

-- GRANT eksplisit: view baru tidak otomatis dapat privilege dari
-- 20260407230007_grant_schema_usage_to_anon.sql (GRANT tidak retroaktif),
-- lihat 20260728150000_fix_missing_view_grants.sql untuk kasus serupa.
GRANT SELECT ON TABLE public.v_consignment_dashboard TO anon, authenticated, authenticator;
