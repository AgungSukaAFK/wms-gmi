-- Fix data: PR yang ter-set 'completed' terlalu dini.
--
-- Bug lama di applyReceiveCompletion (services/procurement-actions.ts):
-- begitu SATU PO diterima penuh, PR induknya langsung di-set 'completed',
-- tanpa cek PO lain dari PR yang sama / sisa qty PR yang belum ter-PO.
-- Akibatnya PR hilang dari picker create PO (filter pr_status='approved')
-- padahal masih ada sisa. Contoh: PR-GMI-4043 (PO 25891/25892 complete,
-- 25893/25895 masih pending, pr_convert_status partial).
--
-- Migration ini mengembalikan PR tsb ke 'approved' bila:
--   (a) masih ada pr_item yang qty-nya belum ter-PO penuh, ATAU
--   (b) ada PO non-rejected yang menutupi PR tsb yang belum diterima penuh.
-- Definisi "ter-PO" mirror lib/pr-po-coverage.ts (po_items.pr_item_id +
-- po_item_pr_links, PO rejected tidak dihitung).
--
-- PR yang status terakhirnya di-set 'completed' MANUAL oleh moderator
-- (moderator_edit_logs) TIDAK disentuh -- itu keputusan sengaja.
--
-- Idempotent: aman dijalankan ulang.

WITH conv AS (
  SELECT pr_item_id, SUM(qty) AS converted, array_agg(DISTINCT po_id) AS po_ids
  FROM (
    SELECT poi.pr_item_id, poi.qty, po.id AS po_id
    FROM public.po_items poi
    JOIN public.pos po ON po.id = poi.po_id
    WHERE po.po_status <> 'rejected' AND poi.pr_item_id IS NOT NULL
    UNION ALL
    SELECT l.pr_item_id, l.qty_pr, po.id
    FROM public.po_item_pr_links l
    JOIN public.po_items poi ON poi.id = l.po_item_id
    JOIN public.pos po ON po.id = poi.po_id
    WHERE po.po_status <> 'rejected'
  ) u
  GROUP BY pr_item_id
),
not_converted AS (
  SELECT DISTINCT pri.pr_id
  FROM public.pr_items pri
  LEFT JOIN conv ON conv.pr_item_id = pri.id
  WHERE COALESCE(conv.converted, 0) < pri.qty
),
not_received AS (
  SELECT DISTINCT pri.pr_id
  FROM public.pr_items pri
  JOIN conv ON conv.pr_item_id = pri.id
  JOIN public.pos po ON po.id = ANY(conv.po_ids)
  WHERE po.po_receive_status IS DISTINCT FROM 'complete'
),
manual_completed AS (
  SELECT DISTINCT ON (doc_id) doc_id AS pr_id,
         changes->'after'->>'pr_status' AS after_status
  FROM public.moderator_edit_logs
  WHERE doc_type = 'pr'
  ORDER BY doc_id, created_at DESC
)
UPDATE public.prs p
SET pr_status = 'approved'
WHERE p.pr_status = 'completed'
  AND (p.id IN (SELECT pr_id FROM not_converted)
       OR p.id IN (SELECT pr_id FROM not_received))
  AND NOT EXISTS (
    SELECT 1 FROM manual_completed m
    WHERE m.pr_id = p.id AND m.after_status = 'completed'
  );
