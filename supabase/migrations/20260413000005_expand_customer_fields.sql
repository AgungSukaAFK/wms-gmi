-- ============================================================
-- EXPAND CUSTOMERS FIELDS
-- ============================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS pic_name TEXT;
