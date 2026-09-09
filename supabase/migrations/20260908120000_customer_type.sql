-- ============================================================
-- ADD CUSTOMER TYPE (Consignment / Non-Consignment / Keduanya)
-- ------------------------------------------------------------
-- Distinguishes customers eligible for the consignment SO flow
-- from regular (non-consignment) customers. Additive + defaulted
-- so it stays backward-compatible with currently deployed code
-- (see AGENTS.md — Vercel + Supabase VPS deploys are not atomic).
-- ============================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'non_consignment';

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_customer_type_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_customer_type_check
  CHECK (customer_type IN ('consignment', 'non_consignment', 'both'));

CREATE INDEX IF NOT EXISTS idx_customers_customer_type ON public.customers(customer_type);
