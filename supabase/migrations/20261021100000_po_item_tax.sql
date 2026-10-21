-- Pajak per item di PO.
-- Date: 2026-10-21
--
-- Sebelumnya PPN/PPh hanya di level dokumen (pos.po_ppn_*, pos.po_pph_*).
-- Data PO dari ERP lama ("Data PO WMS.xlsx") punya kode pajak per baris
-- (T = PPN 11, DT = PPN 11 + PPh 23, kosong = tanpa pajak) dan satu PO bisa
-- campur, jadi PO sekarang bisa memilih mode pajak:
--   - 'document' (default, perilaku lama): pakai kolom pos.po_ppn_* / po_pph_*.
--   - 'item': tiap po_items punya tarif PPN & PPh sendiri, dihitung dari DPP
--     item (subtotal item setelah diskon dokumen dibagi proporsional).
--     Kolom pajak dokumen diabaikan.
-- Rumus ada di lib/po-tax.ts (computePoTotals).
--
-- Backward compat (deploy tidak atomik): cuma menambah kolom ber-default.
-- Code production lama tidak membaca kolom baru, semua PO lama = 'document'.

ALTER TABLE public.pos
  ADD COLUMN IF NOT EXISTS po_tax_mode TEXT NOT NULL DEFAULT 'document';

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_tax_mode_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_tax_mode_check
  CHECK (po_tax_mode IN ('document', 'item'));

ALTER TABLE public.po_items
  ADD COLUMN IF NOT EXISTS item_ppn_rate NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_pph_type TEXT,
  ADD COLUMN IF NOT EXISTS item_pph_rate NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.po_items DROP CONSTRAINT IF EXISTS po_items_item_ppn_rate_check;
ALTER TABLE public.po_items ADD CONSTRAINT po_items_item_ppn_rate_check
  CHECK (item_ppn_rate >= 0 AND item_ppn_rate <= 100);

ALTER TABLE public.po_items DROP CONSTRAINT IF EXISTS po_items_item_pph_type_check;
ALTER TABLE public.po_items ADD CONSTRAINT po_items_item_pph_type_check
  CHECK (item_pph_type IS NULL OR item_pph_type IN ('pph22', 'pph23', 'pph4a2', 'lainnya'));

ALTER TABLE public.po_items DROP CONSTRAINT IF EXISTS po_items_item_pph_rate_check;
ALTER TABLE public.po_items ADD CONSTRAINT po_items_item_pph_rate_check
  CHECK (item_pph_rate >= 0 AND item_pph_rate <= 100);

COMMENT ON COLUMN public.pos.po_tax_mode IS
  'document = PPN/PPh dari kolom pos.po_ppn_*/po_pph_*; item = tarif per po_items (item_ppn_rate, item_pph_type, item_pph_rate).';
