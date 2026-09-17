-- Migration: Job Costing bisa pakai lokasi customer (gudang customer), bukan
-- cuma cabang GMI/GIS sendiri.
-- Date: 2026-09-17
-- Context: item pending "Belum bisa JobCosting di gudang customer" -- bahan
-- (job_costing_items) dan finish part (job_costing_finish_parts) sekarang
-- boleh sumber/tujuannya berupa customer (stok konsinyasi di customer_stock,
-- lihat 20260915100000_consignment_penerimaan.sql), bukan cuma cabang.
--
-- Kolom cabang lama (source_cabang_id / cabang_id) TETAP ada dan tetap
-- nullable seperti sebelumnya -- kode production lama yang masih insert
-- lewat kolom itu saja tidak akan pecah (AGENTS.md backward-compat rule).

ALTER TABLE public.job_costing_items
  ADD COLUMN IF NOT EXISTS source_customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.job_costing_finish_parts
  ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL;

-- "Paling banyak satu" (bukan "wajib satu") -- job_costing_items juga dipakai
-- untuk baris biaya tambahan non-stok (lihat addJobCostingItem di
-- services/finance-actions.ts) yang boleh tidak punya lokasi sama sekali.
ALTER TABLE public.job_costing_items
  DROP CONSTRAINT IF EXISTS job_costing_items_source_location_check;
ALTER TABLE public.job_costing_items
  ADD CONSTRAINT job_costing_items_source_location_check
  CHECK (source_cabang_id IS NULL OR source_customer_id IS NULL);

ALTER TABLE public.job_costing_finish_parts
  DROP CONSTRAINT IF EXISTS job_costing_finish_parts_location_check;
ALTER TABLE public.job_costing_finish_parts
  ADD CONSTRAINT job_costing_finish_parts_location_check
  CHECK (cabang_id IS NULL OR customer_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_job_costing_items_source_customer_id ON public.job_costing_items(source_customer_id);
CREATE INDEX IF NOT EXISTS idx_job_costing_finish_parts_customer_id ON public.job_costing_finish_parts(customer_id);
