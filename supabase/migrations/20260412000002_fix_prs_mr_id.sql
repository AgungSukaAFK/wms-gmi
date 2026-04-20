-- Migration: Add mr_id to prs table
-- Useful for tracking which MR generated this PR.

ALTER TABLE public.prs
ADD COLUMN IF NOT EXISTS mr_id BIGINT REFERENCES public.mrs(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_prs_mr_id ON public.prs(mr_id);
