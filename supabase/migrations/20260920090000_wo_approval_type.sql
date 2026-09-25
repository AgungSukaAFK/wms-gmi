-- Migration: Tambah 'Working Order' ke approval_templates.type
-- Date: 2026-09-20
-- Description:
--   Fitur Working Order (WO) butuh jalur approval sendiri, memakai sistem
--   approval_templates yang sudah generic (lihat 20260504133000_stock_out_approval_c8.sql
--   untuk pola serupa). Murni additive: melebarkan CHECK constraint valid_type,
--   tidak mengubah data/behaviour existing.

ALTER TABLE public.approval_templates
  DROP CONSTRAINT IF EXISTS valid_type;

ALTER TABLE public.approval_templates
  ADD CONSTRAINT valid_type
  CHECK (type IN (
    'Material Request',
    'Purchase Request',
    'Purchase Order',
    'Item Transfer',
    'Receive Item',
    'Stock Out - SPB',
    'Stock Out - SPB PO',
    'Stock Out - SPB DO',
    'Stock Out - SPB Invoice',
    'Return SPB',
    'Working Order'
  ));
