-- Migration: Working Order masuk ke get_pending_approvals_for_user
-- Date: 2026-09-20
-- Description:
--   Widget "Approval Saya" (halaman /notifications, lihat
--   app/(With Sidebar)/notifications/page.tsx) menampilkan semua dokumen
--   yang menunggu approval user dari RPC get_pending_approvals_for_user --
--   fungsi ini di-UNION ALL per tabel dokumen dan belum menyertakan
--   working_orders sama sekali. Tanpa ini, WO yang menunggu approval user
--   tidak akan muncul di daftar global tsb (approve/reject langsung di
--   halaman detail WO tetap berfungsi, tapi user harus tahu link-nya
--   duluan -- tidak ke-notify lewat widget).
--
--   Catatan: approvals[].level pada working_orders menyimpan step_order
--   (angka), BUKAN "menyetujui"/"mengetahui" seperti dokumen lain (lihat
--   services/working-order-actions.ts _buildApprovalFlow) -- label
--   menyetujui/mengetahui WO disimpan di approvals[].approval_role. Jadi
--   step_level di branch WO diambil dari approval_role, bukan level,
--   supaya konsisten dengan levelLabel di halaman notifications.
--
--   Signature (nama fungsi + parameter + return type) sama persis dengan
--   versi sebelumnya (20260818000000_remove_spb_po_do_approval.sql), jadi
--   aman untuk kode lama yang masih memanggilnya selama window deploy.

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

  UNION ALL

  -- Working Order
  SELECT
    'Working Order'::TEXT,
    id::BIGINT,
    wo_kode::TEXT,
    ('/working-order/' || id::TEXT)::TEXT,
    wo_status::TEXT,
    created_at,
    (
      SELECT COALESCE(elem->>'approval_role', elem->>'level', null)
      FROM jsonb_array_elements(approvals) AS elem
      WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.working_orders
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(approvals) AS elem
    WHERE COALESCE(elem->>'user_id', elem->>'userid') = user_uuid::TEXT
      AND elem->>'status' = 'pending'
  )

  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_approvals_for_user(UUID) TO authenticated;
