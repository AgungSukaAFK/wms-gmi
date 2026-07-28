-- Revisi alur SPB:
-- 1. Approval digital untuk SPB ditiadakan -- approval_template tetap dipilih saat
--    membuat SPB, tapi cuma dipakai untuk menentukan slot tanda tangan yang dicetak
--    (maks 4 slot: 1 Yang Menyerahkan + s.d. 3 Mengetahui). Tanda tangan sesungguhnya
--    dilakukan manual di atas kertas setelah dicetak.
-- 2. Stock langsung dikurangi saat SPB dibuat (bukan menunggu approval selesai).
-- 3. Tambah fitur cancel SPB (moderator only) yang mengembalikan stock.

ALTER TABLE public.spb
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
