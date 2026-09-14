-- Migration: Hapus Code Item Customer dari SO Consignment
-- Date: 2026-09-12
-- Description:
--   Field "Code Item Customer" pada consignment_so_items dihapus — item
--   cukup diidentifikasi dari Part Number (PN GMI), tidak perlu kode
--   terpisah dari customer. PN Customer (part_number_customer) tetap ada.

-- View harus di-DROP + CREATE ulang tanpa kolom ini LEBIH DULU (Postgres
-- tidak mengizinkan CREATE OR REPLACE VIEW menghilangkan kolom output —
-- hanya boleh menambah kolom baru di akhir), baru setelah itu kolomnya
-- di-drop dari tabel. DROP VIEW menghapus grant sebelumnya, jadi di-GRANT
-- ulang secara eksplisit.
DROP VIEW IF EXISTS public.v_consignment_dashboard;

CREATE VIEW public.v_consignment_dashboard AS
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
    so.created_at,
    so.updated_at
FROM public.consignment_so so
JOIN public.consignment_so_items item ON item.so_id = so.id
LEFT JOIN public.customers c ON c.id = so.customer_id;

GRANT SELECT ON TABLE public.v_consignment_dashboard TO anon, authenticated, authenticator;

ALTER TABLE public.consignment_so_items
  DROP COLUMN IF EXISTS code_item_customer;
