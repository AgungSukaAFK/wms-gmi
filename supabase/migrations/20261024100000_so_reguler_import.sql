-- Migration: penanda SO Reguler hasil import Excel "LIST PENAWARAN GMI.xlsx"
-- (sheet Monitoring PO GMI) -- dipakai skrip supabase/import/so_reguler_*.sql
-- untuk lewati SO yang sudah pernah diimport, verifikasi, dan rollback.
--
-- Backward compatible: kolom baru ber-default false, code lama tidak membacanya
-- dan SO buatan form tetap false.

ALTER TABLE public.so_reguler
  ADD COLUMN IF NOT EXISTS so_is_import BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.so_reguler.so_is_import IS
'true = SO dibuat oleh import Excel List Penawaran (baris yang belum terkirim di ERP), bukan lewat form.';
