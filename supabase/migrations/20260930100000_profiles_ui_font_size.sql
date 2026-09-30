-- Preferensi ukuran font UI per akun (halaman Profil).
-- 'medium' = ukuran bawaan aplikasi, 'large' = teks sedikit lebih besar.
-- Halaman cetak/PDF tetap medium (ditangani di frontend).
-- Backward-compat: kolom baru dengan default, code lama tidak terpengaruh.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ui_font_size TEXT NOT NULL DEFAULT 'medium';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_ui_font_size_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_ui_font_size_check
      CHECK (ui_font_size IN ('medium', 'large'));
  END IF;
END $$;
