-- Moderator Edit sekarang juga mencakup Receive Item (GRN): header (tanggal/
-- PIC/keterangan), qty item (selama belum completed — begitu completed, stok
-- & po_items.qty_received/mr_items.qty_received sudah diposting sehingga item
-- tidak boleh diubah lagi lewat mode ini), dan jalur/status approval.
-- Menambahkan 'receive' ke daftar doc_type yang valid di moderator_edit_logs,
-- mengikuti pola yang sama dipakai untuk mr/pr/po/spb_*.

ALTER TABLE public.moderator_edit_logs
  DROP CONSTRAINT IF EXISTS moderator_edit_logs_doc_type_check;

ALTER TABLE public.moderator_edit_logs
  ADD CONSTRAINT moderator_edit_logs_doc_type_check
  CHECK (doc_type IN ('mr', 'pr', 'po', 'spb', 'spb_po', 'spb_do', 'spb_invoice', 'return_spb', 'receive'));
