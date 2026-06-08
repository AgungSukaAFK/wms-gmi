-- Detailed problem report for a min/max import batch (used by the upload UI to
-- show exactly which rows are wrong before applying). Read-only.

CREATE OR REPLACE FUNCTION public.report_minmax_import_problems(p_batch_code TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    SELECT s.source_row, s.part_number, s.nama_cabang, s.min_qty, s.max_qty,
           UPPER(BTRIM(s.part_number)) AS pk,
           UPPER(BTRIM(s.nama_cabang)) AS ck
    FROM public.stock_minmax_import_staging s
    WHERE s.batch_code = p_batch_code
  ),
  unmatched_parts AS (
    SELECT DISTINCT s.part_number
    FROM src s
    LEFT JOIN public.barang b ON UPPER(BTRIM(b.part_number)) = s.pk
    WHERE b.id IS NULL
  ),
  unmatched_cabang AS (
    SELECT DISTINCT s.nama_cabang
    FROM src s
    LEFT JOIN public.cabang c ON UPPER(BTRIM(c.nama_cabang)) = s.ck
    WHERE c.id IS NULL
  ),
  negatives AS (
    SELECT s.source_row, s.part_number, s.nama_cabang, s.min_qty, s.max_qty
    FROM src s WHERE s.min_qty < 0 OR s.max_qty < 0
  ),
  dups AS (
    SELECT MIN(s.part_number) AS part_number, MIN(s.nama_cabang) AS nama_cabang,
           COUNT(*) AS n
    FROM src s GROUP BY s.pk, s.ck HAVING COUNT(*) > 1
  ),
  mingtmax AS (
    SELECT s.source_row, s.part_number, s.nama_cabang, s.min_qty, s.max_qty
    FROM src s WHERE s.min_qty > s.max_qty
  )
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM src),
    'unmatched_parts_count', (SELECT COUNT(*) FROM unmatched_parts),
    'unmatched_parts', (SELECT COALESCE(jsonb_agg(part_number), '[]'::jsonb)
                        FROM (SELECT part_number FROM unmatched_parts ORDER BY 1 LIMIT 50) x),
    'unmatched_cabang_count', (SELECT COUNT(*) FROM unmatched_cabang),
    'unmatched_cabang', (SELECT COALESCE(jsonb_agg(nama_cabang), '[]'::jsonb)
                         FROM (SELECT nama_cabang FROM unmatched_cabang ORDER BY 1 LIMIT 50) x),
    'negative_count', (SELECT COUNT(*) FROM negatives),
    'negatives', (SELECT COALESCE(jsonb_agg(to_jsonb(n)), '[]'::jsonb)
                  FROM (SELECT * FROM negatives ORDER BY source_row LIMIT 50) n),
    'duplicate_count', (SELECT COUNT(*) FROM dups),
    'duplicates', (SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
                   FROM (SELECT * FROM dups ORDER BY part_number LIMIT 50) d),
    'min_gt_max_count', (SELECT COUNT(*) FROM mingtmax),
    'min_gt_max', (SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
                   FROM (SELECT * FROM mingtmax ORDER BY source_row LIMIT 50) m)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.report_minmax_import_problems(TEXT)
    FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_minmax_import_problems(TEXT)
    TO service_role;

COMMENT ON FUNCTION public.report_minmax_import_problems(TEXT) IS
'Return detailed problems (unmatched parts/cabang, negatives, duplicates, min>max) for a min/max import batch.';
