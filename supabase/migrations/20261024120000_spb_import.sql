-- Import riwayat SPB dari "SPB MONITORING <site> 2026.xlsx" (Import 23 Oktober/SPB)
--
-- 1. spb.spb_is_import: penanda SPB hasil import Excel (riwayat ERP/monitoring).
--    SPB import sebelum tanggal batas stok tidak memotong stok; cancel/hapus SPB
--    sekarang hanya mengembalikan stok yang benar-benar dipotong (net movement
--    SPB_OUT/SPB_CANCEL/SPB_ROLLBACK, lib/spb-posting.ts), jadi kolom ini cuma
--    penanda, tidak dipakai kode untuk logika stok.
-- 2. Satu DO ERP bisa mencakup beberapa SPB (beberapa SPB-PO), dan satu invoice
--    bisa mencakup beberapa DO. Nomor DO / invoice tidak lagi unik global,
--    tapi unik per SPB-PO (spb_do) / per DO (spb_invoice).
--
-- Backward compatible: kolom baru punya default, constraint unik cuma
-- dilonggarkan -- code production lama tetap jalan.
-- Idempotent: aman dijalankan ulang.

ALTER TABLE public.spb
  ADD COLUMN IF NOT EXISTS spb_is_import BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.spb.spb_is_import IS
  'SPB hasil import SPB Monitoring Excel (riwayat). Stok hanya dipotong untuk SPB import sejak tanggal batas (lihat stock_movements SPB_OUT).';

ALTER TABLE public.spb_do DROP CONSTRAINT IF EXISTS spb_do_do_no_key;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spb_do_spb_po_id_do_no_key') THEN
    ALTER TABLE public.spb_do ADD CONSTRAINT spb_do_spb_po_id_do_no_key UNIQUE (spb_po_id, do_no);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_spb_do_do_no ON public.spb_do(do_no);

ALTER TABLE public.spb_invoice DROP CONSTRAINT IF EXISTS spb_invoice_invoice_no_key;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spb_invoice_spb_do_id_invoice_no_key') THEN
    ALTER TABLE public.spb_invoice ADD CONSTRAINT spb_invoice_spb_do_id_invoice_no_key UNIQUE (spb_do_id, invoice_no);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_spb_invoice_invoice_no ON public.spb_invoice(invoice_no);
