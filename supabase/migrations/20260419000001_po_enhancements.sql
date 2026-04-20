-- Migration: PO Enhancements
-- Date: 2026-04-19
-- Description:
--   1. Add po_pic, po_payment_term, po_detail_status, po_receive_status to pos
--   2. Remove header-level vendor_id from pos (vendor is now per-item)
--   3. Add vendor_id and qty_received to po_items
--   4. Add pr_id reference to po_items for traceability

-- 1. Enrich pos header
ALTER TABLE public.pos
  ADD COLUMN IF NOT EXISTS po_pic        TEXT,
  ADD COLUMN IF NOT EXISTS po_payment_term TEXT,
  ADD COLUMN IF NOT EXISTS po_detail_status TEXT,
  ADD COLUMN IF NOT EXISTS po_receive_status TEXT NOT NULL DEFAULT 'pending';
  -- po_receive_status: 'pending' | 'partial' | 'complete'

-- 2. Remove header-level vendor_id (vendor is per-item now)
ALTER TABLE public.pos DROP COLUMN IF EXISTS vendor_id;

-- 3. Enrich po_items
ALTER TABLE public.po_items
  ADD COLUMN IF NOT EXISTS vendor_id    BIGINT REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qty_received INTEGER NOT NULL DEFAULT 0;

-- 4. Index for common queries
CREATE INDEX IF NOT EXISTS idx_pos_pr_id            ON public.pos(pr_id);
CREATE INDEX IF NOT EXISTS idx_pos_po_receive_status ON public.pos(po_receive_status);
CREATE INDEX IF NOT EXISTS idx_po_items_vendor_id   ON public.po_items(vendor_id);

-- 5. Ensure receive_items also tracks po_item_id for per-line fulfillment
ALTER TABLE public.receive_items
  ADD COLUMN IF NOT EXISTS po_item_id BIGINT REFERENCES public.po_items(id) ON DELETE SET NULL;
