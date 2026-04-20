-- Migration: Add status to pr_items
-- Allows granular status tracking for each item in a Purchase Request.

ALTER TABLE public.pr_items
ADD COLUMN IF NOT EXISTS status doc_status NOT NULL DEFAULT 'open';

-- Index for performance filtering
CREATE INDEX IF NOT EXISTS idx_pr_items_status ON public.pr_items(status);
