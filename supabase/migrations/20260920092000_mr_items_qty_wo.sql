-- Migration: Kolom qty_wo pada mr_items
-- Date: 2026-09-20
-- Description:
--   Channel fulfillment ketiga untuk item MR (selain qty_pr & qty_sharestock_total
--   dari 20260412000001_mr_fulfillment_logic.sql): qty yang terpenuhi lewat
--   Working Order. Diisi (bookkeeping only, bukan pergerakan stok) saat sebuah
--   WO di-Closed ("Selesaikan WO"). Sengaja TIDAK di-netting terhadap qty_pr/
--   qty_sharestock_total -- WO punya cap sendiri terhadap qty_request (lihat
--   services/working-order-actions.ts).

ALTER TABLE public.mr_items
  ADD COLUMN IF NOT EXISTS qty_wo INTEGER NOT NULL DEFAULT 0;
