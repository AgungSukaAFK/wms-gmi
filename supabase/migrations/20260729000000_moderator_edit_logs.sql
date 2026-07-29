-- Audit trail untuk fitur "Moderator Edit": moderator dapat mengedit MR/PR/PO/SPB
-- secara penuh (termasuk jalur & status approval) di luar alur approval normal.
-- Karena ini bisa bypass kontrol approval biasa, setiap pemakaiannya dicatat di
-- sini supaya tetap ada akuntabilitas siapa mengubah apa dan kapan.
--
-- doc_type + doc_id menunjuk ke dokumen manapun (mrs/prs/pos/spb) tanpa perlu
-- FK per jenis dokumen, supaya tabel ini bisa dipakai ulang saat fitur ini
-- diperluas ke PR/PO/SPB.

CREATE TABLE public.moderator_edit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('mr', 'pr', 'po', 'spb')),
  doc_id BIGINT NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_nama TEXT,
  summary TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_moderator_edit_logs_doc ON public.moderator_edit_logs (doc_type, doc_id, created_at DESC);

COMMENT ON TABLE public.moderator_edit_logs IS
'Audit trail fitur Moderator Edit (edit bebas dokumen procurement oleh moderator, termasuk override approval).';

ALTER TABLE public.moderator_edit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read moderator_edit_logs"
  ON public.moderator_edit_logs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Moderators can insert moderator_edit_logs"
  ON public.moderator_edit_logs FOR INSERT
  TO authenticated WITH CHECK (public.is_moderator());

-- RLS policies alone are not enough — PostgREST also requires the base table
-- GRANT (see 20260728120000_fix_missing_table_grants.sql for prior instances
-- of this same gap).
GRANT SELECT, INSERT ON public.moderator_edit_logs TO authenticated;
