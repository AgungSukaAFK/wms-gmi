-- Chapter C5: Moderator/Admin tracking override + custom tracking note

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS tracking_note TEXT,
  ADD COLUMN IF NOT EXISTS tracking_note_updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tracking_note_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_deliveries_tracking_note_updated_by
  ON public.deliveries(tracking_note_updated_by);
