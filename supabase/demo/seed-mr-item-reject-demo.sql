-- =============================================================================
-- DATA DEMO (LOKAL SAJA) — Tolak per item MR oleh approver terakhir.
-- JANGAN dijalankan di Supabase VPS / production.
-- =============================================================================
-- Butuh migration 20261021110000_mr_item_reject.sql + akun @demo.com (seed.sql).
--
-- Isi: 2 MR status open yang step pending-nya = step TERAKHIR, jadi panel
-- "Decision Making" + tombol "Tolak Item" langsung muncul:
--   MR-DEMO-REJ-001  approver terakhir: ppic@demo.com       (3 step)
--   MR-DEMO-REJ-002  approver terakhir: moderator@demo.com  (2 step)
-- Login pakai akun tsb (password: demo123) lalu buka /mr.
-- Beberapa PN diberi stok di gudang lain supaya alokasi share stock juga bisa
-- dicoba bareng item yang ditolak.
--
-- Idempotent: hapus dulu MR-DEMO-REJ-* lama, lalu bikin ulang.
--
-- Jalankan:
--   psql postgresql://postgres:postgres@127.0.0.1:54332/postgres \
--     -v ON_ERROR_STOP=1 -f supabase/demo/seed-mr-item-reject-demo.sql
-- =============================================================================

BEGIN;

DELETE FROM public.notifications WHERE metadata->>'seed' = 'demo-mr-reject';
DELETE FROM public.mr_sharestock_allocations WHERE mr_item_id IN
  (SELECT mi.id FROM public.mr_items mi JOIN public.mrs m ON m.id = mi.mr_id
   WHERE m.mr_kode LIKE 'MR-DEMO-REJ-%');
DELETE FROM public.mr_items WHERE mr_id IN
  (SELECT id FROM public.mrs WHERE mr_kode LIKE 'MR-DEMO-REJ-%');
DELETE FROM public.mrs WHERE mr_kode LIKE 'MR-DEMO-REJ-%';

-- Satu step approvals[] dengan bentuk JSON yang sama dengan create MR di app.
CREATE OR REPLACE FUNCTION pg_temp.step(
  p_order int, p_uid uuid, p_role text, p_status text, p_ts timestamptz
) RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_build_object(
    'step_id', NULL, 'step_order', p_order, 'level', 'menyetujui',
    'status', p_status, 'user_id', p_uid, 'nama', p.nama, 'email', p.email,
    'role', p_role,
    'processed_at', CASE WHEN p_status <> 'pending' THEN p_ts END,
    'signature_url', CASE WHEN p_status = 'approved' THEN
      (SELECT image_url FROM public.user_signatures
       WHERE user_id = p_uid AND NOT is_hidden ORDER BY created_at LIMIT 1) END,
    'snapshot', CASE WHEN p_status <> 'pending' THEN jsonb_build_object(
      'nama', p.nama, 'email', p.email, 'lokasi', coalesce(c.nama_cabang, '')) END)
  FROM public.profiles p LEFT JOIN public.cabang c ON c.id = p.cabang_id
  WHERE p.id = p_uid
$f$;

DO $$
DECLARE
  v_admin uuid := (SELECT id FROM public.profiles WHERE email = 'admin@demo.com');
  v_spv   uuid := (SELECT id FROM public.profiles WHERE email = 'spv@demo.com');
  v_ppic  uuid := (SELECT id FROM public.profiles WHERE email = 'ppic@demo.com');
  v_mod   uuid := (SELECT id FROM public.profiles WHERE email = 'moderator@demo.com');
  v_ts    timestamptz := now() - interval '1 day';
  v_cab   bigint;
  v_src   bigint;
  v_mr_id bigint;
  v_parts bigint[];
  v_qtys  int[] := ARRAY[5, 2, 10, 3, 1];
  v_rem   text[] := ARRAY['Untuk PM unit', 'Stok habis', 'Cadangan site',
                          'Ganti yang rusak', 'Permintaan user'];
  v_prio  text[] := ARRAY['P1', 'P2', 'P3', 'P3', 'P4'];
  i int;
  m int;
BEGIN
  IF v_admin IS NULL OR v_ppic IS NULL OR v_mod IS NULL OR v_spv IS NULL THEN
    RAISE EXCEPTION 'Akun @demo.com belum ada -- jalankan supabase/seed.sql dulu.';
  END IF;

  v_cab := coalesce((SELECT cabang_id FROM public.profiles WHERE id = v_admin),
                    (SELECT min(id) FROM public.cabang));
  v_src := (SELECT min(id) FROM public.cabang WHERE id <> v_cab);

  v_parts := ARRAY(
    SELECT id FROM public.barang WHERE part_number IS NOT NULL
    ORDER BY id LIMIT 10);
  IF coalesce(array_length(v_parts, 1), 0) < 10 THEN
    RAISE EXCEPTION 'Master barang kurang dari 10 baris.';
  END IF;

  -- Max stock di gudang tujuan (biar konsisten dgn aturan create MR) +
  -- stok di gudang lain untuk dicoba sebagai sumber share stock.
  FOR i IN 1..10 LOOP
    INSERT INTO public.stock (part_id, cabang_id, qty, min_qty, max_qty)
    VALUES (v_parts[i], v_cab, 0, 0, 50)
    ON CONFLICT (part_id, cabang_id) DO UPDATE
      SET max_qty = greatest(public.stock.max_qty, 50);
    IF i % 2 = 1 AND v_src IS NOT NULL THEN
      INSERT INTO public.stock (part_id, cabang_id, qty)
      VALUES (v_parts[i], v_src, 20)
      ON CONFLICT (part_id, cabang_id) DO UPDATE
        SET qty = greatest(public.stock.qty, 20);
    END IF;
  END LOOP;

  FOR m IN 1..2 LOOP
    INSERT INTO public.mrs
      (mr_kode, cabang_id, mr_pic, mr_pic_id, mr_tanggal, mr_due_date,
       mr_status, kategori, approvals, mr_type, created_at, updated_at)
    VALUES (
      format('MR-DEMO-REJ-%s', lpad(m::text, 3, '0')),
      v_cab,
      (SELECT nama FROM public.profiles WHERE id = v_admin),
      v_admin,
      current_date - 1,
      current_date + 30,
      'open',
      CASE m WHEN 1 THEN 'Replace Item' ELSE 'New Item' END,
      CASE m
        WHEN 1 THEN jsonb_build_array(
          pg_temp.step(1, v_admin, 'Requester', 'approved', v_ts),
          pg_temp.step(2, v_spv,   'Approver',  'approved', v_ts + interval '2 hours'),
          pg_temp.step(3, v_ppic,  'Approver',  'pending',  NULL))
        ELSE jsonb_build_array(
          pg_temp.step(1, v_admin, 'Requester', 'approved', v_ts),
          pg_temp.step(2, v_mod,   'Approver',  'pending',  NULL))
      END,
      'standard', v_ts, v_ts)
    RETURNING id INTO v_mr_id;

    FOR i IN 1..5 LOOP
      INSERT INTO public.mr_items
        (mr_id, part_id, part_number, part_name, satuan, qty_request,
         item_priority, remarks)
      SELECT v_mr_id, b.id, b.part_number, b.part_name,
             coalesce(b.part_satuan, 'PCS'), v_qtys[i], v_prio[i], v_rem[i]
      FROM public.barang b WHERE b.id = v_parts[(m - 1) * 5 + i];
    END LOOP;

    INSERT INTO public.notifications
      (user_id, actor_id, type, title, message, document_type, document_id,
       document_url, is_read, metadata, created_at)
    VALUES (
      CASE m WHEN 1 THEN v_ppic ELSE v_mod END, v_admin, 'approval_needed',
      'Perlu persetujuan: MR',
      format('Dokumen MR-DEMO-REJ-%s memerlukan persetujuan Anda sebagai penyetuju.',
             lpad(m::text, 3, '0')),
      'MR', v_mr_id, '/mr/' || v_mr_id, false,
      jsonb_build_object('seed', 'demo-mr-reject'), now());
  END LOOP;
END
$$;

COMMIT;

SELECT m.mr_kode, m.mr_status,
       m.approvals->-1->>'email' AS approver_terakhir,
       count(mi.id) AS jml_item
FROM public.mrs m JOIN public.mr_items mi ON mi.mr_id = m.id
WHERE m.mr_kode LIKE 'MR-DEMO-REJ-%'
GROUP BY m.id ORDER BY m.mr_kode;
