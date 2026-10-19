-- ============================================================
-- SO REGULER: kategori baru + Nomor PO customer
-- ------------------------------------------------------------
-- 1. Input Kategori dipasang lagi dengan pilihan baru:
--    Kontrak / Repeat Order / Quotation / Instalasi.
--    Nilai lama gaya MR ('New Item', dst.) tetap diizinkan agar
--    SO lama tetap valid. Kolom tetap nullable (SO 2026-10-16 s.d.
--    sekarang tidak punya kategori; wajib diisi di level app).
-- 2. customer_po_no: nomor PO dari customer, keterangan saja --
--    TIDAK terhubung ke tabel pos.
-- Kompatibel dengan code lama (code lama tidak mengisi kategori
-- maupun customer_po_no).
-- ============================================================

ALTER TABLE public.so_reguler
  DROP CONSTRAINT IF EXISTS so_reguler_kategori_check;

ALTER TABLE public.so_reguler
  ADD CONSTRAINT so_reguler_kategori_check
  CHECK (
    kategori IS NULL OR kategori IN (
      'Kontrak', 'Repeat Order', 'Quotation', 'Instalasi',
      -- legacy (SO s.d. 2026-10-16)
      'New Item', 'Replace Item', 'Fix & Repair', 'Upgrade'
    )
  );

ALTER TABLE public.so_reguler
  ADD COLUMN IF NOT EXISTS customer_po_no TEXT;

COMMENT ON COLUMN public.so_reguler.customer_po_no IS
'Nomor PO dari customer (keterangan saja, tidak terhubung ke tabel pos).';
