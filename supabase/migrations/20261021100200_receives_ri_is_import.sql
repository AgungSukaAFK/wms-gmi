-- Penanda RI hasil import data ERP ("Data PO WMS.xlsx").
-- Date: 2026-10-21
--
-- RI historis dari ERP diimport sebagai RI completed (stok gudang penerima
-- ikut bertambah, qty diterima PO tercatat). Keputusan user: RI import TIDAK
-- memenuhi MR, jadi sumber pemenuhan MR #6 (RI langsung ke gudang MR, lihat
-- lib/mr-fulfillment.ts) mengecualikan RI dengan ri_is_import = true.
--
-- Backward compat: kolom baru ber-default false, code lama tidak membacanya.
-- Code baru (lib/mr-fulfillment.ts) membaca kolom ini, jadi migration ini
-- WAJIB dijalankan sebelum deploy frontend.

ALTER TABLE public.receives
  ADD COLUMN IF NOT EXISTS ri_is_import BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_receives_ri_is_import
  ON public.receives(ri_is_import)
  WHERE ri_is_import;

COMMENT ON COLUMN public.receives.ri_is_import IS
  'true = RI hasil import ERP (Data PO WMS.xlsx); tidak dihitung ke pemenuhan MR.';
