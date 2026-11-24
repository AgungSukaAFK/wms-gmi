-- ============================================================
-- Riwayat Aktivitas SO Consignment
-- (services/consignment-so-actions.ts -> updateConsignmentSo / deleteConsignmentSo)
--
-- Edit header SO Consignment sekarang boleh dilakukan marketing selain
-- moderator/admin, jadi setiap edit dicatat: siapa, kapan, alasan, dan
-- perubahan per field (sebelum -> sesudah) di kolom `changes`.
--
-- Tabel khusus (tanpa FK ke consignment_so) supaya log tetap ada setelah SO
-- dihapus dan tidak bergantung pada CHECK moderator_edit_logs yang pernah
-- drift di production. Murni aditif: code production lama tidak menyentuhnya.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.consignment_so_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  so_id BIGINT NOT NULL,
  so_no TEXT,
  action TEXT NOT NULL CHECK (action IN ('edit', 'delete')),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_nama TEXT,
  user_role TEXT,
  reason TEXT,
  summary TEXT NOT NULL,
  -- [{ "field": "due_date", "label": "Due Date", "before": "...", "after": "..." }]
  changes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consignment_so_logs_so
  ON public.consignment_so_logs (so_id, created_at DESC);

ALTER TABLE public.consignment_so_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read consignment_so_logs"
  ON public.consignment_so_logs;
CREATE POLICY "Authenticated can read consignment_so_logs"
  ON public.consignment_so_logs FOR SELECT
  TO authenticated USING (true);

-- Penulis log hanya boleh atas nama dirinya sendiri, dan hanya role yang
-- memang berhak mengedit/menghapus SO Consignment.
DROP POLICY IF EXISTS "Editors can insert consignment_so_logs"
  ON public.consignment_so_logs;
CREATE POLICY "Editors can insert consignment_so_logs"
  ON public.consignment_so_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name IN ('moderator', 'admin', 'marketing')
    )
  );

-- Policy saja tidak cukup: PostgREST butuh GRANT tabel dasar juga.
GRANT SELECT, INSERT ON public.consignment_so_logs TO authenticated;
