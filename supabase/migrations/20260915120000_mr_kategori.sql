-- Migration: Kategori MR (jenis pengajuan)
-- Date: 2026-09-15
-- Description:
--   Field baru di level dokumen MR: jenis pengajuan (New Item / Replace Item /
--   Fix & Repair / Upgrade) — dipakai buat kolom "Kategori" di export Excel MR
--   ("tarikan MR"), mengikuti referensi sistem GA (bukan klasifikasi barang).
--   Nullable (bukan NOT NULL) supaya kompatibel dengan code produksi lama yang
--   belum tahu kolom ini saat deploy belum atomik (lihat memory
--   db-migrations-backward-compat) — wajib-diisi cuma ditegakkan di aplikasi
--   (form create MR + createMaterialRequest), bukan di level DB.

ALTER TABLE public.mrs ADD COLUMN IF NOT EXISTS kategori TEXT;

ALTER TABLE public.mrs DROP CONSTRAINT IF EXISTS mrs_kategori_check;
ALTER TABLE public.mrs ADD CONSTRAINT mrs_kategori_check
  CHECK (kategori IS NULL OR kategori IN ('New Item', 'Replace Item', 'Fix & Repair', 'Upgrade'));
