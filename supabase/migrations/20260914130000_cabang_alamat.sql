-- Add alamat (address) column to master cabang.
-- Nullable so existing rows and old app code (pre-deploy) remain unaffected.
ALTER TABLE public.cabang
  ADD COLUMN IF NOT EXISTS alamat TEXT;
