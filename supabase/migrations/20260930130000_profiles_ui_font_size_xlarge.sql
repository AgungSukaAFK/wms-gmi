-- Tambah opsi ukuran font 'xlarge' (Extra Large) di preferensi Profil.
-- Backward-compat: build lama menormalisasi nilai tak dikenal ke 'medium',
-- jadi user 'xlarge' cuma tampil medium di build lama (tidak error).
-- Idempotent: constraint lama diganti dengan daftar nilai baru.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_ui_font_size_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_ui_font_size_check
  CHECK (ui_font_size IN ('medium', 'large', 'xlarge'));
