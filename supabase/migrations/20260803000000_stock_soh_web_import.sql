-- Web-based SOH (real qty) import, built on the existing stock_import_staging
-- table (previously only used manually via psql on the VPS, never exposed to
-- the app -- see 20260512093000_stock_real_import_staging.sql and the note in
-- 20260728120000_fix_missing_table_grants.sql). Now that a server action will
-- write to it, secure it the same way as stock_minmax_import_staging.
--
-- Unlike apply_stock_import_staging (Min/Max: all-or-nothing, small manually
-- curated batches), this SOH batch is the full monthly catalog x branch
-- matrix (tens of thousands of rows) sourced from an external system whose
-- part list drifts from public.barang. Blocking the whole batch on a few new
--/renamed parts would make the feature unusable, so unmatched parts/cabang
-- are skipped and reported instead of raising.
--
-- Also folds in a one-off default: any touched stock row that still has
-- max_qty = 0 (never configured) gets bumped to 999999 so it stops being
-- flagged as understock by min/max logic elsewhere. Rows with a real max
-- already set are left untouched.

ALTER TABLE public.stock_import_staging ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: RLS enabled + zero policies denies anon/authenticated,
-- while service_role bypasses RLS.

REVOKE ALL ON public.stock_import_staging FROM anon, authenticated;
GRANT ALL ON public.stock_import_staging TO service_role;

CREATE OR REPLACE FUNCTION public.report_soh_import_problems(p_batch_code TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    SELECT s.source_row, s.part_number, s.nama_cabang, s.qty,
           UPPER(BTRIM(s.part_number)) AS pk,
           UPPER(BTRIM(s.nama_cabang)) AS ck
    FROM public.stock_import_staging s
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
    SELECT s.source_row, s.part_number, s.nama_cabang, s.qty
    FROM src s WHERE s.qty < 0
  ),
  dups AS (
    SELECT MIN(s.part_number) AS part_number, MIN(s.nama_cabang) AS nama_cabang,
           COUNT(*) AS n
    FROM src s GROUP BY s.pk, s.ck HAVING COUNT(*) > 1
  ),
  fractional AS (
    SELECT s.source_row, s.part_number, s.nama_cabang, s.qty
    FROM src s WHERE s.qty <> TRUNC(s.qty)
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
    'fractional_count', (SELECT COUNT(*) FROM fractional),
    'fractional', (SELECT COALESCE(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
                   FROM (SELECT * FROM fractional ORDER BY source_row LIMIT 50) f)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.report_soh_import_problems(TEXT)
    FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_soh_import_problems(TEXT)
    TO service_role;

COMMENT ON FUNCTION public.report_soh_import_problems(TEXT) IS
'Return detailed problems (unmatched parts/cabang, negatives, duplicates, fractional qty) for a SOH import batch. unmatched parts/cabang are informational (skipped, not blocking); the others are blocking.';

CREATE OR REPLACE FUNCTION public.apply_stock_soh_import_staging(
    p_batch_code TEXT,
    p_reference_id TEXT DEFAULT 'WEB_SOH_IMPORT',
    p_notes TEXT DEFAULT 'Update SOH via web'
)
RETURNS TABLE (
    updated_rows BIGINT,
    movement_rows BIGINT,
    max_defaulted_rows BIGINT,
    duplicate_keys BIGINT,
    fractional_qty_rows BIGINT,
    skipped_unmatched_barang BIGINT,
    skipped_unmatched_cabang BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated_rows BIGINT := 0;
    v_movement_rows BIGINT := 0;
    v_max_defaulted_rows BIGINT := 0;
    v_duplicate_keys BIGINT := 0;
    v_fractional_qty_rows BIGINT := 0;
    v_skipped_unmatched_barang BIGINT := 0;
    v_skipped_unmatched_cabang BIGINT := 0;
BEGIN
    IF p_batch_code IS NULL OR BTRIM(p_batch_code) = '' THEN
        RAISE EXCEPTION 'p_batch_code is required';
    END IF;

    -- Fractional / duplicate keys indicate a bug upstream (client is expected
    -- to send integer qty and pre-dedupe) -- treat as blocking, unlike
    -- unmatched barang/cabang below.
    SELECT COUNT(*)
    INTO v_fractional_qty_rows
    FROM public.stock_import_staging s
    WHERE s.batch_code = p_batch_code
      AND s.qty <> TRUNC(s.qty);

    IF v_fractional_qty_rows > 0 THEN
        RAISE EXCEPTION 'Fractional qty found for batch %: % row(s). Qty must be integer.', p_batch_code, v_fractional_qty_rows;
    END IF;

    SELECT COUNT(*)
    INTO v_duplicate_keys
    FROM (
        SELECT UPPER(BTRIM(s.part_number)) AS part_key,
               UPPER(BTRIM(s.nama_cabang)) AS cabang_key
        FROM public.stock_import_staging s
        WHERE s.batch_code = p_batch_code
        GROUP BY 1, 2
        HAVING COUNT(*) > 1
    ) d;

    IF v_duplicate_keys > 0 THEN
        RAISE EXCEPTION 'Duplicate part_number + nama_cabang found for batch %: % key(s).', p_batch_code, v_duplicate_keys;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.stock_import_staging s
        WHERE s.batch_code = p_batch_code AND s.qty < 0
    ) THEN
        RAISE EXCEPTION 'Negative qty found for batch %.', p_batch_code;
    END IF;

    CREATE TEMP TABLE tmp_soh_import_src ON COMMIT DROP AS
    SELECT
        UPPER(BTRIM(s.part_number)) AS part_key,
        UPPER(BTRIM(s.nama_cabang)) AS cabang_key,
        SUM(s.qty)::INTEGER AS qty
    FROM public.stock_import_staging s
    WHERE s.batch_code = p_batch_code
    GROUP BY 1, 2;

    SELECT COUNT(*)
    INTO v_skipped_unmatched_barang
    FROM tmp_soh_import_src src
    LEFT JOIN public.barang b
        ON UPPER(BTRIM(b.part_number)) = src.part_key
    WHERE b.id IS NULL;

    SELECT COUNT(*)
    INTO v_skipped_unmatched_cabang
    FROM tmp_soh_import_src src
    LEFT JOIN public.cabang c
        ON UPPER(BTRIM(c.nama_cabang)) = src.cabang_key
    WHERE c.id IS NULL;

    -- Matched rows only (UPDATE-only: no new stock rows are created for
    -- part/cabang combos that don't already have one).
    CREATE TEMP TABLE tmp_soh_import_target ON COMMIT DROP AS
    SELECT
        st.id AS stock_id,
        st.part_id,
        st.cabang_id,
        st.qty AS old_qty,
        src.qty AS new_qty,
        st.max_qty AS old_max_qty
    FROM tmp_soh_import_src src
    JOIN public.barang b
        ON UPPER(BTRIM(b.part_number)) = src.part_key
    JOIN public.cabang c
        ON UPPER(BTRIM(c.nama_cabang)) = src.cabang_key
    JOIN public.stock st
        ON st.part_id = b.id
       AND st.cabang_id = c.id;

    INSERT INTO public.stock_movements (
        part_id,
        cabang_id,
        qty_change,
        type,
        reference_id,
        notes,
        created_at
    )
    SELECT
        t.part_id,
        t.cabang_id,
        t.new_qty - t.old_qty,
        'ADJUSTMENT',
        p_reference_id,
        p_notes,
        NOW()
    FROM tmp_soh_import_target t
    WHERE t.old_qty IS DISTINCT FROM t.new_qty;

    GET DIAGNOSTICS v_movement_rows = ROW_COUNT;

    UPDATE public.stock st
    SET
        qty = t.new_qty,
        updated_at = NOW()
    FROM tmp_soh_import_target t
    WHERE st.id = t.stock_id
      AND t.old_qty IS DISTINCT FROM t.new_qty;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

    -- Every part+cabang present in this batch that still has max_qty = 0
    -- (never configured) gets a high default so it stops looking understock.
    -- Rows with a real max already set are left alone.
    UPDATE public.stock st
    SET
        max_qty = 999999,
        updated_at = NOW()
    FROM tmp_soh_import_target t
    WHERE st.id = t.stock_id
      AND t.old_max_qty = 0;

    GET DIAGNOSTICS v_max_defaulted_rows = ROW_COUNT;

    RETURN QUERY
    SELECT
        v_updated_rows,
        v_movement_rows,
        v_max_defaulted_rows,
        v_duplicate_keys,
        v_fractional_qty_rows,
        v_skipped_unmatched_barang,
        v_skipped_unmatched_cabang;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_stock_soh_import_staging(TEXT, TEXT, TEXT)
    FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stock_soh_import_staging(TEXT, TEXT, TEXT)
    TO service_role;

COMMENT ON FUNCTION public.apply_stock_soh_import_staging(TEXT, TEXT, TEXT) IS
'Validate and apply a web-uploaded SOH batch from stock_import_staging: updates qty + logs stock_movements for matched rows, defaults max_qty to 999999 for matched rows that still have max_qty = 0, and skips (rather than blocks on) unmatched barang/cabang.';
