-- Update user_role enum to include all required roles
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'finance';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'ga';

-- Create v_stock_with_status view for optimized stock filtering
CREATE OR REPLACE VIEW public.v_stock_with_status AS
SELECT 
  s.id,
  s.part_id,
  s.cabang_id,
  s.qty,
  s.min_qty,
  s.max_qty,
  s.created_at,
  s.updated_at,
  CASE
    WHEN s.min_qty = 0 AND s.max_qty = 0 THEN 'unknown'
    WHEN s.qty < s.min_qty THEN 'low'
    WHEN s.qty > s.max_qty THEN 'overstock'
    ELSE 'normal'
  END AS status,
  b.part_number,
  b.part_name,
  b.part_satuan,
  c.nama_cabang,
  c.kode_cabang
FROM public.stock s
JOIN public.barang b ON s.part_id = b.id
JOIN public.cabang c ON s.cabang_id = c.id;
