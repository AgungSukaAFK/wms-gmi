-- Migration: Add Global Support to Approval Templates
-- Date: 2026-04-10

-- 1. Allow cabang_id to be NULL (NULL means "All Locations")
ALTER TABLE public.approval_templates ALTER COLUMN cabang_id DROP NOT NULL;

-- 2. Update Unique Constraint
-- PostgreSQL's UNIQUE(type, cabang_id) already allows multiple NULLs in cabang_id by default.
-- To enforce ONLY ONE global template per type, we add a partial unique index.
CREATE UNIQUE INDEX unique_global_approval_template 
ON public.approval_templates (type) 
WHERE (cabang_id IS NULL);

-- 3. Update RLS (Ensure Moderators can manage global templates)
-- Existing policies:
-- "Anyone authenticated can read approval_templates" -> Covers global as well.
-- "Moderators have full access to approval_templates" -> Covers global as well.
-- "Admins can manage their own site templates" -> Already checks cabang_id match, so it won't allow global access.

-- No changes needed to RLS because global templates (cabang_id IS NULL) 
-- will only be manageable by Moderators since the Admin policy only allows 
-- management of specific site IDs.

COMMENT ON COLUMN public.approval_templates.cabang_id IS 'ID Cabang. Jika NULL, berarti template ini berlaku untuk SEMUA LOKASI (Global).';
