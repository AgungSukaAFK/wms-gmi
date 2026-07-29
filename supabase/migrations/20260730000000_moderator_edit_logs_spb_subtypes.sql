-- Moderator Edit sekarang juga mencakup dokumen turunan SPB (spb_po, spb_do,
-- spb_invoice, return_spb) yang masing-masing punya alur approval sendiri.
-- Setiap dokumen ini butuh nilai doc_type sendiri di moderator_edit_logs
-- (bukan cuma 'spb') supaya riwayat per-dokumen bisa difilter dengan tepat.
--
-- Base spb sendiri sengaja TIDAK dapat tombol Moderator Edit: dokumennya tidak
-- lagi punya approval digital (langsung completed saat dibuat, approvals cuma
-- dipakai untuk slot tanda tangan cetak) dan sudah punya jalur edit/cancel
-- khusus moderator (updateSpb/cancelSpb di services/spb-actions.ts) dengan
-- rollback stok yang sudah benar -- tidak perlu fitur baru yang tumpang tindih.

ALTER TABLE public.moderator_edit_logs
  DROP CONSTRAINT IF EXISTS moderator_edit_logs_doc_type_check;

ALTER TABLE public.moderator_edit_logs
  ADD CONSTRAINT moderator_edit_logs_doc_type_check
  CHECK (doc_type IN ('mr', 'pr', 'po', 'spb', 'spb_po', 'spb_do', 'spb_invoice', 'return_spb'));
