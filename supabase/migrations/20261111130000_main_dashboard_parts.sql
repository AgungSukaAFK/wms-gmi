-- Migration: Dashboard utama dipecah per bagian
-- Date: 2026-11-11
-- Description:
--   Di produksi get_main_dashboard_summary kadang kena "canceling statement
--   due to statement timeout": satu panggilan menjalankan ±40 query
--   berurutan dan semuanya berbagi satu batas waktu statement.
--
--   Sekarang fungsi menerima p_part:
--     'core'   : profil, opsi lokasi, antrian (state saat ini), approval
--                (milik saya, total, tertahan > 7 hari).
--     'period' : jumlah dokumen periode + pembanding, status MR/PO periode,
--                % qty MR diterima, nilai PO (hanya purchasing).
--     'exec_a' : (atasan) lead time, tren, level MR, umur & approver antrian.
--     'exec_b' : (atasan) MR & stok per lokasi, kategori, prioritas,
--                vendor & barang teratas.
--     'all'    : semuanya (perilaku lama).
--   Halaman memanggil keempat bagian secara PARALEL; tiap bagian punya batas
--   waktunya sendiri, dan kalau satu bagian gagal hanya kartunya yang error.
--
--   Isi query tiap blok sama persis dengan migration 20261111120000.
--   Fungsi lama (tanpa p_part) di-DROP supaya PostgREST tidak bingung
--   memilih overload. Idempotent: aman dijalankan ulang.

DROP FUNCTION IF EXISTS public.get_main_dashboard_summary(
  BIGINT[], DATE, DATE, DATE, DATE, DATE, TEXT[], TEXT[], BOOLEAN);

CREATE OR REPLACE FUNCTION public.get_main_dashboard_summary(
  p_cabang_ids    BIGINT[] DEFAULT NULL,
  p_date_from     DATE     DEFAULT NULL,
  p_date_to       DATE     DEFAULT NULL,
  p_prev_from     DATE     DEFAULT NULL,
  p_prev_to       DATE     DEFAULT NULL,
  p_trend_from    DATE     DEFAULT NULL,
  p_kategori      TEXT[]   DEFAULT NULL,
  p_priorities    TEXT[]   DEFAULT NULL,
  -- TRUE = URL tidak menyebut lokasi: user non-exec dibatasi ke cabangnya.
  p_own_cabang_default BOOLEAN DEFAULT FALSE,
  p_part          TEXT     DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_today    DATE := (now() AT TIME ZONE 'Asia/Jakarta')::DATE;
  v_viewer   JSONB := public.dashboard_viewer();
  v_is_exec   BOOLEAN;  -- diturunkan dari role, bukan parameter
  v_can_value BOOLEAN;  -- idem
  v_all      BOOLEAN;
  v_to       DATE := COALESCE(p_date_to, (now() AT TIME ZONE 'Asia/Jakarta')::DATE);
  v_from     DATE := COALESCE(p_date_from,
                       date_trunc('month', COALESCE(p_date_to, (now() AT TIME ZONE 'Asia/Jakarta')::DATE))::DATE);
  v_has_prev BOOLEAN := (p_prev_from IS NOT NULL AND p_prev_to IS NOT NULL);
  v_lo       DATE;   -- batas bawah scan periode (termasuk pembanding)
  v_trend    DATE;
  v_me       TEXT := auth.uid()::TEXT;
  v_part     JSONB;
  v_queue    JSONB := NULL;
  v_period   JSONB := NULL;
  v_approval JSONB := NULL;
  v_exec     JSONB := NULL;
  v_value    JSONB := NULL;
  v_do_core   BOOLEAN := p_part IN ('all', 'core');
  v_do_period BOOLEAN := p_part IN ('all', 'period');
  v_do_exec_a BOOLEAN := p_part IN ('all', 'exec_a');
  v_do_exec_b BOOLEAN := p_part IN ('all', 'exec_b');
BEGIN
  IF p_part NOT IN ('all', 'core', 'period', 'exec_a', 'exec_b') THEN
    RAISE EXCEPTION 'p_part tidak dikenal: %', p_part;
  END IF;

  v_is_exec   := COALESCE((v_viewer->>'is_exec')::BOOLEAN, FALSE);
  v_can_value := COALESCE((v_viewer->>'can_value')::BOOLEAN, FALSE);

  -- Array kosong = tidak memfilter.
  IF cardinality(p_kategori) = 0 THEN p_kategori := NULL; END IF;
  IF cardinality(p_priorities) = 0 THEN p_priorities := NULL; END IF;
  IF cardinality(p_cabang_ids) = 0 THEN p_cabang_ids := NULL; END IF;

  -- User non-exec tanpa pilihan lokasi -> cabangnya sendiri.
  IF p_own_cabang_default
     AND NOT v_is_exec
     AND p_cabang_ids IS NULL
     AND (v_viewer->>'cabang_id') IS NOT NULL THEN
    p_cabang_ids := ARRAY[(v_viewer->>'cabang_id')::BIGINT];
  END IF;
  v_all := p_cabang_ids IS NULL;

  v_lo    := LEAST(v_from, COALESCE(p_prev_from, v_from));
  v_trend := LEAST(COALESCE(p_trend_from, v_from), v_from);

  -- ==========================================================
  -- CORE: antrian + approval milik saya
  -- ==========================================================
  IF v_do_core THEN
  v_queue := '{}'::JSONB;
    -- ==========================================================
    -- A. ANTRIAN (state saat ini, tidak terikat periode)
    -- ==========================================================
    SELECT jsonb_build_object(
      'mr_open',    count(*) FILTER (WHERE m.mr_status = 'open'),
      'mr_overdue', count(*) FILTER (WHERE m.mr_status IN ('open', 'approved')
                                       AND m.mr_due_date < v_today),
      'mr_frozen',  count(*) FILTER (WHERE m.is_frozen),
      'mr_need_pr', count(*) FILTER (
                      WHERE m.mr_status = 'approved'
                        AND m.mr_convert_status IN ('pending', 'partial')
                        AND EXISTS (
                          SELECT 1 FROM public.mr_items i
                          WHERE i.mr_id = m.id
                            AND COALESCE(i.qty_pr, 0) > 0
                            AND COALESCE(i.item_status, '') <> 'rejected'))
    ) INTO v_part
    FROM public.dashboard_mr_scope(p_cabang_ids, p_kategori, p_priorities) m;
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object(
      'pr_open',    count(*) FILTER (WHERE p.pr_status = 'open'),
      'pr_need_po', count(*) FILTER (WHERE p.pr_status = 'approved'
                                       AND p.pr_convert_status IN ('pending', 'partial'))
    ) INTO v_part
    FROM public.prs p
    WHERE v_all OR p.cabang_id = ANY (p_cabang_ids);
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object(
      'po_open',         count(*) FILTER (WHERE p.po_status = 'open'),
      'po_not_received', count(*) FILTER (WHERE p.po_status = 'approved'
                           AND COALESCE(p.po_receive_status, 'pending') IN ('pending', 'partial')),
      'po_overdue',      count(*) FILTER (WHERE p.po_status = 'approved'
                           AND COALESCE(p.po_receive_status, 'pending') IN ('pending', 'partial')
                           AND p.po_estimasi < v_today)
    ) INTO v_part
    FROM public.pos p
    WHERE v_all OR p.cabang_id = ANY (p_cabang_ids);
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object('ri_open', count(*) FILTER (WHERE r.ri_status = 'open'))
    INTO v_part
    FROM public.receives r
    WHERE v_all OR r.cabang_id = ANY (p_cabang_ids);
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object(
      'it_open',       count(*) FILTER (WHERE t.status = 'open'),
      'it_active',     count(*) FILTER (WHERE t.status = 'approved'),
      'it_packing',    count(*) FILTER (WHERE t.status = 'approved'
                         AND COALESCE(t.tracking_status, 'created') IN ('created', 'packing')),
      'it_in_transit', count(*) FILTER (WHERE t.status = 'approved' AND t.tracking_status = 'in_transit'),
      'it_delivered',  count(*) FILTER (WHERE t.status = 'approved' AND t.tracking_status = 'delivered')
    ) INTO v_part
    FROM public.item_transfers t
    WHERE v_all OR t.dari_cabang_id = ANY (p_cabang_ids) OR t.ke_cabang_id = ANY (p_cabang_ids);
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object('dlv_ongoing', count(*) FILTER (WHERE d.status IN ('open', 'approved')))
    INTO v_part
    FROM public.deliveries d
    WHERE v_all OR d.dari_cabang_id = ANY (p_cabang_ids) OR d.ke_cabang_id = ANY (p_cabang_ids);
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object('stock_request_open', count(*))
    INTO v_part
    FROM public.stock_setting_requests r
    WHERE r.status = 'open' AND (v_all OR r.cabang_id = ANY (p_cabang_ids));
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object(
      'supply_in_transit', count(*),
      'supply_overdue',    count(*) FILTER (WHERE s.deadline < v_today)
    ) INTO v_part
    FROM public.planning_supplies s
    WHERE s.status = 'in_transit'
      AND (v_all OR s.dest_cabang_id = ANY (p_cabang_ids) OR s.source_cabang_id = ANY (p_cabang_ids));
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object(
      'wo_pending',    count(*) FILTER (WHERE w.wo_status = 'Pending Approval'),
      'wo_on_process', count(*) FILTER (WHERE w.wo_status = 'On Process')
    ) INTO v_part
    FROM public.working_orders w
    WHERE v_all OR w.gudang_cabang_id = ANY (p_cabang_ids);
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object('jc_open', count(*) FILTER (WHERE j.status = 'open'))
    INTO v_part
    FROM public.job_costing j
    WHERE v_all OR j.cabang_id = ANY (p_cabang_ids);
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object('freeze_open', count(*))
    INTO v_part
    FROM public.mr_freeze_reports f
    JOIN public.mrs m ON m.id = f.mr_id
    WHERE f.status = 'open' AND (v_all OR m.cabang_id = ANY (p_cabang_ids));
    v_queue := v_queue || v_part;

    -- Stok: logika status sama dengan view v_stock_with_status (baris tanpa
    -- min/max = "unknown", tidak dihitung). Predikat harus cocok dengan
    -- index parsial idx_stock_minmax_set.
    SELECT jsonb_build_object(
      'stock_low',     count(*) FILTER (WHERE s.qty < s.min_qty),
      'stock_over',    count(*) FILTER (WHERE NOT (s.qty < s.min_qty) AND s.qty > s.max_qty),
      'stock_tracked', count(*)
    ) INTO v_part
    FROM public.stock s
    WHERE (s.min_qty <> 0 OR s.max_qty <> 0)
      AND (v_all OR s.cabang_id = ANY (p_cabang_ids));
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object(
      'so_active',  count(*) FILTER (WHERE s.so_status IN ('open', 'partial')),
      'so_overdue', count(*) FILTER (WHERE s.so_status IN ('open', 'partial')
                                       AND s.so_due_date < v_today)
    ) INTO v_part
    FROM public.so_reguler s
    WHERE v_all OR s.cabang_id = ANY (p_cabang_ids);
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object('do_active', count(*) FILTER (WHERE d.status = 'active'))
    INTO v_part
    FROM public.do_reguler d
    WHERE v_all OR d.dari_cabang_id = ANY (p_cabang_ids);
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object(
      'spb_belum_po',         count(*) FILTER (WHERE g.stage = 'belum_po'),
      'spb_po_belum_do',      count(*) FILTER (WHERE g.stage = 'po_belum_do'),
      'spb_do_belum_invoice', count(*) FILTER (WHERE g.stage = 'do_belum_invoice')
    ) INTO v_part
    FROM public.dashboard_spb_progress(p_cabang_ids) g;
    v_queue := v_queue || v_part;

    SELECT jsonb_build_object(
      'invoice_unpaid', count(*) FILTER (WHERE i.approval_status <> 'rejected'
                                           AND i.payment_status = 'unpaid'),
      'invoice_open',   count(*) FILTER (WHERE i.approval_status = 'open')
    ) INTO v_part
    FROM public.spb_invoice i
    JOIN public.spb_do d ON d.id = i.spb_do_id
    JOIN public.spb_po p ON p.id = d.spb_po_id
    JOIN public.spb s    ON s.id = p.spb_id
    WHERE s.spb_is_deleted = FALSE
      AND s.spb_status <> 'CANCELLED'
      AND (v_all OR s.cabang_id = ANY (p_cabang_ids));
    v_queue := v_queue || v_part;

    WITH pa AS MATERIALIZED (
      SELECT a.*, c.nama_cabang,
             GREATEST(v_today - (a.waiting_since AT TIME ZONE 'Asia/Jakarta')::DATE, 0) AS age_days
      FROM public.dashboard_pending_approvals(p_cabang_ids) a
      LEFT JOIN public.cabang c ON c.id = a.cabang_id
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM pa),
      'mine',  (SELECT count(*) FROM pa WHERE v_me IS NOT NULL AND pa.approver_id = v_me),
      'mine_rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'doc_type', x.doc_type, 'id', x.doc_id, 'kode', x.kode, 'href', x.href,
                 'lokasi', x.nama_cabang, 'tanggal', x.tanggal, 'umur_hari', x.age_days)
               ORDER BY x.age_days DESC, x.kode)
        FROM (
          SELECT * FROM pa
          WHERE v_me IS NOT NULL AND pa.approver_id = v_me
          ORDER BY pa.age_days DESC, pa.kode
          LIMIT 8
        ) x
      ), '[]'::JSONB),
      'stale', (SELECT count(*) FROM pa WHERE pa.age_days > 7)
    ) INTO v_approval;
  END IF;

  -- ==========================================================
  -- PERIOD: aktivitas periode + nilai PO
  -- ==========================================================
  IF v_do_period THEN
  v_period := '{}'::JSONB;
    -- ==========================================================
    -- C. AKTIVITAS PERIODE (+ pembanding)
    -- ==========================================================
    SELECT jsonb_build_object(
      'mr', jsonb_build_object(
        'cur',  count(*) FILTER (WHERE m.mr_tanggal BETWEEN v_from AND v_to),
        'prev', CASE WHEN v_has_prev THEN
                  count(*) FILTER (WHERE m.mr_tanggal BETWEEN p_prev_from AND p_prev_to) END),
      'mr_status', jsonb_build_object(
        'open',      count(*) FILTER (WHERE m.mr_tanggal BETWEEN v_from AND v_to AND m.mr_status = 'open'),
        'approved',  count(*) FILTER (WHERE m.mr_tanggal BETWEEN v_from AND v_to AND m.mr_status = 'approved'),
        'completed', count(*) FILTER (WHERE m.mr_tanggal BETWEEN v_from AND v_to
                                        AND m.mr_status IN ('completed', 'done', 'closed')),
        'rejected',  count(*) FILTER (WHERE m.mr_tanggal BETWEEN v_from AND v_to
                                        AND m.mr_status IN ('rejected', 'cancelled')))
    ) INTO v_part
    FROM public.dashboard_mr_scope(p_cabang_ids, p_kategori, p_priorities) m
    WHERE m.mr_tanggal BETWEEN v_lo AND v_to;
    v_period := v_period || v_part;

    -- % qty MR periode ini yang sudah diterima.
    SELECT jsonb_build_object('mr_fulfillment', jsonb_build_object(
      'qty_request',  COALESCE(sum(i.qty_request), 0),
      'qty_received', COALESCE(sum(LEAST(COALESCE(i.qty_received, 0), i.qty_request)), 0)))
    INTO v_part
    FROM public.dashboard_mr_scope(p_cabang_ids, p_kategori, p_priorities) m
    JOIN public.mr_items i ON i.mr_id = m.id
    WHERE m.mr_tanggal BETWEEN v_from AND v_to
      AND m.mr_status NOT IN ('rejected', 'cancelled')
      AND COALESCE(i.item_status, '') <> 'rejected';
    v_period := v_period || v_part;

    SELECT jsonb_build_object('pr', jsonb_build_object(
      'cur',  count(*) FILTER (WHERE p.pr_tanggal BETWEEN v_from AND v_to),
      'prev', CASE WHEN v_has_prev THEN
                count(*) FILTER (WHERE p.pr_tanggal BETWEEN p_prev_from AND p_prev_to) END))
    INTO v_part
    FROM public.prs p
    WHERE p.pr_tanggal BETWEEN v_lo AND v_to
      AND (v_all OR p.cabang_id = ANY (p_cabang_ids));
    v_period := v_period || v_part;

    SELECT jsonb_build_object(
      'po', jsonb_build_object(
        'cur',  count(*) FILTER (WHERE p.po_tanggal BETWEEN v_from AND v_to),
        'prev', CASE WHEN v_has_prev THEN
                  count(*) FILTER (WHERE p.po_tanggal BETWEEN p_prev_from AND p_prev_to) END),
      'po_receive', jsonb_build_object(
        'pending',  count(*) FILTER (WHERE p.po_tanggal BETWEEN v_from AND v_to
                      AND p.po_status NOT IN ('rejected', 'cancelled')
                      AND COALESCE(p.po_receive_status, 'pending') = 'pending'),
        'partial',  count(*) FILTER (WHERE p.po_tanggal BETWEEN v_from AND v_to
                      AND p.po_status NOT IN ('rejected', 'cancelled')
                      AND p.po_receive_status = 'partial'),
        'complete', count(*) FILTER (WHERE p.po_tanggal BETWEEN v_from AND v_to
                      AND p.po_status NOT IN ('rejected', 'cancelled')
                      AND p.po_receive_status = 'complete')))
    INTO v_part
    FROM public.pos p
    WHERE p.po_tanggal BETWEEN v_lo AND v_to
      AND (v_all OR p.cabang_id = ANY (p_cabang_ids));
    v_period := v_period || v_part;

    SELECT jsonb_build_object('ri', jsonb_build_object(
      'cur',  count(*) FILTER (WHERE r.ri_tanggal BETWEEN v_from AND v_to),
      'prev', CASE WHEN v_has_prev THEN
                count(*) FILTER (WHERE r.ri_tanggal BETWEEN p_prev_from AND p_prev_to) END))
    INTO v_part
    FROM public.receives r
    WHERE r.ri_tanggal BETWEEN v_lo AND v_to
      AND (v_all OR r.cabang_id = ANY (p_cabang_ids));
    v_period := v_period || v_part;

    SELECT jsonb_build_object('it', jsonb_build_object(
      'cur',  count(*) FILTER (WHERE t.it_tanggal BETWEEN v_from AND v_to),
      'prev', CASE WHEN v_has_prev THEN
                count(*) FILTER (WHERE t.it_tanggal BETWEEN p_prev_from AND p_prev_to) END))
    INTO v_part
    FROM public.item_transfers t
    WHERE t.it_tanggal BETWEEN v_lo AND v_to
      AND (v_all OR t.dari_cabang_id = ANY (p_cabang_ids) OR t.ke_cabang_id = ANY (p_cabang_ids));
    v_period := v_period || v_part;

    SELECT jsonb_build_object('wo', jsonb_build_object(
      'cur',  count(*) FILTER (WHERE w.wo_tanggal BETWEEN v_from AND v_to),
      'prev', CASE WHEN v_has_prev THEN
                count(*) FILTER (WHERE w.wo_tanggal BETWEEN p_prev_from AND p_prev_to) END))
    INTO v_part
    FROM public.working_orders w
    WHERE w.wo_tanggal BETWEEN v_lo AND v_to
      AND (v_all OR w.gudang_cabang_id = ANY (p_cabang_ids));
    v_period := v_period || v_part;

    SELECT jsonb_build_object('spb', jsonb_build_object(
      'cur',  count(*) FILTER (WHERE x.d BETWEEN v_from AND v_to),
      'prev', CASE WHEN v_has_prev THEN
                count(*) FILTER (WHERE x.d BETWEEN p_prev_from AND p_prev_to) END))
    INTO v_part
    FROM (
      SELECT (s.spb_tanggal AT TIME ZONE 'Asia/Jakarta')::DATE AS d
      FROM public.spb s
      WHERE s.spb_is_deleted = FALSE
        AND s.spb_status <> 'CANCELLED'
        AND (v_all OR s.cabang_id = ANY (p_cabang_ids))
    ) x
    WHERE x.d BETWEEN v_lo AND v_to;
    v_period := v_period || v_part;

    SELECT jsonb_build_object('so', jsonb_build_object(
      'cur',  count(*) FILTER (WHERE s.so_tanggal BETWEEN v_from AND v_to),
      'prev', CASE WHEN v_has_prev THEN
                count(*) FILTER (WHERE s.so_tanggal BETWEEN p_prev_from AND p_prev_to) END))
    INTO v_part
    FROM public.so_reguler s
    WHERE s.so_tanggal BETWEEN v_lo AND v_to
      AND s.so_status <> 'cancelled'
      AND (v_all OR s.cabang_id = ANY (p_cabang_ids));
    v_period := v_period || v_part;

    -- ==========================================================
    -- D. NILAI PO (hanya role purchasing, lihat dashboard_viewer)
    --    Subtotal item (qty x harga), sebelum pajak/diskon/ongkir, per mata uang.
    -- ==========================================================
    IF v_can_value THEN
      WITH po AS (
        SELECT p.id, COALESCE(NULLIF(p.po_currency, ''), 'IDR') AS cur,
               p.po_tanggal, p.po_status::TEXT AS po_status, p.po_receive_status
        FROM public.pos p
        WHERE (v_all OR p.cabang_id = ANY (p_cabang_ids))
          AND p.po_status NOT IN ('rejected', 'cancelled')
      ),
      li AS (
        SELECT po.cur, po.po_tanggal, po.po_status, po.po_receive_status,
               COALESCE(i.qty, 0) * COALESCE(i.harga, 0) AS amount,
               GREATEST(COALESCE(i.qty, 0) - COALESCE(i.qty_received, 0), 0)
                 * COALESCE(i.harga, 0) AS outstanding
        FROM po JOIN public.po_items i ON i.po_id = po.id
      ),
      agg AS (
        SELECT li.cur,
          COALESCE(sum(li.amount) FILTER (WHERE li.po_tanggal BETWEEN v_from AND v_to), 0) AS cur_value,
          CASE WHEN v_has_prev THEN
            COALESCE(sum(li.amount) FILTER (WHERE li.po_tanggal BETWEEN p_prev_from AND p_prev_to), 0)
          END AS prev_value,
          COALESCE(sum(li.outstanding) FILTER (
            WHERE li.po_status = 'approved'
              AND COALESCE(li.po_receive_status, 'pending') IN ('pending', 'partial')), 0) AS outstanding
        FROM li GROUP BY li.cur
      )
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'currency', agg.cur, 'cur', agg.cur_value, 'prev', agg.prev_value,
               'outstanding', agg.outstanding)
             ORDER BY (agg.cur = 'IDR') DESC, agg.cur), '[]'::JSONB)
      INTO v_value
      FROM agg
      WHERE agg.cur_value <> 0 OR COALESCE(agg.prev_value, 0) <> 0 OR agg.outstanding <> 0;
    END IF;

  END IF;

  -- ==========================================================
  -- EXEC A: lead time, tren, level MR, antrian approval (atasan)
  -- ==========================================================
  IF v_do_exec_a AND v_is_exec THEN
    v_exec := COALESCE(v_exec, '{}'::JSONB);
    -- Lead time (hari, dari tanggal dokumen). Selisih negatif dianggap 0.
    SELECT jsonb_build_object('mr_pr', jsonb_build_object(
      'cur',  round(avg(GREATEST(p.pr_tanggal - m.mr_tanggal, 0))
                FILTER (WHERE p.pr_tanggal BETWEEN v_from AND v_to), 1),
      'prev', CASE WHEN v_has_prev THEN
                round(avg(GREATEST(p.pr_tanggal - m.mr_tanggal, 0))
                  FILTER (WHERE p.pr_tanggal BETWEEN p_prev_from AND p_prev_to), 1) END,
      'n',    count(*) FILTER (WHERE p.pr_tanggal BETWEEN v_from AND v_to)))
    INTO v_part
    FROM public.prs p
    JOIN public.mrs m ON m.id = COALESCE(
      p.mr_id, (SELECT min(pi.mr_id) FROM public.pr_items pi WHERE pi.pr_id = p.id))
    WHERE p.pr_tanggal BETWEEN v_lo AND v_to
      AND p.pr_status NOT IN ('rejected', 'cancelled')
      AND (v_all OR p.cabang_id = ANY (p_cabang_ids));
    v_exec := v_exec || jsonb_build_object('lead_time', v_part);

    SELECT jsonb_build_object('pr_po', jsonb_build_object(
      'cur',  round(avg(GREATEST(po.po_tanggal - pr.pr_tanggal, 0))
                FILTER (WHERE po.po_tanggal BETWEEN v_from AND v_to), 1),
      'prev', CASE WHEN v_has_prev THEN
                round(avg(GREATEST(po.po_tanggal - pr.pr_tanggal, 0))
                  FILTER (WHERE po.po_tanggal BETWEEN p_prev_from AND p_prev_to), 1) END,
      'n',    count(*) FILTER (WHERE po.po_tanggal BETWEEN v_from AND v_to)))
    INTO v_part
    FROM public.pos po
    JOIN public.prs pr ON pr.id = COALESCE(
      po.pr_id,
      (SELECT min(pri.pr_id)
       FROM public.po_items poi
       JOIN public.pr_items pri ON pri.id = poi.pr_item_id
       WHERE poi.po_id = po.id))
    WHERE po.po_tanggal BETWEEN v_lo AND v_to
      AND po.po_status NOT IN ('rejected', 'cancelled')
      AND (v_all OR po.cabang_id = ANY (p_cabang_ids));
    v_exec := jsonb_set(v_exec, '{lead_time}', (v_exec->'lead_time') || v_part);

    SELECT jsonb_build_object('po_ri', jsonb_build_object(
      'cur',  round(avg(GREATEST(r.ri_tanggal - po.po_tanggal, 0))
                FILTER (WHERE r.ri_tanggal BETWEEN v_from AND v_to), 1),
      'prev', CASE WHEN v_has_prev THEN
                round(avg(GREATEST(r.ri_tanggal - po.po_tanggal, 0))
                  FILTER (WHERE r.ri_tanggal BETWEEN p_prev_from AND p_prev_to), 1) END,
      'n',    count(*) FILTER (WHERE r.ri_tanggal BETWEEN v_from AND v_to)))
    INTO v_part
    FROM public.receives r
    JOIN public.pos po ON po.id = COALESCE(
      r.po_id, (SELECT min(ri.po_id) FROM public.receive_items ri WHERE ri.ri_id = r.id))
    WHERE r.ri_tanggal BETWEEN v_lo AND v_to
      AND r.ri_status <> 'rejected'
      AND (v_all OR r.cabang_id = ANY (p_cabang_ids));
    v_exec := jsonb_set(v_exec, '{lead_time}', (v_exec->'lead_time') || v_part);

    -- Tren harian (hanya tanggal yang ada datanya; client mengisi celahnya).
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'd', t.d, 'mr', t.mr, 'pr', t.pr, 'po', t.po, 'ri', t.ri) ORDER BY t.d), '[]'::JSONB)
    INTO v_part
    FROM (
      SELECT u.d, sum(u.mr) AS mr, sum(u.pr) AS pr, sum(u.po) AS po, sum(u.ri) AS ri
      FROM (
        SELECT m.mr_tanggal AS d, count(*) AS mr, 0::BIGINT AS pr, 0::BIGINT AS po, 0::BIGINT AS ri
        FROM public.dashboard_mr_scope(p_cabang_ids, p_kategori, p_priorities) m
        WHERE m.mr_tanggal BETWEEN v_trend AND v_to
        GROUP BY 1
        UNION ALL
        SELECT p.pr_tanggal, 0, count(*), 0, 0
        FROM public.prs p
        WHERE p.pr_tanggal BETWEEN v_trend AND v_to
          AND (v_all OR p.cabang_id = ANY (p_cabang_ids))
        GROUP BY 1
        UNION ALL
        SELECT p.po_tanggal, 0, 0, count(*), 0
        FROM public.pos p
        WHERE p.po_tanggal BETWEEN v_trend AND v_to
          AND (v_all OR p.cabang_id = ANY (p_cabang_ids))
        GROUP BY 1
        UNION ALL
        SELECT r.ri_tanggal, 0, 0, 0, count(*)
        FROM public.receives r
        WHERE r.ri_tanggal BETWEEN v_trend AND v_to
          AND (v_all OR r.cabang_id = ANY (p_cabang_ids))
        GROUP BY 1
      ) u
      GROUP BY u.d
    ) t;
    v_exec := v_exec || jsonb_build_object('trend', v_part, 'trend_from', v_trend);

    -- Pipeline level MR aktif.
    SELECT COALESCE(jsonb_object_agg(g.bucket, g.c), '{}'::JSONB)
    INTO v_part
    FROM (
      SELECT lv.bucket, count(*) AS c
      FROM public.dashboard_mr_levels(p_cabang_ids, p_kategori, p_priorities) lv
      GROUP BY lv.bucket
    ) g;
    v_exec := v_exec || jsonb_build_object('mr_pipeline', v_part);


    -- Umur antrian approval & approver dengan antrian terbanyak.
    WITH pa AS MATERIALIZED (
      SELECT a.doc_type, a.approver, a.approver_id,
             GREATEST(v_today - (a.waiting_since AT TIME ZONE 'Asia/Jakarta')::DATE, 0) AS age_days
      FROM public.dashboard_pending_approvals(p_cabang_ids) a
    )
    SELECT jsonb_build_object(
      'aging', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'doc_type', g.doc_type, 'b0', g.b0, 'b1', g.b1, 'b2', g.b2, 'b3', g.b3,
                 'total', g.total, 'oldest', g.oldest)
               ORDER BY g.total DESC, g.doc_type)
        FROM (
          SELECT pa.doc_type,
                 count(*) FILTER (WHERE pa.age_days <= 2)               AS b0,
                 count(*) FILTER (WHERE pa.age_days BETWEEN 3 AND 7)    AS b1,
                 count(*) FILTER (WHERE pa.age_days BETWEEN 8 AND 14)   AS b2,
                 count(*) FILTER (WHERE pa.age_days > 14)               AS b3,
                 count(*) AS total,
                 max(pa.age_days) AS oldest
          FROM pa GROUP BY pa.doc_type
        ) g
      ), '[]'::JSONB),
      'approvers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', g.approver_id, 'nama', g.approver, 'jumlah', g.jumlah,
                 'terlama', g.terlama, 'rata', g.rata)
               ORDER BY g.jumlah DESC, g.terlama DESC)
        FROM (
          SELECT pa.approver_id,
                 COALESCE(max(pa.approver), 'Belum ada approver') AS approver,
                 count(*) AS jumlah,
                 max(pa.age_days) AS terlama,
                 round(avg(pa.age_days), 1) AS rata
          FROM pa
          GROUP BY pa.approver_id
          ORDER BY count(*) DESC, max(pa.age_days) DESC
          LIMIT 10
        ) g
      ), '[]'::JSONB)
    ) INTO v_part;
    v_exec := v_exec || jsonb_build_object('approval', v_part);
  END IF;

  -- ==========================================================
  -- EXEC B: lokasi, stok, kategori, prioritas, vendor, barang (atasan)
  -- ==========================================================
  IF v_do_exec_b AND v_is_exec THEN
    v_exec := COALESCE(v_exec, '{}'::JSONB);
    -- MR per lokasi: aktif (tepat waktu vs lewat due) + jumlah periode.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'cabang_id', g.cabang_id, 'nama', g.nama, 'aktif', g.aktif,
             'overdue', g.overdue, 'periode', g.periode)
           ORDER BY g.aktif DESC, g.periode DESC, g.nama), '[]'::JSONB)
    INTO v_part
    FROM (
      SELECT m.cabang_id, COALESCE(c.nama_cabang, 'Tanpa lokasi') AS nama,
             count(*) FILTER (WHERE m.mr_status IN ('open', 'approved')) AS aktif,
             count(*) FILTER (WHERE m.mr_status IN ('open', 'approved')
                                AND m.mr_due_date < v_today) AS overdue,
             count(*) FILTER (WHERE m.mr_tanggal BETWEEN v_from AND v_to) AS periode
      FROM public.dashboard_mr_scope(p_cabang_ids, p_kategori, p_priorities) m
      LEFT JOIN public.cabang c ON c.id = m.cabang_id
      GROUP BY m.cabang_id, c.nama_cabang
    ) g
    WHERE g.aktif > 0 OR g.periode > 0;
    v_exec := v_exec || jsonb_build_object('mr_by_cabang', v_part);

    -- MR periode per kategori.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('nama', g.nama, 'jumlah', g.c)
             ORDER BY g.c DESC, g.nama), '[]'::JSONB)
    INTO v_part
    FROM (
      SELECT COALESCE(m.kategori, 'Tanpa kategori') AS nama, count(*) AS c
      FROM public.dashboard_mr_scope(p_cabang_ids, p_kategori, p_priorities) m
      WHERE m.mr_tanggal BETWEEN v_from AND v_to
      GROUP BY 1
    ) g;
    v_exec := v_exec || jsonb_build_object('mr_by_kategori', v_part);

    -- Item MR periode per prioritas.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('nama', g.nama, 'jumlah', g.c)
             ORDER BY g.nama), '[]'::JSONB)
    INTO v_part
    FROM (
      SELECT COALESCE(NULLIF(i.item_priority, ''), 'Tanpa prioritas') AS nama, count(*) AS c
      FROM public.dashboard_mr_scope(p_cabang_ids, p_kategori, p_priorities) m
      JOIN public.mr_items i ON i.mr_id = m.id
      WHERE m.mr_tanggal BETWEEN v_from AND v_to
        AND COALESCE(i.item_status, '') <> 'rejected'
        AND (p_priorities IS NULL OR cardinality(p_priorities) = 0
             OR i.item_priority = ANY (p_priorities))
      GROUP BY 1
    ) g;
    v_exec := v_exec || jsonb_build_object('mr_by_priority', v_part);

    -- Stok per lokasi (hanya baris yang punya min/max).
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'cabang_id', g.cabang_id, 'nama', g.nama, 'low', g.low, 'over', g.over_, 'normal', g.normal)
           ORDER BY g.low DESC, g.over_ DESC, g.nama), '[]'::JSONB)
    INTO v_part
    FROM (
      SELECT s.cabang_id, c.nama_cabang AS nama,
             count(*) FILTER (WHERE s.qty < s.min_qty) AS low,
             count(*) FILTER (WHERE NOT (s.qty < s.min_qty) AND s.qty > s.max_qty) AS over_,
             count(*) FILTER (WHERE NOT (s.qty < s.min_qty) AND NOT (s.qty > s.max_qty)) AS normal
      FROM public.stock s
      JOIN public.cabang c ON c.id = s.cabang_id
      WHERE (s.min_qty <> 0 OR s.max_qty <> 0)
        AND (v_all OR s.cabang_id = ANY (p_cabang_ids))
      GROUP BY s.cabang_id, c.nama_cabang
    ) g;
    v_exec := v_exec || jsonb_build_object('stock_by_cabang', v_part);

    -- Vendor teratas periode ini (PO tidak ditolak).
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'nama', g.nama, 'po', g.po_count, 'item', g.item_count,
             'nilai', CASE WHEN v_can_value THEN g.nilai END)
           ORDER BY g.po_count DESC, g.item_count DESC, g.nama), '[]'::JSONB)
    INTO v_part
    FROM (
      SELECT COALESCE(v.vendor_name, 'Tanpa vendor') AS nama,
             count(DISTINCT p.id) AS po_count,
             count(*) AS item_count,
             sum(CASE WHEN COALESCE(NULLIF(p.po_currency, ''), 'IDR') = 'IDR'
                      THEN COALESCE(i.qty, 0) * COALESCE(i.harga, 0) ELSE 0 END) AS nilai
      FROM public.pos p
      JOIN public.po_items i ON i.po_id = p.id
      LEFT JOIN public.vendors v ON v.id = i.vendor_id
      WHERE p.po_tanggal BETWEEN v_from AND v_to
        AND p.po_status NOT IN ('rejected', 'cancelled')
        AND (v_all OR p.cabang_id = ANY (p_cabang_ids))
      GROUP BY 1
      ORDER BY count(DISTINCT p.id) DESC, count(*) DESC
      LIMIT 8
    ) g;
    v_exec := v_exec || jsonb_build_object('top_vendors', v_part);

    -- Barang paling sering diminta periode ini.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'part_number', g.part_number, 'part_name', g.part_name,
             'mr', g.mr_count, 'qty', g.qty, 'satuan', g.satuan)
           ORDER BY g.mr_count DESC, g.qty DESC, g.part_number), '[]'::JSONB)
    INTO v_part
    FROM (
      SELECT i.part_number, max(i.part_name) AS part_name, max(i.satuan) AS satuan,
             count(DISTINCT m.id) AS mr_count,
             COALESCE(sum(i.qty_request), 0) AS qty
      FROM public.dashboard_mr_scope(p_cabang_ids, p_kategori, p_priorities) m
      JOIN public.mr_items i ON i.mr_id = m.id
      WHERE m.mr_tanggal BETWEEN v_from AND v_to
        AND m.mr_status NOT IN ('rejected', 'cancelled')
        AND COALESCE(i.item_status, '') <> 'rejected'
      GROUP BY i.part_number
      ORDER BY count(DISTINCT m.id) DESC, sum(i.qty_request) DESC
      LIMIT 8
    ) g;
    v_exec := v_exec || jsonb_build_object('top_parts', v_part);
  END IF;

  RETURN jsonb_build_object(
    'part',       p_part,
    'viewer',     v_viewer,
    'cabang_ids', COALESCE(to_jsonb(p_cabang_ids), '[]'::JSONB),
    -- Opsi filter lokasi, ikut di sini supaya halaman tidak perlu query kedua.
    'cabang_options', CASE WHEN v_do_core THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nama', c.nama_cabang) ORDER BY c.nama_cabang)
      FROM public.cabang c WHERE c.is_active), '[]'::JSONB) END,
    'today',      v_today,
    'date_from',  v_from,
    'date_to',    v_to,
    'prev_from',  p_prev_from,
    'prev_to',    p_prev_to,
    'trend_from', v_trend,
    'queue',      v_queue,
    'approval',   v_approval,
    'period',     v_period,
    'po_value',   v_value,
    'exec',       CASE WHEN v_is_exec THEN v_exec END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_main_dashboard_summary(
  BIGINT[], DATE, DATE, DATE, DATE, DATE, TEXT[], TEXT[], BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
