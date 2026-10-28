-- Migration: Fix timeout halaman /stock (search_stock_summary)
-- Date: 2026-10-28
-- Description:
--   search_stock_summary & get_stock_cabang_counts (20261028100000) berjalan
--   sebagai pemanggil (SECURITY INVOKER), jadi policy RLS
--   "auth.role() = 'authenticated'" di stock/barang dievaluasi per baris
--   (~357rb baris stock). Di VPS prod query-nya melewati statement_timeout
--   role authenticated (8 detik) -> error 57014 -> halaman /stock kosong.
--   View lama v_stock_summary cepat karena view jalan dengan hak pemiliknya
--   (supabase_admin), RLS tidak dievaluasi.
--
--   Fix: kedua fungsi jalan dengan hak pemilik (SECURITY DEFINER), persis
--   seperti view lama. Aman: fungsi cuma membaca ringkasan stok yang memang
--   boleh dibaca semua user login (policy stock/barang = semua authenticated),
--   search_path sudah dikunci ke public, dan EXECUTE dicabut dari anon/PUBLIC
--   supaya tidak bisa dipanggil tanpa login.

ALTER FUNCTION public.search_stock_summary(
  text, bigint[], text, numeric, numeric, date, date, text[], text, integer, integer
) SECURITY DEFINER;
ALTER FUNCTION public.get_stock_cabang_counts() SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.search_stock_summary(
  text, bigint[], text, numeric, numeric, date, date, text[], text, integer, integer
) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_stock_cabang_counts() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.search_stock_summary(
  text, bigint[], text, numeric, numeric, date, date, text[], text, integer, integer
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_stock_cabang_counts() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
