-- Manual override untuk level progres MR (OPEN 1/2/3A/3B/3C/4/5, CLOSE 1/2A/2B).
--
-- Level otomatis dihitung di client (lib/mr-level.ts) dari data yang sudah ada
-- (mr_convert_status, keberadaan PO, qty_received vs qty_request), tapi sistem
-- tidak punya data untuk membedakan sub-status yang tergantung info eksternal
-- (payment issue vendor, budget approval, barang sudah tiba WH vs sudah
-- dikirim ke site, dokumen tanda terima sudah dikirim ke HO via email atau
-- belum). Kolom ini menyimpan koreksi manual oleh moderator untuk kasus itu;
-- bila NULL, tampilan tetap memakai hasil hitung otomatis.
ALTER TABLE public.mrs
  ADD COLUMN IF NOT EXISTS manual_level TEXT,
  ADD COLUMN IF NOT EXISTS manual_level_note TEXT,
  ADD COLUMN IF NOT EXISTS manual_level_set_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_level_set_at TIMESTAMPTZ;

ALTER TABLE public.mrs
  DROP CONSTRAINT IF EXISTS mrs_manual_level_check;
ALTER TABLE public.mrs
  ADD CONSTRAINT mrs_manual_level_check
  CHECK (manual_level IS NULL OR manual_level IN (
    'OPEN_1', 'OPEN_2', 'OPEN_3A', 'OPEN_3B', 'OPEN_3C', 'OPEN_4', 'OPEN_5',
    'CLOSE_1', 'CLOSE_2A', 'CLOSE_2B'
  ));
