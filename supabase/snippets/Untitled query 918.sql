-- Tambahkan kolom status ke pr_items
ALTER TABLE public.pr_items
ADD COLUMN IF NOT EXISTS status doc_status NOT NULL DEFAULT 'open';

-- Index untuk mempercepat pencarian (opsional tapi disarankan)
CREATE INDEX IF NOT EXISTS idx_pr_items_status ON public.pr_items(status);
