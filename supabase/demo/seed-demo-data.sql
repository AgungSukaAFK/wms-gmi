-- =============================================================================
-- DATA DEMO (LOKAL SAJA) — JANGAN dijalankan di Supabase VPS / production.
-- =============================================================================
-- Isi: stok + rantai dokumen MR -> PR -> PO -> RI -> Item Transfer, plus SPB,
-- dalam berbagai status. Semua langkah approval yang masih "pending" ada di
-- akun moderator@demo.com, jadi demo bisa dijalankan dari satu akun saja.
--
-- Idempotent: setiap run menghapus dulu data demo lama (dikenali dari pola
-- kode dokumen di bawah), lalu membangun ulang. Data lain tidak disentuh.
--   MR-<KODE>-<YYMM>-<NNN>   PR-<KODE>-<YYMM>-<NNN>   PO-GMI-<YYMM>-<NNN>
--   RI-<KODE>-<YYMM>-<NNN>   IT-<KODE>-<YYMM>-<NNN>   SPB-<KODE>-<YYMM>-<NNN>
--
-- Jalankan:
--   psql postgresql://postgres:postgres@127.0.0.1:54332/postgres \
--     -v ON_ERROR_STOP=1 -f supabase/demo/seed-demo-data.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Bersihkan data demo lama
-- ---------------------------------------------------------------------------
DELETE FROM public.notifications WHERE metadata->>'seed' = 'demo';

DELETE FROM public.stock_movements
WHERE reference_id ~ '^(RI|IT|SPB)-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$';

DELETE FROM public.item_transfer_items WHERE it_id IN
  (SELECT id FROM public.item_transfers WHERE it_kode ~ '^IT-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$');
DELETE FROM public.item_transfers WHERE it_kode ~ '^IT-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$';

DELETE FROM public.receive_items WHERE ri_id IN
  (SELECT id FROM public.receives WHERE ri_kode ~ '^RI-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$');
DELETE FROM public.receives WHERE ri_kode ~ '^RI-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$';

DELETE FROM public.po_item_pr_links WHERE po_item_id IN
  (SELECT pi.id FROM public.po_items pi JOIN public.pos p ON p.id = pi.po_id
   WHERE p.po_kode ~ '^PO-GMI-26[0-9]{2}-[0-9]{3}$');
DELETE FROM public.po_items WHERE po_id IN
  (SELECT id FROM public.pos WHERE po_kode ~ '^PO-GMI-26[0-9]{2}-[0-9]{3}$');
DELETE FROM public.pos WHERE po_kode ~ '^PO-GMI-26[0-9]{2}-[0-9]{3}$';

DELETE FROM public.pr_items WHERE pr_id IN
  (SELECT id FROM public.prs WHERE pr_kode ~ '^PR-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$');
DELETE FROM public.prs WHERE pr_kode ~ '^PR-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$';

DELETE FROM public.mr_sharestock_allocations WHERE mr_item_id IN
  (SELECT mi.id FROM public.mr_items mi JOIN public.mrs m ON m.id = mi.mr_id
   WHERE m.mr_kode ~ '^MR-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$');
DELETE FROM public.mr_items WHERE mr_id IN
  (SELECT id FROM public.mrs WHERE mr_kode ~ '^MR-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$');
DELETE FROM public.mrs WHERE mr_kode ~ '^MR-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$';

DELETE FROM public.spb_details WHERE spb_id IN
  (SELECT id FROM public.spb WHERE spb_no ~ '^SPB-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$');
DELETE FROM public.spb WHERE spb_no ~ '^SPB-[A-Z0-9]+-26[0-9]{2}-[0-9]{3}$';

-- ---------------------------------------------------------------------------
-- 1. Helper (pg_temp: hilang otomatis setelah sesi selesai)
-- ---------------------------------------------------------------------------

-- Snapshot profil untuk approvals[].snapshot
CREATE OR REPLACE FUNCTION pg_temp.prof(uid uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $f$
  SELECT jsonb_build_object('id', p.id, 'nama', p.nama, 'email', p.email,
                            'lokasi', coalesce(c.nama_cabang, ''))
  FROM public.profiles p LEFT JOIN public.cabang c ON c.id = p.cabang_id
  WHERE p.id = uid
$f$;

-- URL tanda tangan: hanya moderator yang punya signature di DB lokal.
CREATE OR REPLACE FUNCTION pg_temp.sig(uid uuid) RETURNS text
LANGUAGE sql STABLE AS $f$
  SELECT image_url FROM public.user_signatures
  WHERE user_id = uid AND NOT is_hidden ORDER BY created_at LIMIT 1
$f$;

-- Bangun approvals 2 langkah (Requester -> Moderator) dengan bentuk JSON
-- yang sama persis dengan yang dibuat aplikasi:
--   'mr'  : MR & Item Transfer (create page client-side: step_id/user_id/role)
--   'pr'  : PR & PO (create page: type/userid/level angka)
--   'ri'  : Receive Item (_buildApprovalFlow: + approval_role)
--   'spb' : SPB (buildStockOutApprovalFlow: + approval_role + position)
CREATE OR REPLACE FUNCTION pg_temp.appr(
  shape text, tpl_type text, req uuid, mod uuid,
  s1 text, s2 text, t1 timestamptz, t2 timestamptz, note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $f$
DECLARE
  pr jsonb := pg_temp.prof(req);
  pm jsonb := pg_temp.prof(mod);
  ids bigint[];
  a1 jsonb; a2 jsonb;
BEGIN
  SELECT array_agg(s.id ORDER BY s.step_order) INTO ids
  FROM public.approval_template_steps s
  JOIN public.approval_templates t ON t.id = s.template_id
  WHERE t.type = tpl_type AND t.cabang_id IS NULL;

  IF shape = 'mr' THEN
    a1 := jsonb_build_object(
      'step_id', ids[1], 'step_order', 1, 'level', 'menyetujui', 'status', s1,
      'user_id', req, 'nama', pr->>'nama', 'email', pr->>'email', 'role', 'Requester',
      'processed_at', CASE WHEN s1 <> 'pending' THEN t1 END,
      'signature_url', CASE WHEN s1 = 'approved' THEN pg_temp.sig(req) END,
      'snapshot', CASE WHEN s1 <> 'pending' THEN jsonb_build_object(
        'nama', pr->>'nama', 'email', pr->>'email', 'lokasi', pr->>'lokasi', 'role', 'Requester') END);
    a2 := jsonb_build_object(
      'step_id', ids[2], 'step_order', 2, 'level', 'menyetujui', 'status', s2,
      'user_id', mod, 'nama', pm->>'nama', 'email', pm->>'email', 'role', 'Approver',
      'processed_at', CASE WHEN s2 <> 'pending' THEN t2 END,
      'signature_url', CASE WHEN s2 = 'approved' THEN pg_temp.sig(mod) END,
      'notes', note,
      'snapshot', CASE WHEN s2 <> 'pending' THEN jsonb_build_object(
        'nama', pm->>'nama', 'email', pm->>'email', 'lokasi', pm->>'lokasi') END);
  ELSE
    a1 := jsonb_build_object(
      'type', 'Requester', 'status', s1, 'userid', req,
      'nama', pr->>'nama', 'email', pr->>'email', 'level', 1,
      'processed_at', CASE WHEN s1 <> 'pending' THEN t1 END,
      'signature_url', CASE WHEN s1 = 'approved' THEN pg_temp.sig(req) END,
      'notes', NULL,
      'snapshot', CASE WHEN s1 <> 'pending' THEN jsonb_build_object(
        'nama', pr->>'nama', 'email', pr->>'email', 'lokasi', pr->>'lokasi') END);
    a2 := jsonb_build_object(
      'type', pm->>'nama', 'status', s2, 'userid', mod,
      'nama', pm->>'nama', 'email', pm->>'email', 'level', 2,
      'processed_at', CASE WHEN s2 <> 'pending' THEN t2 END,
      'signature_url', CASE WHEN s2 = 'approved' THEN pg_temp.sig(mod) END,
      'notes', note,
      'snapshot', CASE WHEN s2 <> 'pending' THEN jsonb_build_object(
        'nama', pm->>'nama', 'email', pm->>'email', 'lokasi', pm->>'lokasi') END);
    IF shape IN ('ri', 'spb') THEN
      a1 := a1 || jsonb_build_object('approval_role', 'menyetujui');
      a2 := a2 || jsonb_build_object('approval_role', 'menyetujui');
    END IF;
    IF shape = 'spb' THEN
      a1 := a1 || jsonb_build_object('position', NULL);
      a2 := a2 || jsonb_build_object('position', NULL);
    END IF;
  END IF;
  RETURN jsonb_build_array(a1, a2);
END
$f$;

-- Mutasi stok + catat stock_movements (stok tidak boleh minus).
CREATE OR REPLACE FUNCTION pg_temp.mv(
  p_part bigint, p_cab bigint, p_delta int, p_type text, p_ref text,
  p_notes text, p_ts timestamptz, p_by uuid
) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.stock (part_id, cabang_id, qty)
  VALUES (p_part, p_cab, greatest(p_delta, 0))
  ON CONFLICT (part_id, cabang_id)
  DO UPDATE SET qty = greatest(public.stock.qty + p_delta, 0);
  INSERT INTO public.stock_movements
    (part_id, cabang_id, qty_change, type, reference_id, notes, created_by, created_at)
  VALUES (p_part, p_cab, p_delta, p_type, p_ref, p_notes, p_by, p_ts);
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.notify(
  p_user uuid, p_actor uuid, p_doc_type text, p_doc_id bigint, p_no text,
  p_url text, p_ts timestamptz
) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.notifications
    (user_id, actor_id, type, title, message, document_type, document_id,
     document_url, is_read, metadata, created_at)
  VALUES (p_user, p_actor, 'approval_needed', 'Perlu persetujuan: ' || p_doc_type,
          'Dokumen ' || p_no || ' memerlukan persetujuan Anda sebagai penyetuju.',
          p_doc_type, p_doc_id, p_url, false,
          jsonb_build_object('level', 2, 'document_number', p_no, 'seed', 'demo'),
          p_ts)
$f$;

-- ---------------------------------------------------------------------------
-- 2. Generator utama
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_today   date := DATE '2026-10-06';
  v_mod     uuid := (SELECT id FROM public.profiles WHERE email = 'moderator@demo.com');
  v_purch   uuid := (SELECT id FROM public.profiles WHERE email = 'purchasing@demo.com');
  v_mod_sig uuid := (SELECT id FROM public.user_signatures
                     WHERE user_id = (SELECT id FROM public.profiles WHERE email = 'moderator@demo.com')
                     ORDER BY created_at LIMIT 1);
  v_ho      bigint := (SELECT id FROM public.cabang WHERE nama_cabang = 'GMI-HO');
  v_jkt     bigint := (SELECT id FROM public.cabang WHERE nama_cabang = 'GMI-JAKARTA');

  -- Peminta MR (urutan dipakai acak). Cabang = cabang profil masing-masing.
  v_reqs    uuid[] := ARRAY(
    SELECT id FROM public.profiles
    WHERE email IN ('moderator@demo.com','ppic@demo.com','pjo@demo.com','spv@demo.com',
                    'logistik@demo.com','service@demo.com','manufaktur@demo.com',
                    'admin@demo.com','gl@demo.com')
    ORDER BY email);
  v_ho_reqs uuid[] := ARRAY(
    SELECT id FROM public.profiles
    WHERE email IN ('moderator@demo.com','admin@demo.com','gl@demo.com') ORDER BY email);
  v_stock_cabs bigint[];

  -- Skenario per MR (urut dari yang paling "muda" ke paling tua).
  v_scen text[] := ARRAY[]::text[];
  v_age_min int; v_age_max int;

  v_kategori text[] := ARRAY['New Item','Replace Item','Fix & Repair','Upgrade'];
  v_remarks text[] := ARRAY[
    'Kebutuhan PM 500 jam unit HD785', 'Penggantian part rusak di workshop',
    'Stok safety untuk shift malam', 'Perbaikan sistem kelistrikan dump truck',
    'Kebutuhan project instalasi lampu area pit', 'Restock consumable gudang',
    'Penggantian komponen unit PC2000 breakdown', 'Upgrade lampu kerja ke LED',
    'Kebutuhan overhaul genset site', 'Persiapan audit K3 — perlengkapan safety'];
  v_reject_notes text[] := ARRAY[
    'Qty terlalu besar, stok gudang masih cukup untuk 2 bulan.',
    'Part number salah, mohon cek ulang ke katalog.',
    'Belum ada budget di bulan ini, ajukan ulang bulan depan.'];
  v_ekspedisi text[] := ARRAY['Indah Cargo','Dakota Cargo','JNE Trucking','Lion Parcel','Wahana Express'];
  v_terms text[] := ARRAY['30 Hari','14 Hari','COD','45 Hari','DP 50%'];
  v_prio text[] := ARRAY['P1','P2','P2','P3','P3','P3','P4'];

  i int; j int; n int;
  sc text;
  v_req uuid; v_req_prof jsonb; v_cab bigint; v_cab_kode text;
  v_tgl date; v_due date; v_ts timestamptz;
  v_mr_id bigint; v_mr_kode text; v_mr_status text;
  v_pr_id bigint; v_pr_kode text; v_pr_by uuid; v_pr_ts timestamptz;
  v_po_id bigint; v_po_kode text; v_po_by uuid; v_po_ts timestamptz; v_vendor bigint;
  v_ri_id bigint; v_ri_kode text; v_ri_ts timestamptz; v_recv_cab bigint; v_recv_kode text;
  v_it_id bigint; v_it_kode text; v_it_ts timestamptz; v_it_state text; v_ship text;
  v_seq_mr int := 0; v_seq_pr int := 0; v_seq_po int := 0; v_seq_ri int := 0;
  v_seq_it int := 0; v_seq_spb int := 0;
  v_ss int; v_src bigint; v_qty int; v_partial boolean;
  r record; it record;
  v_scen_idx int := 0;
BEGIN
  PERFORM setseed(0.4242);

  IF v_mod IS NULL OR v_jkt IS NULL OR v_ho IS NULL THEN
    RAISE EXCEPTION 'moderator@demo.com / GMI-HO / GMI-JAKARTA tidak ditemukan';
  END IF;

  -- -------------------------------------------------------------------------
  -- 2a. Pilih 70 barang demo (deterministik) + set stok awal
  -- -------------------------------------------------------------------------
  DROP TABLE IF EXISTS demo_parts;
  CREATE TEMP TABLE demo_parts AS
  SELECT row_number() OVER (ORDER BY md5(b.part_number)) AS rn,
         b.id, b.part_number, b.part_name, b.part_satuan
  FROM public.barang b
  WHERE b.part_name ~* '(filter|bearing|battery|baterai|hose|seal|bolt|cable|kabel|lampu|lamp|relay|sensor|belt|fuse|switch|led|connector|terminal|gasket|o-ring)'
    AND length(b.part_name) BETWEEN 8 AND 45
    -- jangan ganggu barang yang sudah punya stok/kebijakan min-max asli di
    -- DB lokal (daftar tetap, BUKAN cek stok > 0 — kalau dicek dinamis, run
    -- kedua akan memilih barang lain karena stok run pertama sudah terisi)
    AND b.part_number NOT IN ('0 332 019 203', '0462-201-16141', '0462-203-12141',
                              '10L-0002', '10L-0003', '11L-3705-BP')
  ORDER BY md5(b.part_number)
  LIMIT 70;

  v_stock_cabs := ARRAY(SELECT DISTINCT cabang_id FROM (
                    SELECT cabang_id FROM public.profiles WHERE cabang_id IS NOT NULL
                    UNION SELECT v_jkt) x ORDER BY 1);

  -- Stok awal "hasil import SOH". HO dibuat longgar (max >> qty) supaya
  -- moderator bisa langsung bikin MR baru saat demo.
  INSERT INTO public.stock (part_id, cabang_id, qty, min_qty, max_qty)
  SELECT p.id, c.cab,
    CASE WHEN c.cab = v_ho THEN 4 + floor(random() * 12)::int
         WHEN c.cab = v_jkt THEN floor(random() * 6)::int
         WHEN random() < 0.35 THEN 0
         ELSE 3 + floor(random() * 20)::int END,
    2 + floor(random() * 4)::int,
    CASE WHEN c.cab = v_ho THEN 40 + floor(random() * 21)::int
         ELSE 30 + floor(random() * 21)::int END
  FROM demo_parts p CROSS JOIN unnest(v_stock_cabs) AS c(cab)
  ON CONFLICT (part_id, cabang_id)
  DO UPDATE SET qty = EXCLUDED.qty, min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty;

  -- -------------------------------------------------------------------------
  -- 2b. Daftar skenario MR
  -- -------------------------------------------------------------------------
  v_scen := v_scen
    || array_fill('open'::text,            ARRAY[12])  -- menunggu approval moderator
    || array_fill('appr_noPR'::text,       ARRAY[8])   -- approved, siap dibuat PR
    || array_fill('rejected'::text,        ARRAY[3])
    || array_fill('PR_open'::text,         ARRAY[5])   -- PR menunggu approval moderator
    || array_fill('PR_rejected'::text,     ARRAY[2])
    || array_fill('PR_partial'::text,      ARRAY[4])   -- PR baru sebagian item
    || array_fill('PR_noPO'::text,         ARRAY[4])   -- PR approved, siap dibuat PO
    || array_fill('PO_open'::text,         ARRAY[5])   -- PO menunggu approval moderator
    || array_fill('PO_rejected'::text,     ARRAY[1])
    || array_fill('frozen'::text,          ARRAY[1])
    || array_fill('PO_appr'::text,         ARRAY[3])   -- PO approved, belum ada RI
    || array_fill('RI_open'::text,         ARRAY[3])   -- RI menunggu approval moderator
    || array_fill('RI_partial'::text,      ARRAY[2])
    || array_fill('IT_flow'::text,         ARRAY[4])   -- RI selesai, IT open/packing/transit
    || array_fill('IT_delivered'::text,    ARRAY[2])   -- IT sampai di HO, tinggal finalize
    || array_fill('completed'::text,       ARRAY[6]);

  FOR i IN 1 .. array_length(v_scen, 1) LOOP
    sc := v_scen[i];

    -- umur dokumen (hari sebelum hari ini) per skenario
    SELECT a, b INTO v_age_min, v_age_max FROM (VALUES
      ('open',1,8), ('appr_noPR',2,10), ('rejected',5,25), ('PR_open',6,13),
      ('PR_rejected',8,16), ('PR_partial',9,18), ('PR_noPO',9,18),
      ('PO_open',13,21), ('PO_rejected',14,22), ('frozen',30,30), ('PO_appr',18,26),
      ('RI_open',24,32), ('RI_partial',27,35), ('IT_flow',31,40),
      ('IT_delivered',35,42), ('completed',44,62)
    ) s(k, a, b) WHERE k = sc;

    v_tgl := v_today - (v_age_min + floor(random() * (v_age_max - v_age_min + 1)))::int;

    IF sc = 'IT_delivered' THEN
      v_req := v_ho_reqs[1 + floor(random() * array_length(v_ho_reqs, 1))::int];
    ELSE
      v_req := v_reqs[1 + floor(random() * array_length(v_reqs, 1))::int];
    END IF;
    v_req_prof := pg_temp.prof(v_req);
    SELECT p.cabang_id, c.kode_cabang INTO v_cab, v_cab_kode
    FROM public.profiles p JOIN public.cabang c ON c.id = p.cabang_id WHERE p.id = v_req;

    IF sc = 'frozen' THEN
      v_due := v_today - 6;
    ELSIF sc = 'appr_noPR' THEN
      v_due := greatest(v_tgl + 21 + floor(random() * 14)::int, v_today + 10);
    ELSE
      v_due := v_tgl + 14 + floor(random() * 17)::int;
    END IF;

    v_ts := v_tgl + time '08:30' + (floor(random() * 480) || ' minutes')::interval;
    v_seq_mr := v_seq_mr + 1;
    v_mr_kode := format('MR-%s-%s-%s', v_cab_kode, to_char(v_tgl, 'YYMM'), lpad(v_seq_mr::text, 3, '0'));

    v_mr_status := CASE sc WHEN 'open' THEN 'open' WHEN 'rejected' THEN 'rejected'
                           WHEN 'completed' THEN 'completed' ELSE 'approved' END;

    INSERT INTO public.mrs
      (mr_kode, cabang_id, mr_pic, mr_pic_id, mr_tanggal, mr_due_date, mr_status,
       kategori, mr_remarks, approvals, rejection_reason, mr_type,
       is_frozen, frozen_at, frozen_reason, created_at, updated_at)
    VALUES
      (v_mr_kode, v_cab, v_req_prof->>'nama', v_req, v_tgl, v_due, v_mr_status::doc_status,
       v_kategori[1 + floor(random() * 4)::int],
       v_remarks[1 + floor(random() * array_length(v_remarks, 1))::int],
       pg_temp.appr('mr', 'Material Request', v_req, v_mod, 'approved',
         CASE sc WHEN 'open' THEN 'pending' WHEN 'rejected' THEN 'rejected' ELSE 'approved' END,
         v_ts, v_ts + interval '1 day 2 hours',
         CASE WHEN sc = 'rejected' THEN v_reject_notes[1 + floor(random() * 3)::int] END),
       NULL, 'standard',
       sc = 'frozen',
       CASE WHEN sc = 'frozen' THEN v_due + time '00:05' END,
       CASE WHEN sc = 'frozen' THEN format(
         'Freeze otomatis: MR melewati due date (%s) dengan 1 item share stock yang belum ada delivery.', v_due) END,
       v_ts, v_ts)
    RETURNING id INTO v_mr_id;

    IF sc = 'rejected' THEN
      UPDATE public.mrs SET rejection_reason = approvals->1->>'notes' WHERE id = v_mr_id;
    END IF;

    -- Item MR: 2..6 barang unik
    n := 2 + floor(random() * 5)::int;
    INSERT INTO public.mr_items
      (mr_id, part_id, part_number, part_name, satuan, qty_request, qty_pr,
       qty_sharestock_total, item_priority, item_due_date, item_site_cabang_id,
       remarks, created_at, updated_at)
    SELECT v_mr_id, p.id, p.part_number, p.part_name, p.part_satuan,
           p.qty,
           CASE WHEN sc IN ('open','rejected') THEN 0 ELSE p.qty END,
           0,
           v_prio[1 + floor(random() * array_length(v_prio, 1))::int],
           v_due, v_cab,
           CASE WHEN random() < 0.2 THEN 'Urgent, unit standby' END,
           v_ts, v_ts
    FROM (SELECT d.*, 1 + floor(random() * 10)::int AS qty
          FROM (SELECT * FROM demo_parts ORDER BY random() LIMIT n) d) p;

    -- Alokasi share stock (diputuskan approver terakhir) untuk sebagian item
    -- MR approved-tanpa-PR & MR frozen. Item pertama selalu tetap via PR.
    IF sc IN ('appr_noPR', 'frozen') THEN
      FOR r IN SELECT mi.* FROM public.mr_items mi WHERE mi.mr_id = v_mr_id ORDER BY mi.id OFFSET 1 LOOP
        CONTINUE WHEN sc = 'appr_noPR' AND random() > 0.5;
        SELECT s.cabang_id, s.qty INTO v_src, v_ss
        FROM public.stock s
        WHERE s.part_id = r.part_id AND s.cabang_id <> v_cab AND s.qty > 0
          AND s.cabang_id = ANY (v_stock_cabs)
        ORDER BY s.qty DESC LIMIT 1;
        CONTINUE WHEN v_src IS NULL;
        v_ss := least(v_ss, r.qty_request);
        INSERT INTO public.mr_sharestock_allocations (mr_item_id, source_cabang_id, qty, deadline, created_at)
        VALUES (r.id, v_src, v_ss, v_due - 3, v_ts + interval '1 day 2 hours');
        UPDATE public.mr_items SET qty_sharestock_total = v_ss, qty_pr = r.qty_request - v_ss
        WHERE id = r.id;
        EXIT WHEN sc = 'frozen';
      END LOOP;
    END IF;

    IF sc = 'open' THEN
      PERFORM pg_temp.notify(v_mod, v_req, 'MR', v_mr_id, v_mr_kode, '/mr/' || v_mr_id, v_ts);
    END IF;

    CONTINUE WHEN sc IN ('open', 'rejected', 'appr_noPR', 'frozen');

    -- -----------------------------------------------------------------------
    -- PR (dibuat purchasing / moderator dari MR ini)
    -- -----------------------------------------------------------------------
    v_pr_by := CASE WHEN random() < 0.5 THEN v_mod ELSE v_purch END;
    v_pr_ts := v_ts + interval '2 days' + (floor(random() * 300) || ' minutes')::interval;
    v_seq_pr := v_seq_pr + 1;
    v_pr_kode := format('PR-%s-%s-%s', v_cab_kode, to_char(v_pr_ts, 'YYMM'), lpad(v_seq_pr::text, 3, '0'));

    INSERT INTO public.prs
      (pr_kode, cabang_id, pr_pic_id, pr_tanggal, pr_status, approvals, mr_id, created_at, updated_at)
    VALUES
      (v_pr_kode, v_cab, v_pr_by, v_pr_ts::date,
       (CASE sc WHEN 'PR_open' THEN 'open' WHEN 'PR_rejected' THEN 'rejected' ELSE 'approved' END)::doc_status,
       pg_temp.appr('pr', 'Purchase Request', v_pr_by, v_mod, 'approved',
         CASE sc WHEN 'PR_open' THEN 'pending' WHEN 'PR_rejected' THEN 'rejected' ELSE 'approved' END,
         v_pr_ts, v_pr_ts + interval '20 hours',
         CASE WHEN sc = 'PR_rejected' THEN 'Gabungkan dengan PR lain di vendor yang sama.' END),
       v_mr_id, v_pr_ts, v_pr_ts)
    RETURNING id INTO v_pr_id;

    v_partial := sc = 'PR_partial';
    INSERT INTO public.pr_items
      (pr_id, mr_id, mr_item_id, part_id, part_number, part_name, satuan, qty, status, created_at, updated_at)
    SELECT v_pr_id, v_mr_id, mi.id, mi.part_id, mi.part_number, mi.part_name, mi.satuan, mi.qty_pr,
           (CASE sc WHEN 'PR_open' THEN 'open' WHEN 'PR_rejected' THEN 'rejected' ELSE 'approved' END)::doc_status,
           v_pr_ts, v_pr_ts
    FROM (SELECT mi.*, row_number() OVER (ORDER BY mi.id) rn, count(*) OVER () cnt
          FROM public.mr_items mi WHERE mi.mr_id = v_mr_id AND mi.qty_pr > 0) mi
    WHERE NOT v_partial OR mi.rn <= ceil(mi.cnt / 2.0);

    UPDATE public.mrs SET mr_convert_status =
      CASE WHEN sc = 'PR_rejected' THEN 'pending' WHEN v_partial THEN 'partial' ELSE 'complete' END
    WHERE id = v_mr_id;

    IF sc = 'PR_open' THEN
      PERFORM pg_temp.notify(v_mod, v_pr_by, 'PR', v_pr_id, v_pr_kode, '/pr/' || v_pr_id, v_pr_ts);
    END IF;

    CONTINUE WHEN sc IN ('PR_open', 'PR_rejected', 'PR_partial', 'PR_noPO');

    -- -----------------------------------------------------------------------
    -- PO (satu vendor per dokumen)
    -- -----------------------------------------------------------------------
    v_po_by := CASE WHEN random() < 0.5 THEN v_mod ELSE v_purch END;
    v_po_ts := v_pr_ts + interval '3 days' + (floor(random() * 300) || ' minutes')::interval;
    v_vendor := (SELECT id FROM public.vendors WHERE is_active ORDER BY random() LIMIT 1);
    v_seq_po := v_seq_po + 1;
    v_po_kode := format('PO-GMI-%s-%s', to_char(v_po_ts, 'YYMM'), lpad(v_seq_po::text, 3, '0'));

    INSERT INTO public.pos
      (po_kode, pr_id, po_tanggal, po_estimasi, po_keterangan, po_status, approvals,
       po_pic, po_pic_id, po_payment_term, po_receive_status, po_jenis,
       po_ppn_mode, po_ppn_rate, po_diskon_mode, po_diskon_value, po_ongkir,
       created_at, updated_at)
    VALUES
      (v_po_kode, v_pr_id, v_po_ts::date, v_po_ts::date + 14,
       'Pengiriman ke gudang ' || CASE WHEN v_cab = v_ho THEN 'GMI-JAKARTA' ELSE 'GMI-HO' END,
       (CASE sc WHEN 'PO_open' THEN 'open' WHEN 'PO_rejected' THEN 'rejected' ELSE 'approved' END)::doc_status,
       pg_temp.appr('pr', 'Purchase Order', v_po_by, v_mod, 'approved',
         CASE sc WHEN 'PO_open' THEN 'pending' WHEN 'PO_rejected' THEN 'rejected' ELSE 'approved' END,
         v_po_ts, v_po_ts + interval '22 hours',
         CASE WHEN sc = 'PO_rejected' THEN 'Harga di atas vendor pembanding, minta penawaran ulang.' END),
       pg_temp.prof(v_po_by)->>'nama', v_po_by,
       v_terms[1 + floor(random() * array_length(v_terms, 1))::int], 'pending', 'reguler',
       'percent', CASE WHEN random() < 0.75 THEN 11 ELSE 0 END,
       'percent', CASE WHEN random() < 0.25 THEN 5 ELSE 0 END,
       CASE WHEN random() < 0.4 THEN (150 + floor(random() * 8) * 50) * 1000 ELSE 0 END,
       v_po_ts, v_po_ts)
    RETURNING id INTO v_po_id;

    INSERT INTO public.po_items
      (po_id, mr_id, pr_item_id, part_id, part_number, part_name, satuan, qty, harga,
       vendor_id, qty_received, created_at, updated_at)
    SELECT v_po_id, pi.mr_id, pi.id, pi.part_id, pi.part_number, pi.part_name, pi.satuan, pi.qty,
           (25 + floor(random() * 1975)) * 1000, v_vendor, 0, v_po_ts, v_po_ts
    FROM public.pr_items pi WHERE pi.pr_id = v_pr_id ORDER BY pi.id;

    UPDATE public.prs SET pr_convert_status =
      CASE WHEN sc = 'PO_rejected' THEN 'pending' ELSE 'complete' END
    WHERE id = v_pr_id;

    IF sc = 'PO_open' THEN
      PERFORM pg_temp.notify(v_mod, v_po_by, 'PO', v_po_id, v_po_kode, '/po/' || v_po_id, v_po_ts);
    END IF;

    CONTINUE WHEN sc IN ('PO_open', 'PO_rejected', 'PO_appr');

    -- -----------------------------------------------------------------------
    -- Receive Item. Barang untuk MR cabang lain diterima di HO, barang untuk
    -- MR HO diterima di GMI-JAKARTA (lalu dikirim ke HO via Item Transfer).
    -- -----------------------------------------------------------------------
    v_recv_cab := CASE WHEN v_cab = v_ho THEN v_jkt ELSE v_ho END;
    v_recv_kode := (SELECT kode_cabang FROM public.cabang WHERE id = v_recv_cab);
    v_ri_ts := v_po_ts + interval '7 days' + (floor(random() * 2880) || ' minutes')::interval;
    IF v_ri_ts::date >= v_today THEN v_ri_ts := (v_today - 1) + time '10:00'; END IF;
    v_seq_ri := v_seq_ri + 1;
    v_ri_kode := format('RI-%s-%s-%s', v_recv_kode, to_char(v_ri_ts, 'YYMM'), lpad(v_seq_ri::text, 3, '0'));

    INSERT INTO public.receives
      (ri_kode, po_id, cabang_id, ri_pic, ri_pic_id, ri_tanggal, ri_keterangan,
       approval_template_id, approvals, ri_status, completed_at, created_at, updated_at)
    VALUES
      (v_ri_kode, v_po_id, v_recv_cab, pg_temp.prof(v_mod)->>'nama', v_mod, v_ri_ts::date,
       'Barang diterima dalam kondisi baik, surat jalan vendor terlampir.',
       (SELECT id FROM public.approval_templates WHERE type = 'Receive Item' AND cabang_id IS NULL LIMIT 1),
       pg_temp.appr('ri', 'Receive Item', v_mod, v_mod,
         CASE WHEN sc = 'RI_open' AND v_seq_ri % 2 = 0 THEN 'pending' ELSE 'approved' END,
         CASE WHEN sc = 'RI_open' THEN 'pending' ELSE 'approved' END,
         v_ri_ts + interval '10 minutes', v_ri_ts + interval '3 hours'),
       CASE WHEN sc = 'RI_open' THEN 'open' ELSE 'completed' END,
       CASE WHEN sc <> 'RI_open' THEN v_ri_ts + interval '3 hours' END,
       v_ri_ts, v_ri_ts)
    RETURNING id INTO v_ri_id;

    INSERT INTO public.receive_items
      (ri_id, po_id, mr_id, part_id, part_number, part_name, satuan, qty, po_item_id,
       cabang_penerima_id, created_at, updated_at)
    SELECT v_ri_id, v_po_id, poi.mr_id, poi.part_id, poi.part_number, poi.part_name, poi.satuan,
           CASE WHEN sc = 'RI_partial' THEN greatest(1, poi.qty / 2) ELSE poi.qty END,
           poi.id, v_recv_cab, v_ri_ts, v_ri_ts
    FROM public.po_items poi WHERE poi.po_id = v_po_id ORDER BY poi.id;

    IF sc = 'RI_open' THEN
      PERFORM pg_temp.notify(v_mod, v_mod, 'RI', v_ri_id, v_ri_kode, '/receive', v_ri_ts);
      CONTINUE;
    END IF;

    -- Posting RI selesai: qty_received PO + stok gudang penerima
    FOR r IN SELECT * FROM public.receive_items WHERE ri_id = v_ri_id LOOP
      UPDATE public.po_items SET qty_received = qty_received + r.qty WHERE id = r.po_item_id;
      PERFORM pg_temp.mv(r.part_id, v_recv_cab, r.qty, 'RI', v_ri_kode,
        format('Receive %s: %s %s masuk gudang (status received)', v_ri_kode, r.part_number, r.part_name),
        v_ri_ts + interval '3 hours', v_mod);
    END LOOP;

    IF sc = 'RI_partial' THEN
      UPDATE public.pos SET po_receive_status = 'partial' WHERE id = v_po_id;
      CONTINUE;
    END IF;
    UPDATE public.pos SET po_receive_status = 'complete', po_status = 'completed' WHERE id = v_po_id;
    UPDATE public.prs SET pr_status = 'completed' WHERE id = v_pr_id;

    -- -----------------------------------------------------------------------
    -- Item Transfer dari gudang penerima ke cabang MR (distribusi ke MR)
    -- -----------------------------------------------------------------------
    v_it_state := CASE
      WHEN sc = 'completed' THEN 'completed'
      WHEN sc = 'IT_delivered' THEN 'delivered'
      ELSE (ARRAY['open','packing','in_transit','open'])[1 + (v_seq_it % 4)] END;
    v_it_ts := v_ri_ts + interval '1 day' + (floor(random() * 240) || ' minutes')::interval;
    IF v_it_ts::date >= v_today THEN v_it_ts := v_today + time '07:30'; END IF;
    v_ship := (ARRAY['ekspedisi_laut','ekspedisi_udara','ekspedisi_udara'])[1 + floor(random() * 3)::int];
    v_seq_it := v_seq_it + 1;
    v_it_kode := format('IT-%s-%s-%s', v_recv_kode, to_char(v_it_ts, 'YYMM'), lpad(v_seq_it::text, 3, '0'));

    INSERT INTO public.item_transfers
      (it_kode, it_tanggal, dari_cabang_id, ke_cabang_id, shipment_type, ekspedisi,
       jumlah_koli, no_resi, estimasi_hari, pic, remarks, uid_requester, uid_pic,
       uid_receiver, created_by, approvals, signature_requester_id, signed_by_requester_at,
       status, tracking_status, stock_released,
       signature_receiver_id, signed_by_receiver_at, signature_receiver_image_url,
       signature_receiver_printed_name, signature_receiver_label,
       created_at, updated_at)
    VALUES
      (v_it_kode, v_it_ts::date, v_recv_cab, v_cab, v_ship,
       v_ekspedisi[1 + floor(random() * array_length(v_ekspedisi, 1))::int],
       1 + floor(random() * 4)::int,
       CASE WHEN v_it_state <> 'open' THEN 'RS' || (100000000 + floor(random() * 899999999))::bigint END,
       CASE WHEN v_ship = 'ekspedisi_laut' THEN 14 ELSE 5 END,
       pg_temp.prof(v_mod)->>'nama',
       'Distribusi barang hasil ' || v_ri_kode || ' untuk ' || v_mr_kode,
       v_mod, v_mod,
       CASE WHEN v_it_state = 'completed' THEN v_req END,
       v_mod,
       pg_temp.appr('mr', 'Item Transfer', v_mod, v_mod, 'approved',
         CASE WHEN v_it_state = 'open' THEN 'pending' ELSE 'approved' END,
         v_it_ts, v_it_ts + interval '2 hours'),
       v_mod_sig, v_it_ts,
       (CASE v_it_state WHEN 'open' THEN 'open' WHEN 'completed' THEN 'completed' ELSE 'approved' END)::doc_status,
       CASE v_it_state WHEN 'open' THEN 'created' ELSE v_it_state END,
       v_it_state <> 'open',
       CASE WHEN v_it_state = 'completed' AND v_cab = v_ho THEN v_mod_sig END,
       CASE WHEN v_it_state = 'completed' THEN v_it_ts + interval '4 days' END,
       CASE WHEN v_it_state = 'completed' THEN pg_temp.sig(v_req) END,
       CASE WHEN v_it_state = 'completed' THEN v_req_prof->>'nama' END,
       CASE WHEN v_it_state = 'completed' THEN 'Main' END,
       v_it_ts, v_it_ts)
    RETURNING id INTO v_it_id;

    INSERT INTO public.item_transfer_items
      (it_id, part_id, part_number, part_name, satuan, qty, mr_item_id, receive_item_id, created_at, updated_at)
    SELECT v_it_id, ri.part_id, ri.part_number, ri.part_name, ri.satuan, ri.qty,
           pi.mr_item_id, ri.id, v_it_ts, v_it_ts
    FROM public.receive_items ri
    JOIN public.po_items poi ON poi.id = ri.po_item_id
    JOIN public.pr_items pi ON pi.id = poi.pr_item_id
    WHERE ri.ri_id = v_ri_id ORDER BY ri.id;

    IF v_it_state = 'open' THEN
      PERFORM pg_temp.notify(v_mod, v_mod, 'Item Transfer', v_it_id, v_it_kode,
                             '/item-transfer/' || v_it_id, v_it_ts);
      CONTINUE;
    END IF;

    -- Stok keluar dari gudang asal saat IT approved penuh
    FOR it IN SELECT * FROM public.item_transfer_items WHERE it_id = v_it_id LOOP
      PERFORM pg_temp.mv(it.part_id, v_recv_cab, -it.qty, 'IT', v_it_kode,
        format('Item Transfer %s: %s %s keluar dari cabang %s (dalam pengiriman)',
               v_it_kode, it.part_number, it.part_name, v_recv_cab),
        v_it_ts + interval '2 hours', v_mod);
    END LOOP;

    CONTINUE WHEN v_it_state <> 'completed';

    -- IT selesai: stok masuk gudang tujuan + pemenuhan MR
    FOR it IN SELECT * FROM public.item_transfer_items WHERE it_id = v_it_id LOOP
      PERFORM pg_temp.mv(it.part_id, v_cab, it.qty, 'IT', v_it_kode,
        format('Item Transfer %s: %s %s diterima di cabang %s',
               v_it_kode, it.part_number, it.part_name, v_cab),
        v_it_ts + interval '4 days', v_req);
      UPDATE public.mr_items SET qty_received = least(qty_request, qty_received + it.qty)
      WHERE id = it.mr_item_id;
    END LOOP;
    UPDATE public.mrs SET mr_status =
      CASE WHEN (SELECT sum(qty_received) >= sum(qty_request) FROM public.mr_items WHERE mr_id = v_mr_id)
           THEN 'completed' ELSE 'approved' END::doc_status
    WHERE id = v_mr_id;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 2c. SPB (stock out) — sudah selesai, stok langsung berkurang
  -- -------------------------------------------------------------------------
  FOR i IN 1 .. 12 LOOP
    v_req := CASE WHEN i % 3 = 0 THEN (SELECT id FROM public.profiles WHERE email = 'pjo@demo.com')
                  ELSE v_mod END;
    SELECT p.cabang_id, c.kode_cabang, c.nama_cabang INTO v_cab, v_cab_kode, v_recv_kode
    FROM public.profiles p JOIN public.cabang c ON c.id = p.cabang_id WHERE p.id = v_req;
    v_tgl := v_today - (1 + floor(random() * 40))::int;
    v_ts := v_tgl + time '09:00' + (floor(random() * 420) || ' minutes')::interval;
    v_seq_spb := v_seq_spb + 1;
    v_it_kode := format('SPB-%s-%s-%s', v_cab_kode, to_char(v_tgl, 'YYMM'), lpad(v_seq_spb::text, 3, '0'));

    INSERT INTO public.spb
      (spb_no, spb_tanggal, spb_no_wo, spb_section, spb_pic_gmi, spb_pic_ppa,
       spb_kode_unit, spb_tipe_unit, spb_brand, spb_hm, spb_problem_remark, spb_status,
       spb_gudang, cabang_id, spb_pic, created_by, approval_template_id, approvals,
       approval_status, completed_at, created_at, updated_at)
    VALUES
      (v_it_kode, v_ts, format('WO-%s-%s', to_char(v_tgl, 'YYMM'), lpad((40 + i)::text, 4, '0')),
       (ARRAY['Electrical','Mechanical','Hydraulic','Tyre'])[1 + floor(random() * 4)::int],
       pg_temp.prof(v_req)->>'nama',
       (ARRAY['Budi Santoso','Rahmat Hidayat','Agus Pratama','Dedi Kurniawan'])[1 + floor(random() * 4)::int],
       (ARRAY['HD785-','PC2000-','D375A-','GD825-'])[1 + floor(random() * 4)::int] || lpad((10 + i * 7)::text, 3, '0'),
       (ARRAY['HD785-7','PC2000-8','D375A-6','GD825A-2'])[1 + floor(random() * 4)::int],
       'Komatsu', 12000 + floor(random() * 18000)::int,
       (ARRAY['Lampu kerja mati','Kabel harness terbakar','Relay starter rusak',
              'Sensor temperatur error','Fuse sering putus'])[1 + floor(random() * 5)::int],
       'DONE QUOT', v_recv_kode, v_cab, pg_temp.prof(v_req)->>'nama', v_req,
       (SELECT id FROM public.approval_templates WHERE type = 'Stock Out - SPB' AND cabang_id IS NULL LIMIT 1),
       -- Aplikasi menyimpan step SPB sebagai 'pending' (TTD manual di kertas),
       -- tapi RPC get_pending_approvals_for_user tidak memfilter
       -- approval_status SPB sehingga semuanya muncul di "Approval Saya".
       -- Untuk demo dibuat 'approved' supaya daftar approval moderator bersih.
       pg_temp.appr('spb', 'Stock Out - SPB', v_req, v_mod, 'approved', 'approved', v_ts, v_ts),
       'completed', v_ts, v_ts, v_ts)
    RETURNING id INTO v_it_id;

    FOR r IN
      SELECT p.*, s.qty AS stok FROM demo_parts p
      JOIN public.stock s ON s.part_id = p.id AND s.cabang_id = v_cab AND s.qty >= 2
      ORDER BY random() LIMIT 1 + floor(random() * 3)::int
    LOOP
      v_qty := 1 + floor(random() * least(r.stok - 1, 3))::int;
      INSERT INTO public.spb_details
        (spb_id, part_id, dtl_spb_part_number, dtl_spb_part_name, dtl_spb_part_satuan,
         dtl_spb_qty, created_at, updated_at)
      VALUES (v_it_id, r.id, r.part_number, r.part_name, r.part_satuan, v_qty, v_ts, v_ts);
      PERFORM pg_temp.mv(r.id, v_cab, -v_qty, 'SPB_OUT', v_it_kode,
                         'Stock out dari SPB ' || v_it_kode, v_ts, v_req);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Demo seed: % MR, % PR, % PO, % RI, % IT, % SPB',
    v_seq_mr, v_seq_pr, v_seq_po, v_seq_ri, v_seq_it, v_seq_spb;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Formula WO (BOM) untuk SEMUA barang demo, supaya item MR approved mana
--    pun bisa langsung dibuatkan Working Order. Komponen diambil dari pool
--    "bahan baku" terpisah (bukan barang target MR) dan diberi stok besar di
--    GMI-HO & GMI-BPP (departemen WO = HO/BPP) supaya WO lolos cek stok saat
--    full-approved -> On Process.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mod  uuid := (SELECT id FROM public.profiles WHERE email = 'moderator@demo.com');
  v_cabs bigint[] := ARRAY(SELECT id FROM public.cabang WHERE nama_cabang IN ('GMI-HO', 'GMI-BPP'));
  v_qpu  numeric[] := ARRAY[1, 1, 1, 2, 2, 3, 4, 0.5];
  r record;
  v_fid bigint;
  n int;
BEGIN
  PERFORM setseed(0.1717);

  DROP TABLE IF EXISTS demo_components;
  CREATE TEMP TABLE demo_components AS
  SELECT b.id, b.part_number, b.part_name, b.part_satuan
  FROM public.barang b
  WHERE b.part_name ~* '(terminal|skun|kabel|cable|connector|konektor|heat ?shrink|bolt|baut|nut|mur|washer|ring|isolasi|cable tie|housing|socket|pin)'
    AND length(b.part_name) BETWEEN 6 AND 45
    AND b.id NOT IN (SELECT id FROM demo_parts)
    AND b.part_number NOT IN ('0 332 019 203', '0462-201-16141', '0462-203-12141',
                              '10L-0002', '10L-0003', '11L-3705-BP')
  ORDER BY md5('komp' || b.part_number)
  LIMIT 24;

  -- Bersihkan formula lama untuk barang demo (formula lain tidak disentuh)
  DELETE FROM public.wo_formula_components WHERE formula_id IN
    (SELECT id FROM public.wo_formulas WHERE target_part_id IN (SELECT id FROM demo_parts));
  DELETE FROM public.wo_formulas WHERE target_part_id IN (SELECT id FROM demo_parts);

  FOR r IN SELECT * FROM demo_parts ORDER BY rn LOOP
    INSERT INTO public.wo_formulas (target_part_id, is_active, created_by)
    VALUES (r.id, true, v_mod) RETURNING id INTO v_fid;

    n := 2 + floor(random() * 3)::int;  -- 2..4 komponen
    INSERT INTO public.wo_formula_components
      (formula_id, component_part_id, component_part_number, component_part_name,
       component_satuan, qty_per_unit)
    SELECT v_fid, c.id, c.part_number, c.part_name, c.part_satuan,
           v_qpu[1 + floor(random() * array_length(v_qpu, 1))::int]
    FROM (SELECT * FROM demo_components ORDER BY random() LIMIT n) c;
  END LOOP;

  -- Stok komponen di gudang WO
  INSERT INTO public.stock (part_id, cabang_id, qty, min_qty, max_qty)
  SELECT c.id, cab, 300 + floor(random() * 301)::int, 50, 1000
  FROM demo_components c CROSS JOIN unnest(v_cabs) AS cab
  ON CONFLICT (part_id, cabang_id)
  DO UPDATE SET qty = EXCLUDED.qty, min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty;

  RAISE NOTICE 'Demo seed: % formula WO, % komponen (stok di % gudang)',
    (SELECT count(*) FROM demo_parts), (SELECT count(*) FROM demo_components),
    array_length(v_cabs, 1);
END
$$;

COMMIT;
