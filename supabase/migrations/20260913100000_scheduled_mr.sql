-- Migration: Scheduled MR (Material Request 3-Bulan)
-- Date: 2026-09-13
-- Description:
--   Mode baru MR untuk perencanaan kebutuhan sampai 3 bulan ke depan dengan
--   item yang bisa sangat banyak. Setiap item punya due date, priority, dan
--   site sendiri (bukan cuma di level dokumen seperti MR biasa), dan freeze
--   dievaluasi PER ITEM (bukan per dokumen) supaya satu item yang telat
--   tidak mengunci item lain. Alokasi PR vs Share Stock untuk item
--   scheduled MR diputuskan requester saat input (bukan approver terakhir
--   seperti MR biasa) — memakai tabel mr_sharestock_allocations yang sama.
--
--   TETAP memakai tabel mrs/mr_items yang sama (bukan skema paralel) supaya
--   PR (pr_items.mr_item_id), PO (po_items.pr_item_id -> pr_items ->
--   mr_items), dan Share Stock/Delivery (delivery_items.mr_item_id) yang
--   sudah keyed by mr_item_id otomatis "mendukung" Scheduled MR tanpa
--   perubahan skema di ketiga tabel itu. Jalur approval (approval_templates
--   type='Material Request') juga dipakai ulang apa adanya.
--
--   Semua kolom baru additive (nullable / berdefault) sehingga aman untuk
--   deploy tidak atomik (migration jalan duluan, code lama tetap kompatibel
--   karena baris lama otomatis mr_type='standard').

ALTER TABLE public.mrs
  ADD COLUMN IF NOT EXISTS mr_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (mr_type IN ('standard', 'scheduled'));

ALTER TABLE public.mr_items
  ADD COLUMN IF NOT EXISTS item_due_date DATE,
  ADD COLUMN IF NOT EXISTS item_priority TEXT,
  ADD COLUMN IF NOT EXISTS item_site TEXT,
  ADD COLUMN IF NOT EXISTS is_item_frozen BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS item_frozen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS item_frozen_reason TEXT;

-- NULL = laporan level dokumen (MR biasa, existing), terisi = laporan
-- level item (Scheduled MR).
ALTER TABLE public.mr_freeze_reports
  ADD COLUMN IF NOT EXISTS mr_item_id BIGINT REFERENCES public.mr_items(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_mrs_mr_type ON public.mrs(mr_type);
CREATE INDEX IF NOT EXISTS idx_mr_items_item_due_date ON public.mr_items(item_due_date);
CREATE INDEX IF NOT EXISTS idx_mr_items_is_item_frozen ON public.mr_items(is_item_frozen);
CREATE INDEX IF NOT EXISTS idx_mr_freeze_reports_mr_item_id ON public.mr_freeze_reports(mr_item_id);
