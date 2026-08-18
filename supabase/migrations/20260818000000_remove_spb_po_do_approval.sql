-- Digital approval untuk SPB PO dan SPB DO dihapus dari aplikasi (lihat
-- services/spb-actions.ts: createSpbPo/createSpbDo langsung insert
-- approval_status 'completed', tidak ada lagi tombol Approve/Reject).
--
-- Migration ini TIDAK drop kolom approval_template_id/approvals/
-- approval_status/rejection_reason/completed_at di spb_po/spb_do -- kolom
-- itu dibiarkan (unused) supaya kode lama yang mungkin masih jalan selama
-- window deploy non-atomik (Vercel + Supabase VPS terpisah) tidak error.
--
-- Yang dilakukan di sini cuma:
-- 1. Backfill dokumen yang masih nyangkut nunggu approval ('open'/'rejected')
--    jadi 'completed', lalu majukan status spb induknya -- karena tombol
--    Approve/Reject-nya sudah hilang dari UI, dokumen ini tidak akan pernah
--    bisa diselesaikan lewat jalur lama.
-- 2. Update get_pending_approvals_for_user supaya tidak lagi menyodorkan
--    notifikasi approval SPB PO/DO yang sudah tidak ada tombolnya.

-- 1a. SPB PO yang masih open/rejected -> completed, majukan spb induk ke PO_ATTACH
UPDATE spb_po
SET approval_status = 'completed',
    completed_at = COALESCE(completed_at, now()),
    rejection_reason = NULL
WHERE approval_status IN ('open', 'rejected');

UPDATE spb
SET spb_status = 'PO_ATTACH'
WHERE spb_status = 'DONE QUOT'
  AND id IN (
    SELECT spb_id FROM spb_po
    WHERE approval_status = 'completed'
  );

-- 1b. SPB DO yang masih open/rejected -> completed, majukan spb induk ke DO_ATTACH
UPDATE spb_do
SET approval_status = 'completed',
    completed_at = COALESCE(completed_at, now()),
    rejection_reason = NULL
WHERE approval_status IN ('open', 'rejected');

UPDATE spb
SET spb_status = 'DO_ATTACH'
WHERE spb_status = 'PO_ATTACH'
  AND id IN (
    SELECT po.spb_id
    FROM spb_do d
    JOIN spb_po po ON po.id = d.spb_po_id
    WHERE d.approval_status = 'completed'
  );

-- 2. get_pending_approvals_for_user tanpa cabang Stock Out - SPB PO/DO.
-- Signature (nama fungsi + parameter + return type) sama persis dengan versi
-- sebelumnya (20260505100000_fix_pending_approvals_user_id.sql), jadi aman
-- untuk kode lama yang masih memanggilnya selama window deploy.
CREATE OR REPLACE FUNCTION public.get_pending_approvals_for_user(user_uuid UUID)
RETURNS TABLE (
  document_type   TEXT,
  document_id     BIGINT,
  document_number TEXT,
  document_url    TEXT,
  status_col      TEXT,
  created_at      TIMESTAMPTZ,
  step_level      TEXT
)

LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  -- Backward-compatible: support both legacy "userid" and current "user_id"
  -- approval keys so older app builds can still work with a newer DB.

  -- Material Request
  SELECT
    'Material Request'::TEXT,
    id::BIGINT,
    mr_kode::TEXT,
    ('/mr/' || id::TEXT)::TEXT,
    mr_status::TEXT,
    created_at,
    (
      SELECT COALESCE(elem->>'level', null)
      FROM jsonb_array_elements(approvals) AS elem
      WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.mrs
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(approvals) AS elem
    WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
      AND elem->>'status' = 'pending'
  )

  UNION ALL

  -- Purchase Request
  SELECT
    'Purchase Request'::TEXT,
    id::BIGINT,
    pr_kode::TEXT,
    ('/pr/' || id::TEXT)::TEXT,
    pr_status::TEXT,
    created_at,
    (
      SELECT COALESCE(elem->>'level', null)
      FROM jsonb_array_elements(approvals) AS elem
      WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.prs
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(approvals) AS elem
    WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
      AND elem->>'status' = 'pending'
  )

  UNION ALL

  -- Purchase Order
  SELECT
    'Purchase Order'::TEXT,
    id::BIGINT,
    po_kode::TEXT,
    ('/po/' || id::TEXT)::TEXT,
    po_status::TEXT,
    created_at,
    (
      SELECT COALESCE(elem->>'level', null)
      FROM jsonb_array_elements(approvals) AS elem
      WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.pos
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(approvals) AS elem
    WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
      AND elem->>'status' = 'pending'
  )

  UNION ALL

  -- Receive Item
  SELECT
    'Receive Item'::TEXT,
    id::BIGINT,
    ri_kode::TEXT,
    ('/receive?highlight=' || id::TEXT)::TEXT,
    ri_status::TEXT,
    created_at,
    (
      SELECT COALESCE(elem->>'level', null)
      FROM jsonb_array_elements(approvals) AS elem
      WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.receives
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(approvals) AS elem
    WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
      AND elem->>'status' = 'pending'
  )

  UNION ALL

  -- Stock Out - SPB
  SELECT
    'Stock Out - SPB'::TEXT,
    id::BIGINT,
    spb_no::TEXT,
    ('/spb?highlight=' || id::TEXT)::TEXT,
    approval_status::TEXT,
    created_at,
    (
      SELECT COALESCE(elem->>'level', null)
      FROM jsonb_array_elements(approvals) AS elem
      WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.spb
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(approvals) AS elem
    WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
      AND elem->>'status' = 'pending'
  )

  UNION ALL

  -- Stock Out - SPB Invoice
  SELECT
    'Stock Out - SPB Invoice'::TEXT,
    id::BIGINT,
    invoice_no::TEXT,
    ('/spb/invoice?highlight=' || id::TEXT)::TEXT,
    approval_status::TEXT,
    created_at,
    (
      SELECT COALESCE(elem->>'level', null)
      FROM jsonb_array_elements(approvals) AS elem
      WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.spb_invoice
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(approvals) AS elem
    WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
      AND elem->>'status' = 'pending'
  )

  UNION ALL

  -- Return SPB
  SELECT
    'Return SPB'::TEXT,
    id::BIGINT,
    rtn_kode::TEXT,
    ('/return-spb?highlight=' || id::TEXT)::TEXT,
    approval_status::TEXT,
    created_at,
    (
      SELECT COALESCE(elem->>'level', null)
      FROM jsonb_array_elements(approvals) AS elem
      WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.return_spb
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(approvals) AS elem
    WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
      AND elem->>'status' = 'pending'
  )

  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_approvals_for_user(UUID) TO authenticated;
