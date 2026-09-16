-- Migration: PPN & PPh manual nominal untuk Purchase Order
-- Date: 2026-09-16
-- Description:
--   Sebelumnya PPN cuma bisa diisi lewat rate tetap (0/11/12%) dan PPh cuma
--   lewat rate persen (po_ppn_rate/po_pph_rate, lihat migration
--   20260916100000_po_tax_discount_shipping.sql). Sekarang ditambah opsi
--   isi nominal Rupiah langsung (manual) sebagai alternatif -- mengikuti
--   pola yang sama dengan diskon (po_diskon_mode: 'percent' | 'amount').
--
--   po_ppn_rate/po_pph_rate TETAP dipakai kalau mode-nya 'percent' (kolom
--   & CHECK constraint lama tidak diubah). Kolom nominal baru cuma dipakai
--   kalau mode-nya 'amount'.
--
--   Semua kolom baru nullable-atau-ber-default sehingga migration ini aman
--   dideploy sebelum kode frontend yang memakainya ikut ter-deploy (lihat
--   memory db-migrations-backward-compat).

ALTER TABLE public.pos
  ADD COLUMN IF NOT EXISTS po_ppn_mode TEXT NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS po_ppn_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS po_pph_mode TEXT NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS po_pph_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_ppn_mode_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_ppn_mode_check
  CHECK (po_ppn_mode IN ('percent', 'amount'));

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_ppn_amount_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_ppn_amount_check
  CHECK (po_ppn_amount >= 0);

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_pph_mode_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_pph_mode_check
  CHECK (po_pph_mode IN ('percent', 'amount'));

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_pph_amount_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_pph_amount_check
  CHECK (po_pph_amount >= 0);
