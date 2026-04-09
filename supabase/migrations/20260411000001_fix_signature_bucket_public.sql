-- ============================================================
-- BUGFIX: SIGNATURE BUCKET PUBLIC ACCESS
-- ============================================================

-- 1. Ubah bucket signatures menjadi Public
UPDATE storage.buckets 
SET public = true 
WHERE id = 'signatures';

-- 2. Tambahkan policy untuk akses baca publik (Select)
-- Agar tag <img> di browser (terutama Safari) bisa merender gambar
CREATE POLICY "Public Read for Signatures"
ON storage.objects FOR SELECT
USING (bucket_id = 'signatures');
