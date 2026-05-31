-- Migration: Delivery Estimasi (Hari)
-- Date: 2026-05-31
-- Description:
--   Tambah kolom estimasi_hari pada deliveries untuk menyimpan estimasi
--   lama pengiriman (dalam hari). Input manual oleh user.
--   Default aplikasi:
--     - handcarry_internal / handcarry_eksternal => 1 hari
--     - ekspedisi                                 => 5 hari
--   Default DB di-set 1 (nilai aman terkecil); aplikasi mengirim nilai eksplisit.

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS estimasi_hari INTEGER NOT NULL DEFAULT 1
    CHECK (estimasi_hari >= 1);

-- Backfill baris lama (mayoritas bertipe 'ekspedisi') ke 5 hari,
-- handcarry tetap 1 hari.
UPDATE public.deliveries
SET estimasi_hari = 5
WHERE shipment_type = 'ekspedisi';
