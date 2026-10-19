-- ============================================================
-- DATA: site consignment untuk customer PT Petrosea Tbk
-- ------------------------------------------------------------
-- Dipasang ke SEMUA akun Petrosea yang aktif (customer_name tidak
-- unik -- 1 perusahaan banyak akun). Akun yang masih
-- 'non_consignment' diubah jadi 'both' supaya muncul di picker
-- customer SO Consignment tapi tetap bisa dipakai DO/SO Reguler.
-- Site tanpa gudang (cabang_id NULL) -- bisa dihubungkan nanti
-- dari /customers -> Kelola site.
-- Idempotent: aman di-run ulang.
-- ============================================================

UPDATE public.customers
SET customer_type = 'both'
WHERE is_active
  AND customer_name ILIKE '%petrosea%'
  AND customer_type = 'non_consignment';

INSERT INTO public.customer_sites (customer_id, site_name)
SELECT c.id, s.site_name
FROM public.customers c
CROSS JOIN (VALUES
  ('PSF (BALIKPAPAN)'),
  ('PRC (BALIKPAPAN)'),
  ('KJA (BATU KAJANG)'),
  ('BC (KALTENG)'),
  ('MUTU (KALTENG)'),
  ('BPM (KALTENG)'),
  ('BBB (KALTENG)'),
  ('DBK (KALTENG)'),
  ('KSM (KOTABANGUN)'),
  ('IBP (TABANG)'),
  ('BSL (SUMATERA)'),
  ('FRP (FREEPORT)'),
  ('CEP (MELAK)'),
  ('KS (MELAK)'),
  ('PBP (KALTENG)'),
  ('GBM (KALTENG)'),
  ('VALE BAHO (BAHODOPI)'),
  ('SDA (HALMAHERA)')
) AS s(site_name)
WHERE c.is_active
  AND c.customer_name ILIKE '%petrosea%'
  AND NOT EXISTS (
    SELECT 1 FROM public.customer_sites cs
    WHERE cs.customer_id = c.id
      AND UPPER(cs.site_name) = UPPER(s.site_name)
  );
