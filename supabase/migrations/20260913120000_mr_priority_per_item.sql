-- Migration: Prioritas MR jadi per-item (bukan per-dokumen)
-- Date: 2026-09-13
-- Description:
--   Revisi: status prioritas pada fitur Material Request (MR) biasa
--   dipindah dari level dokumen (mrs.mr_priority) ke level barang
--   (mr_items.item_priority) — kolom yang sama yang sudah dipakai
--   Scheduled MR (migration 20260913100000_scheduled_mr.sql). Selector
--   "Tingkat Prioritas" di form create tetap ada, tapi cuma sebagai
--   default prefill per item baru — sumber kebenaran sekarang di item.
--
--   Backfill DULU (setiap mr_items existing mewarisi prioritas dokumen
--   induknya) supaya histori prioritas MR yang sudah ada tidak hilang,
--   baru drop kolom lama. mr_items.prioritas (kolom lama dari skema awal,
--   terkonfirmasi tidak pernah dipakai) ikut dibersihkan sekalian.

-- Dibungkus DO block + cek information_schema supaya aman di-run ulang:
-- backfill & DROP COLUMN mr_priority cuma jalan kalau kolomnya masih ada
-- (kalau migration ini sudah pernah sukses sebelumnya, mr_priority sudah
-- tidak ada lagi — re-run tanpa guard ini akan gagal "column does not
-- exist" pada UPDATE-nya).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mrs' AND column_name = 'mr_priority'
  ) THEN
    UPDATE public.mr_items mi
    SET item_priority = m.mr_priority
    FROM public.mrs m
    WHERE mi.mr_id = m.id
      AND mi.item_priority IS NULL;

    ALTER TABLE public.mrs DROP COLUMN mr_priority;
  END IF;
END $$;

ALTER TABLE public.mr_items ALTER COLUMN item_priority SET DEFAULT 'P3';
ALTER TABLE public.mr_items ALTER COLUMN item_priority SET NOT NULL;
ALTER TABLE public.mr_items DROP COLUMN IF EXISTS prioritas;
