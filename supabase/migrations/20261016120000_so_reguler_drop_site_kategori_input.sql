-- ============================================================
-- SO REGULER: hapus input Kategori & Lokasi Site
-- ------------------------------------------------------------
-- SO tidak lagi punya lokasi site. Gudang dipilih saat proses
-- berikutnya (default gudang akun yang memproses):
--   - PO dari SO  -> gudang penerima disimpan di pos.cabang_id
--   - DO by SO    -> gudang pengirim do_reguler.dari_cabang_id
-- so_reguler.cabang_id cukup dibuat nullable (SO lama tetap
-- menyimpan nilainya). Kolom kategori sudah nullable, tidak
-- diubah. Kompatibel dengan code lama (code lama tetap mengisi
-- cabang_id & kategori).
-- ============================================================

ALTER TABLE public.so_reguler ALTER COLUMN cabang_id DROP NOT NULL;

COMMENT ON COLUMN public.so_reguler.cabang_id IS
'Legacy: lokasi site SO (hanya terisi untuk SO lama). Sejak 2026-10-16 gudang dipilih per PO (pos.cabang_id) / per DO (do_reguler.dari_cabang_id).';
