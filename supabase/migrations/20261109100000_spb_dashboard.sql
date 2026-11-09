-- Migration: Dashboard SPB
-- Date: 2026-11-09
-- Description:
--   Dua RPC read-only untuk halaman /spb/dashboard:
--
--   1. get_spb_dashboard_summary(cabang_ids, date_from, date_to, no_wo)
--      Ringkasan jumlah dokumen: SPB (total + per status + progress
--      PO/DO/Invoice), SPB PO, SPB DO, SPB Invoice (per approval & payment),
--      Return SPB (per approval), dan total qty item sudah/belum PO.
--
--   2. get_spb_wo_items(no_wo, cabang_ids, date_from, date_to)
--      Daftar item SPB untuk satu nomor WO (spb.spb_no_wo) beserta qty yang
--      sudah / belum dibuatkan PO dan nomor PO/DO/Invoice-nya.
--
--   Catatan qty PO: spb_po_details tidak menyimpan qty -- satu item SPB
--   masuk ke PO secara utuh. Jadi qty_po = dtl_spb_qty kalau item sudah
--   tertaut ke minimal satu SPB PO, selain itu 0.
--
--   Filter yang sama dipakai keduanya:
--     - SPB yang di-soft-delete (spb_is_deleted) selalu diabaikan.
--     - date_from inklusif, date_to EKSKLUSIF (terhadap spb_tanggal).
--     - no_wo dicocokkan persis, tidak peka huruf besar/kecil & spasi tepi.
--     - cabang_ids NULL / kosong = semua lokasi.
--
--   SECURITY INVOKER: RLS tabel SPB tetap berlaku (policy authenticated).
--   Tidak ada perubahan tabel. Idempotent: aman dijalankan ulang.

-- Index bantu untuk filter No WO (dicocokkan lewat lower(btrim(...))).
CREATE INDEX IF NOT EXISTS idx_spb_no_wo_norm
  ON public.spb (lower(btrim(spb_no_wo)))
  WHERE spb_is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_spb_po_details_spb_dtl_id
  ON public.spb_po_details (spb_dtl_id);

-- 1. Ringkasan dashboard
CREATE OR REPLACE FUNCTION public.get_spb_dashboard_summary(
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
  WITH s AS (
    SELECT sp.id, sp.spb_status
    FROM public.spb sp
    WHERE sp.spb_is_deleted = FALSE
      AND (p_cabang_ids IS NULL OR cardinality(p_cabang_ids) = 0
           OR sp.cabang_id = ANY (p_cabang_ids))
      AND (p_date_from IS NULL OR sp.spb_tanggal >= p_date_from)
      AND (p_date_to IS NULL OR sp.spb_tanggal < p_date_to)
      AND (NULLIF(btrim(p_no_wo), '') IS NULL
           OR lower(btrim(sp.spb_no_wo)) = lower(btrim(p_no_wo)))
  ),
  po AS (
    SELECT p.id, p.spb_id
    FROM public.spb_po p
    JOIN s ON s.id = p.spb_id
  ),
  dlv AS (
    SELECT d.id, po.spb_id
    FROM public.spb_do d
    JOIN po ON po.id = d.spb_po_id
  ),
  inv AS (
    SELECT i.id, i.approval_status, i.payment_status, dlv.spb_id
    FROM public.spb_invoice i
    JOIN dlv ON dlv.id = i.spb_do_id
  ),
  rtn AS (
    SELECT r.id, r.approval_status
    FROM public.return_spb r
    JOIN s ON s.id = r.spb_id
  ),
  prog AS (
    SELECT
      s.id,
      s.spb_status,
      EXISTS (SELECT 1 FROM po  WHERE po.spb_id  = s.id) AS has_po,
      EXISTS (SELECT 1 FROM dlv WHERE dlv.spb_id = s.id) AS has_do,
      EXISTS (SELECT 1 FROM inv WHERE inv.spb_id = s.id) AS has_inv
    FROM s
  ),
  items AS (
    SELECT
      sd.dtl_spb_qty,
      EXISTS (
        SELECT 1 FROM public.spb_po_details pod WHERE pod.spb_dtl_id = sd.id
      ) AS has_po
    FROM public.spb_details sd
    JOIN s ON s.id = sd.spb_id
    WHERE s.spb_status <> 'CANCELLED'
  )
  SELECT jsonb_build_object(
    'spb_total', (SELECT count(*) FROM s),
    'by_status', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object('status', x.spb_status, 'count', x.c)
               ORDER BY x.c DESC, x.spb_status
             )
      FROM (SELECT spb_status, count(*) AS c FROM s GROUP BY spb_status) x
    ), '[]'::jsonb),
    'progress', (
      SELECT jsonb_build_object(
        'belum_po',         count(*) FILTER (WHERE spb_status <> 'CANCELLED' AND NOT has_po),
        'po_belum_do',      count(*) FILTER (WHERE spb_status <> 'CANCELLED' AND has_po AND NOT has_do),
        'do_belum_invoice', count(*) FILTER (WHERE spb_status <> 'CANCELLED' AND has_do AND NOT has_inv),
        'sudah_invoice',    count(*) FILTER (WHERE spb_status <> 'CANCELLED' AND has_inv),
        'cancelled',        count(*) FILTER (WHERE spb_status = 'CANCELLED')
      )
      FROM prog
    ),
    'po_total', (SELECT count(*) FROM po),
    'do_total', (SELECT count(*) FROM dlv),
    'invoice', (
      SELECT jsonb_build_object(
        'total',     count(*),
        'open',      count(*) FILTER (WHERE approval_status = 'open'),
        'completed', count(*) FILTER (WHERE approval_status = 'completed'),
        'rejected',  count(*) FILTER (WHERE approval_status = 'rejected'),
        'paid',      count(*) FILTER (WHERE payment_status = 'paid'),
        'unpaid',    count(*) FILTER (WHERE payment_status = 'unpaid')
      )
      FROM inv
    ),
    'return', (
      SELECT jsonb_build_object(
        'total',     count(*),
        'open',      count(*) FILTER (WHERE approval_status = 'open'),
        'completed', count(*) FILTER (WHERE approval_status = 'completed'),
        'rejected',  count(*) FILTER (WHERE approval_status = 'rejected')
      )
      FROM rtn
    ),
    'items', (
      SELECT jsonb_build_object(
        'total',        count(*),
        'qty_total',    COALESCE(sum(dtl_spb_qty), 0),
        'qty_po',       COALESCE(sum(dtl_spb_qty) FILTER (WHERE has_po), 0),
        'qty_belum_po', COALESCE(sum(dtl_spb_qty) FILTER (WHERE NOT has_po), 0),
        'item_belum_po', count(*) FILTER (WHERE NOT has_po)
      )
      FROM items
    )
  );
$$;

-- 2. Item per nomor WO
CREATE OR REPLACE FUNCTION public.get_spb_wo_items(
  p_no_wo      TEXT,
  p_cabang_ids BIGINT[] DEFAULT NULL,
  p_date_from  TIMESTAMPTZ DEFAULT NULL,
  p_date_to    TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  spb_id        BIGINT,
  spb_no        TEXT,
  spb_no_wo     TEXT,
  spb_tanggal   TIMESTAMPTZ,
  spb_status    TEXT,
  spb_kode_unit TEXT,
  nama_cabang   TEXT,
  spb_dtl_id    BIGINT,
  part_number   TEXT,
  part_name     TEXT,
  satuan        TEXT,
  qty           INTEGER,
  qty_returned  INTEGER,
  qty_po        INTEGER,
  qty_belum_po  INTEGER,
  po_nos        TEXT,
  do_nos        TEXT,
  invoice_nos   TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    sp.id,
    sp.spb_no,
    sp.spb_no_wo,
    sp.spb_tanggal,
    sp.spb_status,
    sp.spb_kode_unit,
    c.nama_cabang,
    sd.id,
    sd.dtl_spb_part_number,
    sd.dtl_spb_part_name,
    sd.dtl_spb_part_satuan,
    sd.dtl_spb_qty,
    sd.dtl_spb_qty_returned,
    CASE WHEN links.po_nos IS NOT NULL THEN sd.dtl_spb_qty ELSE 0 END,
    CASE WHEN links.po_nos IS NOT NULL THEN 0 ELSE sd.dtl_spb_qty END,
    links.po_nos,
    links.do_nos,
    links.invoice_nos
  FROM public.spb sp
  JOIN public.spb_details sd ON sd.spb_id = sp.id
  LEFT JOIN public.cabang c ON c.id = sp.cabang_id
  LEFT JOIN LATERAL (
    SELECT
      string_agg(DISTINCT p.po_no, ', ')      AS po_nos,
      string_agg(DISTINCT d.do_no, ', ')      AS do_nos,
      string_agg(DISTINCT i.invoice_no, ', ') AS invoice_nos
    FROM public.spb_po_details pod
    JOIN public.spb_po p ON p.id = pod.spb_po_id
    LEFT JOIN public.spb_do_details dod ON dod.spb_po_dtl_id = pod.id
    LEFT JOIN public.spb_do d ON d.id = dod.spb_do_id
    LEFT JOIN public.spb_invoice_details idt ON idt.spb_do_dtl_id = dod.id
    LEFT JOIN public.spb_invoice i ON i.id = idt.spb_invoice_id
    WHERE pod.spb_dtl_id = sd.id
  ) links ON TRUE
  WHERE sp.spb_is_deleted = FALSE
    AND sp.spb_status <> 'CANCELLED'
    AND NULLIF(btrim(p_no_wo), '') IS NOT NULL
    AND lower(btrim(sp.spb_no_wo)) = lower(btrim(p_no_wo))
    AND (p_cabang_ids IS NULL OR cardinality(p_cabang_ids) = 0
         OR sp.cabang_id = ANY (p_cabang_ids))
    AND (p_date_from IS NULL OR sp.spb_tanggal >= p_date_from)
    AND (p_date_to IS NULL OR sp.spb_tanggal < p_date_to)
  ORDER BY sp.spb_tanggal, sp.spb_no, sd.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_spb_dashboard_summary(BIGINT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_spb_wo_items(TEXT, BIGINT[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
