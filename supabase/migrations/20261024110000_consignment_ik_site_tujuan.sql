-- Migration: IK Consignment -- tujuan = site customer, + penanda data import
-- Date: 2026-10-24
-- Description:
--   Tujuan IK (Invoice Konsinyasi) adalah SITE CUSTOMER (customer_sites =
--   gudang customer), bukan gudang (cabang) GMI. Alur stok baru:
--     - IK         : stok gudang asal GMI dipotong; barang tercatat dikirim
--                    ke site customer (tidak masuk stok cabang mana pun).
--     - Penerimaan : qty terima masuk customer_stock; selisih tidak masuk
--                    stok mana pun (komplain, ditindaklanjuti manual).
--
--   Perubahan:
--     1. consignment_ik.ke_site_id (FK customer_sites) + ke_site_name
--        (snapshot nama site; juga dipakai IK import yang site-nya tidak ada
--        di master). ke_cabang_id jadi NULLABLE.
--     2. consignment_ik.ik_is_import / consignment_so.so_is_import = data
--        hasil import Excel "Data Cosigment Petrosea" (riwayat IK ERP).
--        IK import tidak perlu Penerimaan.
--     3. v_consignment_dashboard: tujuan IK = cabang (IK lama) atau site.
--
--   Backward-compat (deploy tidak atomik): kode production lama masih
--   mengisi ke_cabang_id -> tetap lolos; kolom view tidak berubah.
--   Idempotent: aman di-run ulang.

-- 1. Tujuan IK = site customer
ALTER TABLE public.consignment_ik
  ADD COLUMN IF NOT EXISTS ke_site_id BIGINT REFERENCES public.customer_sites(id),
  ADD COLUMN IF NOT EXISTS ke_site_name TEXT;

ALTER TABLE public.consignment_ik
  ALTER COLUMN ke_cabang_id DROP NOT NULL;

ALTER TABLE public.consignment_ik
  DROP CONSTRAINT IF EXISTS consignment_ik_tujuan_check;
ALTER TABLE public.consignment_ik
  ADD CONSTRAINT consignment_ik_tujuan_check
  CHECK (ke_cabang_id IS NOT NULL OR NULLIF(btrim(ke_site_name), '') IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_consignment_ik_ke_site ON public.consignment_ik(ke_site_id);

COMMENT ON COLUMN public.consignment_ik.ke_site_id IS
'Site customer tujuan IK (gudang customer). IK baru selalu mengisi ini + ke_site_name; ke_cabang_id hanya untuk IK lama.';
COMMENT ON COLUMN public.consignment_ik.ke_site_name IS
'Snapshot nama site tujuan saat IK dibuat (tetap terisi walau site tidak ada di master, mis. IK import).';

-- 2. Penanda data import
ALTER TABLE public.consignment_ik
  ADD COLUMN IF NOT EXISTS ik_is_import BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.consignment_so
  ADD COLUMN IF NOT EXISTS so_is_import BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.consignment_ik.ik_is_import IS
'true = IK riwayat ERP hasil import Excel Data Cosigment Petrosea; tidak perlu Penerimaan.';
COMMENT ON COLUMN public.consignment_so.so_is_import IS
'true = SO dibuat oleh import Excel Data Cosigment Petrosea, bukan lewat form.';

-- 3. Dashboard: tujuan IK bisa cabang (IK lama) atau site customer.
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
    so.created_at,
    so.updated_at,
    ik_agg.total_qty_ik,
    ik_agg.no_ik_terakhir,
    ik_agg.tgl_ik_terakhir,
    ik_agg.no_awb_terakhir,
    ik_agg.gudang_terakhir,
    CASE
      WHEN ik_agg.total_qty_ik IS NULL OR ik_agg.total_qty_ik = 0 THEN NULL
      WHEN ik_agg.total_qty_ik >= item.qty THEN 'Full'
      ELSE 'Partial'
    END AS partial_full,
    CASE
      WHEN ik_agg.tgl_ik_terakhir IS NULL THEN NULL
      ELSE (ik_agg.tgl_ik_terakhir - so.so_tanggal_input)
    END AS durasi_kirim_ik_so
FROM public.consignment_so so
JOIN public.consignment_so_items item ON item.so_id = so.id
LEFT JOIN public.customers c ON c.id = so.customer_id
LEFT JOIN LATERAL (
    SELECT
        SUM(iki.qty) AS total_qty_ik,
        (ARRAY_AGG(ik.ik_kode ORDER BY ik.ik_tanggal DESC, ik.id DESC))[1] AS no_ik_terakhir,
        (ARRAY_AGG(ik.ik_tanggal ORDER BY ik.ik_tanggal DESC, ik.id DESC))[1] AS tgl_ik_terakhir,
        (ARRAY_AGG(ik.no_awb ORDER BY ik.ik_tanggal DESC, ik.id DESC))[1] AS no_awb_terakhir,
        (ARRAY_AGG(
          cabang_asal.nama_cabang || ' → ' || COALESCE(cabang_tujuan.nama_cabang, ik.ke_site_name, '-')
          ORDER BY ik.ik_tanggal DESC, ik.id DESC
        ))[1] AS gudang_terakhir
    FROM public.consignment_ik_items iki
    JOIN public.consignment_ik ik ON ik.id = iki.ik_id
    JOIN public.cabang cabang_asal ON cabang_asal.id = ik.dari_cabang_id
    LEFT JOIN public.cabang cabang_tujuan ON cabang_tujuan.id = ik.ke_cabang_id
    WHERE iki.so_item_id = item.id
) ik_agg ON true;
