-- PO Outstanding: PO yang masih berjalan dari sistem ERP lama ("PO OST.xls"),
-- diimport ke WMS supaya penerimaannya (RI) lewat WMS.
-- Date: 2026-10-19
--
-- Keputusan user:
--   - PO diimport apa adanya (nomor PO ERP), status menunggu approval dengan
--     jalur approval kosong -- moderator/purchasing mengisinya nanti (editor
--     approval moderator atau Edit PO pakai template).
--   - Label "outstanding" permanen sebagai penanda asal import.
--   - Item PO dihubungkan ke item PR per baris nanti (manual, dengan
--     checkbox di detail PO). No. PR, Nama Proyek, dan Keterangan
--     Requisition dari Excel disimpan sebagai teks referensi per item.
--   - Lokasi (cabang) PO dipilih user saat edit; Nama Proyek cuma referensi.
--
-- Jenis PO tetap 'reguler' (bukan 'non_pr', yang mengunci RI ke GMI-JAKARTA
-- dan masuk alur Job Costing). Constraint "reguler wajib punya PR"
-- dilonggarkan khusus PO outstanding.
--
-- Backward compat (deploy tidak atomik): cuma menambah kolom nullable/default
-- false dan melonggarkan constraint. Code production lama tidak pernah
-- mengisi kolom baru, dan semua PO lama tetap lolos constraint baru.

-- ============================================================
-- 1. pos: label outstanding
-- ============================================================
ALTER TABLE public.pos
  ADD COLUMN IF NOT EXISTS po_is_outstanding BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pos_po_is_outstanding
  ON public.pos(po_is_outstanding)
  WHERE po_is_outstanding;

ALTER TABLE public.pos DROP CONSTRAINT IF EXISTS pos_reguler_requires_pr_check;
ALTER TABLE public.pos ADD CONSTRAINT pos_reguler_requires_pr_check
  CHECK (po_jenis <> 'reguler' OR pr_id IS NOT NULL OR po_is_outstanding);

-- ============================================================
-- 2. po_items: referensi teks dari Excel (dipakai mencocokkan ke PR WMS)
-- ============================================================
ALTER TABLE public.po_items
  ADD COLUMN IF NOT EXISTS ost_pr_ref TEXT,
  ADD COLUMN IF NOT EXISTS ost_proyek_ref TEXT,
  ADD COLUMN IF NOT EXISTS ost_keterangan TEXT;
