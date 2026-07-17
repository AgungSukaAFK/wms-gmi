-- Migration: add receives.ri_pic_id
-- receives only stored the PIC name as text (ri_pic), no user id — so there
-- was no way to notify the Receive creator on approval/rejection. Additive,
-- nullable: old rows stay NULL, old app code that doesn't send this field
-- keeps working unchanged.

ALTER TABLE public.receives
  ADD COLUMN IF NOT EXISTS ri_pic_id UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_receives_ri_pic_id ON public.receives(ri_pic_id);
