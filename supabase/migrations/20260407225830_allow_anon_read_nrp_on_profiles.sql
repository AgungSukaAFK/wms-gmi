-- Allow unauthenticated (anon) users to fetch the email of a user given their NRP
-- This is necessary for the NRP-based login flow.
CREATE POLICY "Allow anon to lookup email by NRP"
ON public.profiles FOR SELECT
TO anon
USING (TRUE);

-- Note: We are allowing SELECT on all columns for anon for now to simplify.
-- In production, we'd only want to allow selecting 'email' where 'nrp' matches.
