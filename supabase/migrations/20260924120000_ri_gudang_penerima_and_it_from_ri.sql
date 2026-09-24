-- Revisi alur RI: gudang penerima per item (bukan otomatis cabang MR), dan
-- distribusi qty ke MR sekarang lewat Item Transfer (IT), bukan langsung
-- dari RI. Lihat services/procurement-actions.ts (applyReceiveCompletion)
-- dan services/item-transfer-actions.ts (finalizeItemTransfer).
--
-- Semua kolom baru nullable/additive -> aman untuk deploy tidak atomik.
-- RI yang sudah selesai SEBELUM revisi ini tetap NULL di cabang_penerima_id
-- (tidak di-backfill / tidak disentuh retroaktif — mr_items.qty_received
-- mereka sudah terlanjur ter-set lewat alur lama).

ALTER TABLE public.receive_items
  ADD COLUMN IF NOT EXISTS cabang_penerima_id BIGINT REFERENCES public.cabang(id);

CREATE INDEX IF NOT EXISTS idx_receive_items_cabang_penerima_id
  ON public.receive_items(cabang_penerima_id);

ALTER TABLE public.item_transfer_items
  ADD COLUMN IF NOT EXISTS mr_item_id BIGINT REFERENCES public.mr_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS receive_item_id BIGINT REFERENCES public.receive_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_item_transfer_items_mr_item_id
  ON public.item_transfer_items(mr_item_id);
CREATE INDEX IF NOT EXISTS idx_item_transfer_items_receive_item_id
  ON public.item_transfer_items(receive_item_id);
