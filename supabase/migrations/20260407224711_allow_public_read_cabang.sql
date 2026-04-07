-- Allow anyone (including anonymous users) to read the list of branches for signup
CREATE POLICY "Allow public read access to cabang"
ON public.cabang FOR SELECT
USING (TRUE);
