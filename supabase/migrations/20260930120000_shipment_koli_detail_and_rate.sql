-- Migration: Detail koli (berat + dimensi) & layanan/rate kurir di pengiriman
-- Date: 2026-09-30
-- Description:
--   Berlaku untuk semua fitur pengiriman: Item Transfer (item_transfers),
--   Delivery (deliveries), DO Reguler (do_reguler).
--     - layanan_kurir : jenis layanan ekspedisi, input manual (mis. "REG",
--                       "One Day Service"). Tidak ada master data layanan.
--     - rate_per_kg   : harga rate per kg (Rp), input manual sesuai kurir.
--     - koli_detail   : baris koli [{qty, berat_kg, panjang_cm, lebar_cm,
--                       tinggi_cm}] — 1 baris = sekelompok koli yang sama
--                       berat & dimensinya. Format dijaga di lib/shipment.ts.
--   jumlah_koli TETAP dipakai & diisi app = total qty koli_detail, jadi build
--   production lama (yang cuma baca/tulis jumlah_koli) tetap jalan. Estimasi
--   biaya dihitung di app (rate x berat tagih), tidak disimpan.
--   Semua kolom baru nullable / ber-default, aman untuk data lama. Idempotent.

ALTER TABLE public.item_transfers
  ADD COLUMN IF NOT EXISTS layanan_kurir TEXT,
  ADD COLUMN IF NOT EXISTS rate_per_kg NUMERIC(14,2) CHECK (rate_per_kg >= 0),
  ADD COLUMN IF NOT EXISTS koli_detail JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(koli_detail) = 'array');

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS layanan_kurir TEXT,
  ADD COLUMN IF NOT EXISTS rate_per_kg NUMERIC(14,2) CHECK (rate_per_kg >= 0),
  ADD COLUMN IF NOT EXISTS koli_detail JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(koli_detail) = 'array');

ALTER TABLE public.do_reguler
  ADD COLUMN IF NOT EXISTS layanan_kurir TEXT,
  ADD COLUMN IF NOT EXISTS rate_per_kg NUMERIC(14,2) CHECK (rate_per_kg >= 0),
  ADD COLUMN IF NOT EXISTS koli_detail JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(koli_detail) = 'array');
