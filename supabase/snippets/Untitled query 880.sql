-- Tambahkan status untuk item PR dan item Share Stock
ALTER TABLE public.pr_items ADD COLUMN IF NOT EXISTS status doc_status NOT NULL DEFAULT 'open';
ALTER TABLE public.mr_items ADD COLUMN IF NOT EXISTS ss_status doc_status NOT NULL DEFAULT 'open';
