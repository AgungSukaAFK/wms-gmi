-- Migration: Tambah role Marketing (manajemen customer)
-- Date: 2026-06-02
-- Description:
--   Menambahkan role 'marketing' ke master roles. Role ini ditujukan untuk
--   manajemen customer (CRUD). Akses tulis customer diberikan ke role
--   'marketing' dan 'moderator' (lihat services/master-actions.ts &
--   app/(With Sidebar)/customers/page.tsx).
--   Idempotent: aman dijalankan berulang.

-- 1. Seed role marketing (skip jika sudah ada)
INSERT INTO public.roles (name, label, description, color)
VALUES (
  'marketing',
  'Marketing',
  'Manajemen customer (CRUD) dan aktivitas marketing',
  'pink'
)
ON CONFLICT (name) DO NOTHING;

-- 2. Beri akses halaman /customers untuk role marketing (global / cabang_id NULL)
INSERT INTO public.role_permissions (role_id, page_path, cabang_id)
SELECT r.id, '/customers', NULL
FROM public.roles r
WHERE r.name = 'marketing'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.page_path = '/customers'
      AND rp.cabang_id IS NULL
  );
