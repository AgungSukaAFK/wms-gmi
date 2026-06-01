-- Migration: Rename "Transfer Item" (TI) -> "Item Transfer" (IT)
-- Date: 2026-06-02
-- Description:
--   Penamaan fitur diubah dari "Transfer Item" (singkatan TI) menjadi
--   "Item Transfer" (singkatan IT). Mencakup rename tabel, kolom, index,
--   constraint, RLS policy, serta update kode tipe stock_movements 'TI' -> 'IT'.
--   TIDAK ada perubahan struktur/relasi data; murni penamaan, aman untuk data lama.

-- 1. Rename tables
ALTER TABLE IF EXISTS public.transfer_items RENAME TO item_transfers;
ALTER TABLE IF EXISTS public.transfer_item_items RENAME TO item_transfer_items;

-- 2. Rename columns
ALTER TABLE public.item_transfers RENAME COLUMN ti_kode TO it_kode;
ALTER TABLE public.item_transfers RENAME COLUMN ti_tanggal TO it_tanggal;
ALTER TABLE public.item_transfer_items RENAME COLUMN ti_id TO it_id;

-- 3. Rename check constraint
ALTER TABLE public.item_transfers
  RENAME CONSTRAINT transfer_items_diff_cabang TO item_transfers_diff_cabang;

-- 4. Rename indexes (termasuk pkey & unique key bawaan, cosmetic - IF EXISTS aman)
ALTER INDEX IF EXISTS transfer_items_pkey RENAME TO item_transfers_pkey;
ALTER INDEX IF EXISTS transfer_item_items_pkey RENAME TO item_transfer_items_pkey;
ALTER INDEX IF EXISTS transfer_items_ti_kode_key RENAME TO item_transfers_it_kode_key;
ALTER INDEX IF EXISTS idx_transfer_items_dari_cabang RENAME TO idx_item_transfers_dari_cabang;
ALTER INDEX IF EXISTS idx_transfer_items_ke_cabang RENAME TO idx_item_transfers_ke_cabang;
ALTER INDEX IF EXISTS idx_transfer_items_status RENAME TO idx_item_transfers_status;
ALTER INDEX IF EXISTS idx_transfer_item_items_ti_id RENAME TO idx_item_transfer_items_it_id;

-- 5. Rename RLS policies
ALTER POLICY "Allow authenticated full access to transfer_items"
  ON public.item_transfers
  RENAME TO "Allow authenticated full access to item_transfers";
ALTER POLICY "Allow authenticated full access to transfer_item_items"
  ON public.item_transfer_items
  RENAME TO "Allow authenticated full access to item_transfer_items";

-- 6. Update kode tipe stock_movements pada data historis: 'TI' -> 'IT'
UPDATE public.stock_movements SET type = 'IT' WHERE type = 'TI';
