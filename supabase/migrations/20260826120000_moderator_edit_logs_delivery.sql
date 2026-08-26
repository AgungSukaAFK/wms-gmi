-- Tambah 'delivery' ke daftar doc_type yang valid di moderator_edit_logs,
-- untuk fitur Moderator Edit/Hapus Delivery (edit item/qty/logistik dan hard
-- delete delivery yang sudah ada, di luar alur cancel yang sudah ada).

ALTER TABLE public.moderator_edit_logs
  DROP CONSTRAINT IF EXISTS moderator_edit_logs_doc_type_check;

ALTER TABLE public.moderator_edit_logs
  ADD CONSTRAINT moderator_edit_logs_doc_type_check
  CHECK (doc_type IN ('mr', 'pr', 'po', 'spb', 'spb_po', 'spb_do', 'spb_invoice', 'return_spb', 'receive', 'delivery'));
