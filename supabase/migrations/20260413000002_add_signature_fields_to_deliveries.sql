-- ============================================================
-- ADD SIGNATURE & USER FIELDS TO DELIVERIES
-- ============================================================

-- Add new columns to deliveries table
ALTER TABLE public.deliveries
ADD COLUMN uid_sender UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN uid_receiver UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN uid_pic UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN signature_sender_id UUID REFERENCES public.user_signatures(id) ON DELETE SET NULL,
ADD COLUMN signature_receiver_id UUID REFERENCES public.user_signatures(id) ON DELETE SET NULL,
ADD COLUMN signed_by_sender_at TIMESTAMPTZ,
ADD COLUMN signed_by_receiver_at TIMESTAMPTZ;

-- Make legacy pic column nullable (replaced by uid_pic) and set default empty string
ALTER TABLE public.deliveries ALTER COLUMN pic DROP NOT NULL;
ALTER TABLE public.deliveries ALTER COLUMN pic SET DEFAULT '';

-- Create index for faster lookups
CREATE INDEX idx_deliveries_uid_sender ON public.deliveries(uid_sender);
CREATE INDEX idx_deliveries_uid_receiver ON public.deliveries(uid_receiver);
CREATE INDEX idx_deliveries_uid_pic ON public.deliveries(uid_pic);
CREATE INDEX idx_deliveries_signature_sender ON public.deliveries(signature_sender_id);
CREATE INDEX idx_deliveries_signature_receiver ON public.deliveries(signature_receiver_id);
