-- Add Remarks and Priority to Material Request
ALTER TABLE public.mrs 
ADD COLUMN IF NOT EXISTS mr_priority TEXT NOT NULL DEFAULT 'P3',
ADD COLUMN IF NOT EXISTS mr_remarks TEXT;

-- Standardizing priority values: P1, P2, P3, P4
-- P1: Emergency
-- P2: High
-- P3: Normal
-- P4: Low

COMMENT ON COLUMN public.mrs.mr_priority IS 'Priority level of the request (P1 to P4).';
COMMENT ON COLUMN public.mrs.mr_remarks IS 'Additional notes or remarks for the material request.';
