-- Bulk approve PO Outstanding bekas import yang belum punya jalur approval.
-- PO ini sudah full ACC di sistem lama, jadi jalur template "PO Outstanding"
-- langsung dicatat approved semua, tanpa TTD. Status mengikuti approvePO +
-- syncPoReceiveAndCompletion: penerimaan penuh -> completed, selain itu approved.
-- Coverage & completion PR tidak berubah (hanya melihat rejected dan
-- po_receive_status), jadi tidak ada sinkron PR.
--
-- Satu baris moderator_edit_logs per PO menyimpan kondisi sebelumnya.
-- Aman dijalankan ulang; environment tanpa template ini dilewati.

DO $$
DECLARE
  v_template_count integer;
  v_template_id bigint;
  v_invalid_steps integer;
  v_approvals jsonb;
  v_step_count integer;
  v_po_count integer;
BEGIN
  SELECT count(*), min(id)
    INTO v_template_count, v_template_id
  FROM public.approval_templates
  WHERE type = 'Purchase Order' AND name = 'PO Outstanding';

  IF v_template_count = 0 THEN
    RAISE NOTICE 'Template PO Outstanding tidak ada, migration dilewati.';
    RETURN;
  END IF;
  IF v_template_count > 1 THEN
    RAISE EXCEPTION 'Template PO Outstanding lebih dari satu.';
  END IF;

  SELECT
    jsonb_agg(
      jsonb_build_object(
        'nama', p.nama,
        'email', p.email,
        'notes', NULL,
        'status', 'approved',
        'userid', s.user_id,
        'step_id', s.id,
        'snapshot', NULL,
        'processed_at', to_jsonb(now()),
        'approval_role', s.level,
        'signature_url', NULL
      )
      ORDER BY s.step_order
    ),
    count(*),
    count(*) FILTER (WHERE s.approver_type <> 'user' OR p.id IS NULL)
    INTO v_approvals, v_step_count, v_invalid_steps
  FROM public.approval_template_steps s
  LEFT JOIN public.profiles p ON p.id = s.user_id
  WHERE s.template_id = v_template_id;

  IF v_step_count = 0 OR v_invalid_steps > 0 THEN
    RAISE EXCEPTION 'Step template PO Outstanding tidak valid (% step, % bermasalah).',
      v_step_count, v_invalid_steps;
  END IF;

  WITH target AS (
    SELECT id, po_status, approvals
    FROM public.pos
    WHERE po_is_outstanding
      AND po_status = 'open'
      AND COALESCE(approvals, '[]'::jsonb) = '[]'::jsonb
    FOR UPDATE
  ),
  updated AS (
    UPDATE public.pos po
    SET
      approvals = v_approvals,
      po_status = CASE
        WHEN po.po_receive_status = 'complete' THEN 'completed'
        ELSE 'approved'
      END::public.doc_status
    FROM target t
    WHERE po.id = t.id
    RETURNING po.id, po.po_status AS new_status, t.po_status AS old_status, t.approvals AS old_approvals
  )
  INSERT INTO public.moderator_edit_logs (doc_type, doc_id, user_nama, summary, changes)
  SELECT
    'po',
    u.id,
    'Sistem (bulk approval PO Outstanding)',
    format(
      'Bulk approval PO Outstanding: status %s → %s, jalur approval (%s tahap), tanpa TTD.',
      u.old_status, u.new_status, v_step_count
    ),
    jsonb_build_object(
      'before', jsonb_build_object('po_status', u.old_status, 'approvals', u.old_approvals),
      'after', jsonb_build_object('po_status', u.new_status, 'approvals', v_approvals)
    )
  FROM updated u;

  GET DIAGNOSTICS v_po_count = ROW_COUNT;
  RAISE NOTICE 'PO Outstanding di-approve: %', v_po_count;
END $$;
