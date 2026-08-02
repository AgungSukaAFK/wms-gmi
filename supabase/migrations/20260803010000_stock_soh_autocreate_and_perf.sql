-- Follow-up to 20260803000000_stock_soh_web_import.sql based on first real
-- production run of the web SOH upload:
--
-- 1. Unmatched parts (269 on the first run) are no longer just skipped --
--    they're auto-created as new public.barang rows (part_satuan defaults to
--    'UNIT' since the SOH file has no satuan column -- meant to be reviewed
--    manually on the Barang page later) plus a stock row for every valid
--    cabang this batch has for them (min_qty=0, max_qty=999999, brand new).
--    This only applies to genuinely new parts -- an existing part that's
--    merely missing a stock row for some cabang is still left untouched
--    (unchanged UPDATE-only behavior), same as before.
-- 2. Negative qty (4 rows on the first run) no longer blocks the whole
--    ~193k-row batch. Those specific rows are skipped and reported;
--    everything else still applies. Duplicate keys / fractional qty are
--    still blocking (should be structurally impossible from the client, so
--    finding any is a signal something upstream is broken).
--
-- `part_name` is added to stock_import_staging (nullable) so the web SOH
-- flow can supply "Deskripsi Barang" for auto-created parts. The old manual
-- VPS CSV flow never sets it -- backward compatible, apply_stock_import_staging
-- (the old function, still used by that manual flow) is untouched.

ALTER TABLE public.stock_import_staging ADD COLUMN IF NOT EXISTS part_name TEXT;

-- Return column set changes (new_parts_created, new_stock_rows added;
-- skipped_unmatched_barang removed) -- CREATE OR REPLACE can't change the
-- OUT parameter set, so the old signature must be dropped first.
DROP FUNCTION IF EXISTS public.apply_stock_soh_import_staging(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.apply_stock_soh_import_staging(
    p_batch_code TEXT,
    p_reference_id TEXT DEFAULT 'WEB_SOH_IMPORT',
    p_notes TEXT DEFAULT 'Update SOH via web'
)
RETURNS TABLE (
    updated_rows BIGINT,
    movement_rows BIGINT,
    max_defaulted_rows BIGINT,
    new_parts_created BIGINT,
    new_stock_rows BIGINT,
    duplicate_keys BIGINT,
    fractional_qty_rows BIGINT,
    skipped_negative_qty BIGINT,
    negative_samples JSONB,
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
    v_new_parts_created BIGINT := 0;
    v_new_stock_rows BIGINT := 0;
    v_duplicate_keys BIGINT := 0;
    v_fractional_qty_rows BIGINT := 0;
    v_skipped_negative_qty BIGINT := 0;
    v_negative_samples JSONB := '[]'::jsonb;
    v_skipped_unmatched_cabang BIGINT := 0;
BEGIN
    IF p_batch_code IS NULL OR BTRIM(p_batch_code) = '' THEN
        RAISE EXCEPTION 'p_batch_code is required';
    END IF;

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

    SELECT COUNT(*)
    INTO v_skipped_negative_qty
    FROM public.stock_import_staging s
    WHERE s.batch_code = p_batch_code
      AND s.qty < 0;

    IF v_skipped_negative_qty > 0 THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
        INTO v_negative_samples
        FROM (
            SELECT source_row, part_number, nama_cabang, qty
            FROM public.stock_import_staging
            WHERE batch_code = p_batch_code AND qty < 0
            ORDER BY source_row
            LIMIT 50
        ) x;
    END IF;

    -- Aggregated source, negative rows dropped (counted above, not applied).
    CREATE TEMP TABLE tmp_soh_import_src ON COMMIT DROP AS
    SELECT
        UPPER(BTRIM(s.part_number)) AS part_key,
        UPPER(BTRIM(s.nama_cabang)) AS cabang_key,
        (array_agg(s.part_number))[1] AS part_number,
        (array_agg(s.part_name))[1] AS part_name,
        SUM(s.qty)::INTEGER AS qty
    FROM public.stock_import_staging s
    WHERE s.batch_code = p_batch_code
      AND s.qty >= 0
    GROUP BY 1, 2;

    SELECT COUNT(*)
    INTO v_skipped_unmatched_cabang
    FROM tmp_soh_import_src src
    LEFT JOIN public.cabang c
        ON UPPER(BTRIM(c.nama_cabang)) = src.cabang_key
    WHERE c.id IS NULL;

    -- Parts not yet in master -- auto-create. part_satuan isn't in the SOH
    -- file, defaults to 'UNIT'.
    CREATE TEMP TABLE tmp_new_barang ON COMMIT DROP AS
    SELECT DISTINCT ON (src.part_key)
        src.part_key,
        src.part_number,
        COALESCE(NULLIF(BTRIM(src.part_name), ''), src.part_number) AS part_name
    FROM tmp_soh_import_src src
    LEFT JOIN public.barang b ON UPPER(BTRIM(b.part_number)) = src.part_key
    WHERE b.id IS NULL;

    WITH inserted AS (
        INSERT INTO public.barang (part_number, part_name, part_satuan)
        SELECT n.part_number, n.part_name, 'UNIT'
        FROM tmp_new_barang n
        ON CONFLICT (part_number) DO NOTHING
        RETURNING id
    )
    SELECT COUNT(*) INTO v_new_parts_created FROM inserted;

    -- Matched rows (parts that already existed before this batch): update
    -- qty for existing stock rows only -- unchanged UPDATE-only behavior,
    -- no stock row is created for a pre-existing part missing a cabang row.
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
        part_id, cabang_id, qty_change, type, reference_id, notes, created_at
    )
    SELECT t.part_id, t.cabang_id, t.new_qty - t.old_qty, 'ADJUSTMENT', p_reference_id, p_notes, NOW()
    FROM tmp_soh_import_target t
    WHERE t.old_qty IS DISTINCT FROM t.new_qty;

    GET DIAGNOSTICS v_movement_rows = ROW_COUNT;

    UPDATE public.stock st
    SET qty = t.new_qty, updated_at = NOW()
    FROM tmp_soh_import_target t
    WHERE st.id = t.stock_id
      AND t.old_qty IS DISTINCT FROM t.new_qty;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

    -- Every matched part+cabang in this batch that still has max_qty = 0
    -- (never configured) gets defaulted; rows with a real max are untouched.
    UPDATE public.stock st
    SET max_qty = 999999, updated_at = NOW()
    FROM tmp_soh_import_target t
    WHERE st.id = t.stock_id
      AND t.old_max_qty = 0;

    GET DIAGNOSTICS v_max_defaulted_rows = ROW_COUNT;

    -- Brand-new parts created above: one stock row per valid-cabang entry
    -- this batch has for them.
    WITH new_stock AS (
        INSERT INTO public.stock (part_id, cabang_id, qty, min_qty, max_qty)
        SELECT b.id, c.id, src.qty, 0, 999999
        FROM tmp_soh_import_src src
        JOIN tmp_new_barang n ON n.part_key = src.part_key
        JOIN public.barang b ON UPPER(BTRIM(b.part_number)) = src.part_key
        JOIN public.cabang c ON UPPER(BTRIM(c.nama_cabang)) = src.cabang_key
        ON CONFLICT (part_id, cabang_id) DO NOTHING
        RETURNING id, part_id, cabang_id, qty
    ),
    logged AS (
        INSERT INTO public.stock_movements (part_id, cabang_id, qty_change, type, reference_id, notes, created_at)
        SELECT part_id, cabang_id, qty, 'ADJUSTMENT', p_reference_id, p_notes, NOW()
        FROM new_stock
        WHERE qty <> 0
        RETURNING id
    )
    SELECT COUNT(*) INTO v_new_stock_rows FROM new_stock;

    RETURN QUERY
    SELECT
        v_updated_rows,
        v_movement_rows,
        v_max_defaulted_rows,
        v_new_parts_created,
        v_new_stock_rows,
        v_duplicate_keys,
        v_fractional_qty_rows,
        v_skipped_negative_qty,
        v_negative_samples,
        v_skipped_unmatched_cabang;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_stock_soh_import_staging(TEXT, TEXT, TEXT)
    FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stock_soh_import_staging(TEXT, TEXT, TEXT)
    TO service_role;

COMMENT ON FUNCTION public.apply_stock_soh_import_staging(TEXT, TEXT, TEXT) IS
'Apply a web-uploaded SOH batch: updates qty + logs stock_movements for matched rows, defaults max_qty to 999999 for matched rows that still have max_qty = 0, auto-creates barang + stock rows for parts not yet in master (part_satuan defaults to UNIT), and skips (rather than blocks on) negative qty / unmatched cabang rows.';
