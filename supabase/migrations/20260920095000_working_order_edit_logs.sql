-- Migration: Audit trail edit Working Order
-- Date: 2026-09-20
-- Description:
--   Semua edit WO (field biasa maupun penyesuaian qty/stok saat status
--   On Process) wajib tercatat: siapa, kapan, apa yang berubah. Tabel
--   terpisah dari moderator_edit_logs (20260729000000_moderator_edit_logs.sql)
--   karena pelaku edit WO bukan cuma moderator -- juga anggota approval list
--   WO tsb -- sehingga semantik RLS-nya beda (insert lebih terbuka, bukan
--   is_moderator()-only).

CREATE TABLE public.working_order_edit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wo_id BIGINT REFERENCES public.working_orders(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_nama TEXT,
  summary TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_working_order_edit_logs_wo_id ON public.working_order_edit_logs (wo_id, created_at DESC);

COMMENT ON TABLE public.working_order_edit_logs IS
'Audit trail edit Working Order (field & penyesuaian stok saat On Process), termasuk siapa/kapan/apa yang berubah.';

ALTER TABLE public.working_order_edit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read working_order_edit_logs"
  ON public.working_order_edit_logs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert working_order_edit_logs"
  ON public.working_order_edit_logs FOR INSERT
  TO authenticated WITH CHECK (true);

-- RLS policies alone are not enough -- PostgREST also requires the base
-- table GRANT (see 20260728120000_fix_missing_table_grants.sql).
GRANT SELECT, INSERT ON public.working_order_edit_logs TO authenticated;
