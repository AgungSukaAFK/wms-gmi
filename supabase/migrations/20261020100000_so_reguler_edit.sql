-- ============================================================
-- SO REGULER: Edit / Revisi (role marketing & moderator)
-- ------------------------------------------------------------
-- Semua isian SO boleh diubah (nomor SO, tanggal, kategori, customer, info PO
-- customer, marketing, keterangan, item: tambah/hapus/ubah qty/catatan) dengan
-- penjaga distribusi qty:
--   * Item yang sudah dipakai PO/DO (baris po_items / do_reguler_items mana
--     pun, termasuk PO rejected / DO cancelled -- FK so_item_id) tidak bisa
--     dihapus dan part-nya tidak bisa diganti.
--   * Qty item tidak boleh turun di bawah qty yang sudah "terpakai":
--       min_qty = qty PO (non-rejected) + qty DO dari stok biasa
--               = qty_po + (qty_do - LEAST(qty_do_from_po, qty_do))
--     (mirror computeSoItemRemaining / soItemMinQty di lib/so-reguler.ts;
--     menjamin sisaPo & sisaDo tidak pernah negatif).
--   * Customer tidak bisa diganti kalau sudah ada DO (non-cancelled) dari SO
--     ini -- DO by SO wajib customer yang sama dengan SO.
--   * SO dibatalkan tidak bisa diedit.
--   * Konflik edit bersamaan dicegah dengan cek updated_at (optimistic lock).
-- Semua validasi + perubahan dijalankan atomik dalam satu fungsi dengan baris
-- SO di-lock (FOR UPDATE), jadi tidak ada kondisi setengah tersimpan.
--
-- Riwayat: so_reguler.so_revision naik 1 tiap edit; so_reguler_revisions
-- menyimpan alasan + snapshot sebelum & sesudah (diff dihitung di app).
--
-- Backward-compat: kolom baru punya DEFAULT, tabel & fungsi baru tidak
-- disentuh code production lama.
-- ============================================================

ALTER TABLE public.so_reguler
  ADD COLUMN IF NOT EXISTS so_revision INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.so_reguler.so_revision IS
'Nomor revisi SO (0 = belum pernah diedit). Naik 1 setiap Edit SO.';

CREATE TABLE IF NOT EXISTS public.so_reguler_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  so_id BIGINT NOT NULL REFERENCES public.so_reguler(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  edited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  edited_by_nama TEXT,
  reason TEXT NOT NULL,
  snapshot_before JSONB NOT NULL,
  snapshot_after JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (so_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_so_reguler_revisions_so_id
  ON public.so_reguler_revisions (so_id, revision_no DESC);

ALTER TABLE public.so_reguler_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "so_reguler_revisions_select" ON public.so_reguler_revisions;
CREATE POLICY "so_reguler_revisions_select"
  ON public.so_reguler_revisions FOR SELECT TO authenticated
  USING (true);

-- Baris hanya ditulis lewat update_so_reguler (SECURITY DEFINER); append-only.
GRANT SELECT ON public.so_reguler_revisions TO authenticated;

-- ------------------------------------------------------------
-- Snapshot header + item (dipakai sebelum & sesudah edit)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._so_reguler_snapshot(p_so_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'so_kode', s.so_kode,
    'so_tanggal', s.so_tanggal,
    'so_due_date', s.so_due_date,
    'kategori', s.kategori,
    'customer_id', s.customer_id,
    'customer_name', c.customer_name,
    'customer_po_no', s.customer_po_no,
    'customer_po_date', s.customer_po_date,
    'customer_po_received_date', s.customer_po_received_date,
    'marketing_name', s.marketing_name,
    'remarks', s.remarks,
    'so_status', s.so_status,
    'so_revision', s.so_revision,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id,
        'part_id', i.part_id,
        'part_number', i.part_number,
        'part_name', i.part_name,
        'satuan', i.satuan,
        'qty', i.qty,
        'remarks', i.remarks
      ) ORDER BY i.id)
      FROM public.so_reguler_items i WHERE i.so_id = s.id
    ), '[]'::jsonb)
  )
  FROM public.so_reguler s
  LEFT JOIN public.customers c ON c.id = s.customer_id
  WHERE s.id = p_so_id;
$$;

-- ------------------------------------------------------------
-- Edit SO (atomik)
--   p_header: { so_kode, so_tanggal, so_due_date, kategori, customer_id,
--               customer_po_no, customer_po_date, customer_po_received_date,
--               marketing_name, remarks }
--   p_items : [{ id?, part_id, part_number, part_name, satuan, qty, remarks }]
--             id = so_reguler_items.id untuk item lama; tanpa id = item baru.
--             Item lama yang tidak dikirim = dihapus.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_so_reguler(
  p_so_id bigint,
  p_expected_updated_at timestamptz,
  p_header jsonb,
  p_items jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_nama text;
  v_so record;
  v_before jsonb;
  v_after jsonb;
  v_rev integer;
  v_kode text := upper(btrim(COALESCE(p_header->>'so_kode', '')));
  v_tanggal date := NULLIF(p_header->>'so_tanggal', '')::date;
  v_due date := NULLIF(p_header->>'so_due_date', '')::date;
  v_kategori text := NULLIF(btrim(COALESCE(p_header->>'kategori', '')), '');
  v_customer_id bigint := NULLIF(p_header->>'customer_id', '')::bigint;
  v_po_date date := NULLIF(p_header->>'customer_po_date', '')::date;
  v_po_recv date := NULLIF(p_header->>'customer_po_received_date', '')::date;
  v_errors text[] := '{}';
  v_row record;
  v_bad text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_actor AND r.name IN ('marketing', 'moderator')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak. Hanya marketing/moderator yang bisa mengedit SO.';
  END IF;

  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Alasan perubahan wajib diisi.';
  END IF;

  SELECT * INTO v_so FROM public.so_reguler WHERE id = p_so_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SO Reguler tidak ditemukan.';
  END IF;
  IF v_so.so_status = 'cancelled' THEN
    RAISE EXCEPTION 'SO % sudah dibatalkan, tidak bisa diedit.', v_so.so_kode;
  END IF;
  IF p_expected_updated_at IS NULL OR v_so.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'SO % baru saja diubah di tempat lain. Muat ulang halaman lalu ulangi perubahan.', v_so.so_kode;
  END IF;

  -- ---------- Header ----------
  IF v_kode = '' THEN
    RAISE EXCEPTION 'Nomor SO wajib diisi.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.so_reguler WHERE so_kode = v_kode AND id <> p_so_id) THEN
    RAISE EXCEPTION 'Nomor SO % sudah digunakan SO lain.', v_kode;
  END IF;
  IF v_tanggal IS NULL THEN
    RAISE EXCEPTION 'Tanggal SO wajib diisi.';
  END IF;
  IF v_due IS NOT NULL AND v_due < v_tanggal THEN
    RAISE EXCEPTION 'Deadline tidak boleh sebelum tanggal SO.';
  END IF;
  IF v_po_date IS NOT NULL AND v_po_recv IS NOT NULL AND v_po_recv < v_po_date THEN
    RAISE EXCEPTION 'Tanggal PO diterima tidak boleh sebelum tanggal PO dibuat.';
  END IF;
  -- Kategori baru wajib salah satu pilihan baru; nilai lama (legacy / NULL)
  -- boleh dipertahankan apa adanya.
  IF v_kategori IS DISTINCT FROM v_so.kategori
     AND (v_kategori IS NULL OR v_kategori NOT IN ('Kontrak', 'Repeat Order', 'Quotation', 'Instalasi')) THEN
    RAISE EXCEPTION 'Kategori SO wajib dipilih.';
  END IF;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer wajib dipilih.';
  END IF;
  IF v_customer_id <> v_so.customer_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customers
      WHERE id = v_customer_id AND is_active
        AND customer_type IN ('non_consignment', 'both')
    ) THEN
      RAISE EXCEPTION 'Customer tidak valid (harus customer reguler yang aktif).';
    END IF;
    SELECT string_agg(DISTINCT d.do_kode, ', ') INTO v_bad
      FROM public.do_reguler d
      WHERE d.so_id = p_so_id AND d.status <> 'cancelled';
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Customer tidak bisa diganti karena SO sudah dikirim lewat DO: %.', v_bad;
    END IF;
  END IF;

  -- ---------- Items ----------
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Daftar barang tidak boleh kosong.';
  END IF;

  DROP TABLE IF EXISTS _so_edit_items;
  CREATE TEMP TABLE _so_edit_items ON COMMIT DROP AS
  SELECT
    NULLIF(e->>'id', '')::bigint AS id,
    NULLIF(e->>'part_id', '')::bigint AS part_id,
    btrim(COALESCE(e->>'part_number', '')) AS part_number,
    btrim(COALESCE(e->>'part_name', '')) AS part_name,
    btrim(COALESCE(e->>'satuan', '')) AS satuan,
    e->>'qty' AS qty_raw,
    NULLIF(btrim(COALESCE(e->>'remarks', '')), '') AS remarks
  FROM jsonb_array_elements(p_items) e;

  SELECT string_agg(COALESCE(NULLIF(part_number, ''), '?'), ', ') INTO v_bad
    FROM _so_edit_items
    WHERE part_id IS NULL OR part_number = '' OR part_name = '' OR satuan = ''
       OR qty_raw IS NULL OR qty_raw !~ '^[0-9]+$' OR qty_raw::numeric <= 0
       OR qty_raw::numeric > 2147483647;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Qty harus bilangan bulat > 0 dan data barang lengkap: %', v_bad;
  END IF;

  SELECT string_agg(part_number, ', ') INTO v_bad FROM (
    SELECT MIN(part_number) AS part_number FROM _so_edit_items
    GROUP BY part_id HAVING COUNT(*) > 1
  ) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Barang yang sama muncul lebih dari sekali: %', v_bad;
  END IF;

  SELECT string_agg(e.id::text, ', ') INTO v_bad
    FROM _so_edit_items e
    WHERE e.id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.so_reguler_items i WHERE i.id = e.id AND i.so_id = p_so_id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Item SO tidak dikenali (id %). Muat ulang halaman.', v_bad;
  END IF;

  SELECT string_agg(part_number, ', ') INTO v_bad
    FROM _so_edit_items e
    WHERE NOT EXISTS (SELECT 1 FROM public.barang b WHERE b.id = e.part_id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Barang tidak ditemukan di master: %', v_bad;
  END IF;

  -- Pemakaian per item lama (sumber yang sama dgn fetchSoItemFulfillment).
  DROP TABLE IF EXISTS _so_edit_usage;
  CREATE TEMP TABLE _so_edit_usage ON COMMIT DROP AS
  SELECT
    i.id,
    i.part_id,
    i.part_number,
    COALESCE(po.qty_po, 0) AS qty_po,
    COALESCE(dl.qty_do, 0) AS qty_do,
    COALESCE(dl.qty_do_from_po, 0) AS qty_do_from_po,
    COALESCE(po.qty_po, 0)
      + COALESCE(dl.qty_do, 0)
      - LEAST(COALESCE(dl.qty_do_from_po, 0), COALESCE(dl.qty_do, 0)) AS min_qty,
    (EXISTS (SELECT 1 FROM public.po_items x WHERE x.so_item_id = i.id)
      OR EXISTS (SELECT 1 FROM public.do_reguler_items y WHERE y.so_item_id = i.id)) AS referenced
  FROM public.so_reguler_items i
  LEFT JOIN LATERAL (
    SELECT SUM(pi.qty) AS qty_po
    FROM public.po_items pi JOIN public.pos p ON p.id = pi.po_id
    WHERE pi.so_item_id = i.id AND p.po_status <> 'rejected'
  ) po ON true
  LEFT JOIN LATERAL (
    SELECT SUM(di.qty) AS qty_do, SUM(di.qty_from_po) AS qty_do_from_po
    FROM public.do_reguler_items di JOIN public.do_reguler d ON d.id = di.do_id
    WHERE di.so_item_id = i.id AND d.status <> 'cancelled'
  ) dl ON true
  WHERE i.so_id = p_so_id;

  -- Hapus item yang sudah dipakai PO/DO
  FOR v_row IN
    SELECT u.* FROM _so_edit_usage u
    WHERE u.referenced AND NOT EXISTS (SELECT 1 FROM _so_edit_items e WHERE e.id = u.id)
  LOOP
    v_errors := v_errors || format('%s tidak bisa dihapus (sudah dipakai PO/DO)', v_row.part_number);
  END LOOP;

  -- Ganti part pada item yang sudah dipakai PO/DO
  FOR v_row IN
    SELECT u.part_number FROM _so_edit_usage u JOIN _so_edit_items e ON e.id = u.id
    WHERE u.referenced AND e.part_id <> u.part_id
  LOOP
    v_errors := v_errors || format('Barang %s tidak bisa diganti (sudah dipakai PO/DO)', v_row.part_number);
  END LOOP;

  -- Qty di bawah yang sudah terpakai
  FOR v_row IN
    SELECT u.part_number, u.min_qty, u.qty_po, u.qty_do, e.qty_raw::integer AS qty
    FROM _so_edit_usage u JOIN _so_edit_items e ON e.id = u.id
    WHERE e.qty_raw::integer < u.min_qty
  LOOP
    v_errors := v_errors || format(
      'Qty %s minimal %s (sudah PO %s, DO %s), diisi %s',
      v_row.part_number, v_row.min_qty, v_row.qty_po, v_row.qty_do, v_row.qty);
  END LOOP;

  IF array_length(v_errors, 1) > 0 THEN
    RAISE EXCEPTION '%', array_to_string(v_errors, '; ');
  END IF;

  -- ---------- Apply ----------
  v_before := public._so_reguler_snapshot(p_so_id);
  v_rev := v_so.so_revision + 1;

  DELETE FROM public.so_reguler_items i
  WHERE i.so_id = p_so_id
    AND NOT EXISTS (SELECT 1 FROM _so_edit_items e WHERE e.id = i.id);

  UPDATE public.so_reguler_items i SET
    part_id = e.part_id,
    part_number = e.part_number,
    part_name = e.part_name,
    satuan = e.satuan,
    qty = e.qty_raw::integer,
    remarks = e.remarks
  FROM _so_edit_items e
  WHERE e.id = i.id AND i.so_id = p_so_id
    AND (i.part_id, i.part_number, i.part_name, i.satuan, i.qty, i.remarks)
        IS DISTINCT FROM (e.part_id, e.part_number, e.part_name, e.satuan, e.qty_raw::integer, e.remarks);

  INSERT INTO public.so_reguler_items (so_id, part_id, part_number, part_name, satuan, qty, remarks)
  SELECT p_so_id, e.part_id, e.part_number, e.part_name, e.satuan, e.qty_raw::integer, e.remarks
  FROM _so_edit_items e WHERE e.id IS NULL;

  UPDATE public.so_reguler SET
    so_kode = v_kode,
    so_tanggal = v_tanggal,
    so_due_date = v_due,
    kategori = v_kategori,
    customer_id = v_customer_id,
    customer_po_no = NULLIF(upper(btrim(COALESCE(p_header->>'customer_po_no', ''))), ''),
    customer_po_date = v_po_date,
    customer_po_received_date = v_po_recv,
    marketing_name = NULLIF(upper(btrim(COALESCE(p_header->>'marketing_name', ''))), ''),
    remarks = NULLIF(btrim(COALESCE(p_header->>'remarks', '')), ''),
    so_revision = v_rev
  WHERE id = p_so_id;

  v_after := public._so_reguler_snapshot(p_so_id);

  SELECT nama INTO v_actor_nama FROM public.profiles WHERE id = v_actor;
  INSERT INTO public.so_reguler_revisions
    (so_id, revision_no, edited_by, edited_by_nama, reason, snapshot_before, snapshot_after)
  VALUES
    (p_so_id, v_rev, v_actor, v_actor_nama, btrim(p_reason), v_before, v_after);

  RETURN jsonb_build_object('revision_no', v_rev);
END;
$$;

REVOKE ALL ON FUNCTION public._so_reguler_snapshot(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_so_reguler(bigint, timestamptz, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._so_reguler_snapshot(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_so_reguler(bigint, timestamptz, jsonb, jsonb, text) TO authenticated;
