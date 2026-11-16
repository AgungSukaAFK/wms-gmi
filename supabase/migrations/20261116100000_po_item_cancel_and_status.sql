-- Migration: Pembatalan item PO, status per barang, edit PO oleh approver
-- Date: 2026-11-16
--
-- 1. po_items: pembatalan per item (PO yang sudah full approved).
--    Saat item dibatalkan, sisa qty yang belum diterima dipindah ke
--    qty_cancelled dan po_items.qty diturunkan menjadi qty yang sudah
--    diterima. Dengan begitu SEMUA rumus yang ada (sisa PR, sisa SO, sisa RI,
--    po_receive_status, completion PR) otomatis menganggap qty itu batal tanpa
--    perlu diubah. Qty awal = qty + qty_cancelled.
--    PO yang punya item dibatalkan langsung berstatus 'closed'; item lain yang
--    masih aktif tetap bisa diterima lewat RI.
--
-- 2. po_items: status progres per barang yang bisa diedit (item_detail_status,
--    item_estimasi, item_status_note) + log perubahannya di po_item_status_logs.
--
-- 3. po_revisions: jenis revisi (revisi / edit_approver / batal_item) dan
--    apakah approval di-reset, supaya "Riwayat PO" bisa menampilkan dengan
--    benar edit approver (approval TIDAK diulang) dan pembatalan item.
--
-- Backward-compat: semua kolom baru punya DEFAULT / nullable; frontend lama
-- tetap jalan (kolom baru diabaikan). Status 'closed' sudah ada di enum
-- doc_status sejak awal.

-- ---------------------------------------------------------------- 1 & 2
ALTER TABLE public.po_items
  ADD COLUMN IF NOT EXISTS qty_cancelled INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by_nama TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS item_detail_status TEXT,
  ADD COLUMN IF NOT EXISTS item_estimasi DATE,
  ADD COLUMN IF NOT EXISTS item_status_note TEXT,
  ADD COLUMN IF NOT EXISTS item_status_updated_by_nama TEXT,
  ADD COLUMN IF NOT EXISTS item_status_updated_at TIMESTAMPTZ;

ALTER TABLE public.po_items DROP CONSTRAINT IF EXISTS po_items_qty_cancelled_check;
ALTER TABLE public.po_items ADD CONSTRAINT po_items_qty_cancelled_check
  CHECK (qty_cancelled >= 0);

COMMENT ON COLUMN public.po_items.qty_cancelled IS
'Qty item yang dibatalkan (PO approved). po_items.qty sudah dikurangi qty ini; qty awal = qty + qty_cancelled.';
COMMENT ON COLUMN public.po_items.item_detail_status IS
'Status progres per barang (mis. Menunggu Vendor, Dalam Pengiriman). Informatif, diedit approver/purchasing/moderator.';
COMMENT ON COLUMN public.po_items.item_estimasi IS
'Estimasi barang ini diterima (per item).';

CREATE TABLE IF NOT EXISTS public.po_item_status_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES public.pos(id) ON DELETE CASCADE,
  po_item_id BIGINT REFERENCES public.po_items(id) ON DELETE CASCADE,
  -- 'status' (status/estimasi/catatan diubah) | 'cancel' (item dibatalkan)
  action TEXT NOT NULL,
  -- { before: {...}, after: {...} } atau detail pembatalan.
  detail JSONB,
  note TEXT,
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_by_nama TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_item_status_logs_po
  ON public.po_item_status_logs (po_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_item_status_logs_item
  ON public.po_item_status_logs (po_item_id, created_at DESC);

ALTER TABLE public.po_item_status_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_item_status_logs_select" ON public.po_item_status_logs;
CREATE POLICY "po_item_status_logs_select"
  ON public.po_item_status_logs FOR SELECT TO authenticated
  USING (true);

-- Hak akses (approver / purchasing / moderator) dicek di server action.
-- Append-only: tidak ada UPDATE/DELETE.
DROP POLICY IF EXISTS "po_item_status_logs_insert" ON public.po_item_status_logs;
CREATE POLICY "po_item_status_logs_insert"
  ON public.po_item_status_logs FOR INSERT TO authenticated
  WITH CHECK (changed_by = auth.uid());

GRANT SELECT, INSERT ON public.po_item_status_logs TO authenticated;

-- ---------------------------------------------------------------- 3
ALTER TABLE public.po_revisions
  ADD COLUMN IF NOT EXISTS revision_kind TEXT NOT NULL DEFAULT 'revisi',
  ADD COLUMN IF NOT EXISTS approval_reset BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.po_revisions DROP CONSTRAINT IF EXISTS po_revisions_revision_kind_check;
ALTER TABLE public.po_revisions ADD CONSTRAINT po_revisions_revision_kind_check
  CHECK (revision_kind IN ('revisi', 'edit_approver', 'batal_item'));

COMMENT ON COLUMN public.po_revisions.revision_kind IS
'revisi = purchasing/moderator (approval diulang); edit_approver = approver edit sebelum ada RI (approval tetap); batal_item = pembatalan item.';
