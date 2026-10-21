-- Migration: Tolak per item MR oleh approver terakhir
-- Date: 2026-10-21
-- Description:
--   Approver terakhir MR (mis. PPIC) bisa menolak item tertentu saat menyetujui
--   MR, wajib dengan keterangan. Item yang ditolak tetap disimpan (qty_request
--   tidak diubah, untuk histori) tapi qty_pr & qty_sharestock_total = 0 dan
--   dikecualikan dari pemenuhan / status completed MR.
--
--   Backward-compat: semua kolom punya default / nullable, jadi code lama yang
--   insert mr_items tanpa kolom ini tetap jalan (item otomatis 'active').

ALTER TABLE public.mr_items
  ADD COLUMN IF NOT EXISTS item_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS item_reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS item_rejected_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_rejected_at TIMESTAMPTZ;

ALTER TABLE public.mr_items
  DROP CONSTRAINT IF EXISTS mr_items_item_status_check;
ALTER TABLE public.mr_items
  ADD CONSTRAINT mr_items_item_status_check
  CHECK (item_status IN ('active', 'rejected'));

-- Item ditolak wajib punya keterangan.
ALTER TABLE public.mr_items
  DROP CONSTRAINT IF EXISTS mr_items_item_reject_reason_check;
ALTER TABLE public.mr_items
  ADD CONSTRAINT mr_items_item_reject_reason_check
  CHECK (item_status <> 'rejected' OR length(btrim(coalesce(item_reject_reason, ''))) > 0);
