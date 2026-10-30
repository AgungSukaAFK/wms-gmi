-- Migration: Hapus (arsip) master Barang & Vendor tanpa merusak dokumen
-- Date: 2026-10-30
-- Description:
--   Hapus barang/vendor dari /barang & /vendors (satuan maupun massal oleh
--   moderator) sekarang SOFT DELETE: baris master tetap ada, cuma ditandai
--   deleted_at. Alasannya hard delete merusak dokumen lama:
--     - stock, stock_movements, stock_setting_requests ON DELETE CASCADE
--       (riwayat stok ikut hilang);
--     - po_items.vendor_id, job_costing*, hm_* ON DELETE SET NULL
--       (vendor/part di dokumen jadi kosong);
--     - vendor tidak di-snapshot di PR/PO/SPB/IT (nama diambil lewat join).
--   Dengan soft delete semua dokumen tetap menunjuk ke baris yang sama, jadi
--   tampilan & isi dokumen tidak berubah. Barang/vendor terhapus cuma
--   disembunyikan dari list master, picker pembuatan dokumen baru, global
--   search, dan halaman /stock. Moderator bisa memulihkan dari filter
--   "Terhapus".
--
--   Pengaman: kalau barang terhapus ternyata kemasukan stok lagi (mis. RI dari
--   PO lama, import SOH), barangnya otomatis dipulihkan supaya stoknya tidak
--   "hilang" dari /stock.
--
--   Aditif & idempotent: kolom baru nullable, fungsi di-replace dengan
--   signature sama. Code production lama tetap jalan (belum mengisi/membaca
--   deleted_at). WAJIB dijalankan SEBELUM deploy frontend baru (code baru
--   memfilter deleted_at).

ALTER TABLE public.barang
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Untuk filter "Terhapus" (moderator); baris aktif tidak masuk index.
CREATE INDEX IF NOT EXISTS idx_barang_deleted_at
  ON public.barang (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_deleted_at
  ON public.vendors (deleted_at) WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Pulihkan otomatis barang terhapus yang kemasukan stok (qty <> 0).
-- Trigger level statement + transition table: import SOH meng-update ratusan
-- ribu baris stock dalam 1 statement, jadi cukup 1 UPDATE barang per statement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_deleted_barang_on_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.barang b
     SET deleted_at = NULL,
         deleted_by = NULL
   WHERE b.deleted_at IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM new_rows n WHERE n.part_id = b.id AND n.qty <> 0
     );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_restore_deleted_barang_ins ON public.stock;
CREATE TRIGGER trg_stock_restore_deleted_barang_ins
  AFTER INSERT ON public.stock
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.restore_deleted_barang_on_stock();

DROP TRIGGER IF EXISTS trg_stock_restore_deleted_barang_upd ON public.stock;
CREATE TRIGGER trg_stock_restore_deleted_barang_upd
  AFTER UPDATE ON public.stock
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.restore_deleted_barang_on_stock();

-- ---------------------------------------------------------------------------
-- /stock: sembunyikan barang terhapus.
-- Salinan definisi prod search_stock_summary (20261028100000 + SECURITY
-- DEFINER dari 20261028120000), satu-satunya perubahan: b.deleted_at IS NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_stock_summary(p_search text DEFAULT NULL::text, p_cabang_ids bigint[] DEFAULT NULL::bigint[], p_status text DEFAULT NULL::text, p_qty_from numeric DEFAULT NULL::numeric, p_qty_to numeric DEFAULT NULL::numeric, p_updated_from date DEFAULT NULL::date, p_updated_to date DEFAULT NULL::date, p_satuan text[] DEFAULT NULL::text[], p_sort text DEFAULT 'qty_desc'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(part_id bigint, part_number text, part_name text, part_satuan text, total_qty bigint, active_locations bigint, last_updated timestamp with time zone, scope_qty bigint, scope_locations bigint, negative_locations bigint, below_min_locations bigint, above_max_locations bigint, cabang_breakdown jsonb, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    WHERE b.deleted_at IS NULL
      AND
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
$function$;

REVOKE EXECUTE ON FUNCTION public.search_stock_summary(
  text, bigint[], text, numeric, numeric, date, date, text[], text, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_stock_summary(
  text, bigint[], text, numeric, numeric, date, date, text[], text, integer, integer
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Global search (top bar): barang terhapus tidak muncul.
-- Salinan 20261030100000_global_search.sql, satu-satunya perubahan:
-- b.deleted_at is null di bagian Barang. Vendor di hasil PO tetap tampil
-- (itu data dokumen).
-- ---------------------------------------------------------------------------
create or replace function public.global_search(
  p_query text,
  p_limit int default 5
)
returns table (
  kind text,         -- mr | pr | po | it | so | barang
  id text,
  title text,        -- kode dokumen / part number
  subtitle text,
  status text,
  created_at timestamptz,
  exact boolean      -- kode / part number persis sama dengan query
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_q text := left(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')), 100);
  v_limit int := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_esc text;
  v_words text[];
  v_tokens text[];   -- '%kata%' per kata, maks. 5
  v_suffix text;     -- '%/kataTerakhir' (nomor urut di akhir kode)
begin
  if auth.uid() is null or char_length(v_q) < 2 then
    return;
  end if;

  -- Escape karakter wildcard LIKE supaya "%" / "_" di query dicari apa adanya.
  v_esc := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_words := string_to_array(v_esc, ' ');
  select coalesce(array_agg('%' || w || '%' order by char_length(w) desc), array[]::text[])
    into v_tokens
    from (select distinct w from unnest(v_words) as w where w <> '' limit 5) s;
  if cardinality(v_tokens) = 0 then
    return;
  end if;
  v_suffix := '%/' || v_words[array_upper(v_words, 1)];

  -- Material Request
  return query
  select 'mr'::text, m.id::text, m.mr_kode,
         concat_ws(' · ', nullif(m.mr_pic, ''), c.nama_cabang),
         m.mr_status::text, m.created_at,
         lower(m.mr_kode) = lower(v_q)
    from public.mrs m
    left join public.cabang c on c.id = m.cabang_id
   where concat_ws(' ', m.mr_kode, m.mr_pic, m.mr_remarks) ilike all (v_tokens)
   order by lower(m.mr_kode) = lower(v_q) desc,
            m.mr_kode ilike v_suffix desc,
            m.mr_kode ilike all (v_tokens) desc,
            m.created_at desc
   limit v_limit;

  -- Purchase Request (juga cocok ke kode MR asalnya)
  return query
  select 'pr'::text, p.id::text, p.pr_kode,
         concat_ws(' · ', c.nama_cabang, m.mr_kode),
         p.pr_status::text, p.created_at,
         lower(p.pr_kode) = lower(v_q)
    from public.prs p
    left join public.cabang c on c.id = p.cabang_id
    left join public.mrs m on m.id = p.mr_id
   where concat_ws(' ', p.pr_kode, m.mr_kode) ilike all (v_tokens)
   order by lower(p.pr_kode) = lower(v_q) desc,
            p.pr_kode ilike v_suffix desc,
            p.pr_kode ilike all (v_tokens) desc,
            p.created_at desc
   limit v_limit;

  -- Purchase Order (juga cocok ke nama vendor item & referensi PR)
  return query
  with po_vendor as (
    select pi.po_id, string_agg(distinct v.vendor_name, ', ') as vendors
      from public.po_items pi
      join public.vendors v on v.id = pi.vendor_id
     group by pi.po_id
  )
  select 'po'::text, po.id::text, po.po_kode,
         concat_ws(' · ', pv.vendors, c.nama_cabang),
         po.po_status::text, po.created_at,
         lower(po.po_kode) = lower(v_q)
    from public.pos po
    left join po_vendor pv on pv.po_id = po.id
    left join public.cabang c on c.id = po.cabang_id
   where concat_ws(' ', po.po_kode, po.po_pr_referensi, pv.vendors) ilike all (v_tokens)
   order by lower(po.po_kode) = lower(v_q) desc,
            po.po_kode ilike v_suffix desc,
            po.po_kode ilike all (v_tokens) desc,
            po.created_at desc
   limit v_limit;

  -- Item Transfer
  return query
  select 'it'::text, t.id::text, t.it_kode,
         concat_ws(' → ', cf.nama_cabang, ct.nama_cabang),
         t.status::text, t.created_at,
         lower(t.it_kode) = lower(v_q)
    from public.item_transfers t
    left join public.cabang cf on cf.id = t.dari_cabang_id
    left join public.cabang ct on ct.id = t.ke_cabang_id
   where concat_ws(' ', t.it_kode, t.no_resi, t.remarks) ilike all (v_tokens)
   order by lower(t.it_kode) = lower(v_q) desc,
            t.it_kode ilike v_suffix desc,
            t.it_kode ilike all (v_tokens) desc,
            t.created_at desc
   limit v_limit;

  -- SO Reguler (juga cocok ke nama customer & nomor PO customer)
  return query
  select 'so'::text, s.id::text, s.so_kode,
         concat_ws(' · ', cu.customer_name, nullif(s.customer_po_no, '')),
         s.so_status, s.created_at,
         lower(s.so_kode) = lower(v_q)
    from public.so_reguler s
    left join public.customers cu on cu.id = s.customer_id
   where concat_ws(' ', s.so_kode, s.customer_po_no, cu.customer_name) ilike all (v_tokens)
   order by lower(s.so_kode) = lower(v_q) desc,
            s.so_kode ilike v_suffix desc,
            s.so_kode ilike all (v_tokens) desc,
            s.created_at desc
   limit v_limit;

  -- Barang
  return query
  select 'barang'::text, b.id::text, b.part_number,
         concat_ws(' · ', b.part_name, nullif(b.part_satuan, '')),
         null::text, b.created_at,
         lower(b.part_number) = lower(v_q)
    from public.barang b
   where b.deleted_at is null
     and concat_ws(' ', b.part_number, b.part_name) ilike all (v_tokens)
   order by lower(b.part_number) = lower(v_q) desc,
            b.part_number ilike all (v_tokens) desc,
            b.part_number
   limit v_limit;
end;
$$;

revoke execute on function public.global_search(text, int) from public, anon;
grant execute on function public.global_search(text, int) to authenticated;
