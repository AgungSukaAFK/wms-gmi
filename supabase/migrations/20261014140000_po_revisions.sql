-- Edit / Revisi PO oleh purchasing & moderator.
--
-- Setiap revisi: semua input PO bisa diubah (header, harga/pajak, item, tambah
-- referensi PR baru), lalu alur approval diulang dari awal. Riwayatnya
-- disimpan di po_revisions (snapshot sebelum & sesudah + diff yang sudah
-- dihitung) supaya halaman detail PO bisa menampilkan "Riwayat PO" yang jelas,
-- termasuk approval ronde sebelumnya yang di-reset.
--
-- Backward-compat: kolom baru punya DEFAULT dan tabel baru tidak disentuh code
-- production lama, jadi aman dijalankan sebelum deploy frontend.

ALTER TABLE public.pos
  ADD COLUMN IF NOT EXISTS po_revision INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pos.po_revision IS
'Nomor revisi PO (0 = belum pernah direvisi). Naik 1 setiap Edit/Revisi PO.';

CREATE TABLE IF NOT EXISTS public.po_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES public.pos(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  edited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  edited_by_nama TEXT,
  -- 'purchasing' | 'moderator' — peran yang dipakai saat merevisi.
  edited_by_role TEXT,
  reason TEXT NOT NULL,
  summary TEXT,
  -- Diff terhitung: { header: [...], items: { added, removed, changed }, totals }
  changes JSONB,
  -- Snapshot lengkap (header + items + approvals) sebelum & sesudah revisi.
  snapshot_before JSONB,
  snapshot_after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (po_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_po_revisions_po_id
  ON public.po_revisions (po_id, revision_no DESC);

ALTER TABLE public.po_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_revisions_select" ON public.po_revisions;
CREATE POLICY "po_revisions_select"
  ON public.po_revisions FOR SELECT TO authenticated
  USING (true);

-- Hak revisi (purchasing/moderator) dicek di server action; di sini cukup
-- pastikan baris dicatat atas nama user yang login. Tidak ada UPDATE/DELETE:
-- riwayat bersifat append-only (ikut terhapus kalau PO-nya dihapus).
DROP POLICY IF EXISTS "po_revisions_insert" ON public.po_revisions;
CREATE POLICY "po_revisions_insert"
  ON public.po_revisions FOR INSERT TO authenticated
  WITH CHECK (edited_by = auth.uid());

GRANT SELECT, INSERT ON public.po_revisions TO authenticated;
