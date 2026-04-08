-- Allow admins to update all profiles
CREATE POLICY "Allow admins to update all profiles"
ON public.profiles FOR UPDATE
USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "Allow admins to delete profiles"
ON public.profiles FOR DELETE
USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);
