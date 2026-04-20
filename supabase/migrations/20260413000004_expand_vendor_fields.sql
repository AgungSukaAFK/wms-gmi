-- ============================================================
-- EXPAND VENDORS FIELDS
-- ============================================================

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS pic_name TEXT;
