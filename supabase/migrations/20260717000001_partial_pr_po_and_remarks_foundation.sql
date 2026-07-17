-- Migration: Foundation for multi-MR PR / multi-PR PO with partial items,
-- per-item MR remarks, and conversion progress tracking.
-- Additive only: all new columns are nullable or have safe defaults, so
-- production app code that has not yet been redeployed keeps working
-- unchanged against this schema.

-- 1. Precise item-level linkage (mirrors delivery_items.mr_item_id pattern)
ALTER TABLE public.pr_items
  ADD COLUMN IF NOT EXISTS mr_item_id BIGINT REFERENCES public.mr_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pr_items_mr_item_id ON public.pr_items(mr_item_id);

ALTER TABLE public.po_items
  ADD COLUMN IF NOT EXISTS pr_item_id BIGINT REFERENCES public.pr_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_po_items_pr_item_id ON public.po_items(pr_item_id);

-- 2. Best-effort backfill for existing rows (safe: matches on mr_id/pr_id + part_id,
-- only fills rows that are still NULL, never overwrites).
UPDATE public.pr_items pri
SET mr_item_id = mi.id
FROM public.mr_items mi
WHERE pri.mr_item_id IS NULL
  AND pri.mr_id = mi.mr_id
  AND pri.part_id = mi.part_id;

UPDATE public.po_items poi
SET pr_item_id = pri.id
FROM public.pr_items pri, public.pos po
WHERE poi.pr_item_id IS NULL
  AND po.id = poi.po_id
  AND pri.pr_id = po.pr_id
  AND pri.part_id = poi.part_id
  AND pri.mr_id = poi.mr_id;

-- 3. Fix long-standing bug: prs.mr_id was never populated by createPurchaseRequest
-- (only stamped per pr_items row). Backfill header with the first linked MR so
-- existing PRs at least show a primary MR reference. Never depended upon before
-- since it was always NULL, so this is a pure improvement, not a behavior change.
UPDATE public.prs p
SET mr_id = (
  SELECT pri.mr_id FROM public.pr_items pri
  WHERE pri.pr_id = p.id
  ORDER BY pri.id
  LIMIT 1
)
WHERE p.mr_id IS NULL;

-- 4. Per-item remarks on MR (replaces document-level mrs.mr_remarks in the UI;
-- mrs.mr_remarks column itself is left untouched for backward compatibility).
ALTER TABLE public.mr_items
  ADD COLUMN IF NOT EXISTS remarks TEXT;

-- 5. Conversion progress tracking, mirroring the existing po_receive_status pattern.
ALTER TABLE public.mrs
  ADD COLUMN IF NOT EXISTS mr_convert_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.mrs
  DROP CONSTRAINT IF EXISTS mrs_mr_convert_status_check;
ALTER TABLE public.mrs
  ADD CONSTRAINT mrs_mr_convert_status_check
  CHECK (mr_convert_status IN ('pending', 'partial', 'complete'));

ALTER TABLE public.prs
  ADD COLUMN IF NOT EXISTS pr_convert_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.prs
  DROP CONSTRAINT IF EXISTS prs_pr_convert_status_check;
ALTER TABLE public.prs
  ADD CONSTRAINT prs_pr_convert_status_check
  CHECK (pr_convert_status IN ('pending', 'partial', 'complete'));

CREATE INDEX IF NOT EXISTS idx_mrs_mr_convert_status ON public.mrs(mr_convert_status);
CREATE INDEX IF NOT EXISTS idx_prs_pr_convert_status ON public.prs(pr_convert_status);
