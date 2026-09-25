-- Migration: Kategori HO/Branch pada cabang
-- Date: 2026-09-20
-- Description:
--   Fitur Working Order butuh input "Gudang WO" yang membedakan HO vs Branch.
--   Kolom ini belum pernah ada di cabang. Sengaja NULLABLE (tanpa backfill
--   otomatis by nama) karena data cabang di VPS production sudah diketahui
--   menyimpang dari histori migration seed (lihat memory project
--   cabang-production-drift) -- klasifikasi HO/Branch per baris harus
--   dilakukan manual pasca-deploy, lihat catatan SQL di deskripsi PR/laporan
--   deploy fitur ini.

ALTER TABLE public.cabang
  ADD COLUMN IF NOT EXISTS cabang_type TEXT;

ALTER TABLE public.cabang
  DROP CONSTRAINT IF EXISTS cabang_cabang_type_check;

ALTER TABLE public.cabang
  ADD CONSTRAINT cabang_cabang_type_check
  CHECK (cabang_type IS NULL OR cabang_type IN ('HO', 'Branch'));
