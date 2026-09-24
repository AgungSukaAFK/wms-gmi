-- Moderator "Hapus Dokumen Cascade": MR / PR / PO / RI (Receive) / Delivery /
-- Item Transfer (termasuk Scheduled MR, yang memakai tabel mrs/mr_items yang
-- sama).
--
-- Kenapa satu fungsi Postgres atomic (bukan sequential JS call seperti delete
-- lain di codebase ini): blast radius-nya jauh lebih besar (lintas MR->PR->PO
-- ->RI + reverse stok di banyak baris sekaligus), jadi partial-failure di
-- tengah proses jauh lebih berbahaya daripada delete manapun yang sudah ada.
--
-- Aturan cascade (item-level, BUKAN document-level, karena 1 PR bisa
-- bersumber dari banyak MR dan 1 PO bisa bersumber dari banyak PR):
--   - Hapus MR  -> hapus semua pr_items/po_items/receive_items/delivery_items
--                  /item_transfer_items yang lineage-nya balik ke MR ini,
--                  lalu hapus header PR/PO/Delivery/IT yang jadi kosong. MR
--                  sendiri selalu habis total.
--   - Hapus PR  -> hapus pr_items PR ini + po_items/receive_items turunannya.
--                  MR tetap ada, convert_status di-recompute.
--   - Hapus PO  -> hapus PO + seluruh receive_items turunannya. PR/MR tetap
--                  ada, convert_status di-recompute.
--   - Hapus RI  -> reverse stok yang sudah diposting (kalau ri_status
--                  'completed'), lalu hapus RI. PO/PR/MR tetap ada.
--   - Hapus Delivery -> reverse stok ke cabang sumber (kalau belum
--                  cancelled), lalu hapus. Delivery yang sudah completed
--                  (barang diterima di tujuan) tidak boleh dihapus.
--   - Hapus Item Transfer -> reverse stok ke gudang asal (kalau sudah
--                  stock_released tapi belum completed), lalu hapus. IT yang
--                  sudah completed (barang diterima di tujuan -- termasuk
--                  yang sudah mendistribusikan qty ke MR, lihat
--                  finalizeItemTransfer di item-transfer-actions.ts) tidak
--                  boleh dihapus.
--
-- CATATAN PENTING soal revisi alur RI->IT->MR (2026-09-24): sejak revisi ini,
-- stok RI mendarat di receive_items.cabang_penerima_id (gudang penerima
-- pilihan user), BUKAN otomatis di cabang MR lagi -- dan mr_items.qty_received
-- /mrs.mr_status HANYA berubah saat Item Transfer yang mereferensikan MR itu
-- di-finalize (bukan lagi saat RI completed). Makanya reverse stok RI di
-- bawah pakai COALESCE(receive_items.cabang_penerima_id, mrs.cabang_id) --
-- fallback ke cabang MR cuma buat RI lama pra-revisi yang cabang_penerima_id
-- -nya NULL. Dan karena distribusi ke MR sekarang HANYA lewat IT completed
-- (yang tidak boleh dihapus sama sekali, lihat aturan block di atas), fungsi
-- ini TIDAK PERNAH perlu recompute mr_items.qty_received/mrs.mr_status --
-- kalau path-nya sampai ke situ, IT-nya pasti sudah completed dan cascade
-- delete-nya sudah di-block duluan.
--
-- Kalau reverse stok akan membuat stok negatif (karena sudah dipakai lebih
-- lanjut di dokumen lain di luar cascade ini, mis. SPB/Consignment/Job
-- Costing), seluruh operasi di-block (tidak ada yang ditulis) dan
-- konfliknya dikembalikan supaya bisa ditampilkan ke moderator.
--
-- Satu implementasi (`_cascade_delete_document_impl`) dipakai dua entry
-- point publik: plan_cascade_document_delete (read-only, buat dialog
-- konfirmasi) dan execute_cascade_document_delete (menulis), supaya logic
-- resolusi scope + deteksi konflik tidak pernah dobel-implementasi/berbeda
-- antara preview dan eksekusi asli.

-- moderator_edit_logs.doc_type belum mencakup 'item_transfer' (constraint
-- terakhir di-set di 20260826120000_moderator_edit_logs_delivery.sql, sebelum
-- Item Transfer ikut jadi bagian sistem delete cascade ini).
ALTER TABLE public.moderator_edit_logs
  DROP CONSTRAINT IF EXISTS moderator_edit_logs_doc_type_check;
ALTER TABLE public.moderator_edit_logs
  ADD CONSTRAINT moderator_edit_logs_doc_type_check
  CHECK (doc_type IN ('mr', 'pr', 'po', 'spb', 'spb_po', 'spb_do', 'spb_invoice', 'return_spb', 'receive', 'delivery', 'item_transfer'));

CREATE OR REPLACE FUNCTION public._cascade_delete_document_impl(
  p_doc_type text,
  p_doc_id bigint,
  p_reason text,
  p_dry_run boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_nama text;

  v_mr_ids bigint[] := '{}';
  v_mr_item_ids bigint[] := '{}';
  v_pr_item_ids bigint[] := '{}';
  v_po_item_ids bigint[] := '{}';
  v_receive_item_ids bigint[] := '{}';
  v_delivery_item_ids bigint[] := '{}';
  v_it_item_ids bigint[] := '{}';

  v_pr_ids_delete bigint[] := '{}';
  v_po_ids_delete bigint[] := '{}';
  v_ri_ids_delete bigint[] := '{}';
  v_dlv_ids_delete bigint[] := '{}';
  v_it_ids_delete bigint[] := '{}';

  v_pr_ids_survive bigint[] := '{}';
  v_po_ids_survive bigint[] := '{}';
  v_mr_ids_survive bigint[] := '{}';
  v_mr_item_ids_survive bigint[] := '{}';

  v_blocked_kodes text[];
  v_blocked_reasons text[] := '{}';
  v_conflicts jsonb := '[]'::jsonb;
  v_documents jsonb := '[]'::jsonb;
  v_tmp jsonb;
  v_snapshot jsonb := '{}'::jsonb;
  v_can_delete boolean;
  v_row record;
BEGIN
  IF NOT public.is_moderator() THEN
    RAISE EXCEPTION 'Hanya moderator yang dapat menghapus dokumen.';
  END IF;

  IF p_doc_type NOT IN ('mr', 'pr', 'po', 'receive', 'delivery', 'item_transfer') THEN
    RAISE EXCEPTION 'Tipe dokumen tidak dikenali: %', p_doc_type;
  END IF;

  SELECT nama INTO v_actor_nama FROM public.profiles WHERE id = v_actor;

  -- ============================================================
  -- 1. Resolve scope per doc_type
  -- ============================================================
  IF p_doc_type = 'mr' THEN
    IF NOT EXISTS (SELECT 1 FROM public.mrs WHERE id = p_doc_id) THEN
      RAISE EXCEPTION 'MR tidak ditemukan.';
    END IF;
    v_mr_ids := ARRAY[p_doc_id];

    SELECT COALESCE(array_agg(id), '{}') INTO v_mr_item_ids
      FROM public.mr_items WHERE mr_id = p_doc_id;

    SELECT COALESCE(array_agg(id), '{}') INTO v_pr_item_ids
      FROM public.pr_items
      WHERE mr_item_id = ANY(v_mr_item_ids) OR (mr_item_id IS NULL AND mr_id = p_doc_id);

    SELECT COALESCE(array_agg(id), '{}') INTO v_po_item_ids
      FROM public.po_items
      WHERE pr_item_id = ANY(v_pr_item_ids) OR (pr_item_id IS NULL AND mr_id = p_doc_id);

    SELECT COALESCE(array_agg(id), '{}') INTO v_receive_item_ids
      FROM public.receive_items
      WHERE po_item_id = ANY(v_po_item_ids) OR (po_item_id IS NULL AND mr_id = p_doc_id);

    SELECT COALESCE(array_agg(id), '{}') INTO v_delivery_item_ids
      FROM public.delivery_items WHERE mr_item_id = ANY(v_mr_item_ids);
    -- Legacy: delivery_items pra-fitur multi-MR yang mr_item_id-nya NULL,
    -- HANYA dianggap milik MR ini kalau delivery tsb murni legacy (semua
    -- item di dalamnya juga NULL) — kalau delivery itu delivery baru yang
    -- digabung dari beberapa MR (lihat "MR Selector (multi)" di
    -- app/(With Sidebar)/deliveries/create), jangan diperlakukan seolah
    -- seluruh isinya milik MR ini.
    v_delivery_item_ids := v_delivery_item_ids || (
      SELECT COALESCE(array_agg(di.id), '{}')
      FROM public.delivery_items di
      JOIN public.deliveries d ON d.id = di.dlv_id
      WHERE d.mr_id = p_doc_id AND di.mr_item_id IS NULL AND di.id <> ALL(v_delivery_item_ids)
        AND NOT EXISTS (
          SELECT 1 FROM public.delivery_items di2
          WHERE di2.dlv_id = di.dlv_id AND di2.mr_item_id IS NOT NULL
        )
    );

    -- Header PR/PO/RI/Delivery HANYA dihapus penuh kalau SEMUA item mereka
    -- masuk scope penghapusan ini — PR bisa multi-MR, PO bisa multi-PR, dan
    -- Delivery bisa digabung dari beberapa MR sekaligus, jadi tidak boleh
    -- diasumsikan otomatis habis total hanya karena titik masuknya MR.
    SELECT COALESCE(array_agg(pr_id), '{}') INTO v_pr_ids_delete
      FROM (
        SELECT pri.pr_id FROM public.pr_items pri
        WHERE pri.id = ANY(v_pr_item_ids)
        GROUP BY pri.pr_id
        HAVING COUNT(*) = (SELECT COUNT(*) FROM public.pr_items pri2 WHERE pri2.pr_id = pri.pr_id)
      ) x;
    SELECT COALESCE(array_agg(DISTINCT pri.pr_id), '{}') INTO v_pr_ids_survive
      FROM public.pr_items pri WHERE pri.id = ANY(v_pr_item_ids) AND pri.pr_id <> ALL(v_pr_ids_delete);

    SELECT COALESCE(array_agg(po_id), '{}') INTO v_po_ids_delete
      FROM (
        SELECT poi.po_id FROM public.po_items poi
        WHERE poi.id = ANY(v_po_item_ids)
        GROUP BY poi.po_id
        HAVING COUNT(*) = (SELECT COUNT(*) FROM public.po_items poi2 WHERE poi2.po_id = poi.po_id)
      ) x;
    SELECT COALESCE(array_agg(DISTINCT poi.po_id), '{}') INTO v_po_ids_survive
      FROM public.po_items poi WHERE poi.id = ANY(v_po_item_ids) AND poi.po_id <> ALL(v_po_ids_delete);

    SELECT COALESCE(array_agg(ri_id), '{}') INTO v_ri_ids_delete
      FROM (
        SELECT ri.ri_id FROM public.receive_items ri
        WHERE ri.id = ANY(v_receive_item_ids)
        GROUP BY ri.ri_id
        HAVING COUNT(*) = (SELECT COUNT(*) FROM public.receive_items ri2 WHERE ri2.ri_id = ri.ri_id)
      ) x;

    SELECT COALESCE(array_agg(dlv_id), '{}') INTO v_dlv_ids_delete
      FROM (
        SELECT di.dlv_id FROM public.delivery_items di
        WHERE di.id = ANY(v_delivery_item_ids)
        GROUP BY di.dlv_id
        HAVING COUNT(*) = (SELECT COUNT(*) FROM public.delivery_items di2 WHERE di2.dlv_id = di.dlv_id)
      ) x;

    -- Item Transfer: sama seperti Delivery, IT bisa digabung dari beberapa
    -- MR sekaligus per item (item_transfer_items.mr_item_id) -- header cuma
    -- dihapus penuh kalau SEMUA item-nya masuk scope.
    SELECT COALESCE(array_agg(id), '{}') INTO v_it_item_ids
      FROM public.item_transfer_items WHERE mr_item_id = ANY(v_mr_item_ids);
    SELECT COALESCE(array_agg(it_id), '{}') INTO v_it_ids_delete
      FROM (
        SELECT iti.it_id FROM public.item_transfer_items iti
        WHERE iti.id = ANY(v_it_item_ids)
        GROUP BY iti.it_id
        HAVING COUNT(*) = (SELECT COUNT(*) FROM public.item_transfer_items iti2 WHERE iti2.it_id = iti.it_id)
      ) x;

  ELSIF p_doc_type = 'pr' THEN
    IF NOT EXISTS (SELECT 1 FROM public.prs WHERE id = p_doc_id) THEN
      RAISE EXCEPTION 'PR tidak ditemukan.';
    END IF;
    v_pr_ids_delete := ARRAY[p_doc_id];

    SELECT COALESCE(array_agg(id), '{}') INTO v_pr_item_ids
      FROM public.pr_items WHERE pr_id = p_doc_id;
    SELECT COALESCE(array_agg(id), '{}') INTO v_po_item_ids
      FROM public.po_items WHERE pr_item_id = ANY(v_pr_item_ids);
    SELECT COALESCE(array_agg(id), '{}') INTO v_receive_item_ids
      FROM public.receive_items WHERE po_item_id = ANY(v_po_item_ids);

    SELECT COALESCE(array_agg(DISTINCT mi.mr_id), '{}') INTO v_mr_ids_survive
      FROM public.pr_items pri JOIN public.mr_items mi ON mi.id = pri.mr_item_id
      WHERE pri.id = ANY(v_pr_item_ids);

    SELECT COALESCE(array_agg(po_id), '{}') INTO v_po_ids_delete
      FROM (
        SELECT poi.po_id FROM public.po_items poi
        WHERE poi.id = ANY(v_po_item_ids)
        GROUP BY poi.po_id
        HAVING COUNT(*) = (SELECT COUNT(*) FROM public.po_items poi2 WHERE poi2.po_id = poi.po_id)
      ) full_pos;
    SELECT COALESCE(array_agg(DISTINCT poi.po_id), '{}') INTO v_po_ids_survive
      FROM public.po_items poi WHERE poi.id = ANY(v_po_item_ids) AND poi.po_id <> ALL(v_po_ids_delete);

    -- RI 1:1 dengan satu PO, tapi PO itu bisa multi-PR — RI-nya baru habis
    -- total kalau SEMUA receive_items-nya (termasuk yang dari PR lain di PO
    -- yang sama) ikut masuk scope. Kalau tidak, RI survive & cuma item yang
    -- terkait PR ini yang dihapus (qty_received-nya di-recompute di langkah 8).
    SELECT COALESCE(array_agg(ri_id), '{}') INTO v_ri_ids_delete
      FROM (
        SELECT ri.ri_id FROM public.receive_items ri
        WHERE ri.id = ANY(v_receive_item_ids)
        GROUP BY ri.ri_id
        HAVING COUNT(*) = (SELECT COUNT(*) FROM public.receive_items ri2 WHERE ri2.ri_id = ri.ri_id)
      ) x;

  ELSIF p_doc_type = 'po' THEN
    IF NOT EXISTS (SELECT 1 FROM public.pos WHERE id = p_doc_id) THEN
      RAISE EXCEPTION 'PO tidak ditemukan.';
    END IF;
    v_po_ids_delete := ARRAY[p_doc_id];

    SELECT COALESCE(array_agg(id), '{}') INTO v_po_item_ids
      FROM public.po_items WHERE po_id = p_doc_id;
    SELECT COALESCE(array_agg(id), '{}') INTO v_receive_item_ids
      FROM public.receive_items
      WHERE po_item_id = ANY(v_po_item_ids) OR (po_item_id IS NULL AND po_id = p_doc_id);
    SELECT COALESCE(array_agg(DISTINCT ri_id), '{}') INTO v_ri_ids_delete
      FROM public.receive_items WHERE id = ANY(v_receive_item_ids);

    SELECT COALESCE(array_agg(DISTINCT pri.pr_id), '{}') INTO v_pr_ids_survive
      FROM public.po_items poi JOIN public.pr_items pri ON pri.id = poi.pr_item_id
      WHERE poi.id = ANY(v_po_item_ids);
    SELECT COALESCE(array_agg(DISTINCT mi.mr_id), '{}') INTO v_mr_ids_survive
      FROM public.po_items poi
      JOIN public.pr_items pri ON pri.id = poi.pr_item_id
      JOIN public.mr_items mi ON mi.id = pri.mr_item_id
      WHERE poi.id = ANY(v_po_item_ids);

  ELSIF p_doc_type = 'receive' THEN
    IF NOT EXISTS (SELECT 1 FROM public.receives WHERE id = p_doc_id) THEN
      RAISE EXCEPTION 'Receive tidak ditemukan.';
    END IF;
    v_ri_ids_delete := ARRAY[p_doc_id];

    SELECT COALESCE(array_agg(id), '{}') INTO v_receive_item_ids
      FROM public.receive_items WHERE ri_id = p_doc_id;

    SELECT COALESCE(array_agg(DISTINCT po_id), '{}') INTO v_po_ids_survive
      FROM public.receive_items WHERE id = ANY(v_receive_item_ids);
    SELECT COALESCE(array_agg(DISTINCT mr_id), '{}') INTO v_mr_ids_survive
      FROM public.receive_items WHERE id = ANY(v_receive_item_ids);

  ELSIF p_doc_type = 'delivery' THEN
    IF NOT EXISTS (SELECT 1 FROM public.deliveries WHERE id = p_doc_id) THEN
      RAISE EXCEPTION 'Delivery tidak ditemukan.';
    END IF;
    v_dlv_ids_delete := ARRAY[p_doc_id];

    SELECT COALESCE(array_agg(id), '{}') INTO v_delivery_item_ids
      FROM public.delivery_items WHERE dlv_id = p_doc_id;

    SELECT COALESCE(array_agg(DISTINCT mr_item_id) FILTER (WHERE mr_item_id IS NOT NULL), '{}')
      INTO v_mr_item_ids_survive
      FROM public.delivery_items WHERE id = ANY(v_delivery_item_ids);

  ELSIF p_doc_type = 'item_transfer' THEN
    IF NOT EXISTS (SELECT 1 FROM public.item_transfers WHERE id = p_doc_id) THEN
      RAISE EXCEPTION 'Item Transfer tidak ditemukan.';
    END IF;
    v_it_ids_delete := ARRAY[p_doc_id];

    SELECT COALESCE(array_agg(id), '{}') INTO v_it_item_ids
      FROM public.item_transfer_items WHERE it_id = p_doc_id;
  END IF;

  -- ============================================================
  -- 2. Blocking conditions non-stok: delivery/IT yang sudah completed
  --    (barang sudah diterima) tidak bisa direverse dengan aman — berlaku
  --    untuk delivery/IT manapun yang ITEM-nya tersentuh di scope ini, bukan
  --    cuma yang header-nya bakal dihapus penuh (delivery/IT multi-MR yang
  --    cuma sebagian item-nya kena tetap harus dicek). Ini juga yang bikin
  --    fungsi ini TIDAK PERNAH perlu reverse distribusi qty ke MR: kalau IT-
  --    nya sudah completed (satu-satunya titik qty pindah ke MR), delete-nya
  --    ke-block duluan di sini.
  -- ============================================================
  IF array_length(v_delivery_item_ids, 1) > 0 THEN
    SELECT array_agg(DISTINCT dlv_kode) INTO v_blocked_kodes
      FROM public.deliveries d
      JOIN public.delivery_items di ON di.dlv_id = d.id
      WHERE di.id = ANY(v_delivery_item_ids)
        AND (d.status::text = 'completed' OR COALESCE(d.tracking_status::text, '') = 'completed');
    IF v_blocked_kodes IS NOT NULL AND array_length(v_blocked_kodes, 1) > 0 THEN
      v_blocked_reasons := v_blocked_reasons ||
        format('Delivery %s sudah selesai (barang diterima) dan tidak bisa dihapus.',
               array_to_string(v_blocked_kodes, ', '));
    END IF;
  END IF;

  IF array_length(v_it_item_ids, 1) > 0 THEN
    SELECT array_agg(DISTINCT it_kode) INTO v_blocked_kodes
      FROM public.item_transfers it2
      JOIN public.item_transfer_items iti ON iti.it_id = it2.id
      WHERE iti.id = ANY(v_it_item_ids) AND it2.status = 'completed';
    IF v_blocked_kodes IS NOT NULL AND array_length(v_blocked_kodes, 1) > 0 THEN
      v_blocked_reasons := v_blocked_reasons ||
        format('Item Transfer %s sudah selesai (barang diterima) dan tidak bisa dihapus.',
               array_to_string(v_blocked_kodes, ', '));
    END IF;
  END IF;

  -- ============================================================
  -- 3. Hitung NET delta stok per (cabang,part) dari SEMUA sumber reverse
  --    (RI + Delivery + IT) sekaligus ke satu temp table, supaya nanti di
  --    langkah 6 stok diterapkan SATU KALI per (cabang,part) pakai net-nya
  --    -- bukan per baris dokumen sumber secara berurutan. Kalau diterapkan
  --    berurutan (mis. RI subtract dulu baru IT addback), padahal cabang+
  --    part-nya SAMA, hasil antara bisa transit lewat negatif semu meski
  --    net akhirnya aman (skenario nyata: RI mendarat di gudang X lalu IT
  --    memindahkannya keluar dari gudang X -- reverse keduanya sekaligus
  --    net-nya nol di gudang X).
  -- ============================================================
  DROP TABLE IF EXISTS pg_temp.tmp_stock_delta;
  CREATE TEMP TABLE tmp_stock_delta AS
  SELECT cabang_id, part_id, SUM(delta) AS delta FROM (
    -- RI: stok mendarat di cabang_penerima_id (gudang penerima pilihan
    -- user) sejak revisi 2026-09-24. Fallback ke mrs.cabang_id cuma buat
    -- RI lama pra-revisi yang cabang_penerima_id-nya NULL.
    SELECT COALESCE(ri.cabang_penerima_id, mrs.cabang_id) AS cabang_id,
      ri.part_id AS part_id, -SUM(ri.qty) AS delta
    FROM public.receive_items ri
    JOIN public.receives r ON r.id = ri.ri_id
    JOIN public.mrs ON mrs.id = ri.mr_id
    WHERE ri.id = ANY(v_receive_item_ids) AND r.ri_status = 'completed'
    GROUP BY COALESCE(ri.cabang_penerima_id, mrs.cabang_id), ri.part_id

    UNION ALL

    SELECT dl.dari_cabang_id AS cabang_id, di.part_id AS part_id, SUM(di.qty_on_delivery) AS delta
    FROM public.delivery_items di
    JOIN public.deliveries dl ON dl.id = di.dlv_id
    WHERE di.id = ANY(v_delivery_item_ids) AND dl.status::text <> 'cancelled'
    GROUP BY dl.dari_cabang_id, di.part_id

    UNION ALL

    -- IT: reverse ke gudang asal, cuma kalau stok sudah keluar
    -- (stock_released) tapi belum completed (yang completed sudah
    -- di-block di langkah 2, tidak akan pernah sampai sini).
    SELECT it2.dari_cabang_id AS cabang_id, iti.part_id AS part_id, SUM(iti.qty) AS delta
    FROM public.item_transfer_items iti
    JOIN public.item_transfers it2 ON it2.id = iti.it_id
    WHERE iti.id = ANY(v_it_item_ids) AND it2.stock_released = true AND it2.status <> 'completed'
    GROUP BY it2.dari_cabang_id, iti.part_id
  ) parts
  GROUP BY cabang_id, part_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'part_id', d.part_id,
      'part_number', b.part_number,
      'part_name', b.part_name,
      'cabang_id', d.cabang_id,
      'cabang_nama', c.nama_cabang,
      'current_qty', COALESCE(s.qty, 0),
      'delta', d.delta,
      'resulting_qty', COALESCE(s.qty, 0) + d.delta,
      'shortfall', ABS(COALESCE(s.qty, 0) + d.delta)
    )), '[]'::jsonb)
    INTO v_conflicts
  FROM pg_temp.tmp_stock_delta d
  LEFT JOIN public.stock s ON s.part_id = d.part_id AND s.cabang_id = d.cabang_id
  LEFT JOIN public.barang b ON b.id = d.part_id
  LEFT JOIN public.cabang c ON c.id = d.cabang_id
  WHERE COALESCE(s.qty, 0) + d.delta < 0;

  v_can_delete := array_length(v_blocked_reasons, 1) IS NULL AND jsonb_array_length(v_conflicts) = 0;

  -- ============================================================
  -- 4. Preview dokumen yang akan terhapus (dipakai di dry-run DAN
  --    disimpan sebagai snapshot audit saat eksekusi asli)
  -- ============================================================
  SELECT COALESCE(jsonb_agg(jsonb_build_object('doc_type', 'mr', 'id', id, 'kode', mr_kode)), '[]'::jsonb)
    INTO v_tmp FROM public.mrs WHERE id = ANY(v_mr_ids);
  v_documents := v_documents || v_tmp;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('doc_type', 'pr', 'id', id, 'kode', pr_kode)), '[]'::jsonb)
    INTO v_tmp FROM public.prs WHERE id = ANY(v_pr_ids_delete);
  v_documents := v_documents || v_tmp;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('doc_type', 'po', 'id', id, 'kode', po_kode)), '[]'::jsonb)
    INTO v_tmp FROM public.pos WHERE id = ANY(v_po_ids_delete);
  v_documents := v_documents || v_tmp;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('doc_type', 'receive', 'id', id, 'kode', ri_kode)), '[]'::jsonb)
    INTO v_tmp FROM public.receives WHERE id = ANY(v_ri_ids_delete);
  v_documents := v_documents || v_tmp;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('doc_type', 'delivery', 'id', id, 'kode', dlv_kode)), '[]'::jsonb)
    INTO v_tmp FROM public.deliveries WHERE id = ANY(v_dlv_ids_delete);
  v_documents := v_documents || v_tmp;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('doc_type', 'item_transfer', 'id', id, 'kode', it_kode)), '[]'::jsonb)
    INTO v_tmp FROM public.item_transfers WHERE id = ANY(v_it_ids_delete);
  v_documents := v_documents || v_tmp;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'can_delete', v_can_delete,
      'documents', v_documents,
      'conflicts', v_conflicts,
      'blocked_reasons', to_jsonb(v_blocked_reasons)
    );
  END IF;

  IF NOT v_can_delete THEN
    RETURN jsonb_build_object(
      'success', false,
      'can_delete', false,
      'documents', v_documents,
      'conflicts', v_conflicts,
      'blocked_reasons', to_jsonb(v_blocked_reasons)
    );
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan penghapusan wajib diisi.';
  END IF;

  -- ============================================================
  -- 5. Snapshot audit (sebelum baris manapun dihapus)
  -- ============================================================
  v_snapshot := jsonb_build_object('reason', p_reason, 'documents', v_documents);

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_tmp
    FROM public.mr_items t WHERE id = ANY(v_mr_item_ids);
  v_snapshot := v_snapshot || jsonb_build_object('mr_items', v_tmp);
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_tmp
    FROM public.pr_items t WHERE id = ANY(v_pr_item_ids);
  v_snapshot := v_snapshot || jsonb_build_object('pr_items', v_tmp);
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_tmp
    FROM public.po_items t WHERE id = ANY(v_po_item_ids);
  v_snapshot := v_snapshot || jsonb_build_object('po_items', v_tmp);
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_tmp
    FROM public.receive_items t WHERE id = ANY(v_receive_item_ids);
  v_snapshot := v_snapshot || jsonb_build_object('receive_items', v_tmp);
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_tmp
    FROM public.delivery_items t WHERE id = ANY(v_delivery_item_ids);
  v_snapshot := v_snapshot || jsonb_build_object('delivery_items', v_tmp);
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_tmp
    FROM public.item_transfer_items t WHERE id = ANY(v_it_item_ids);
  v_snapshot := v_snapshot || jsonb_build_object('item_transfer_items', v_tmp);

  -- ============================================================
  -- 6. Terapkan net delta stok dari tmp_stock_delta (langkah 3) -- SATU
  --    UPDATE teragregasi per (cabang,part), bukan per baris dokumen sumber
  --    berurutan (lihat alasan lengkap di komentar langkah 3). Sudah
  --    divalidasi tidak akan negatif di langkah 3, tapi tetap divalidasi
  --    ulang di sini (optimistic concurrency guard) karena tidak pakai row
  --    lock eksplisit.
  -- ============================================================
  UPDATE public.stock s
    SET qty = s.qty + d.delta, updated_at = NOW()
    FROM pg_temp.tmp_stock_delta d
    WHERE s.part_id = d.part_id AND s.cabang_id = d.cabang_id;

  IF EXISTS (
    SELECT 1 FROM pg_temp.tmp_stock_delta d
    JOIN public.stock s ON s.part_id = d.part_id AND s.cabang_id = d.cabang_id
    WHERE s.qty < 0
  ) THEN
    RAISE EXCEPTION 'Stok berubah saat proses berlangsung (jadi negatif), batalkan dan coba lagi.';
  END IF;

  -- (cabang,part) yang delta-nya positif tapi belum pernah punya baris stock
  -- sama sekali (mis. reverse Delivery/IT ke cabang yang belum pernah
  -- kedatangan part itu).
  INSERT INTO public.stock (part_id, cabang_id, qty)
  SELECT d.part_id, d.cabang_id, d.delta
  FROM pg_temp.tmp_stock_delta d
  LEFT JOIN public.stock s ON s.part_id = d.part_id AND s.cabang_id = d.cabang_id
  WHERE s.id IS NULL AND d.delta > 0;

  -- Riwayat stock_movements per baris dokumen sumber (buat audit trail --
  -- TIDAK dipakai lagi buat menggerakkan stock.qty, itu sudah selesai di
  -- atas via tmp_stock_delta).
  FOR v_row IN
    SELECT ri.part_id, ri.qty, COALESCE(ri.cabang_penerima_id, mrs.cabang_id) AS cabang_id
    FROM public.receive_items ri
    JOIN public.receives r ON r.id = ri.ri_id
    JOIN public.mrs ON mrs.id = ri.mr_id
    WHERE ri.id = ANY(v_receive_item_ids) AND r.ri_status = 'completed'
  LOOP
    INSERT INTO public.stock_movements (part_id, cabang_id, qty_change, type, reference_id, created_by, notes)
    VALUES (v_row.part_id, v_row.cabang_id, -v_row.qty, 'CASCADE_DELETE',
      p_doc_type || ':' || p_doc_id,
      v_actor,
      format('Cascade delete %s #%s: reverse stok RI. Alasan: %s', p_doc_type, p_doc_id, p_reason));
  END LOOP;

  FOR v_row IN
    SELECT di.part_id, di.qty_on_delivery, dl.dari_cabang_id
    FROM public.delivery_items di
    JOIN public.deliveries dl ON dl.id = di.dlv_id
    WHERE di.id = ANY(v_delivery_item_ids) AND dl.status::text <> 'cancelled'
  LOOP
    INSERT INTO public.stock_movements (part_id, cabang_id, qty_change, type, reference_id, created_by, notes)
    VALUES (v_row.part_id, v_row.dari_cabang_id, v_row.qty_on_delivery, 'CASCADE_DELETE',
      p_doc_type || ':' || p_doc_id,
      v_actor,
      format('Cascade delete %s #%s: reverse stok Delivery ke cabang sumber. Alasan: %s', p_doc_type, p_doc_id, p_reason));
  END LOOP;

  FOR v_row IN
    SELECT iti.part_id, iti.qty, it2.dari_cabang_id
    FROM public.item_transfer_items iti
    JOIN public.item_transfers it2 ON it2.id = iti.it_id
    WHERE iti.id = ANY(v_it_item_ids) AND it2.stock_released = true AND it2.status <> 'completed'
  LOOP
    INSERT INTO public.stock_movements (part_id, cabang_id, qty_change, type, reference_id, created_by, notes)
    VALUES (v_row.part_id, v_row.dari_cabang_id, v_row.qty, 'CASCADE_DELETE',
      p_doc_type || ':' || p_doc_id,
      v_actor,
      format('Cascade delete %s #%s: reverse stok Item Transfer ke gudang asal. Alasan: %s', p_doc_type, p_doc_id, p_reason));
  END LOOP;

  DROP TABLE IF EXISTS pg_temp.tmp_stock_delta;

  -- ============================================================
  -- 7. Hapus baris, urutan bottom-up (RI -> Delivery -> IT -> PO -> PR -> MR)
  --    supaya FK blocking (pr_items.mr_id, po_items.mr_id, dst — tidak
  --    ON DELETE CASCADE) tidak pernah menabrak header yang masih
  --    direferensikan.
  -- ============================================================
  DELETE FROM public.receive_items WHERE id = ANY(v_receive_item_ids);
  DELETE FROM public.receives WHERE id = ANY(v_ri_ids_delete);

  DELETE FROM public.delivery_items WHERE id = ANY(v_delivery_item_ids);
  DELETE FROM public.deliveries WHERE id = ANY(v_dlv_ids_delete);

  DELETE FROM public.item_transfer_items WHERE id = ANY(v_it_item_ids);
  DELETE FROM public.item_transfers WHERE id = ANY(v_it_ids_delete);

  DELETE FROM public.po_items WHERE id = ANY(v_po_item_ids);
  DELETE FROM public.pos WHERE id = ANY(v_po_ids_delete);

  -- pos.pr_id adalah referensi tampilan "PR pertama" saja (bukan sumber
  -- kebenaran, lihat komentar di createPurchaseOrder), TAPI kolomnya NOT
  -- NULL tanpa ON DELETE SET NULL/CASCADE -> PO yang bertahan (masih punya
  -- item dari PR lain) harus di-repoint dulu sebelum PR yang lama dihapus,
  -- supaya tidak menabrak FK pos_pr_id_fkey.
  IF array_length(v_pr_ids_delete, 1) > 0 THEN
    UPDATE public.pos p SET pr_id = sub.new_pr_id
    FROM (
      SELECT poi.po_id, MIN(pri.pr_id) AS new_pr_id
      FROM public.po_items poi
      JOIN public.pr_items pri ON pri.id = poi.pr_item_id
      WHERE pri.pr_id <> ALL(v_pr_ids_delete)
      GROUP BY poi.po_id
    ) sub
    WHERE p.id = sub.po_id AND p.pr_id = ANY(v_pr_ids_delete) AND p.id <> ALL(v_po_ids_delete);
  END IF;

  DELETE FROM public.pr_items WHERE id = ANY(v_pr_item_ids);
  DELETE FROM public.prs WHERE id = ANY(v_pr_ids_delete);

  IF array_length(v_mr_ids, 1) > 0 THEN
    DELETE FROM public.mr_items WHERE mr_id = ANY(v_mr_ids);
    DELETE FROM public.mrs WHERE id = ANY(v_mr_ids);
  END IF;

  -- ============================================================
  -- 8. Recompute status dokumen ancestor yang bertahan, supaya
  --    "seolah dokumen yang dihapus tidak pernah dibuat" — semua
  --    rumus di bawah mirror persis _applyMrConversionStatus /
  --    _applyPrConversionStatus / applyReceiveCompletion /
  --    syncShareStockStatuses di services/*.ts.
  -- ============================================================

  -- po_items.qty_received: live-recompute untuk po_item yang receive_items-nya
  -- berkurang tapi po_item-nya sendiri survive. Aman dijalankan tiap kali
  -- array survive-nya terisi (no-op kalau memang tidak ada receive_items
  -- yang berubah untuk po tsb).
  --
  -- CATATAN: mr_items.qty_received/mrs.mr_status TIDAK di-recompute di sini
  -- sama sekali -- sejak revisi RI->IT (2026-09-24), field itu HANYA berubah
  -- lewat Item Transfer yang completed, dan IT yang completed selalu
  -- di-block dari cascade delete (langkah 2). Jadi tidak akan pernah ada
  -- kondisi di titik ini yang butuh reverse qty_received/mr_status MR.
  IF array_length(v_po_ids_survive, 1) > 0 THEN
    UPDATE public.po_items poi
      SET qty_received = COALESCE(
        (SELECT SUM(ri2.qty) FROM public.receive_items ri2 WHERE ri2.po_item_id = poi.id), 0)
      WHERE poi.po_id = ANY(v_po_ids_survive);
  END IF;

  -- pos.po_receive_status / po_status: recompute untuk PO yang bertahan
  -- (kehilangan sebagian po_items-nya karena PR/MR sumbernya dihapus).
  IF array_length(v_po_ids_survive, 1) > 0 THEN
    UPDATE public.pos p SET
      po_receive_status = sub.status,
      po_status = CASE WHEN sub.status = 'complete' THEN 'completed'::doc_status ELSE p.po_status END
    FROM (
      SELECT po_id,
        CASE WHEN bool_and(qty_received >= qty) THEN 'complete'
             WHEN bool_or(qty_received > 0) THEN 'partial'
             ELSE 'pending' END AS status
      FROM public.po_items WHERE po_id = ANY(v_po_ids_survive)
      GROUP BY po_id
    ) sub
    WHERE p.id = sub.po_id;
  END IF;

  -- prs.pr_convert_status: recompute untuk PR yang bertahan (kehilangan
  -- sebagian po_items-nya karena PO turunannya dihapus).
  IF array_length(v_pr_ids_survive, 1) > 0 THEN
    UPDATE public.prs p SET pr_convert_status = sub.status
    FROM (
      SELECT pri.pr_id,
        CASE WHEN SUM(LEAST(pri.qty, COALESCE(conv.converted, 0))) <= 0 THEN 'pending'
             WHEN SUM(LEAST(pri.qty, COALESCE(conv.converted, 0))) < SUM(pri.qty) THEN 'partial'
             ELSE 'complete' END AS status
      FROM public.pr_items pri
      LEFT JOIN (
        SELECT poi.pr_item_id, SUM(poi.qty) AS converted
        FROM public.po_items poi JOIN public.pos po ON po.id = poi.po_id
        WHERE po.po_status <> 'rejected'
        GROUP BY poi.pr_item_id
      ) conv ON conv.pr_item_id = pri.id
      WHERE pri.pr_id = ANY(v_pr_ids_survive)
      GROUP BY pri.pr_id
    ) sub
    WHERE p.id = sub.pr_id;
  END IF;

  -- mrs.mr_convert_status: recompute untuk MR yang bertahan (kehilangan
  -- sebagian pr_items-nya karena PR turunannya dihapus).
  IF array_length(v_mr_ids_survive, 1) > 0 THEN
    UPDATE public.mrs m SET mr_convert_status = sub.status
    FROM (
      SELECT mi.mr_id,
        CASE WHEN SUM(LEAST(mi.qty_pr, COALESCE(conv.converted, 0))) <= 0 THEN 'pending'
             WHEN SUM(LEAST(mi.qty_pr, COALESCE(conv.converted, 0))) < SUM(mi.qty_pr) THEN 'partial'
             ELSE 'complete' END AS status
      FROM public.mr_items mi
      LEFT JOIN (
        SELECT pri.mr_item_id, SUM(pri.qty) AS converted
        FROM public.pr_items pri JOIN public.prs pr2 ON pr2.id = pri.pr_id
        WHERE pr2.pr_status <> 'rejected'
        GROUP BY pri.mr_item_id
      ) conv ON conv.mr_item_id = mi.id
      WHERE mi.mr_id = ANY(v_mr_ids_survive) AND mi.qty_pr > 0
      GROUP BY mi.mr_id
    ) sub
    WHERE m.id = sub.mr_id;
  END IF;

  -- mr_items.ss_status: recompute untuk item yang delivery-nya dihapus
  -- (mirror syncShareStockStatuses — cuma hitung delivery yang sudah
  -- di-sign penerima).
  IF array_length(v_mr_item_ids_survive, 1) > 0 THEN
    UPDATE public.mr_items mi SET ss_status = COALESCE(sub.status, 'open')
    FROM (SELECT unnest(v_mr_item_ids_survive) AS id) base
    LEFT JOIN (
      SELECT di.mr_item_id,
        CASE WHEN SUM(di.qty_on_delivery) >= MAX(mi2.qty_sharestock_total) THEN 'closed'
             ELSE 'approved' END AS status
      FROM public.delivery_items di
      JOIN public.deliveries dl ON dl.id = di.dlv_id AND dl.signature_receiver_id IS NOT NULL
      JOIN public.mr_items mi2 ON mi2.id = di.mr_item_id
      WHERE di.mr_item_id = ANY(v_mr_item_ids_survive)
      GROUP BY di.mr_item_id
    ) sub ON sub.mr_item_id = base.id
    WHERE mi.id = base.id;
  END IF;

  -- ============================================================
  -- 9. Audit log (reuse moderator_edit_logs — doc_type constraint-nya
  --    sudah mencakup mr/pr/po/receive/delivery)
  -- ============================================================
  INSERT INTO public.moderator_edit_logs (doc_type, doc_id, user_id, user_nama, summary, changes)
  VALUES (
    p_doc_type,
    p_doc_id,
    v_actor,
    COALESCE(v_actor_nama, 'Moderator'),
    format('Hapus Cascade %s #%s (%s dokumen ikut terhapus). Alasan: %s',
      p_doc_type, p_doc_id, jsonb_array_length(v_documents), p_reason),
    v_snapshot
  );

  RETURN jsonb_build_object(
    'success', true,
    'can_delete', true,
    'documents', v_documents,
    'conflicts', '[]'::jsonb,
    'blocked_reasons', '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.plan_cascade_document_delete(
  p_doc_type text,
  p_doc_id bigint
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._cascade_delete_document_impl(p_doc_type, p_doc_id, NULL, true);
$$;

CREATE OR REPLACE FUNCTION public.execute_cascade_document_delete(
  p_doc_type text,
  p_doc_id bigint,
  p_reason text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._cascade_delete_document_impl(p_doc_type, p_doc_id, p_reason, false);
$$;

REVOKE ALL ON FUNCTION public._cascade_delete_document_impl(text, bigint, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_cascade_document_delete(text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_cascade_document_delete(text, bigint, text) TO authenticated;

COMMENT ON FUNCTION public.execute_cascade_document_delete IS
'Hapus dokumen MR/PR/PO/Receive/Delivery/Item Transfer beserta seluruh turunannya (item-level cascade), reverse stok yang sudah terlanjur diposting, dan recompute status dokumen ancestor yang bertahan. Khusus moderator. Block (tanpa menulis apapun) kalau reverse stok akan membuat stok negatif atau ada delivery/item transfer yang sudah completed dalam scope.';
