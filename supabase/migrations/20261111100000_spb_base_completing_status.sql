-- Migration: Base Status & Completing Status SPB
-- Date: 2026-11-11
-- Description:
--   Dua status turunan SPB (dihitung otomatis, TIDAK diinput manual). Kolom
--   spb_status lama tidak diubah, jadi kode production lama tetap jalan.
--
--   1. Base Status (kelengkapan data awal, "sampai PIC PPA"):
--        'Lengkap'       -> No WO, Section, PIC GMI, PIC PPA, Kode Unit,
--                           Tipe Unit terisi + minimal 1 item.
--        'Belum Lengkap' -> salah satu di atas kosong.
--      public.spb_base_missing(spb) mengembalikan label field yang masih
--      kosong (urutan tetap), dipakai untuk tooltip/list.
--
--   2. Completing Status (progres proses, tahap tertinggi yang tercapai):
--        'Cancelled'   -> spb_status = 'CANCELLED'
--        'Paid'        -> ada invoice (non-rejected) & semuanya paid
--        'Invoiced'    -> ada invoice (non-rejected)
--        'Delivered'   -> ada SPB DO
--        'PO Customer' -> ada SPB PO
--        'Quotation'   -> belum ada dokumen lanjutan
--
--   Fungsi-fungsi ini menerima row public.spb sehingga PostgREST
--   memperlakukannya sebagai computed column: bisa di-select, difilter,
--   dan di-order langsung dari tabel spb
--   (mis. select=*,spb_base_status&spb_base_status=eq.Lengkap).
--
--   Juga:
--   - v_spb_report ditambah kolom spb_base_status, spb_base_missing,
--     spb_completing_status di PALING AKHIR (CREATE OR REPLACE VIEW valid,
--     select * lama tetap jalan).
--   - RPC get_spb_status_summary(...) untuk ringkasan di Dashboard SPB,
--     filter sama dengan get_spb_dashboard_summary.
--
--   Semua lookup per SPB lewat index yang sudah ada (spb_details.spb_id,
--   spb_po.spb_id, spb_do.spb_po_id, spb_invoice.spb_do_id).
--   Tidak ada perubahan tabel. Idempotent: aman dijalankan ulang.

-- 1. Field Base Status yang masih kosong
CREATE OR REPLACE FUNCTION public.spb_base_missing(s public.spb)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN NULLIF(btrim(s.spb_no_wo), '')     IS NULL THEN 'No WO' END,
    CASE WHEN NULLIF(btrim(s.spb_section), '')   IS NULL THEN 'Section' END,
    CASE WHEN NULLIF(btrim(s.spb_pic_gmi), '')   IS NULL THEN 'PIC GMI' END,
    CASE WHEN NULLIF(btrim(s.spb_pic_ppa), '')   IS NULL THEN 'PIC PPA' END,
    CASE WHEN NULLIF(btrim(s.spb_kode_unit), '') IS NULL THEN 'Kode Unit' END,
    CASE WHEN NULLIF(btrim(s.spb_tipe_unit), '') IS NULL THEN 'Tipe Unit' END,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.spb_details sd WHERE sd.spb_id = s.id
    ) THEN 'Item' END
  ], NULL);
$$;

-- 2. Base Status
CREATE OR REPLACE FUNCTION public.spb_base_status(s public.spb)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN cardinality(public.spb_base_missing(s)) = 0 THEN 'Lengkap'
    ELSE 'Belum Lengkap'
  END;
$$;

-- 3. Completing Status
CREATE OR REPLACE FUNCTION public.spb_completing_status(s public.spb)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN s.spb_status = 'CANCELLED' THEN 'Cancelled'
    WHEN inv.n > 0 AND inv.unpaid = 0 THEN 'Paid'
    WHEN inv.n > 0 THEN 'Invoiced'
    WHEN EXISTS (
      SELECT 1
      FROM public.spb_do d
      JOIN public.spb_po p ON p.id = d.spb_po_id
      WHERE p.spb_id = s.id
    ) THEN 'Delivered'
    WHEN EXISTS (
      SELECT 1 FROM public.spb_po p WHERE p.spb_id = s.id
    ) THEN 'PO Customer'
    ELSE 'Quotation'
  END
  FROM (
    SELECT
      count(*) AS n,
      count(*) FILTER (WHERE i.payment_status IS DISTINCT FROM 'paid') AS unpaid
    FROM public.spb_invoice i
    JOIN public.spb_do d ON d.id = i.spb_do_id
    JOIN public.spb_po p ON p.id = d.spb_po_id
    WHERE p.spb_id = s.id
      AND i.approval_status IS DISTINCT FROM 'rejected'
  ) inv;
$$;

GRANT EXECUTE ON FUNCTION public.spb_base_missing(public.spb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spb_base_status(public.spb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spb_completing_status(public.spb) TO authenticated;

-- 4. v_spb_report + kolom status (ditambah di paling akhir)
CREATE OR REPLACE VIEW public.v_spb_report AS
SELECT
    s.id AS spb_id,
    s.spb_no,
    s.spb_tanggal,
    s.spb_no_wo,
    s.spb_section,
    s.spb_pic_gmi,
    s.spb_pic_ppa,
    s.spb_kode_unit,
    s.spb_tipe_unit,
    s.spb_brand,
    s.spb_hm,
    s.spb_problem_remark,
    s.spb_status,
    s.spb_gudang,
    s.created_at AS spb_created_at,
    sd.id AS spb_dtl_id,
    sd.dtl_spb_part_number,
    sd.dtl_spb_part_name,
    sd.dtl_spb_qty,
    sd.dtl_spb_part_satuan,
    po.po_no,
    po.so_no,
    po.so_date,
    po.created_at AS po_created_at,
    d.do_no,
    d.do_date,
    d.created_at AS do_created_at,
    i.invoice_no,
    i.invoice_date,
    i.invoice_email_date,
    i.created_at AS invoice_created_at,
    i.id AS invoice_id,
    i.payment_status AS invoice_payment_status,
    s.cabang_id AS spb_cabang_id,
    public.spb_base_status(s) AS spb_base_status,
    array_to_string(public.spb_base_missing(s), ', ') AS spb_base_missing,
    public.spb_completing_status(s) AS spb_completing_status
FROM public.spb s
JOIN public.spb_details sd ON sd.spb_id = s.id
LEFT JOIN public.spb_po_details pod ON pod.spb_dtl_id = sd.id
LEFT JOIN public.spb_po po ON po.id = pod.spb_po_id
LEFT JOIN public.spb_do_details dod ON dod.spb_po_dtl_id = pod.id
LEFT JOIN public.spb_do d ON d.id = dod.spb_do_id
LEFT JOIN public.spb_invoice_details idtl ON idtl.spb_do_dtl_id = dod.id
LEFT JOIN public.spb_invoice i ON i.id = idtl.spb_invoice_id
WHERE s.spb_is_deleted = FALSE;

GRANT SELECT ON public.v_spb_report TO anon, authenticated, authenticator;

-- 5. Ringkasan status untuk Dashboard SPB
--    Filter sama dengan get_spb_dashboard_summary: date_from inklusif,
--    date_to eksklusif, no_wo dicocokkan persis (case/spasi tepi diabaikan),
--    cabang_ids NULL/kosong = semua lokasi.
--    Base Status & field kosong hanya dihitung untuk SPB non-cancelled.
CREATE OR REPLACE FUNCTION public.get_spb_status_summary(
  p_cabang_ids BIGINT[] DEFAULT NULL,
  p_date_from  TIMESTAMPTZ DEFAULT NULL,
  p_date_to    TIMESTAMPTZ DEFAULT NULL,
  p_no_wo      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH st AS MATERIALIZED (
    SELECT
      sp.spb_status = 'CANCELLED' AS is_cancelled,
      public.spb_base_missing(sp) AS missing,
      public.spb_completing_status(sp) AS completing
    FROM public.spb sp
    WHERE sp.spb_is_deleted = FALSE
      AND (p_cabang_ids IS NULL OR cardinality(p_cabang_ids) = 0
           OR sp.cabang_id = ANY (p_cabang_ids))
      AND (p_date_from IS NULL OR sp.spb_tanggal >= p_date_from)
      AND (p_date_to IS NULL OR sp.spb_tanggal < p_date_to)
      AND (NULLIF(btrim(p_no_wo), '') IS NULL
           OR lower(btrim(sp.spb_no_wo)) = lower(btrim(p_no_wo)))
  ),
  missing_counts AS (
    SELECT f.field, count(*) AS n
    FROM st, unnest(st.missing) AS f(field)
    WHERE NOT st.is_cancelled
    GROUP BY f.field
  )
  SELECT jsonb_build_object(
    'base', jsonb_build_object(
      'lengkap',       (SELECT count(*) FROM st WHERE NOT is_cancelled AND cardinality(missing) = 0),
      'belum_lengkap', (SELECT count(*) FROM st WHERE NOT is_cancelled AND cardinality(missing) > 0)
    ),
    'missing', COALESCE(
      (SELECT jsonb_object_agg(field, n) FROM missing_counts),
      '{}'::jsonb
    ),
    'completing', jsonb_build_object(
      'quotation',   (SELECT count(*) FROM st WHERE completing = 'Quotation'),
      'po_customer', (SELECT count(*) FROM st WHERE completing = 'PO Customer'),
      'delivered',   (SELECT count(*) FROM st WHERE completing = 'Delivered'),
      'invoiced',    (SELECT count(*) FROM st WHERE completing = 'Invoiced'),
      'paid',        (SELECT count(*) FROM st WHERE completing = 'Paid'),
      'cancelled',   (SELECT count(*) FROM st WHERE completing = 'Cancelled')
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_spb_status_summary(BIGINT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
