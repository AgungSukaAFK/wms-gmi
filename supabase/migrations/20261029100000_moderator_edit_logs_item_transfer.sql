-- Moderator Edit Item Transfer mencatat riwayat ke moderator_edit_logs dengan
-- doc_type 'item_transfer'.
--
-- Nilai ini sebenarnya sudah ditambahkan di
-- 20260924110000_moderator_cascade_delete.sql, tapi per 2026-10-29 constraint
-- di VPS production masih versi 20260826120000 (berhenti di 'delivery') --
-- sehingga log cascade delete IT maupun Moderator Edit IT ditolak di sana.
-- Migration ini menyetel ulang constraint secara idempoten (hanya melebarkan,
-- aman untuk kode production yang sedang jalan).

ALTER TABLE public.moderator_edit_logs
  DROP CONSTRAINT IF EXISTS moderator_edit_logs_doc_type_check;

ALTER TABLE public.moderator_edit_logs
  ADD CONSTRAINT moderator_edit_logs_doc_type_check
  CHECK (doc_type IN ('mr', 'pr', 'po', 'spb', 'spb_po', 'spb_do', 'spb_invoice', 'return_spb', 'receive', 'delivery', 'item_transfer'));
