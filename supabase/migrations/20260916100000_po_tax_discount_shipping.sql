-- Migration: Pajak (PPN/PPh), Diskon, dan Ongkir untuk Purchase Order
-- Date: 2026-09-16
-- Description:
--   Tambah field level dokumen (bukan per-item -- PO sekarang cuma punya 1
--   vendor per dokumen, lihat migration/kerjaan "vendor per dokumen") untuk:
--     - po_harga_termasuk_pajak: checkbox "Harga sudah termasuk pajak" --
--       kalau true, PPN tidak dijumlahkan lagi ke Total PO (sudah nempel di
--       harga satuan).
--     - po_ppn_rate: 0 (tanpa PPN), 11, atau 12 (persen).
--     - po_diskon_mode + po_diskon_value: diskon bisa persen dari subtotal
--       ('percent') atau nominal Rupiah tetap ('amount').
--     - po_ongkir: biaya ongkos kirim (Rupiah), ditambahkan ke Total PO.
--     - po_pph_type + po_pph_rate: PPh = pajak potong-pungut (withholding).
--       TIDAK mengurangi Total PO (nilai kontrak/approval tetap utuh) --
--       cuma pengurang terpisah di "Jumlah Dibayar ke Vendor", dihitung di
--       aplikasi (lib/po-tax.ts), bukan disimpan sebagai kolom tersendiri.
--
--   Semua kolom baru nullable-atau-ber-default sehingga migration ini aman
--   dideploy sebelum kode frontend yang memakainya ikut ter-deploy (lihat
--   memory db-migrations-backward-compat) -- kode lama yang belum tahu
--   kolom ini tetap insert PO normal, otomatis kepakein default (0/false).

ALTER TABLE public.pos
  ADD COLUMN IF NOT EXISTS po_harga_termasuk_pajak BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS po_ppn_rate NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS po_diskon_mode TEXT NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS po_diskon_value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS po_ongkir NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS po_pph_type TEXT,
  ADD COLUMN IF NOT EXISTS po_pph_rate NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_ppn_rate_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_ppn_rate_check
  CHECK (po_ppn_rate IN (0, 11, 12));

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_diskon_mode_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_diskon_mode_check
  CHECK (po_diskon_mode IN ('percent', 'amount'));

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_diskon_value_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_diskon_value_check
  CHECK (po_diskon_value >= 0);

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_ongkir_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_ongkir_check
  CHECK (po_ongkir >= 0);

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_pph_type_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_pph_type_check
  CHECK (po_pph_type IS NULL OR po_pph_type IN ('pph22', 'pph23', 'pph4a2', 'lainnya'));

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_po_pph_rate_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_po_pph_rate_check
  CHECK (po_pph_rate >= 0);
