-- Harden min/max import: only the service_role (used by server actions after a
-- moderator check) may touch the staging table / apply function. Blocks direct
-- PostgREST access by anon/authenticated.

ALTER TABLE public.stock_minmax_import_staging ENABLE ROW LEVEL SECURITY;
-- No policies are created on purpose: with RLS enabled and no policy, anon and
-- authenticated are denied, while service_role bypasses RLS.

REVOKE ALL ON public.stock_minmax_import_staging FROM anon, authenticated;
GRANT ALL ON public.stock_minmax_import_staging TO service_role;

REVOKE EXECUTE ON FUNCTION public.apply_stock_minmax_import_staging(TEXT)
    FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stock_minmax_import_staging(TEXT)
    TO service_role;
