-- Migration: Revisi RI yang ditolak + perbaikan tab "Perlu Tindakan"
-- Date: 2026-11-13
--
-- 1. receives.created_by + receives.ri_revision
--    Pembuat RI dicatat supaya notifikasi penolakan bisa dikirim ke pembuat,
--    PIC, dan approver yang sebelumnya sudah approve. RI lama di-backfill dari
--    ri_pic_id (form create RI selalu mengisi PIC = user yang membuat).
--
-- 2. receive_revisions
--    Riwayat revisi RI yang ditolak: snapshot header + item + approval ronde
--    yang ditolak, alasan penolakan, siapa yang merevisi & catatannya.
--    Append-only (tidak ada UPDATE/DELETE), ikut terhapus kalau RI dihapus.
--
-- 3. get_pending_approvals_for_user (tab "Perlu Tindakan" / Notifikasi)
--    Sebelumnya dokumen muncul selama step user masih 'pending', walaupun:
--      - belum giliran user (approval berurutan: hanya step pending PERTAMA),
--      - dokumen sudah DITOLAK di step sebelumnya (step sisanya tetap pending).
--    Sekarang hanya dokumen yang benar-benar menunggu tindakan user.
--    URL juga diperbaiki: RI -> /receive?ri=<id> (detail langsung terbuka),
--    MR terjadwal -> /mr/scheduled/<id>. Item Transfer ditambahkan.
--    step_level mengambil approval_role dulu (RI/PO/PR/MR menyimpan angka
--    step_order di "level").
--
-- 4. Perbaiki document_url notifikasi lama untuk RI ('/receive' tanpa id).
--
-- Backward-compat: kolom baru punya DEFAULT, signature RPC tidak berubah.

-- ---------------------------------------------------------------- 1
ALTER TABLE public.receives
  ADD COLUMN IF NOT EXISTS created_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS ri_revision INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.receives.created_by IS
'User pembuat RI. Dipakai untuk notifikasi penolakan & hak revisi RI ditolak.';
COMMENT ON COLUMN public.receives.ri_revision IS
'Nomor revisi RI (0 = belum pernah direvisi). Naik 1 setiap revisi RI yang ditolak.';

UPDATE public.receives
   SET created_by = ri_pic_id
 WHERE created_by IS NULL
   AND ri_pic_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = receives.ri_pic_id);

-- ---------------------------------------------------------------- 2
CREATE TABLE IF NOT EXISTS public.receive_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ri_id BIGINT NOT NULL REFERENCES public.receives(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  revised_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  revised_by_nama TEXT,
  note TEXT,
  -- Alasan & penolak ronde sebelumnya (disalin dari approvals yang ditolak).
  rejection_reason TEXT,
  rejected_by_nama TEXT,
  -- Ringkasan perubahan item (added / removed / changed) untuk tampilan.
  changes JSONB,
  -- Snapshot sebelum revisi: { header, items, approvals }.
  snapshot_before JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ri_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_receive_revisions_ri_id
  ON public.receive_revisions (ri_id, revision_no DESC);

ALTER TABLE public.receive_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "receive_revisions_select" ON public.receive_revisions;
CREATE POLICY "receive_revisions_select"
  ON public.receive_revisions FOR SELECT TO authenticated
  USING (true);

-- Hak revisi (pembuat / PIC / moderator) dicek di server action.
DROP POLICY IF EXISTS "receive_revisions_insert" ON public.receive_revisions;
CREATE POLICY "receive_revisions_insert"
  ON public.receive_revisions FOR INSERT TO authenticated
  WITH CHECK (revised_by = auth.uid());

GRANT SELECT, INSERT ON public.receive_revisions TO authenticated;

-- ---------------------------------------------------------------- 3
-- Level step user kalau SEKARANG giliran user (step pending pertama milik
-- user dan tidak ada step yang ditolak). NULL = bukan giliran / tidak perlu
-- tindakan.
CREATE OR REPLACE FUNCTION public.approval_turn_level(approvals JSONB, user_uuid UUID)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(approvals) <> 'array' THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(approvals) e
      WHERE e->>'status' = 'rejected'
    ) THEN NULL
    ELSE (
      SELECT CASE
        WHEN COALESCE(first_pending.elem->>'user_id', first_pending.elem->>'userid') = user_uuid::TEXT
          THEN COALESCE(first_pending.elem->>'approval_role', first_pending.elem->>'level', 'menyetujui')
        ELSE NULL
      END
      FROM (
        SELECT e.elem
        FROM jsonb_array_elements(approvals) WITH ORDINALITY AS e(elem, ord)
        WHERE e.elem->>'status' = 'pending'
        ORDER BY e.ord
        LIMIT 1
      ) AS first_pending
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.approval_turn_level(JSONB, UUID) TO authenticated;

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
SET search_path = public
AS $$
  SELECT * FROM (
    -- Material Request (reguler & terjadwal)
    SELECT
      'Material Request'::TEXT,
      id::BIGINT,
      mr_kode::TEXT,
      (CASE WHEN mr_type = 'scheduled' THEN '/mr/scheduled/' ELSE '/mr/' END || id::TEXT)::TEXT,
      mr_status::TEXT,
      created_at,
      public.approval_turn_level(approvals, user_uuid)
    FROM public.mrs
    WHERE COALESCE(mr_status::TEXT, '') NOT IN ('rejected', 'cancelled', 'canceled')

    UNION ALL

    -- Purchase Request
    SELECT
      'Purchase Request'::TEXT, id::BIGINT, pr_kode::TEXT,
      ('/pr/' || id::TEXT)::TEXT, pr_status::TEXT, created_at,
      public.approval_turn_level(approvals, user_uuid)
    FROM public.prs
    WHERE COALESCE(pr_status::TEXT, '') NOT IN ('rejected', 'cancelled', 'canceled')

    UNION ALL

    -- Purchase Order
    SELECT
      'Purchase Order'::TEXT, id::BIGINT, po_kode::TEXT,
      ('/po/' || id::TEXT)::TEXT, po_status::TEXT, created_at,
      public.approval_turn_level(approvals, user_uuid)
    FROM public.pos
    WHERE COALESCE(po_status::TEXT, '') NOT IN ('rejected', 'cancelled', 'canceled')

    UNION ALL

    -- Receive Item
    SELECT
      'Receive Item'::TEXT, id::BIGINT, ri_kode::TEXT,
      ('/receive?ri=' || id::TEXT)::TEXT, ri_status::TEXT, created_at,
      public.approval_turn_level(approvals, user_uuid)
    FROM public.receives
    WHERE ri_status::TEXT = 'open'

    UNION ALL

    -- Item Transfer
    SELECT
      'Item Transfer'::TEXT, id::BIGINT, it_kode::TEXT,
      ('/item-transfer/' || id::TEXT)::TEXT, status::TEXT, created_at,
      public.approval_turn_level(approvals, user_uuid)
    FROM public.item_transfers
    WHERE COALESCE(status::TEXT, '') NOT IN ('rejected', 'cancelled', 'canceled')

    UNION ALL

    -- Stock Out - SPB
    SELECT
      'Stock Out - SPB'::TEXT, id::BIGINT, spb_no::TEXT,
      ('/spb?highlight=' || id::TEXT)::TEXT, approval_status::TEXT, created_at,
      public.approval_turn_level(approvals, user_uuid)
    FROM public.spb
    WHERE COALESCE(approval_status::TEXT, '') NOT IN ('rejected', 'cancelled', 'canceled')

    UNION ALL

    -- Stock Out - SPB Invoice
    SELECT
      'Stock Out - SPB Invoice'::TEXT, id::BIGINT, invoice_no::TEXT,
      ('/spb/invoice?highlight=' || id::TEXT)::TEXT, approval_status::TEXT, created_at,
      public.approval_turn_level(approvals, user_uuid)
    FROM public.spb_invoice
    WHERE COALESCE(approval_status::TEXT, '') NOT IN ('rejected', 'cancelled', 'canceled')

    UNION ALL

    -- Return SPB
    SELECT
      'Return SPB'::TEXT, id::BIGINT, rtn_kode::TEXT,
      ('/return-spb?highlight=' || id::TEXT)::TEXT, approval_status::TEXT, created_at,
      public.approval_turn_level(approvals, user_uuid)
    FROM public.return_spb
    WHERE COALESCE(approval_status::TEXT, '') NOT IN ('rejected', 'cancelled', 'canceled')

    UNION ALL

    -- Working Order
    SELECT
      'Working Order'::TEXT, id::BIGINT, wo_kode::TEXT,
      ('/working-order/' || id::TEXT)::TEXT, wo_status::TEXT, created_at,
      public.approval_turn_level(approvals, user_uuid)
    FROM public.working_orders
    WHERE wo_status = 'Pending Approval'
  ) AS t(document_type, document_id, document_number, document_url, status_col, created_at, step_level)
  WHERE t.step_level IS NOT NULL
  ORDER BY t.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_approvals_for_user(UUID) TO authenticated;

-- ---------------------------------------------------------------- 4
UPDATE public.notifications
   SET document_url = '/receive?ri=' || document_id::TEXT
 WHERE document_type = 'RI'
   AND document_id IS NOT NULL
   AND (document_url = '/receive' OR document_url LIKE '/receive?highlight=%');
