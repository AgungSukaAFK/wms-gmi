SELECT to_regclass('public.stock_setting_requests') AS tbl;             -- harus ada
SELECT relrowsecurity FROM pg_class WHERE relname='stock_setting_requests'; -- true
