-- Backfill: one job_costing_finish_parts row per pre-revision job costing,
-- derived from the legacy single finish-part columns on the header (joined
-- to barang for a part_number/part_name snapshot, matching how
-- job_costing_items rows are snapshotted).
INSERT INTO public.job_costing_finish_parts
  (job_id, part_id, part_number, part_name, qty, cabang_id, created_at, updated_at)
SELECT
  jc.id,
  jc.finish_part_id,
  b.part_number,
  b.part_name,
  COALESCE(jc.qty_finish_part, 1),
  jc.finish_part_cabang_id,
  jc.created_at,
  jc.created_at
FROM public.job_costing jc
LEFT JOIN public.barang b ON b.id = jc.finish_part_id
WHERE jc.finish_part_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.job_costing_finish_parts fp WHERE fp.job_id = jc.id
  );

-- Mark ALL existing job_costing rows as "stock already applied", regardless
-- of status. Pre-revision createJobCosting() always mutated stock
-- unconditionally at create time, no matter which status was chosen
-- (including 'rejected'), and any row that made it into the table already
-- passed every rollback check in that old code path -- so its stock effect
-- is historically real. Without this, the new approval-gated logic would
-- wrongly treat old rows as "not yet applied" the next time their status is
-- touched, and could double-apply or wrongly skip a reversal.
UPDATE public.job_costing
SET stock_applied_at = COALESCE(created_at, NOW())
WHERE stock_applied_at IS NULL;
