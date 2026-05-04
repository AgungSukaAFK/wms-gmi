-- Chapter C1: Job Costing multi-cabang source + finish part destination/qty

ALTER TABLE public.job_costing
  ADD COLUMN IF NOT EXISTS finish_part_id BIGINT REFERENCES public.barang(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finish_part_cabang_id BIGINT REFERENCES public.cabang(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qty_finish_part NUMERIC NOT NULL DEFAULT 1;

ALTER TABLE public.job_costing_items
  ADD COLUMN IF NOT EXISTS source_cabang_id BIGINT REFERENCES public.cabang(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_costing_finish_part_id ON public.job_costing(finish_part_id);
CREATE INDEX IF NOT EXISTS idx_job_costing_finish_part_cabang_id ON public.job_costing(finish_part_cabang_id);
CREATE INDEX IF NOT EXISTS idx_job_costing_items_source_cabang_id ON public.job_costing_items(source_cabang_id);
