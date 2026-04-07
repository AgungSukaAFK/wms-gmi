-- Ensure schemas are accessible to PostgREST roles (anon, authenticated)
GRANT USAGE ON SCHEMA public TO anon, authenticated, authenticator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, authenticator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, authenticator;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, authenticator;

-- Re-apply table specific read for anon to be sure
GRANT SELECT ON public.cabang TO anon;
GRANT SELECT ON public.profiles TO anon;
