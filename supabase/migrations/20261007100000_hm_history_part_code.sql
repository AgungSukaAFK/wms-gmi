-- HM Maintenance: Part Number tampil sebagai identitas utama part.
-- hm_history (sumber Ekspor CSV riwayat) ditambah kolom part_code
-- (= hm_parts.code, otomatis = barang.part_number kalau part di-link ke
-- master barang). Kolom baru ditaruh PALING AKHIR supaya CREATE OR REPLACE
-- VIEW valid & build lama (select *) tetap jalan. Idempotent.

CREATE OR REPLACE VIEW public.hm_history WITH (security_invoker = true) AS
SELECT
  'Penggantian Part'::TEXT AS kind,
  0                        AS kind_order,
  r.id,
  COALESCE(u.code, '')     AS unit_code,
  COALESCE(u.name, '')     AS unit_name,
  COALESCE(p.name, '')     AS part_name,
  ''::TEXT                 AS service_kind,
  r.date, r.hm, r.note,
  COALESCE(p.code, '')     AS part_code
FROM public.hm_replacements r
LEFT JOIN public.hm_units u ON u.id = r.unit_id
LEFT JOIN public.hm_parts p ON p.id = r.part_id
UNION ALL
SELECT
  'Servis Umum', 1, s.id,
  COALESCE(u.code, ''), COALESCE(u.name, ''), '',
  s.kind::TEXT, s.date, s.hm, s.note,
  ''
FROM public.hm_services s
LEFT JOIN public.hm_units u ON u.id = s.unit_id;

GRANT SELECT ON public.hm_history TO authenticated;
