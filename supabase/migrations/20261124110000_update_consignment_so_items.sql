-- ============================================================
-- Edit item SO Consignment (atomik) + riwayat aktivitas
-- (services/consignment-so-actions.ts -> updateConsignmentSoItems)
--
-- Aturan penjaga alur data (IK = pengiriman, menunjuk ke consignment_so_items
-- lewat so_item_id; qty terkirim selalu dihitung dari consignment_ik_items):
--   * item yang sudah punya baris IK (termasuk IK import) TIDAK boleh dihapus
--     dan part-nya tidak boleh diganti
--   * qty item tidak boleh di bawah total qty yang sudah dikirim via IK
--   * item baru boleh ditambah (part aktif, tidak kembar dalam satu SO)
--   * minimal 1 item, qty > 0, PN Customer wajib
--   * optimistic lock lewat consignment_so.updated_at (cegah timpa edit orang lain)
--   * baris item dikunci FOR UPDATE: INSERT IK baru (FOR KEY SHARE via FK)
--     menunggu sampai transaksi ini selesai, jadi cek qty terkirim tidak balapan
--   * alasan wajib; role moderator/admin/marketing dicek lagi di sini
--   * log ke consignment_so_logs ditulis di transaksi yang sama
--
-- Murni aditif (fungsi baru): aman untuk code production lama.
-- Butuh tabel consignment_so_logs dari 20261124100000.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_consignment_so_items(
  p_so_id BIGINT,
  p_items JSONB,
  p_reason TEXT,
  p_expected_updated_at TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_nama TEXT;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_so RECORD;
  v_item JSONB;
  v_ex RECORD;
  v_barang RECORD;
  v_id BIGINT;
  v_part_id BIGINT;
  v_qty NUMERIC;
  v_pnc TEXT;
  v_shipped NUMERIC;
  v_ik_rows INT;
  v_seen_ids BIGINT[] := '{}';
  v_seen_parts BIGINT[] := '{}';
  v_changes JSONB := '[]'::JSONB;
  v_added INT := 0;
  v_removed INT := 0;
  v_changed INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Session expired';
  END IF;

  SELECT r.name INTO v_role
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_uid
    AND r.name IN ('moderator', 'admin', 'marketing')
  ORDER BY CASE r.name WHEN 'moderator' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END
  LIMIT 1;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak. Hanya moderator, admin, atau marketing yang dapat mengubah item SO Consignment.';
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'Alasan perubahan wajib diisi.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'SO Consignment minimal punya satu item.';
  END IF;

  SELECT * INTO v_so FROM public.consignment_so WHERE id = p_so_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SO Consignment tidak ditemukan.';
  END IF;
  IF p_expected_updated_at IS NOT NULL
     AND v_so.updated_at <> p_expected_updated_at::TIMESTAMPTZ THEN
    RAISE EXCEPTION 'SO ini baru saja diubah pengguna lain. Tutup lalu buka lagi detail SO, kemudian ulangi edit.';
  END IF;

  -- 1) Item di payload: ubah qty / PN Customer, atau tambah baru.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_id := NULLIF(v_item->>'id', '')::BIGINT;
    v_part_id := NULLIF(v_item->>'part_id', '')::BIGINT;
    v_qty := NULLIF(v_item->>'qty', '')::NUMERIC;
    v_pnc := btrim(COALESCE(v_item->>'part_number_customer', ''));

    IF v_part_id IS NULL THEN
      RAISE EXCEPTION 'Part item tidak valid.';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Qty item harus lebih dari 0.';
    END IF;
    IF v_part_id = ANY (v_seen_parts) THEN
      RAISE EXCEPTION 'Part yang sama tidak boleh muncul dua kali dalam satu SO.';
    END IF;
    v_seen_parts := v_seen_parts || v_part_id;

    IF v_id IS NOT NULL THEN
      IF v_id = ANY (v_seen_ids) THEN
        RAISE EXCEPTION 'Item ganda pada daftar yang dikirim.';
      END IF;
      v_seen_ids := v_seen_ids || v_id;

      SELECT * INTO v_ex FROM public.consignment_so_items
      WHERE id = v_id AND so_id = p_so_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item % bukan bagian dari SO ini.', v_id;
      END IF;
      IF v_ex.part_id <> v_part_id THEN
        RAISE EXCEPTION '%: part item tidak dapat diganti. Hapus lalu tambah item baru.', v_ex.part_number;
      END IF;
      IF v_pnc = '' THEN
        RAISE EXCEPTION '%: PN Customer wajib diisi.', v_ex.part_number;
      END IF;

      SELECT COALESCE(SUM(qty), 0) INTO v_shipped
      FROM public.consignment_ik_items WHERE so_item_id = v_id;
      IF v_qty < v_shipped THEN
        RAISE EXCEPTION '%: qty tidak boleh di bawah qty yang sudah dikirim via IK (%).', v_ex.part_number, v_shipped;
      END IF;

      IF v_qty <> v_ex.qty THEN
        UPDATE public.consignment_so_items SET qty = v_qty WHERE id = v_id;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'field', 'item_qty', 'label', v_ex.part_number, 'name', v_ex.part_name,
          'before', v_ex.qty::TEXT || ' ' || v_ex.satuan,
          'after', v_qty::TEXT || ' ' || v_ex.satuan));
        v_changed := v_changed + 1;
      END IF;
      IF v_pnc IS DISTINCT FROM COALESCE(v_ex.part_number_customer, '') THEN
        UPDATE public.consignment_so_items SET part_number_customer = v_pnc WHERE id = v_id;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'field', 'item_pnc', 'label', v_ex.part_number, 'name', v_ex.part_name,
          'before', NULLIF(v_ex.part_number_customer, ''),
          'after', v_pnc));
        v_changed := v_changed + 1;
      END IF;
    ELSE
      IF v_pnc = '' THEN
        RAISE EXCEPTION 'PN Customer wajib diisi untuk item baru.';
      END IF;
      SELECT id, part_number, part_name, part_satuan INTO v_barang
      FROM public.barang WHERE id = v_part_id AND deleted_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Barang tidak ditemukan atau sudah dihapus.';
      END IF;
      INSERT INTO public.consignment_so_items
        (so_id, part_id, part_number, part_name, satuan, part_number_customer, qty)
      VALUES
        (p_so_id, v_barang.id, v_barang.part_number, v_barang.part_name,
         v_barang.part_satuan, v_pnc, v_qty)
      RETURNING id INTO v_id;
      -- Tandai agar tidak ikut terhapus di langkah 2.
      v_seen_ids := v_seen_ids || v_id;
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'item_added', 'label', v_barang.part_number, 'name', v_barang.part_name,
        'before', NULL,
        'after', v_qty::TEXT || ' ' || v_barang.part_satuan));
      v_added := v_added + 1;
    END IF;
  END LOOP;

  -- 2) Item yang tidak ada di payload = dihapus (hanya bila belum pernah dikirim).
  FOR v_ex IN
    SELECT * FROM public.consignment_so_items
    WHERE so_id = p_so_id AND NOT (id = ANY (v_seen_ids))
    FOR UPDATE
  LOOP
    SELECT COUNT(*) INTO v_ik_rows
    FROM public.consignment_ik_items WHERE so_item_id = v_ex.id;
    IF v_ik_rows > 0 THEN
      RAISE EXCEPTION '%: sudah punya pengiriman (IK), tidak dapat dihapus dari SO.', v_ex.part_number;
    END IF;
    DELETE FROM public.consignment_so_items WHERE id = v_ex.id;
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field', 'item_removed', 'label', v_ex.part_number, 'name', v_ex.part_name,
      'before', v_ex.qty::TEXT || ' ' || v_ex.satuan,
      'after', NULL));
    v_removed := v_removed + 1;
  END LOOP;

  IF jsonb_array_length(v_changes) = 0 THEN
    RAISE EXCEPTION 'Tidak ada perubahan item.';
  END IF;

  UPDATE public.consignment_so SET updated_at = NOW() WHERE id = p_so_id;

  SELECT nama INTO v_nama FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.consignment_so_logs
    (so_id, so_no, action, user_id, user_nama, user_role, reason, summary, changes)
  VALUES
    (p_so_id, v_so.so_no, 'edit', v_uid, COALESCE(v_nama, '-'), v_role, v_reason,
     'Edit item: ' || concat_ws(', ',
        CASE WHEN v_added > 0 THEN v_added || ' ditambah' END,
        CASE WHEN v_removed > 0 THEN v_removed || ' dihapus' END,
        CASE WHEN v_changed > 0 THEN v_changed || ' diubah' END),
     v_changes);

  RETURN jsonb_build_object(
    'success', TRUE, 'added', v_added, 'removed', v_removed, 'changed', v_changed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_consignment_so_items(BIGINT, JSONB, TEXT, TEXT)
  TO authenticated;
