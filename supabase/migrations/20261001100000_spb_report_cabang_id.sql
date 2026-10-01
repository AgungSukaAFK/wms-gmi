-- Report SPB: filter by lokasi
--   v_spb_report belum membawa lokasi SPB (spb.cabang_id), jadi halaman
--   Report SPB tidak bisa difilter per lokasi seperti halaman daftar SPB.
--   Kolom cabang_id ditambahkan di PALING AKHIR supaya CREATE OR REPLACE VIEW
--   valid dan code production lama (select *) tetap jalan tanpa perubahan.
-- Idempotent: aman dijalankan ulang.

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
    s.cabang_id AS spb_cabang_id
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
