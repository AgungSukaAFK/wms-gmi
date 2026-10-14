-- Migration: Keterangan wajib saat qty PR melebihi sisa qty_pr MR.
-- Additive only: kolom nullable, code production lama yang tidak mengisi
-- kolom ini tetap jalan tanpa perubahan.

ALTER TABLE public.pr_items
  ADD COLUMN IF NOT EXISTS over_mr_note TEXT;

COMMENT ON COLUMN public.pr_items.over_mr_note IS
  'Alasan qty PR melebihi sisa qty_pr MR item sumber (wajib diisi app saat over-request).';
