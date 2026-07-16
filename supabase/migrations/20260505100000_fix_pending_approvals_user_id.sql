-- Fix: get_pending_approvals_for_user was filtering by "userid" (no underscore)
-- but approval JSONB objects use "user_id" (with underscore).
-- Updated to check both formats using OR for backward compatibility.

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
      WHERE (elem->>'user_id' = user_uuid::TEXT OR elem->>'userid' = user_uuid::TEXT)
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.mrs
  WHERE (
    approvals @> ('[{"user_id":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
    OR
    approvals @> ('[{"userid":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
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
      WHERE (elem->>'user_id' = user_uuid::TEXT OR elem->>'userid' = user_uuid::TEXT)
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.prs
  WHERE (
    approvals @> ('[{"user_id":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
    OR
    approvals @> ('[{"userid":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
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
      WHERE (elem->>'user_id' = user_uuid::TEXT OR elem->>'userid' = user_uuid::TEXT)
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.pos
  WHERE (
    approvals @> ('[{"user_id":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
    OR
    approvals @> ('[{"userid":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
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
      WHERE (elem->>'user_id' = user_uuid::TEXT OR elem->>'userid' = user_uuid::TEXT)
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.receives
  WHERE (
    approvals @> ('[{"user_id":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
    OR
    approvals @> ('[{"userid":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
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
      WHERE (elem->>'user_id' = user_uuid::TEXT OR elem->>'userid' = user_uuid::TEXT)
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.spb
  WHERE (
    approvals @> ('[{"user_id":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
    OR
    approvals @> ('[{"userid":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
  )

  UNION ALL

  -- Stock Out - SPB PO
  SELECT
    'Stock Out - SPB PO'::TEXT,
    id::BIGINT,
    po_no::TEXT,
    ('/spb/po?highlight=' || id::TEXT)::TEXT,
    approval_status::TEXT,
    created_at,
    (
      SELECT COALESCE(elem->>'level', null)
      FROM jsonb_array_elements(approvals) AS elem
      WHERE (elem->>'user_id' = user_uuid::TEXT OR elem->>'userid' = user_uuid::TEXT)
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.spb_po
  WHERE (
    approvals @> ('[{"user_id":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
    OR
    approvals @> ('[{"userid":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
  )

  UNION ALL

  -- Stock Out - SPB DO
  SELECT
    'Stock Out - SPB DO'::TEXT,
    id::BIGINT,
    do_no::TEXT,
    ('/spb/do?highlight=' || id::TEXT)::TEXT,
    approval_status::TEXT,
    created_at,
    (
      SELECT COALESCE(elem->>'level', null)
      FROM jsonb_array_elements(approvals) AS elem
      WHERE (elem->>'user_id' = user_uuid::TEXT OR elem->>'userid' = user_uuid::TEXT)
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.spb_do
  WHERE (
    approvals @> ('[{"user_id":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
    OR
    approvals @> ('[{"userid":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
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
      WHERE (elem->>'user_id' = user_uuid::TEXT OR elem->>'userid' = user_uuid::TEXT)
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.spb_invoice
  WHERE (
    approvals @> ('[{"user_id":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
    OR
    approvals @> ('[{"userid":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
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
      WHERE (elem->>'user_id' = user_uuid::TEXT OR elem->>'userid' = user_uuid::TEXT)
        AND elem->>'status' = 'pending'
      LIMIT 1
    )
  FROM public.return_spb
  WHERE (
    approvals @> ('[{"user_id":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
    OR
    approvals @> ('[{"userid":"' || user_uuid::TEXT || '","status":"pending"}]')::jsonb
  )

  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_approvals_for_user(UUID) TO authenticated;
