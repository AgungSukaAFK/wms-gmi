-- Backfill: hitung ulang mr_items.qty_received & mrs.mr_status dengan rumus
-- pemenuhan MR yang baru (mirror lib/mr-fulfillment.ts -> computeMrItemsFulfilledQty).
-- Sebelumnya hanya Item Transfer + Job Costing yang dihitung, sehingga MR yang
-- dipenuhi lewat share stock / bypass / WO / RI langsung ke gudang MR tidak
-- pernah completed. Jalankan SETELAH 20261015100000_audit_qty_status_fixes.sql.
--
-- Sumber pemenuhan (semua yang sudah final):
--   1. Item Transfer completed (item_transfer_items.mr_item_id)
--   2. Job Costing yang stoknya sudah diterapkan (finish part -> MR)
--   3. Delivery share stock yang sudah di-finalize (signature penerima ada)
--   4. Bypass share stock (mr_sharestock_bypasses)
--   5. Working Order Closed (applied_qty)
--   6. RI completed yang gudang penerimanya = gudang MR (via po_item -> pr_item)
--   7. RI lama pra-revisi (cabang_penerima_id NULL) via mr_id + part_id
--
-- Toleran terhadap skema yang tertinggal (DB yang belum menjalankan semua
-- migration lama): sumber yang tabel/kolomnya belum ada dilewati dan
-- dilaporkan lewat NOTICE. Kalau receive_items.cabang_penerima_id belum ada,
-- semua RI completed diperlakukan sebagai RI lama (sumber #7), persis alur lama.
-- qty_received di-cap ke qty_request. Hanya MR approved/completed yang
-- disentuh. Idempotent (aman dijalankan ulang).

CREATE OR REPLACE FUNCTION pg_temp.col_exists(p_table TEXT, p_col TEXT)
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_col
  );
$$;

DO $$
DECLARE
  parts TEXT[] := ARRAY[]::TEXT[];
  has_ri_cabang BOOLEAN := pg_temp.col_exists('receive_items', 'cabang_penerima_id');
  src_sql TEXT;
  n_items INTEGER;
  n_mrs INTEGER;
BEGIN
  -- 1. Item Transfer completed
  IF pg_temp.col_exists('item_transfer_items', 'mr_item_id') THEN
    parts := array_append(parts, $q$
      SELECT iti.mr_item_id, iti.qty
      FROM public.item_transfer_items iti
      JOIN public.item_transfers it ON it.id = iti.it_id
      WHERE it.status::TEXT = 'completed' AND iti.mr_item_id IS NOT NULL$q$);
  ELSE
    RAISE NOTICE 'Lewati sumber #1 (Item Transfer): kolom item_transfer_items.mr_item_id belum ada';
  END IF;

  -- 2. Job Costing finish part -> MR
  IF pg_temp.col_exists('job_costing_finish_parts', 'mr_item_id')
     AND pg_temp.col_exists('job_costing', 'stock_applied_at') THEN
    parts := array_append(parts, $q$
      SELECT f.mr_item_id, f.qty
      FROM public.job_costing_finish_parts f
      JOIN public.job_costing j ON j.id = f.job_id
      WHERE j.stock_applied_at IS NOT NULL AND f.mr_item_id IS NOT NULL$q$);
  ELSE
    RAISE NOTICE 'Lewati sumber #2 (Job Costing): job_costing_finish_parts.mr_item_id / job_costing.stock_applied_at belum ada';
  END IF;

  -- 3. Delivery share stock finalized
  IF pg_temp.col_exists('delivery_items', 'mr_item_id')
     AND pg_temp.col_exists('deliveries', 'signature_receiver_id') THEN
    parts := array_append(parts, $q$
      SELECT di.mr_item_id, di.qty_on_delivery
      FROM public.delivery_items di
      JOIN public.deliveries d ON d.id = di.dlv_id
      WHERE d.signature_receiver_id IS NOT NULL
        AND d.status::TEXT <> 'cancelled'
        AND di.mr_item_id IS NOT NULL$q$);
  ELSE
    RAISE NOTICE 'Lewati sumber #3 (Delivery): delivery_items.mr_item_id / deliveries.signature_receiver_id belum ada';
  END IF;

  -- 4. Bypass share stock
  IF to_regclass('public.mr_sharestock_bypasses') IS NOT NULL THEN
    parts := array_append(parts, $q$
      SELECT b.mr_item_id, b.qty FROM public.mr_sharestock_bypasses b$q$);
  ELSE
    RAISE NOTICE 'Lewati sumber #4 (Bypass): tabel mr_sharestock_bypasses belum ada -- jalankan 20261015100000 dulu';
  END IF;

  -- 5. Working Order Closed
  IF pg_temp.col_exists('working_order_items', 'applied_qty') THEN
    parts := array_append(parts, $q$
      SELECT w.mr_item_id, w.applied_qty
      FROM public.working_order_items w
      JOIN public.working_orders wo ON wo.id = w.wo_id
      WHERE wo.wo_status = 'Closed'$q$);
  ELSE
    RAISE NOTICE 'Lewati sumber #5 (Working Order): tabel working_order_items belum ada';
  END IF;

  -- 6. RI langsung ke gudang MR
  IF has_ri_cabang
     AND pg_temp.col_exists('receive_items', 'po_item_id')
     AND pg_temp.col_exists('po_items', 'pr_item_id')
     AND pg_temp.col_exists('pr_items', 'mr_item_id') THEN
    parts := array_append(parts, $q$
      SELECT pri.mr_item_id, ri.qty
      FROM public.receive_items ri
      JOIN public.receives r ON r.id = ri.ri_id
      JOIN public.po_items poi ON poi.id = ri.po_item_id
      JOIN public.pr_items pri ON pri.id = poi.pr_item_id
      JOIN public.mr_items mi ON mi.id = pri.mr_item_id
      JOIN public.mrs m ON m.id = mi.mr_id
      WHERE r.ri_status = 'completed'
        AND ri.cabang_penerima_id IS NOT NULL
        AND ri.cabang_penerima_id = m.cabang_id$q$);
  ELSE
    RAISE NOTICE 'Lewati sumber #6 (RI ke gudang MR): kolom lineage RI/PO/PR belum lengkap';
  END IF;

  -- 7. RI lama (alur pra-revisi: kredit via mr_id + part_id)
  parts := array_append(parts, (
    $q$
      SELECT mi.id, ri.qty
      FROM public.receive_items ri
      JOIN public.receives r ON r.id = ri.ri_id
      JOIN public.mr_items mi ON mi.mr_id = ri.mr_id AND mi.part_id = ri.part_id
      WHERE r.ri_status = 'completed'$q$
    || CASE WHEN has_ri_cabang THEN ' AND ri.cabang_penerima_id IS NULL' ELSE '' END
  ));

  src_sql := 'SELECT mr_item_id, SUM(qty)::INTEGER AS qty FROM ('
    || array_to_string(parts, ' UNION ALL ')
    || ') x(mr_item_id, qty) GROUP BY mr_item_id';

  -- Hanya item yang punya sumber pemenuhan yang disentuh (item tanpa sumber
  -- sama sekali dibiarkan apa adanya).
  EXECUTE format($u$
    UPDATE public.mr_items mi
    SET qty_received = LEAST(mi.qty_request, src.qty)
    FROM (%s) src, public.mrs m
    WHERE src.mr_item_id = mi.id
      AND m.id = mi.mr_id
      AND m.mr_status::TEXT IN ('approved', 'completed', 'done', 'closed')
      AND mi.qty_received IS DISTINCT FROM LEAST(mi.qty_request, src.qty)
  $u$, src_sql);
  GET DIAGNOSTICS n_items = ROW_COUNT;

  -- MR approved/completed: completed bila semua item terpenuhi, selain itu approved.
  UPDATE public.mrs m
  SET mr_status = (CASE WHEN agg.all_fulfilled THEN 'completed' ELSE 'approved' END)::public.doc_status
  FROM (
    SELECT mr_id, bool_and(qty_received >= qty_request) AS all_fulfilled
    FROM public.mr_items
    GROUP BY mr_id
  ) agg
  WHERE agg.mr_id = m.id
    AND m.mr_status::TEXT IN ('approved', 'completed', 'done', 'closed')
    AND m.mr_status::TEXT IS DISTINCT FROM (CASE WHEN agg.all_fulfilled THEN 'completed' ELSE 'approved' END);
  GET DIAGNOSTICS n_mrs = ROW_COUNT;

  RAISE NOTICE 'Backfill selesai: % item MR diperbarui, % MR berubah status', n_items, n_mrs;
END $$;
