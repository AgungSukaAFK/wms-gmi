-- Migration: add missing pos.po_pic_id
-- createPurchaseOrder already accepts po_pic_id as a parameter (used to build
-- the approval flow) but never persists it on the pos row — only the text
-- name (po_pic) is stored. This blocks notifying the PO owner on
-- approve/reject. Additive/nullable: old rows stay NULL, old app code that
-- doesn't send this field keeps working unchanged.

ALTER TABLE public.pos
  ADD COLUMN IF NOT EXISTS po_pic_id UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_pos_po_pic_id ON public.pos(po_pic_id);
