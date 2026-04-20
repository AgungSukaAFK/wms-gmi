ALTER TABLE public.delivery_items
ADD COLUMN IF NOT EXISTS mr_item_id BIGINT REFERENCES public.mr_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_items_mr_item_id ON public.delivery_items(mr_item_id);