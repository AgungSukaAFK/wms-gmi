-- Migration: Add Name to Approval Templates
-- Date: 2026-04-10

-- 1. Add name column
ALTER TABLE public.approval_templates ADD COLUMN name TEXT;

-- 2. Populate existing rows with a default name if any exist
UPDATE public.approval_templates 
SET name = 'Template ' || type || ' ' || COALESCE((SELECT nama_cabang FROM public.cabang WHERE id = cabang_id), 'Global')
WHERE name IS NULL;

-- 3. Make name NOT NULL for future entries
ALTER TABLE public.approval_templates ALTER COLUMN name SET NOT NULL;

COMMENT ON COLUMN public.approval_templates.name IS 'Nama deskriptif untuk template approval.';
