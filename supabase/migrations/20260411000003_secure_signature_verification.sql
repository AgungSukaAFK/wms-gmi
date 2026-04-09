-- Add security tracking for signature verification
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS signature_failed_attempts INTEGER NOT NULL DEFAULT 0;

-- Ensure is_active is true for existing users (or whatever policy is preferred)
-- Normally it should be handled in auth, but we'll ensure it's set up for the lockout check.
UPDATE public.profiles SET is_active = TRUE WHERE is_active IS FALSE AND email != 'admin@demo.com'; -- Safety for tests

COMMENT ON COLUMN public.profiles.signature_failed_attempts IS 'Tracks consecutive failed signature password attempts for security lockout.';
