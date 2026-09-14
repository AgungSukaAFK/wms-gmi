-- Migration: Scheduled MR item_site -> rujuk cabang (bukan teks bebas)
-- Date: 2026-09-13
-- Description:
--   item_site pada mr_items awalnya teks bebas. Ternyata "site" di project
--   ini sudah punya daftar baku: cabang (lihat "Lokasi Site" di form MR
--   create & pemilihan cabang di Approval Templates) -- bukan konsep baru.
--   Ganti jadi FK ke cabang supaya combobox pencarian di Scheduled MR
--   memakai daftar yang sama, bukan input bebas.
--   Belum ada data produksi yang bergantung pada kolom lama (fitur baru
--   dirilis di migration sebelumnya pada tanggal yang sama), jadi aman
--   di-drop+ganti tipe langsung.

ALTER TABLE public.mr_items DROP COLUMN IF EXISTS item_site;

ALTER TABLE public.mr_items
  ADD COLUMN IF NOT EXISTS item_site_cabang_id BIGINT REFERENCES public.cabang(id);

CREATE INDEX IF NOT EXISTS idx_mr_items_item_site_cabang_id
  ON public.mr_items(item_site_cabang_id);
