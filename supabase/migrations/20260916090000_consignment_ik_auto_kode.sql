-- Migration: Auto-generate Kode IK (Item Konsinyasi)
-- Date: 2026-09-16
-- Description:
--   ik_kode sebelumnya diinput manual oleh user (free text) -- rawan typo,
--   dan cuma dijaga pola "cek-lalu-insert" di service (SELECT ... lalu
--   INSERT) yang punya celah race condition kalau 2 user submit nyaris
--   bersamaan (dua-duanya lolos SELECT sebelum salah satu sempat INSERT).
--
--   Sekarang ik_kode di-generate otomatis dengan format IK-00001 (5 digit,
--   urut) lewat SEQUENCE Postgres. nextval() pada SEQUENCE bersifat atomik
--   di level database -- setiap pemanggilan dijamin dapat angka yang
--   berbeda meski dipanggil bersamaan dari banyak request sekaligus, tanpa
--   perlu locking manual di aplikasi. Ini beda dari pola "cek-lalu-insert"
--   yang lama, yang race-nya cuma ketolong oleh UNIQUE constraint (gagal
--   insert, bukan dicegah dari awal).

-- 1. Sequence nomor urut IK. Kalau kebetulan ada data ik_kode existing yang
--    sudah ikut format "IK-#####", mulai dari angka setelahnya supaya tidak
--    tabrakan; kalau tidak ada, mulai dari 1.
CREATE SEQUENCE IF NOT EXISTS public.consignment_ik_kode_seq;

SELECT setval(
  'public.consignment_ik_kode_seq',
  GREATEST(
    1,
    COALESCE(
      (
        SELECT MAX((substring(ik_kode FROM '^IK-(\d{5})$'))::int)
        FROM public.consignment_ik
        WHERE ik_kode ~ '^IK-\d{5}$'
      ),
      0
    ) + 1
  ),
  false
);

-- 2. Function pembangkit kode berikutnya, dipanggil dari service lewat
--    supabase.rpc('generate_consignment_ik_kode'). SECURITY DEFINER supaya
--    role authenticated (yang cuma di-GRANT EXECUTE di bawah, bukan
--    kepemilikan sequence) tetap bisa nextval() tanpa perlu grant langsung
--    ke sequence-nya.
CREATE OR REPLACE FUNCTION public.generate_consignment_ik_kode()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'IK-' || LPAD(nextval('public.consignment_ik_kode_seq')::text, 5, '0');
$$;

GRANT EXECUTE ON FUNCTION public.generate_consignment_ik_kode() TO anon, authenticated, authenticator;
