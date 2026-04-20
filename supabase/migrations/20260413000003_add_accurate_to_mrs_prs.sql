-- ============================================================
-- ADD ACCURATE FLAG TO MRS AND PRS
-- Tracks whether a document has been recorded in the Accurate
-- accounting system (for manual sync tracking only)
-- ============================================================

ALTER TABLE public.mrs
  ADD COLUMN accurate BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.prs
  ADD COLUMN accurate BOOLEAN NOT NULL DEFAULT false;
