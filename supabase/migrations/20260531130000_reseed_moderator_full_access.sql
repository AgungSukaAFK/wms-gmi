-- Migration: Re-seed Moderator Full Access
-- Date: 2026-05-31
-- Description:
--   Mengembalikan permission full-access (global / cabang_id NULL) untuk role
--   'moderator' pada seluruh halaman/modul utama. Seed awal (STEP 8 di
--   20260410000000_rbac_schema.sql) sebagian hilang sehingga matrix Role &
--   Permission tampak kosong untuk moderator.
--
--   Idempotent: hanya menambah baris yang belum ada (pakai NOT EXISTS karena
--   cabang_id NULL dianggap distinct oleh UNIQUE constraint).
--
--   Catatan: ini HANYA untuk role moderator. Permission role lain (PPIC, PJO,
--   purchasing, dst.) sengaja tidak di-seed — dikonfigurasi manual via halaman
--   Role & Permission sesuai kebijakan.

INSERT INTO public.role_permissions (role_id, page_path, cabang_id)
SELECT r.id, p.path, NULL
FROM public.roles r
CROSS JOIN (VALUES
  ('/dashboard'), ('/stock'), ('/receive'), ('/deliveries'),
  ('/share-stock'), ('/mr'), ('/pr'), ('/po'), ('/spb'),
  ('/return-spb'), ('/job-costing'), ('/barang'), ('/vendors'),
  ('/customers'), ('/cabang'), ('/users'), ('/role-management')
) AS p(path)
WHERE r.name = 'moderator'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.page_path = p.path
      AND rp.cabang_id IS NULL
  );
