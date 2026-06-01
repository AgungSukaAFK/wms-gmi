-- Migration: Item Transfer tracking note + moderator override
-- Date: 2026-06-02
-- Description:
--   Menyamakan progress/tracking Item Transfer dengan Delivery. Menambahkan
--   kolom catatan tracking + jejak siapa/kapan yang override (oleh moderator/admin).
--   Tidak mengubah data lama; kolom baru nullable.

ALTER TABLE public.item_transfers
  ADD COLUMN IF NOT EXISTS tracking_note TEXT,
  ADD COLUMN IF NOT EXISTS tracking_note_updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tracking_note_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_item_transfers_tracking_note_updated_by
  ON public.item_transfers(tracking_note_updated_by);
