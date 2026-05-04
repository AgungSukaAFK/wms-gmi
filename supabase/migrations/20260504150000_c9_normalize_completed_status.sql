-- Chapter C9: Normalize legacy final statuses to completed

UPDATE public.mrs
SET mr_status = 'completed'
WHERE mr_status IN ('done', 'closed');

UPDATE public.prs
SET pr_status = 'completed'
WHERE pr_status IN ('done', 'closed');

UPDATE public.pos
SET po_status = 'completed'
WHERE po_status IN ('closed');

UPDATE public.pos
SET po_status = 'completed'
WHERE po_receive_status = 'complete'
  AND po_status = 'approved';

UPDATE public.deliveries
SET status = 'completed'
WHERE status IN ('done', 'closed');

UPDATE public.job_costing
SET status = 'completed'
WHERE status = 'closed';
