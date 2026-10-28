-- Filter lengkap halaman /stock (Monitoring Stok).
--
-- 1. search_stock_summary(...): ringkasan stok per part (setara
--    v_stock_summary) + filter per gudang. "Cakupan" = gudang yang dipilih
--    (p_cabang_ids), atau semua gudang kalau kosong. Filter nilai stok
--    (status, rentang qty, tanggal diubah) dihitung dalam cakupan itu;
--    total_qty / active_locations / last_updated tetap seluruh gudang.
--    Status = ada gudang dalam cakupan yang memenuhi:
--      in_stock      qty > 0
--      empty         (kebalikan) tidak ada gudang dengan qty <> 0
--      negative      qty < 0
--      below_min     min_qty > 0 dan qty < min_qty
--      above_max     max_qty > 0 dan qty > max_qty
--      minmax_unset  qty > 0 tapi min_qty = 0 dan max_qty = 0
--    Part yang belum punya baris stock di gudang tsb dianggap qty 0.
--    Tanggal diubah memakai tanggal bisnis WIB (Asia/Jakarta).
--    total_count = jumlah baris sebelum paging.
-- 2. get_stock_cabang_counts(): jumlah part yang punya stok (> 0) per gudang,
--    untuk label dropdown gudang.
--
-- Backward compatible: hanya fungsi baru, v_stock_summary tidak diubah.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.search_stock_summary(
  p_search TEXT DEFAULT NULL,
  p_cabang_ids BIGINT[] DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_qty_from NUMERIC DEFAULT NULL,
  p_qty_to NUMERIC DEFAULT NULL,
  p_updated_from DATE DEFAULT NULL,
  p_updated_to DATE DEFAULT NULL,
  p_satuan TEXT[] DEFAULT NULL,
  p_sort TEXT DEFAULT 'qty_desc',
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  part_id BIGINT,
  part_number TEXT,
  part_name TEXT,
  part_satuan TEXT,
  total_qty BIGINT,
  active_locations BIGINT,
  last_updated TIMESTAMPTZ,
  scope_qty BIGINT,
  scope_locations BIGINT,
  negative_locations BIGINT,
  below_min_locations BIGINT,
  above_max_locations BIGINT,
  cabang_breakdown JSONB,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT
      s.*,
      (COALESCE(cardinality(p_cabang_ids), 0) = 0
        OR s.cabang_id = ANY (p_cabang_ids)) AS in_scope
    FROM public.stock s
  ),
  agg AS (
    SELECT
      s.part_id,
      SUM(s.qty) AS total_qty,
      COUNT(*) FILTER (WHERE s.qty > 0) AS active_locations,
      MAX(s.updated_at) AS last_updated,
      SUM(s.qty) FILTER (WHERE s.in_scope) AS scope_qty,
      COUNT(*) FILTER (WHERE s.in_scope AND s.qty > 0) AS scope_locations,
      COUNT(*) FILTER (WHERE s.in_scope AND s.qty <> 0) AS scope_nonzero,
      COUNT(*) FILTER (WHERE s.in_scope AND s.qty < 0) AS negative_locations,
      COUNT(*) FILTER (
        WHERE s.in_scope AND s.min_qty > 0 AND s.qty < s.min_qty
      ) AS below_min_locations,
      COUNT(*) FILTER (
        WHERE s.in_scope AND s.max_qty > 0 AND s.qty > s.max_qty
      ) AS above_max_locations,
      COUNT(*) FILTER (
        WHERE s.in_scope AND s.qty > 0 AND s.min_qty = 0 AND s.max_qty = 0
      ) AS minmax_unset_locations,
      MAX(s.updated_at) FILTER (WHERE s.in_scope) AS scope_updated
    FROM scoped s
    GROUP BY s.part_id
  ),
  filtered AS (
    SELECT
      b.id AS part_id,
      b.part_number,
      b.part_name,
      b.part_satuan,
      COALESCE(a.total_qty, 0)::BIGINT AS total_qty,
      COALESCE(a.active_locations, 0) AS active_locations,
      a.last_updated,
      COALESCE(a.scope_qty, 0)::BIGINT AS scope_qty,
      COALESCE(a.scope_locations, 0) AS scope_locations,
      COALESCE(a.negative_locations, 0) AS negative_locations,
      COALESCE(a.below_min_locations, 0) AS below_min_locations,
      COALESCE(a.above_max_locations, 0) AS above_max_locations
    FROM public.barang b
    LEFT JOIN agg a ON a.part_id = b.id
    WHERE
      (NULLIF(btrim(p_search), '') IS NULL
        OR b.part_number ILIKE '%' || btrim(p_search) || '%'
        OR b.part_name ILIKE '%' || btrim(p_search) || '%')
      AND (COALESCE(cardinality(p_satuan), 0) = 0
        OR upper(btrim(b.part_satuan)) = ANY (p_satuan))
      AND CASE COALESCE(p_status, 'all')
        WHEN 'in_stock' THEN COALESCE(a.scope_locations, 0) > 0
        WHEN 'empty' THEN COALESCE(a.scope_nonzero, 0) = 0
        WHEN 'negative' THEN COALESCE(a.negative_locations, 0) > 0
        WHEN 'below_min' THEN COALESCE(a.below_min_locations, 0) > 0
        WHEN 'above_max' THEN COALESCE(a.above_max_locations, 0) > 0
        WHEN 'minmax_unset' THEN COALESCE(a.minmax_unset_locations, 0) > 0
        ELSE TRUE
      END
      AND (p_qty_from IS NULL OR COALESCE(a.scope_qty, 0) >= p_qty_from)
      AND (p_qty_to IS NULL OR COALESCE(a.scope_qty, 0) <= p_qty_to)
      AND (p_updated_from IS NULL
        OR a.scope_updated >= (p_updated_from::timestamp AT TIME ZONE 'Asia/Jakarta'))
      AND (p_updated_to IS NULL
        OR a.scope_updated < ((p_updated_to + 1)::timestamp AT TIME ZONE 'Asia/Jakarta'))
  ),
  ranked AS (
    SELECT
      f.*,
      row_number() OVER (
        ORDER BY
          CASE p_sort WHEN 'no_asc' THEN f.part_id END ASC,
          CASE p_sort WHEN 'no_desc' THEN f.part_id END DESC,
          CASE p_sort WHEN 'part_number_asc' THEN f.part_number END ASC,
          CASE p_sort WHEN 'part_number_desc' THEN f.part_number END DESC,
          CASE p_sort WHEN 'part_name_asc' THEN f.part_name END ASC,
          CASE p_sort WHEN 'part_name_desc' THEN f.part_name END DESC,
          CASE p_sort WHEN 'active_locations_asc' THEN f.active_locations END ASC,
          CASE p_sort WHEN 'active_locations_desc' THEN f.active_locations END DESC,
          CASE p_sort WHEN 'qty_asc' THEN f.total_qty END ASC,
          CASE p_sort WHEN 'cabang_qty_asc' THEN f.scope_qty END ASC,
          CASE p_sort WHEN 'cabang_qty_desc' THEN f.scope_qty END DESC,
          CASE p_sort WHEN 'last_updated_asc' THEN f.last_updated END ASC NULLS LAST,
          CASE p_sort WHEN 'last_updated_desc' THEN f.last_updated END DESC NULLS LAST,
          -- qty_desc (default) sekaligus pemecah seri untuk sort lain.
          f.total_qty DESC,
          f.part_id
      ) AS rn,
      count(*) OVER () AS total_count
    FROM filtered f
  )
  SELECT
    r.part_id,
    r.part_number,
    r.part_name,
    r.part_satuan,
    r.total_qty,
    r.active_locations,
    r.last_updated,
    r.scope_qty,
    r.scope_locations,
    r.negative_locations,
    r.below_min_locations,
    r.above_max_locations,
    CASE WHEN COALESCE(cardinality(p_cabang_ids), 0) > 0 THEN (
      SELECT jsonb_agg(
        jsonb_build_object(
          'cabang_id', s.cabang_id,
          'nama_cabang', c.nama_cabang,
          'qty', s.qty,
          'min_qty', s.min_qty,
          'max_qty', s.max_qty
        )
        ORDER BY s.qty DESC, c.nama_cabang
      )
      FROM public.stock s
      JOIN public.cabang c ON c.id = s.cabang_id
      WHERE s.part_id = r.part_id AND s.cabang_id = ANY (p_cabang_ids)
    ) END AS cabang_breakdown,
    r.total_count
  FROM ranked r
  WHERE r.rn > GREATEST(p_offset, 0)
    AND r.rn <= GREATEST(p_offset, 0) + GREATEST(p_limit, 1)
  ORDER BY r.rn;
$$;

GRANT EXECUTE ON FUNCTION public.search_stock_summary(
  TEXT, BIGINT[], TEXT, NUMERIC, NUMERIC, DATE, DATE, TEXT[], TEXT, INT, INT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_stock_cabang_counts()
RETURNS TABLE (cabang_id BIGINT, parts_in_stock BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT s.cabang_id, count(*) AS parts_in_stock
  FROM public.stock s
  WHERE s.qty > 0
  GROUP BY s.cabang_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_cabang_counts() TO authenticated;
