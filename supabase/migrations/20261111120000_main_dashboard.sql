-- Migration: Dashboard utama (/dashboard)
-- Date: 2026-11-11
-- Description:
--   RPC read-only untuk dashboard utama. Tidak ada perubahan tabel/kolom;
--   hanya index bantu + function. Idempotent: aman dijalankan ulang.
--
--   1. get_main_dashboard_summary(...)  -> JSONB
--      Satu panggilan untuk semua angka dashboard: antrian yang perlu
--      perhatian (state saat ini), aktivitas periode + pembanding periode
--      sebelumnya, lead time, tren harian, pipeline level MR, umur approval,
--      stok min/max, vendor & barang teratas, ringkasan penjualan.
--
--   2. get_main_dashboard_list(kind, ...) -> JSONB { total, rows }
--      Daftar sumber data di balik tiap kartu (drill-down), berpaginasi.
--      Predikat tiap "kind" sama persis dengan angka di summary.
--
--   Helper (dipakai dua RPC di atas supaya definisinya satu tempat):
--     dashboard_viewer, dashboard_mr_scope, dashboard_mr_levels,
--     dashboard_pending_approvals, dashboard_spb_progress, dashboard_list_rows.
--
--   Aturan filter:
--     - p_cabang_ids NULL / kosong = semua lokasi.
--     - Tanggal memakai tanggal dokumen (mr_tanggal, pr_tanggal, po_tanggal,
--       ri_tanggal, ...) -- sama dengan filter "dari/sampai" di halaman list.
--       date_from & date_to INKLUSIF.
--     - p_kategori / p_priorities hanya berlaku untuk angka MR.
--     - "Hari ini" = tanggal WIB (Asia/Jakarta).
--
--   Hak akses ditentukan DI SINI dari role user yang login (auth.uid()),
--   bukan dari parameter, lewat dashboard_viewer():
--     - is_exec   : moderator / manager / spv / pjo / gl. Hanya mereka yang
--                   mendapat analitik seluruh perusahaan (blok "exec").
--                   User lain default-nya hanya lokasi cabangnya sendiri.
--     - can_value : purchasing. Sama dengan canViewPOPrice di
--                   lib/po-price-access.ts -- nilai Rupiah PO hanya untuk mereka.
--   Karena itu halaman cukup SATU panggilan RPC (profil + role + angka).
--   SECURITY INVOKER: RLS tabel tetap berlaku.

-- ============================================================
-- 0. Index bantu
-- ============================================================

-- stock ~ratusan ribu baris, tapi yang punya min/max hanya sebagian kecil.
-- Tanpa index ini hitung stok menipis = seq scan seluruh tabel.
CREATE INDEX IF NOT EXISTS idx_stock_minmax_set
  ON public.stock (cabang_id)
  WHERE (min_qty <> 0 OR max_qty <> 0);

-- FK yang sering di-join tapi belum ber-index.
CREATE INDEX IF NOT EXISTS idx_mr_items_mr_id ON public.mr_items (mr_id);
CREATE INDEX IF NOT EXISTS idx_pr_items_pr_id ON public.pr_items (pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_items_mr_id ON public.pr_items (mr_id);
CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON public.po_items (po_id);
CREATE INDEX IF NOT EXISTS idx_receives_po_id ON public.receives (po_id);
CREATE INDEX IF NOT EXISTS idx_receive_items_ri_id ON public.receive_items (ri_id);

-- ============================================================
-- 0b. Helper: siapa yang membuka dashboard + hak aksesnya
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_viewer()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id',        p.id,
    'nama',      p.nama,
    'cabang_id', p.cabang_id,
    'cabang',    c.nama_cabang,
    'roles',     COALESCE(r.roles, '[]'::JSONB),
    'is_exec',   COALESCE(r.is_exec, FALSE),
    'can_value', COALESCE(r.can_value, FALSE)
  )
  FROM public.profiles p
  LEFT JOIN public.cabang c ON c.id = p.cabang_id
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(jsonb_build_object('name', ro.name, 'label', ro.label) ORDER BY ro.id) AS roles,
      bool_or(ro.name IN ('moderator', 'manager', 'spv', 'pjo', 'gl')) AS is_exec,
      bool_or(ro.name = 'purchasing') AS can_value
    FROM public.user_roles ur
    JOIN public.roles ro ON ro.id = ur.role_id
    WHERE ur.user_id = p.id
  ) r ON TRUE
  WHERE p.id = auth.uid();
$$;

-- ============================================================
-- 1. Helper: MR sesuai filter lokasi / kategori / prioritas
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_mr_scope(
  p_cabang_ids BIGINT[] DEFAULT NULL,
  p_kategori   TEXT[]   DEFAULT NULL,
  p_priorities TEXT[]   DEFAULT NULL
)
RETURNS SETOF public.mrs
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT m.*
  FROM public.mrs m
  WHERE (p_cabang_ids IS NULL OR cardinality(p_cabang_ids) = 0
         OR m.cabang_id = ANY (p_cabang_ids))
    AND (p_kategori IS NULL OR cardinality(p_kategori) = 0
         OR m.kategori = ANY (p_kategori))
    AND (p_priorities IS NULL OR cardinality(p_priorities) = 0
         OR EXISTS (
           SELECT 1 FROM public.mr_items i
           WHERE i.mr_id = m.id AND i.item_priority = ANY (p_priorities)
         ));
$$;

-- ============================================================
-- 2. Helper: level MR aktif (open / approved)
--    Meniru computeMrAutoBucket di lib/mr-level.ts + override manual_level.
--    Bucket: WAITING_APPROVAL, OPEN_1, OPEN_2, OPEN_3_5, CLOSE_1, CLOSE_2.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_mr_levels(
  p_cabang_ids BIGINT[] DEFAULT NULL,
  p_kategori   TEXT[]   DEFAULT NULL,
  p_priorities TEXT[]   DEFAULT NULL
)
RETURNS TABLE (mr_id BIGINT, bucket TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH rules AS (
    SELECT
      COALESCE((SELECT r.pending_convert_statuses
                FROM public.mr_level_auto_rules r WHERE r.id = 1),
               ARRAY['pending']::TEXT[]) AS pending_statuses,
      COALESCE((SELECT r.close_start_min_received_pct
                FROM public.mr_level_auto_rules r WHERE r.id = 1), 0) AS close_start,
      COALESCE((SELECT r.close_done_min_received_pct
                FROM public.mr_level_auto_rules r WHERE r.id = 1), 100) AS close_done
  ),
  m AS MATERIALIZED (
    SELECT s.id, s.mr_status::TEXT AS mr_status, s.mr_convert_status, s.manual_level
    FROM public.dashboard_mr_scope(p_cabang_ids, p_kategori, p_priorities) s
    WHERE s.mr_status IN ('open', 'approved')
  ),
  q AS (
    SELECT i.mr_id,
           COALESCE(sum(i.qty_request), 0)  AS req,
           COALESCE(sum(i.qty_received), 0) AS recv
    FROM public.mr_items i
    JOIN m ON m.id = i.mr_id
    WHERE COALESCE(i.item_status, '') <> 'rejected'
    GROUP BY i.mr_id
  ),
  hp AS (
    SELECT DISTINCT pri.mr_id
    FROM public.pr_items pri
    JOIN m ON m.id = pri.mr_id
    JOIN public.po_items poi ON poi.pr_item_id = pri.id
  )
  SELECT
    m.id,
    CASE
      WHEN m.mr_status = 'open' THEN 'WAITING_APPROVAL'
      WHEN m.manual_level IN ('OPEN_1', 'OPEN_2', 'CLOSE_1') THEN m.manual_level
      WHEN m.manual_level IN ('OPEN_3A', 'OPEN_3B', 'OPEN_3C', 'OPEN_4', 'OPEN_5') THEN 'OPEN_3_5'
      WHEN m.manual_level IN ('CLOSE_2A', 'CLOSE_2B') THEN 'CLOSE_2'
      WHEN COALESCE(q.req, 0) > 0
           AND (q.recv * 100.0 / q.req) >= rules.close_done THEN 'CLOSE_2'
      WHEN COALESCE(q.recv, 0) > 0
           AND (CASE WHEN q.req > 0 THEN q.recv * 100.0 / q.req ELSE 0 END) >= rules.close_start
        THEN 'CLOSE_1'
      WHEN m.mr_convert_status IS NULL OR m.mr_convert_status = ''
           OR m.mr_convert_status = ANY (rules.pending_statuses) THEN 'OPEN_1'
      WHEN hp.mr_id IS NULL THEN 'OPEN_2'
      ELSE 'OPEN_3_5'
    END
  FROM m
  CROSS JOIN rules
  LEFT JOIN q  ON q.mr_id = m.id
  LEFT JOIN hp ON hp.mr_id = m.id;
$$;

-- ============================================================
-- 3. Helper: dokumen yang sedang menunggu approval
--    Approval berurutan -> approver saat ini = step "pending" pertama.
--    waiting_since = waktu step terakhir disetujui (atau dokumen dibuat).
--    href berakhiran "=" artinya URL pencarian: client menambahkan kode
--    dokumen (di-encode) di belakangnya.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_pending_approvals(
  p_cabang_ids BIGINT[] DEFAULT NULL
)
RETURNS TABLE (
  doc_type      TEXT,
  doc_id        BIGINT,
  kode          TEXT,
  href          TEXT,
  cabang_id     BIGINT,
  tanggal       DATE,
  created_at    TIMESTAMPTZ,
  approver      TEXT,
  approver_id   TEXT,
  waiting_since TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH docs AS (
    SELECT 'mr'::TEXT AS doc_type, m.id AS doc_id, m.mr_kode AS kode,
           '/mr/' || m.id AS href, m.cabang_id, m.mr_tanggal AS tanggal,
           m.created_at, m.approvals
    FROM public.mrs m
    WHERE m.mr_status = 'open'
    UNION ALL
    SELECT 'pr', p.id, p.pr_kode, '/pr/' || p.id, p.cabang_id, p.pr_tanggal,
           p.created_at, p.approvals
    FROM public.prs p
    WHERE p.pr_status = 'open'
    UNION ALL
    SELECT 'po', p.id, p.po_kode, '/po/' || p.id, p.cabang_id, p.po_tanggal,
           p.created_at, p.approvals
    FROM public.pos p
    WHERE p.po_status = 'open'
    UNION ALL
    SELECT 'ri', r.id, r.ri_kode, '/receive?search=', r.cabang_id, r.ri_tanggal,
           r.created_at, r.approvals
    FROM public.receives r
    WHERE r.ri_status = 'open'
    UNION ALL
    SELECT 'it', t.id, t.it_kode, '/item-transfer/' || t.id, t.dari_cabang_id,
           t.it_tanggal, t.created_at, t.approvals
    FROM public.item_transfers t
    WHERE t.status = 'open'
    UNION ALL
    SELECT 'wo', w.id, w.wo_kode, '/working-order/' || w.id, w.gudang_cabang_id,
           w.wo_tanggal, w.created_at, w.approvals
    FROM public.working_orders w
    WHERE w.wo_status = 'Pending Approval'
    UNION ALL
    SELECT 'spb', s.id, s.spb_no, '/spb?search=', s.cabang_id,
           (s.spb_tanggal AT TIME ZONE 'Asia/Jakarta')::DATE, s.created_at, s.approvals
    FROM public.spb s
    WHERE s.approval_status = 'open'
      AND s.spb_is_deleted = FALSE
      AND s.spb_status <> 'CANCELLED'
    UNION ALL
    SELECT 'spb_invoice', i.id, i.invoice_no, '/spb/invoice?search=', s.cabang_id,
           (COALESCE(i.invoice_date, i.created_at) AT TIME ZONE 'Asia/Jakarta')::DATE,
           i.created_at, i.approvals
    FROM public.spb_invoice i
    JOIN public.spb_do d ON d.id = i.spb_do_id
    JOIN public.spb_po p ON p.id = d.spb_po_id
    JOIN public.spb s    ON s.id = p.spb_id
    WHERE i.approval_status = 'open'
      AND s.spb_is_deleted = FALSE
    UNION ALL
    SELECT 'return_spb', r.id, r.rtn_kode, '/return-spb?search=', s.cabang_id,
           (r.rtn_tanggal AT TIME ZONE 'Asia/Jakarta')::DATE, r.created_at, r.approvals
    FROM public.return_spb r
    JOIN public.spb s ON s.id = r.spb_id
    WHERE r.approval_status = 'open'
      AND s.spb_is_deleted = FALSE
  ),
  a AS (
    SELECT d.*,
           CASE WHEN jsonb_typeof(d.approvals) = 'array'
                THEN d.approvals ELSE '[]'::JSONB END AS steps
    FROM docs d
    WHERE (p_cabang_ids IS NULL OR cardinality(p_cabang_ids) = 0
           OR d.cabang_id = ANY (p_cabang_ids))
  )
  SELECT
    a.doc_type, a.doc_id, a.kode, a.href, a.cabang_id, a.tanggal, a.created_at,
    cur.approver, cur.approver_id,
    COALESCE(prev.last_at, a.created_at) AS waiting_since
  FROM a
  LEFT JOIN LATERAL (
    SELECT NULLIF(btrim(e.elem->>'nama'), '') AS approver,
           COALESCE(e.elem->>'user_id', e.elem->>'userid') AS approver_id
    FROM jsonb_array_elements(a.steps) WITH ORDINALITY AS e(elem, ord)
    WHERE e.elem->>'status' = 'pending'
    ORDER BY e.ord
    LIMIT 1
  ) cur ON TRUE
  LEFT JOIN LATERAL (
    SELECT max((e.elem->>'processed_at')::TIMESTAMPTZ) AS last_at
    FROM jsonb_array_elements(a.steps) AS e(elem)
    WHERE e.elem->>'status' = 'approved'
      AND e.elem->>'processed_at' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
  ) prev ON TRUE;
$$;

-- ============================================================
-- 4. Helper: posisi SPB aktif (tanpa Cancelled / terhapus)
--    Definisi sama dengan "Progress Dokumen" di get_spb_dashboard_summary.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_spb_progress(
  p_cabang_ids BIGINT[] DEFAULT NULL
)
RETURNS TABLE (spb_id BIGINT, stage TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH s AS MATERIALIZED (
    SELECT sp.id
    FROM public.spb sp
    WHERE sp.spb_is_deleted = FALSE
      AND sp.spb_status <> 'CANCELLED'
      AND (p_cabang_ids IS NULL OR cardinality(p_cabang_ids) = 0
           OR sp.cabang_id = ANY (p_cabang_ids))
  ),
  po AS MATERIALIZED (
    SELECT p.id, p.spb_id FROM public.spb_po p JOIN s ON s.id = p.spb_id
  ),
  dlv AS MATERIALIZED (
    SELECT d.id, po.spb_id FROM public.spb_do d JOIN po ON po.id = d.spb_po_id
  ),
  inv AS (
    SELECT DISTINCT dlv.spb_id
    FROM public.spb_invoice i JOIN dlv ON dlv.id = i.spb_do_id
  )
  SELECT
    s.id,
    CASE
      WHEN fi.spb_id IS NOT NULL THEN 'sudah_invoice'
      WHEN fd.spb_id IS NOT NULL THEN 'do_belum_invoice'
      WHEN fp.spb_id IS NOT NULL THEN 'po_belum_do'
      ELSE 'belum_po'
    END
  FROM s
  LEFT JOIN (SELECT DISTINCT spb_id FROM po)  fp ON fp.spb_id = s.id
  LEFT JOIN (SELECT DISTINCT spb_id FROM dlv) fd ON fd.spb_id = s.id
  LEFT JOIN inv fi ON fi.spb_id = s.id;
$$;

-- ============================================================
-- 5. Ringkasan dashboard
-- ============================================================
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
  p_own_cabang_default BOOLEAN DEFAULT FALSE
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
  v_queue    JSONB := '{}'::JSONB;
  v_period   JSONB := '{}'::JSONB;
  v_approval JSONB := '{}'::JSONB;
  v_exec     JSONB := '{}'::JSONB;
  v_value    JSONB := NULL;
BEGIN
  v_is_exec   := COALESCE((v_viewer->>'is_exec')::BOOLEAN, FALSE);
  v_can_value := COALESCE((v_viewer->>'can_value')::BOOLEAN, FALSE);

  -- User non-exec tanpa pilihan lokasi -> cabangnya sendiri.
  IF p_own_cabang_default
     AND NOT v_is_exec
     AND (p_cabang_ids IS NULL OR cardinality(p_cabang_ids) = 0)
     AND (v_viewer->>'cabang_id') IS NOT NULL THEN
    p_cabang_ids := ARRAY[(v_viewer->>'cabang_id')::BIGINT];
  END IF;
  v_all := (p_cabang_ids IS NULL OR cardinality(p_cabang_ids) = 0);

  v_lo    := LEAST(v_from, COALESCE(p_prev_from, v_from));
  v_trend := LEAST(COALESCE(p_trend_from, v_from), v_from);

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

  -- ==========================================================
  -- B. APPROVAL (giliran saya selalu; ranking & umur hanya exec)
  -- ==========================================================
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
    'stale', (SELECT count(*) FROM pa WHERE pa.age_days > 7),
    'aging', CASE WHEN v_is_exec THEN COALESCE((
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
    ), '[]'::JSONB) END,
    'approvers', CASE WHEN v_is_exec THEN COALESCE((
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
    ), '[]'::JSONB) END
  ) INTO v_approval;

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

  -- ==========================================================
  -- E. ANALITIK EKSEKUTIF
  -- ==========================================================
  IF v_is_exec THEN
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
    'viewer',     v_viewer,
    'cabang_ids', COALESCE(to_jsonb(p_cabang_ids), '[]'::JSONB),
    -- Opsi filter lokasi, ikut di sini supaya halaman tidak perlu query kedua.
    'cabang_options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nama', c.nama_cabang) ORDER BY c.nama_cabang)
      FROM public.cabang c WHERE c.is_active), '[]'::JSONB),
    'today',      v_today,
    'date_from',  v_from,
    'date_to',    v_to,
    'prev_from',  p_prev_from,
    'prev_to',    p_prev_to,
    'queue',      v_queue,
    'approval',   v_approval,
    'period',     v_period,
    'po_value',   v_value,
    'exec',       CASE WHEN v_is_exec THEN v_exec END
  );
END;
$$;

-- ============================================================
-- 6. Baris drill-down per "kind"
--    o_sort DESC NULLS LAST lalu o_text ASC = urutan tampil (paling kritis
--    dulu). o_search = teks yang dicari kotak pencarian.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dashboard_list_rows(
  p_kind          TEXT,
  p_cabang_ids    BIGINT[],
  p_date_from     DATE,
  p_date_to       DATE,
  p_kategori      TEXT[],
  p_priorities    TEXT[],
  p_args          JSONB
)
RETURNS TABLE (o_sort NUMERIC, o_text TEXT, o_search TEXT, o_item JSONB)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Jakarta')::DATE;
  v_all   BOOLEAN := (p_cabang_ids IS NULL OR cardinality(p_cabang_ids) = 0);
  v_to    DATE := COALESCE(p_date_to, (now() AT TIME ZONE 'Asia/Jakarta')::DATE);
  v_from  DATE := COALESCE(p_date_from,
                    date_trunc('month', COALESCE(p_date_to, (now() AT TIME ZONE 'Asia/Jakarta')::DATE))::DATE);
  v_arg   JSONB := COALESCE(p_args, '{}'::JSONB);
  v_me    TEXT := auth.uid()::TEXT;
  -- Nilai Rupiah PO hanya untuk role purchasing (lihat dashboard_viewer).
  v_can_value BOOLEAN :=
    COALESCE((public.dashboard_viewer()->>'can_value')::BOOLEAN, FALSE);
  v_epoch CONSTANT DATE := DATE '2000-01-01';
BEGIN
  -- ---------------- Material Request ----------------
  IF p_kind IN ('mr_open', 'mr_overdue', 'mr_frozen', 'mr_need_pr', 'mr_level', 'mr_period') THEN
    RETURN QUERY
    SELECT
      (CASE p_kind
         WHEN 'mr_overdue' THEN v_today - m.mr_due_date
         WHEN 'mr_period'  THEN m.mr_tanggal - v_epoch
         ELSE v_today - m.mr_tanggal
       END)::NUMERIC,
      m.mr_kode,
      concat_ws(' ', m.mr_kode, m.mr_pic, c.nama_cabang, m.kategori),
      jsonb_build_object(
        'id', m.id, 'kode', m.mr_kode, 'href', '/mr/' || m.id,
        'tanggal', m.mr_tanggal, 'due_date', m.mr_due_date,
        'hari_lewat', CASE WHEN m.mr_status IN ('open', 'approved') AND m.mr_due_date < v_today
                           THEN v_today - m.mr_due_date END,
        'umur_hari', GREATEST(v_today - m.mr_tanggal, 0),
        'lokasi', c.nama_cabang, 'pic', m.mr_pic, 'status', m.mr_status::TEXT,
        'kategori', m.kategori, 'konversi', m.mr_convert_status,
        'level', lv.bucket, 'catatan', m.frozen_reason)
    FROM public.dashboard_mr_scope(p_cabang_ids, p_kategori, p_priorities) m
    LEFT JOIN public.cabang c ON c.id = m.cabang_id
    LEFT JOIN public.dashboard_mr_levels(p_cabang_ids, p_kategori, p_priorities) lv
           ON lv.mr_id = m.id
    WHERE CASE p_kind
      WHEN 'mr_open'    THEN m.mr_status = 'open'
      WHEN 'mr_overdue' THEN m.mr_status IN ('open', 'approved') AND m.mr_due_date < v_today
      WHEN 'mr_frozen'  THEN COALESCE(m.is_frozen, FALSE)
      WHEN 'mr_need_pr' THEN m.mr_status = 'approved'
                             AND m.mr_convert_status IN ('pending', 'partial')
                             AND EXISTS (
                               SELECT 1 FROM public.mr_items i
                               WHERE i.mr_id = m.id
                                 AND COALESCE(i.qty_pr, 0) > 0
                                 AND COALESCE(i.item_status, '') <> 'rejected')
      WHEN 'mr_level'   THEN lv.bucket = (v_arg->>'bucket')
      WHEN 'mr_period'  THEN m.mr_tanggal BETWEEN v_from AND v_to
                             AND (v_arg->>'status' IS NULL
                                  OR (v_arg->>'status' = 'completed'
                                      AND m.mr_status IN ('completed', 'done', 'closed'))
                                  OR (v_arg->>'status' = 'rejected'
                                      AND m.mr_status IN ('rejected', 'cancelled'))
                                  OR m.mr_status::TEXT = v_arg->>'status')
      ELSE FALSE
    END;

  -- ---------------- Purchase Request ----------------
  ELSIF p_kind IN ('pr_open', 'pr_need_po', 'pr_period') THEN
    RETURN QUERY
    SELECT
      (CASE p_kind WHEN 'pr_period' THEN p.pr_tanggal - v_epoch
                   ELSE v_today - p.pr_tanggal END)::NUMERIC,
      p.pr_kode,
      concat_ws(' ', p.pr_kode, pf.nama, c.nama_cabang, mr.mr_kode),
      jsonb_build_object(
        'id', p.id, 'kode', p.pr_kode, 'href', '/pr/' || p.id,
        'tanggal', p.pr_tanggal, 'umur_hari', GREATEST(v_today - p.pr_tanggal, 0),
        'lokasi', c.nama_cabang, 'pic', pf.nama, 'status', p.pr_status::TEXT,
        'status_po', p.pr_convert_status, 'mr_kode', mr.mr_kode)
    FROM public.prs p
    LEFT JOIN public.cabang c    ON c.id = p.cabang_id
    LEFT JOIN public.profiles pf ON pf.id = p.pr_pic_id
    LEFT JOIN public.mrs mr      ON mr.id = p.mr_id
    WHERE (v_all OR p.cabang_id = ANY (p_cabang_ids))
      AND CASE p_kind
        WHEN 'pr_open'    THEN p.pr_status = 'open'
        WHEN 'pr_need_po' THEN p.pr_status = 'approved'
                               AND p.pr_convert_status IN ('pending', 'partial')
        WHEN 'pr_period'  THEN p.pr_tanggal BETWEEN v_from AND v_to
        ELSE FALSE
      END;

  -- ---------------- Purchase Order ----------------
  ELSIF p_kind IN ('po_open', 'po_not_received', 'po_overdue', 'po_period') THEN
    RETURN QUERY
    SELECT
      (CASE p_kind
         WHEN 'po_period'  THEN p.po_tanggal - v_epoch
         WHEN 'po_overdue' THEN v_today - p.po_estimasi
         WHEN 'po_not_received' THEN COALESCE(v_today - p.po_estimasi, -100000)
         ELSE v_today - p.po_tanggal
       END)::NUMERIC,
      p.po_kode,
      concat_ws(' ', p.po_kode, p.po_pic, c.nama_cabang, it.vendors),
      jsonb_build_object(
        'id', p.id, 'kode', p.po_kode, 'href', '/po/' || p.id,
        'tanggal', p.po_tanggal, 'estimasi', p.po_estimasi,
        'hari_lewat', CASE WHEN p.po_status = 'approved'
                             AND COALESCE(p.po_receive_status, 'pending') IN ('pending', 'partial')
                             AND p.po_estimasi < v_today
                           THEN v_today - p.po_estimasi END,
        'umur_hari', GREATEST(v_today - p.po_tanggal, 0),
        'lokasi', c.nama_cabang, 'pic', p.po_pic, 'status', p.po_status::TEXT,
        'status_terima', COALESCE(p.po_receive_status, 'pending'),
        'vendor', it.vendors,
        'qty', it.qty, 'qty_diterima', it.qty_received,
        'mata_uang', COALESCE(NULLIF(p.po_currency, ''), 'IDR'),
        'nilai', CASE WHEN v_can_value THEN it.nilai END)
    FROM public.pos p
    LEFT JOIN public.cabang c ON c.id = p.cabang_id
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT v.vendor_name, ', ') AS vendors,
             COALESCE(sum(i.qty), 0) AS qty,
             COALESCE(sum(i.qty_received), 0) AS qty_received,
             COALESCE(sum(COALESCE(i.qty, 0) * COALESCE(i.harga, 0)), 0) AS nilai
      FROM public.po_items i
      LEFT JOIN public.vendors v ON v.id = i.vendor_id
      WHERE i.po_id = p.id
    ) it ON TRUE
    WHERE (v_all OR p.cabang_id = ANY (p_cabang_ids))
      AND CASE p_kind
        WHEN 'po_open' THEN p.po_status = 'open'
        WHEN 'po_not_received' THEN p.po_status = 'approved'
             AND COALESCE(p.po_receive_status, 'pending') IN ('pending', 'partial')
        WHEN 'po_overdue' THEN p.po_status = 'approved'
             AND COALESCE(p.po_receive_status, 'pending') IN ('pending', 'partial')
             AND p.po_estimasi < v_today
        WHEN 'po_period' THEN p.po_tanggal BETWEEN v_from AND v_to
             AND (v_arg->>'receive' IS NULL
                  OR (p.po_status NOT IN ('rejected', 'cancelled')
                      AND COALESCE(p.po_receive_status, 'pending') = v_arg->>'receive'))
        ELSE FALSE
      END;

  -- ---------------- Receive Item ----------------
  ELSIF p_kind IN ('ri_open', 'ri_period') THEN
    RETURN QUERY
    SELECT
      (CASE p_kind WHEN 'ri_period' THEN r.ri_tanggal - v_epoch
                   ELSE v_today - r.ri_tanggal END)::NUMERIC,
      r.ri_kode,
      concat_ws(' ', r.ri_kode, r.ri_pic, c.nama_cabang, po.po_kode),
      jsonb_build_object(
        'id', r.id, 'kode', r.ri_kode, 'href', '/receive?search=',
        'tanggal', r.ri_tanggal, 'umur_hari', GREATEST(v_today - r.ri_tanggal, 0),
        'lokasi', c.nama_cabang, 'pic', r.ri_pic, 'status', r.ri_status,
        'po_kode', po.po_kode)
    FROM public.receives r
    LEFT JOIN public.cabang c ON c.id = r.cabang_id
    LEFT JOIN public.pos po   ON po.id = r.po_id
    WHERE (v_all OR r.cabang_id = ANY (p_cabang_ids))
      AND CASE p_kind
        WHEN 'ri_open'   THEN r.ri_status = 'open'
        WHEN 'ri_period' THEN r.ri_tanggal BETWEEN v_from AND v_to
        ELSE FALSE
      END;

  -- ---------------- Approval ----------------
  ELSIF p_kind = 'approval_pending' THEN
    RETURN QUERY
    SELECT
      x.age_days::NUMERIC,
      x.kode,
      concat_ws(' ', x.kode, x.approver, x.nama_cabang),
      jsonb_build_object(
        'id', x.doc_id, 'doc_type', x.doc_type, 'kode', x.kode, 'href', x.href,
        'tanggal', x.tanggal, 'lokasi', x.nama_cabang,
        'approver', COALESCE(x.approver, 'Belum ada approver'),
        'umur_hari', x.age_days)
    FROM (
      SELECT a.*, c.nama_cabang,
             GREATEST(v_today - (a.waiting_since AT TIME ZONE 'Asia/Jakarta')::DATE, 0) AS age_days
      FROM public.dashboard_pending_approvals(p_cabang_ids) a
      LEFT JOIN public.cabang c ON c.id = a.cabang_id
    ) x
    WHERE (COALESCE((v_arg->>'mine')::BOOLEAN, FALSE) = FALSE
           OR (v_me IS NOT NULL AND x.approver_id = v_me))
      AND (NOT (v_arg ? 'approver')
           OR x.approver_id IS NOT DISTINCT FROM NULLIF(v_arg->>'approver', ''))
      AND (v_arg->>'doc' IS NULL OR x.doc_type = v_arg->>'doc')
      AND (v_arg->>'stale' IS NULL OR x.age_days > 7)
      AND (v_arg->>'age' IS NULL OR CASE v_arg->>'age'
             WHEN '0' THEN x.age_days <= 2
             WHEN '1' THEN x.age_days BETWEEN 3 AND 7
             WHEN '2' THEN x.age_days BETWEEN 8 AND 14
             WHEN '3' THEN x.age_days > 14
             ELSE TRUE END);

  -- ---------------- Stok ----------------
  ELSIF p_kind IN ('stock_low', 'stock_over') THEN
    RETURN QUERY
    SELECT
      (CASE p_kind WHEN 'stock_low' THEN s.min_qty - s.qty ELSE s.qty - s.max_qty END)::NUMERIC,
      b.part_number,
      concat_ws(' ', b.part_number, b.part_name, c.nama_cabang),
      jsonb_build_object(
        'id', s.id, 'kode', b.part_number, 'href', '/stock?search=',
        'part_name', b.part_name, 'satuan', b.part_satuan, 'lokasi', c.nama_cabang,
        'qty', s.qty, 'min_qty', s.min_qty, 'max_qty', s.max_qty,
        'selisih', CASE p_kind WHEN 'stock_low' THEN s.min_qty - s.qty ELSE s.qty - s.max_qty END)
    FROM public.stock s
    JOIN public.barang b ON b.id = s.part_id
    JOIN public.cabang c ON c.id = s.cabang_id
    WHERE (s.min_qty <> 0 OR s.max_qty <> 0)
      AND (v_all OR s.cabang_id = ANY (p_cabang_ids))
      AND CASE p_kind
        WHEN 'stock_low'  THEN s.qty < s.min_qty
        WHEN 'stock_over' THEN NOT (s.qty < s.min_qty) AND s.qty > s.max_qty
        ELSE FALSE
      END;

  -- ---------------- Item Transfer ----------------
  ELSIF p_kind IN ('it_open', 'it_active', 'it_period') THEN
    RETURN QUERY
    SELECT
      (CASE p_kind WHEN 'it_period' THEN t.it_tanggal - v_epoch
                   ELSE v_today - t.it_tanggal END)::NUMERIC,
      t.it_kode,
      concat_ws(' ', t.it_kode, t.pic, cd.nama_cabang, ck.nama_cabang, t.no_resi),
      jsonb_build_object(
        'id', t.id, 'kode', t.it_kode, 'href', '/item-transfer/' || t.id,
        'tanggal', t.it_tanggal, 'umur_hari', GREATEST(v_today - t.it_tanggal, 0),
        'dari', cd.nama_cabang, 'ke', ck.nama_cabang, 'pic', t.pic,
        'status', t.status::TEXT, 'tracking', COALESCE(t.tracking_status, 'created'),
        'ekspedisi', t.ekspedisi, 'no_resi', t.no_resi)
    FROM public.item_transfers t
    LEFT JOIN public.cabang cd ON cd.id = t.dari_cabang_id
    LEFT JOIN public.cabang ck ON ck.id = t.ke_cabang_id
    WHERE (v_all OR t.dari_cabang_id = ANY (p_cabang_ids) OR t.ke_cabang_id = ANY (p_cabang_ids))
      AND CASE p_kind
        WHEN 'it_open'   THEN t.status = 'open'
        WHEN 'it_active' THEN t.status = 'approved'
        WHEN 'it_period' THEN t.it_tanggal BETWEEN v_from AND v_to
        ELSE FALSE
      END;

  -- ---------------- Delivery ----------------
  ELSIF p_kind = 'dlv_ongoing' THEN
    RETURN QUERY
    SELECT
      (v_today - (d.created_at AT TIME ZONE 'Asia/Jakarta')::DATE)::NUMERIC,
      d.dlv_kode,
      concat_ws(' ', d.dlv_kode, d.pic, cd.nama_cabang, ck.nama_cabang, d.no_resi),
      jsonb_build_object(
        'id', d.id, 'kode', d.dlv_kode, 'href', '/deliveries?search=',
        'tanggal', (d.created_at AT TIME ZONE 'Asia/Jakarta')::DATE,
        'umur_hari', GREATEST(v_today - (d.created_at AT TIME ZONE 'Asia/Jakarta')::DATE, 0),
        'dari', cd.nama_cabang, 'ke', ck.nama_cabang, 'pic', d.pic,
        'status', d.status::TEXT, 'tracking', d.tracking_status,
        'ekspedisi', d.ekspedisi, 'no_resi', d.no_resi)
    FROM public.deliveries d
    LEFT JOIN public.cabang cd ON cd.id = d.dari_cabang_id
    LEFT JOIN public.cabang ck ON ck.id = d.ke_cabang_id
    WHERE d.status IN ('open', 'approved')
      AND (v_all OR d.dari_cabang_id = ANY (p_cabang_ids) OR d.ke_cabang_id = ANY (p_cabang_ids));

  -- ---------------- Request stok ----------------
  ELSIF p_kind = 'stock_request_open' THEN
    RETURN QUERY
    SELECT
      (v_today - (r.created_at AT TIME ZONE 'Asia/Jakarta')::DATE)::NUMERIC,
      r.part_number,
      concat_ws(' ', r.part_number, r.part_name, c.nama_cabang, pf.nama),
      jsonb_build_object(
        'id', r.id, 'kode', r.part_number, 'href', '/stock-requests?search=',
        'part_name', r.part_name, 'lokasi', c.nama_cabang,
        'tanggal', (r.created_at AT TIME ZONE 'Asia/Jakarta')::DATE,
        'umur_hari', GREATEST(v_today - (r.created_at AT TIME ZONE 'Asia/Jakarta')::DATE, 0),
        'alasan', CASE r.reason WHEN 'no_policy' THEN 'Belum ada min/max'
                                WHEN 'limit_reached' THEN 'Melebihi maksimum'
                                ELSE r.reason END,
        'qty', r.current_qty, 'max_qty', r.max_qty, 'pic', pf.nama)
    FROM public.stock_setting_requests r
    LEFT JOIN public.cabang c    ON c.id = r.cabang_id
    LEFT JOIN public.profiles pf ON pf.id = r.requested_by
    WHERE r.status = 'open'
      AND (v_all OR r.cabang_id = ANY (p_cabang_ids));

  -- ---------------- Barang dalam pengiriman ----------------
  ELSIF p_kind IN ('supply_in_transit', 'supply_overdue') THEN
    RETURN QUERY
    SELECT
      COALESCE(v_today - s.deadline, -100000)::NUMERIC,
      COALESCE(s.part_number, ''),
      concat_ws(' ', s.part_number, s.part_name, cs.nama_cabang, cd.nama_cabang, mr.mr_kode, dl.dlv_kode),
      jsonb_build_object(
        'id', s.id, 'kode', s.part_number, 'href', '/planning-supply?search=',
        'part_name', s.part_name, 'satuan', s.satuan, 'qty', s.qty,
        'dari', cs.nama_cabang, 'ke', cd.nama_cabang,
        'deadline', s.deadline,
        'hari_lewat', CASE WHEN s.deadline < v_today THEN v_today - s.deadline END,
        'mr_kode', mr.mr_kode, 'dlv_kode', dl.dlv_kode)
    FROM public.planning_supplies s
    LEFT JOIN public.cabang cs     ON cs.id = s.source_cabang_id
    LEFT JOIN public.cabang cd     ON cd.id = s.dest_cabang_id
    LEFT JOIN public.mrs mr        ON mr.id = s.mr_id
    LEFT JOIN public.deliveries dl ON dl.id = s.dlv_id
    WHERE s.status = 'in_transit'
      AND (v_all OR s.dest_cabang_id = ANY (p_cabang_ids) OR s.source_cabang_id = ANY (p_cabang_ids))
      AND (p_kind = 'supply_in_transit' OR s.deadline < v_today);

  -- ---------------- Working Order ----------------
  ELSIF p_kind IN ('wo_pending', 'wo_on_process') THEN
    RETURN QUERY
    SELECT
      (v_today - w.wo_tanggal)::NUMERIC,
      w.wo_kode,
      concat_ws(' ', w.wo_kode, w.departemen, c.nama_cabang, mr.mr_kode, pf.nama),
      jsonb_build_object(
        'id', w.id, 'kode', w.wo_kode, 'href', '/working-order/' || w.id,
        'tanggal', w.wo_tanggal, 'umur_hari', GREATEST(v_today - w.wo_tanggal, 0),
        'lokasi', c.nama_cabang, 'departemen', w.departemen, 'status', w.wo_status,
        'mr_kode', mr.mr_kode, 'pic', pf.nama)
    FROM public.working_orders w
    LEFT JOIN public.cabang c    ON c.id = w.gudang_cabang_id
    LEFT JOIN public.mrs mr      ON mr.id = w.mr_id
    LEFT JOIN public.profiles pf ON pf.id = w.wo_pic_id
    WHERE (v_all OR w.gudang_cabang_id = ANY (p_cabang_ids))
      AND w.wo_status = CASE p_kind WHEN 'wo_pending' THEN 'Pending Approval' ELSE 'On Process' END;

  -- ---------------- Job Costing ----------------
  ELSIF p_kind = 'jc_open' THEN
    RETURN QUERY
    SELECT
      (v_today - COALESCE(j.job_tanggal, (j.created_at AT TIME ZONE 'Asia/Jakarta')::DATE))::NUMERIC,
      j.job_kode,
      concat_ws(' ', j.job_kode, j.description, c.nama_cabang, j.finish_part),
      jsonb_build_object(
        'id', j.id, 'kode', j.job_kode, 'href', '/job-costing?search=',
        'tanggal', COALESCE(j.job_tanggal, (j.created_at AT TIME ZONE 'Asia/Jakarta')::DATE),
        'umur_hari', GREATEST(v_today - COALESCE(j.job_tanggal, (j.created_at AT TIME ZONE 'Asia/Jakarta')::DATE), 0),
        'lokasi', c.nama_cabang, 'status', j.status::TEXT,
        'catatan', j.description, 'finish_part', j.finish_part)
    FROM public.job_costing j
    LEFT JOIN public.cabang c ON c.id = j.cabang_id
    WHERE j.status = 'open'
      AND (v_all OR j.cabang_id = ANY (p_cabang_ids));

  -- ---------------- Laporan kendala MR (freeze) ----------------
  ELSIF p_kind = 'freeze_open' THEN
    RETURN QUERY
    SELECT
      (v_today - (f.created_at AT TIME ZONE 'Asia/Jakarta')::DATE)::NUMERIC,
      m.mr_kode,
      concat_ws(' ', m.mr_kode, f.kendala, c.nama_cabang, pf.nama),
      jsonb_build_object(
        'id', f.id, 'kode', m.mr_kode, 'href', '/mr/' || m.id,
        'tanggal', (f.created_at AT TIME ZONE 'Asia/Jakarta')::DATE,
        'umur_hari', GREATEST(v_today - (f.created_at AT TIME ZONE 'Asia/Jakarta')::DATE, 0),
        'lokasi', c.nama_cabang, 'catatan', f.kendala, 'pic', pf.nama)
    FROM public.mr_freeze_reports f
    JOIN public.mrs m ON m.id = f.mr_id
    LEFT JOIN public.cabang c    ON c.id = m.cabang_id
    LEFT JOIN public.profiles pf ON pf.id = f.reporter_id
    WHERE f.status = 'open'
      AND (v_all OR m.cabang_id = ANY (p_cabang_ids));

  -- ---------------- SO / DO Reguler ----------------
  ELSIF p_kind IN ('so_active', 'so_overdue', 'so_period') THEN
    RETURN QUERY
    SELECT
      (CASE p_kind WHEN 'so_period' THEN s.so_tanggal - v_epoch
                   ELSE COALESCE(v_today - s.so_due_date, -100000) END)::NUMERIC,
      s.so_kode,
      concat_ws(' ', s.so_kode, cu.customer_name, c.nama_cabang, s.customer_po_no, s.so_pic),
      jsonb_build_object(
        'id', s.id, 'kode', s.so_kode, 'href', '/so-reguler/so?search=',
        'tanggal', s.so_tanggal, 'due_date', s.so_due_date,
        'hari_lewat', CASE WHEN s.so_status IN ('open', 'partial') AND s.so_due_date < v_today
                           THEN v_today - s.so_due_date END,
        'lokasi', c.nama_cabang, 'customer', cu.customer_name, 'pic', s.so_pic,
        'status', s.so_status, 'kategori', s.kategori, 'po_customer', s.customer_po_no)
    FROM public.so_reguler s
    LEFT JOIN public.cabang c     ON c.id = s.cabang_id
    LEFT JOIN public.customers cu ON cu.id = s.customer_id
    WHERE (v_all OR s.cabang_id = ANY (p_cabang_ids))
      AND CASE p_kind
        WHEN 'so_active'  THEN s.so_status IN ('open', 'partial')
        WHEN 'so_overdue' THEN s.so_status IN ('open', 'partial') AND s.so_due_date < v_today
        WHEN 'so_period'  THEN s.so_tanggal BETWEEN v_from AND v_to AND s.so_status <> 'cancelled'
        ELSE FALSE
      END;

  ELSIF p_kind = 'do_active' THEN
    RETURN QUERY
    SELECT
      (v_today - d.do_tanggal)::NUMERIC,
      d.do_kode,
      concat_ws(' ', d.do_kode, cu.customer_name, c.nama_cabang, d.kode_po, d.no_resi),
      jsonb_build_object(
        'id', d.id, 'kode', d.do_kode, 'href', '/so-reguler/do?search=',
        'tanggal', d.do_tanggal, 'umur_hari', GREATEST(v_today - d.do_tanggal, 0),
        'lokasi', c.nama_cabang, 'customer', cu.customer_name, 'pic', d.pic,
        'status', d.status, 'tracking', d.tracking_status,
        'ekspedisi', d.ekspedisi, 'no_resi', d.no_resi)
    FROM public.do_reguler d
    LEFT JOIN public.cabang c     ON c.id = d.dari_cabang_id
    LEFT JOIN public.customers cu ON cu.id = d.customer_id
    WHERE d.status = 'active'
      AND (v_all OR d.dari_cabang_id = ANY (p_cabang_ids));

  -- ---------------- SPB ----------------
  ELSIF p_kind IN ('spb_belum_po', 'spb_po_belum_do', 'spb_do_belum_invoice', 'spb_period') THEN
    RETURN QUERY
    SELECT
      (CASE p_kind
         WHEN 'spb_period' THEN (s.spb_tanggal AT TIME ZONE 'Asia/Jakarta')::DATE - v_epoch
         ELSE v_today - (s.spb_tanggal AT TIME ZONE 'Asia/Jakarta')::DATE
       END)::NUMERIC,
      s.spb_no,
      concat_ws(' ', s.spb_no, s.spb_no_wo, s.spb_kode_unit, c.nama_cabang, s.spb_pic_gmi),
      jsonb_build_object(
        'id', s.id, 'kode', s.spb_no, 'href', '/spb?search=',
        'tanggal', (s.spb_tanggal AT TIME ZONE 'Asia/Jakarta')::DATE,
        'umur_hari', GREATEST(v_today - (s.spb_tanggal AT TIME ZONE 'Asia/Jakarta')::DATE, 0),
        'lokasi', c.nama_cabang, 'no_wo', s.spb_no_wo, 'kode_unit', s.spb_kode_unit,
        'pic', s.spb_pic_gmi, 'status', s.spb_status, 'tahap', g.stage)
    FROM public.spb s
    JOIN public.dashboard_spb_progress(p_cabang_ids) g ON g.spb_id = s.id
    LEFT JOIN public.cabang c ON c.id = s.cabang_id
    WHERE CASE p_kind
      WHEN 'spb_belum_po'         THEN g.stage = 'belum_po'
      WHEN 'spb_po_belum_do'      THEN g.stage = 'po_belum_do'
      WHEN 'spb_do_belum_invoice' THEN g.stage = 'do_belum_invoice'
      WHEN 'spb_period' THEN (s.spb_tanggal AT TIME ZONE 'Asia/Jakarta')::DATE BETWEEN v_from AND v_to
      ELSE FALSE
    END;

  ELSIF p_kind IN ('invoice_unpaid', 'invoice_open') THEN
    RETURN QUERY
    SELECT
      (v_today - (COALESCE(i.invoice_date, i.created_at) AT TIME ZONE 'Asia/Jakarta')::DATE)::NUMERIC,
      i.invoice_no,
      concat_ws(' ', i.invoice_no, s.spb_no, s.spb_no_wo, c.nama_cabang),
      jsonb_build_object(
        'id', i.id, 'kode', i.invoice_no, 'href', '/spb/invoice?search=',
        'tanggal', (COALESCE(i.invoice_date, i.created_at) AT TIME ZONE 'Asia/Jakarta')::DATE,
        'umur_hari', GREATEST(v_today - (COALESCE(i.invoice_date, i.created_at) AT TIME ZONE 'Asia/Jakarta')::DATE, 0),
        'lokasi', c.nama_cabang, 'spb_no', s.spb_no, 'no_wo', s.spb_no_wo,
        'status', i.approval_status, 'pembayaran', i.payment_status)
    FROM public.spb_invoice i
    JOIN public.spb_do d ON d.id = i.spb_do_id
    JOIN public.spb_po p ON p.id = d.spb_po_id
    JOIN public.spb s    ON s.id = p.spb_id
    LEFT JOIN public.cabang c ON c.id = s.cabang_id
    WHERE s.spb_is_deleted = FALSE
      AND s.spb_status <> 'CANCELLED'
      AND (v_all OR s.cabang_id = ANY (p_cabang_ids))
      AND CASE p_kind
        WHEN 'invoice_unpaid' THEN i.approval_status <> 'rejected' AND i.payment_status = 'unpaid'
        WHEN 'invoice_open'   THEN i.approval_status = 'open'
        ELSE FALSE
      END;

  ELSE
    RAISE EXCEPTION 'Jenis daftar dashboard tidak dikenal: %', p_kind;
  END IF;
END;
$$;

-- ============================================================
-- 7. Daftar drill-down (berpaginasi + pencarian)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_main_dashboard_list(
  p_kind          TEXT,
  p_cabang_ids    BIGINT[] DEFAULT NULL,
  p_date_from     DATE     DEFAULT NULL,
  p_date_to       DATE     DEFAULT NULL,
  p_kategori      TEXT[]   DEFAULT NULL,
  p_priorities    TEXT[]   DEFAULT NULL,
  p_args          JSONB    DEFAULT '{}'::JSONB,
  p_search        TEXT     DEFAULT NULL,
  p_limit         INTEGER  DEFAULT 20,
  p_offset        INTEGER  DEFAULT 0
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH r AS MATERIALIZED (
    SELECT *
    FROM public.dashboard_list_rows(
      p_kind, p_cabang_ids, p_date_from, p_date_to,
      p_kategori, p_priorities, p_args)
  ),
  f AS (
    SELECT r.o_item,
           row_number() OVER (ORDER BY r.o_sort DESC NULLS LAST, r.o_text, r.o_item->>'id') AS rn
    FROM r
    WHERE NULLIF(btrim(p_search), '') IS NULL
       OR r.o_search ILIKE '%' || replace(replace(replace(btrim(p_search),
            '\', '\\'), '%', '\%'), '_', '\_') || '%'
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'rows', COALESCE((
      SELECT jsonb_agg(f.o_item ORDER BY f.rn)
      FROM f
      WHERE f.rn > GREATEST(COALESCE(p_offset, 0), 0)
        AND f.rn <= GREATEST(COALESCE(p_offset, 0), 0)
                    + LEAST(GREATEST(COALESCE(p_limit, 20), 1), 5000)
    ), '[]'::JSONB)
  );
$$;

-- ============================================================
-- 8. Grants
-- ============================================================
GRANT EXECUTE ON FUNCTION public.dashboard_viewer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_mr_scope(BIGINT[], TEXT[], TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_mr_levels(BIGINT[], TEXT[], TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_pending_approvals(BIGINT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_spb_progress(BIGINT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_list_rows(TEXT, BIGINT[], DATE, DATE, TEXT[], TEXT[], JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_main_dashboard_summary(BIGINT[], DATE, DATE, DATE, DATE, DATE, TEXT[], TEXT[], BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_main_dashboard_list(TEXT, BIGINT[], DATE, DATE, TEXT[], TEXT[], JSONB, TEXT, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
