-- ============================================================
-- SO REGULER: nama marketing + tanggal PO customer
-- ------------------------------------------------------------
-- 1. marketing_name: nama marketing, diketik manual (UPPERCASE
--    di app). Teks bebas, belum terhubung ke tabel profiles.
-- 2. customer_po_date: tanggal PO dibuat oleh customer.
-- 3. customer_po_received_date: tanggal PO diterima via email.
-- Semua nullable -- kompatibel dengan code lama (tidak mengisi
-- kolom ini) dan SO yang sudah ada.
-- ============================================================

ALTER TABLE public.so_reguler
  ADD COLUMN IF NOT EXISTS marketing_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_po_date DATE,
  ADD COLUMN IF NOT EXISTS customer_po_received_date DATE;

COMMENT ON COLUMN public.so_reguler.marketing_name IS
'Nama marketing (input manual, UPPERCASE).';
COMMENT ON COLUMN public.so_reguler.customer_po_date IS
'Tanggal PO dibuat oleh customer.';
COMMENT ON COLUMN public.so_reguler.customer_po_received_date IS
'Tanggal PO customer diterima via email.';
