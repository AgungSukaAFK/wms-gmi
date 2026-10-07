-- Migration: Mata uang Purchase Order (IDR / USD / AUD)
-- Date: 2026-10-06
-- Description:
--   Sebelumnya seluruh nominal PO (harga item, PPN/PPh manual, diskon,
--   ongkir) diasumsikan Rupiah. Sekarang satu PO bisa dibuat dalam IDR, USD,
--   atau AUD -- mata uang berlaku di level dokumen (sama seperti vendor &
--   pajak, lihat po-vendor-per-document). Tidak ada konversi kurs: nominal
--   disimpan apa adanya dalam mata uang PO.
--
--   Kolom NOT NULL DEFAULT 'IDR' sehingga semua PO lama otomatis IDR dan
--   kode production lama (yang belum mengirim po_currency) tetap jalan.

ALTER TABLE public.pos
  ADD COLUMN IF NOT EXISTS po_currency TEXT NOT NULL DEFAULT 'IDR';

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_currency_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_currency_check
  CHECK (po_currency IN ('IDR', 'USD', 'AUD'));
