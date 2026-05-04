-- Add cabang page permission for moderator role
INSERT INTO public.role_permissions (role_id, page_path)
SELECT r.id, '/cabang'
FROM public.roles r
WHERE r.name = 'moderator'
  AND NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.page_path = '/cabang'
  );
