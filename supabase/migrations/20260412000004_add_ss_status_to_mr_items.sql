-- Migration: Add ss_status to mr_items
-- Tracks the fulfillment life cycle of the internal stock sharing portion of an MR item.

ALTER TABLE public.mr_items
ADD COLUMN IF NOT EXISTS ss_status doc_status NOT NULL DEFAULT 'open';

-- Index for performance filtering in the Share Stock module
CREATE INDEX IF NOT EXISTS idx_mr_items_ss_status ON public.mr_items(ss_status);
