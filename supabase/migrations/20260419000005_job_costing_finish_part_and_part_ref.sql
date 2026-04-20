-- Add additional header fields for WMS legacy-style Job Costing form
ALTER TABLE public.job_costing
  ADD COLUMN IF NOT EXISTS finish_part TEXT,
  ADD COLUMN IF NOT EXISTS job_tanggal DATE;

-- Add material reference snapshot fields on job_costing_items
ALTER TABLE public.job_costing_items
  ADD COLUMN IF NOT EXISTS part_id BIGINT REFERENCES public.barang(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS part_number TEXT,
  ADD COLUMN IF NOT EXISTS part_name TEXT;

CREATE INDEX IF NOT EXISTS idx_job_costing_job_tanggal ON public.job_costing(job_tanggal);
CREATE INDEX IF NOT EXISTS idx_job_costing_finish_part ON public.job_costing(finish_part);
CREATE INDEX IF NOT EXISTS idx_job_costing_items_part_id ON public.job_costing_items(part_id);
