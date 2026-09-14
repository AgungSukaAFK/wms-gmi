-- ============================================================
-- SIGNATURE DELETE + HISTORICAL SNAPSHOT
-- ============================================================
-- Tujuan:
--   1. Mengizinkan user menghapus permanen tanda tangan miliknya sendiri
--      (sebelumnya tidak ada policy DELETE sama sekali di user_signatures,
--      jadi DELETE selalu memengaruhi 0 baris).
--   2. deliveries & item_transfers menyimpan signature_*_id lalu me-LIVE-JOIN
--      ke user_signatures untuk menampilkan gambar tanda tangan. Begitu baris
--      user_signatures dihapus, tanda tangan pada delivery/item-transfer yang
--      SUDAH selesai akan ikut hilang dari tampilan. Untuk mencegah itu,
--      gambar/nama tanda tangan dibekukan (snapshot) ke tabel deliveries &
--      item_transfers saat penandatanganan terjadi — mengikuti pola yang
--      sudah dipakai approvals JSONB di MR/PO/PR/Receive (signature_url).
--      Setelah snapshot terisi, penghapusan baris user_signatures TIDAK lagi
--      memengaruhi histori yang sudah ditandatangani.
--   Catatan: file gambar di Supabase Storage (bucket "signatures") TIDAK
--   ikut dihapus oleh fitur delete ini — snapshot di atas menyimpan URL yang
--   sama, jadi file tersebut harus tetap ada agar snapshot & histori lama
--   tetap bisa tampil.

-- 1. Kolom snapshot di deliveries (sender & receiver)
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS signature_sender_image_url TEXT,
  ADD COLUMN IF NOT EXISTS signature_sender_printed_name TEXT,
  ADD COLUMN IF NOT EXISTS signature_sender_label TEXT,
  ADD COLUMN IF NOT EXISTS signature_receiver_image_url TEXT,
  ADD COLUMN IF NOT EXISTS signature_receiver_printed_name TEXT,
  ADD COLUMN IF NOT EXISTS signature_receiver_label TEXT;

-- 2. Kolom snapshot di item_transfers (receiver saja — signature requester
--    sudah dibekukan lebih dulu lewat approvals[0].signature_url, kolom
--    signature_requester_id sendiri tidak pernah dipakai untuk tampilan)
ALTER TABLE public.item_transfers
  ADD COLUMN IF NOT EXISTS signature_receiver_image_url TEXT,
  ADD COLUMN IF NOT EXISTS signature_receiver_printed_name TEXT,
  ADD COLUMN IF NOT EXISTS signature_receiver_label TEXT;

-- 3. Backfill data lama dari user_signatures yang saat ini masih ada,
--    supaya delivery/item-transfer yang sudah ditandatangani sebelumnya
--    ikut terlindungi sebelum fitur delete tersedia.
UPDATE public.deliveries d
SET
  signature_sender_image_url = us.image_url,
  signature_sender_printed_name = us.printed_name,
  signature_sender_label = us.label
FROM public.user_signatures us
WHERE d.signature_sender_id = us.id
  AND d.signature_sender_image_url IS NULL;

UPDATE public.deliveries d
SET
  signature_receiver_image_url = us.image_url,
  signature_receiver_printed_name = us.printed_name,
  signature_receiver_label = us.label
FROM public.user_signatures us
WHERE d.signature_receiver_id = us.id
  AND d.signature_receiver_image_url IS NULL;

UPDATE public.item_transfers it
SET
  signature_receiver_image_url = us.image_url,
  signature_receiver_printed_name = us.printed_name,
  signature_receiver_label = us.label
FROM public.user_signatures us
WHERE it.signature_receiver_id = us.id
  AND it.signature_receiver_image_url IS NULL;

-- 4. Izinkan pemilik menghapus tanda tangannya sendiri.
DROP POLICY IF EXISTS "Users can delete own signatures" ON public.user_signatures;
CREATE POLICY "Users can delete own signatures"
    ON public.user_signatures FOR DELETE
    USING (auth.uid() = user_id);
