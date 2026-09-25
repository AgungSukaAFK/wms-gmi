-- Demo data for local presentation. Safe to rerun: only DEMO-* records are replaced.
BEGIN;

DELETE FROM public.working_orders WHERE wo_kode LIKE 'DEMO-%';
DELETE FROM public.pos WHERE po_kode LIKE 'DEMO-%';
DELETE FROM public.prs WHERE pr_kode LIKE 'DEMO-%';
DELETE FROM public.mrs WHERE mr_kode LIKE 'DEMO-%';
DELETE FROM public.approval_templates WHERE name = 'DEMO - Working Order Approval';

-- Mark the demo locations as HO/Branch for the WO selector.
UPDATE public.cabang SET cabang_type = 'HO' WHERE id IN (1, 2);
UPDATE public.cabang SET cabang_type = 'Branch' WHERE id = 4;

-- A small BOM set using existing master barang.
INSERT INTO public.wo_formulas (target_part_id, is_active, created_by)
VALUES
  (5, true, '4e4ce19e-b205-4f1f-a122-b39a4099b420'),
  (6, true, '4e4ce19e-b205-4f1f-a122-b39a4099b420')
ON CONFLICT (target_part_id) DO UPDATE
SET is_active = EXCLUDED.is_active,
    updated_at = now();

DELETE FROM public.wo_formula_components
WHERE formula_id IN (SELECT id FROM public.wo_formulas WHERE target_part_id IN (5, 6));

INSERT INTO public.wo_formula_components
  (formula_id, component_part_id, component_part_number, component_part_name, component_satuan, qty_per_unit)
SELECT f.id, b.id, b.part_number, b.part_name, b.part_satuan, x.qty_per_unit
FROM (VALUES
  (5::bigint, 1::bigint, 2::numeric),
  (5::bigint, 3::bigint, 1::numeric),
  (6::bigint, 1::bigint, 1::numeric),
  (6::bigint, 4::bigint, 2::numeric)
) AS x(target_part_id, component_part_id, qty_per_unit)
JOIN public.wo_formulas f ON f.target_part_id = x.target_part_id
JOIN public.barang b ON b.id = x.component_part_id;

-- Stock for the production demonstration in GMI-HO.
INSERT INTO public.stock (part_id, cabang_id, qty, min_qty, max_qty)
VALUES
  (1, 1, 80, 10, 150),
  (3, 1, 40, 5, 80),
  (4, 1, 40, 5, 80),
  (5, 1, 8, 0, 30),
  (6, 1, 5, 0, 30)
ON CONFLICT (part_id, cabang_id) DO UPDATE
SET qty = EXCLUDED.qty, min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty;

-- One two-step approval route for the WO demo.
INSERT INTO public.approval_templates (type, cabang_id, name)
VALUES ('Working Order', 1, 'DEMO - Working Order Approval');

CREATE TEMP TABLE demo_wo_template AS
SELECT id FROM public.approval_templates
WHERE name = 'DEMO - Working Order Approval';

INSERT INTO public.approval_template_steps
  (template_id, step_order, approver_type, user_id, level, position_label)
SELECT id, 1, 'user', '0b657f86-9bec-4937-9259-75f2557777d5', 'menyetujui', 'SPV Operasional'
FROM demo_wo_template;

INSERT INTO public.approval_template_steps
  (template_id, step_order, approver_type, user_id, level, position_label)
SELECT id, 2, 'user', 'a80b3879-eb8b-48fd-98df-07cdc66cccac', 'menyetujui', 'Manufaktur'
FROM demo_wo_template;

-- Procurement documents: three MR states and a linked PR/PO pair.
INSERT INTO public.mrs
  (mr_kode, cabang_id, mr_pic, mr_pic_id, mr_tanggal, mr_due_date, mr_status, mr_remarks, accurate, mr_convert_status, mr_type, kategori)
VALUES
  ('DEMO-MR-001', 4, 'PPIC Demo', 'b9ed0cf8-60e4-4694-8188-add83b8f1aac', CURRENT_DATE - 4, CURRENT_DATE + 10, 'approved', 'Kebutuhan assembly unit A', true, 'pending', 'standard', 'New Item'),
  ('DEMO-MR-002', 4, 'Manufaktur Demo', 'a80b3879-eb8b-48fd-98df-07cdc66cccac', CURRENT_DATE - 2, CURRENT_DATE + 14, 'approved', 'Kebutuhan assembly unit B', true, 'pending', 'standard', 'Replace Item'),
  ('DEMO-MR-003', 4, 'PPIC Demo', 'b9ed0cf8-60e4-4694-8188-add83b8f1aac', CURRENT_DATE, CURRENT_DATE + 21, 'open', 'Menunggu review kebutuhan baru', false, 'pending', 'standard', 'Upgrade'),
  ('DEMO-MR-004', 4, 'PPIC Demo', 'b9ed0cf8-60e4-4694-8188-add83b8f1aac', CURRENT_DATE - 7, CURRENT_DATE + 3, 'rejected', 'Contoh MR ditolak untuk demo status', false, 'pending', 'standard', 'Fix & Repair');

INSERT INTO public.mr_items
  (mr_id, part_id, part_number, part_name, satuan, qty_request, qty_received, qty_pr, qty_sharestock_total, qty_wo, ss_status, item_due_date, item_priority, item_site_cabang_id)
SELECT m.id, b.id, b.part_number, b.part_name, b.part_satuan, x.qty, 0, 0, 0, x.qty_wo, 'open', CURRENT_DATE + x.due_days, x.priority, 4
FROM (VALUES
  ('DEMO-MR-001', 5::bigint, 4, 2, 10, 'P1'),
  ('DEMO-MR-002', 6::bigint, 3, 1, 14, 'P2'),
  ('DEMO-MR-003', 5::bigint, 2, 0, 21, 'P3'),
  ('DEMO-MR-004', 6::bigint, 1, 0, 3, 'P3')
) AS x(mr_kode, part_id, qty, qty_wo, due_days, priority)
JOIN public.mrs m ON m.mr_kode = x.mr_kode
JOIN public.barang b ON b.id = x.part_id;

INSERT INTO public.prs
  (pr_kode, cabang_id, pr_pic_id, pr_tanggal, pr_status, mr_id, accurate, pr_convert_status)
SELECT 'DEMO-PR-001', 4, '00ab0a18-77e3-499c-a259-116faf4eb48a', CURRENT_DATE - 3, 'approved', m.id, true, 'complete'
FROM public.mrs m WHERE m.mr_kode = 'DEMO-MR-001';

INSERT INTO public.pr_items
  (pr_id, mr_id, part_id, part_number, part_name, satuan, qty, status, mr_item_id)
SELECT p.id, m.id, i.part_id, i.part_number, i.part_name, i.satuan, 2, 'approved', i.id
FROM public.prs p
JOIN public.mrs m ON m.id = p.mr_id
JOIN public.mr_items i ON i.mr_id = m.id
WHERE p.pr_kode = 'DEMO-PR-001';

INSERT INTO public.pos
  (po_kode, pr_id, po_tanggal, po_estimasi, po_keterangan, po_status, po_pic, po_pic_id, po_payment_term, po_receive_status, po_harga_termasuk_pajak, po_ppn_rate, po_diskon_mode, po_diskon_value, po_ongkir, po_pph_rate, po_ppn_mode, po_ppn_amount, po_pph_mode, po_pph_amount)
SELECT 'DEMO-PO-001', p.id, CURRENT_DATE - 2, CURRENT_DATE + 12, 'Pengadaan pendukung assembly', 'approved', 'Purchasing Demo', '00ab0a18-77e3-499c-a259-116faf4eb48a', '30 hari', 'partial', false, 12, 'amount', 0, 0, 0, 'amount', 0, 'amount', 0
FROM public.prs p WHERE p.pr_kode = 'DEMO-PR-001';

INSERT INTO public.po_items
  (po_id, mr_id, part_id, part_number, part_name, satuan, qty, harga, vendor_id, qty_received, pr_item_id)
SELECT po.id, m.id, i.part_id, i.part_number, i.part_name, i.satuan, 2, 125000, 1, 1, pi.id
FROM public.pos po
JOIN public.prs pr ON pr.id = po.pr_id
JOIN public.mrs m ON m.id = pr.mr_id
JOIN public.pr_items pi ON pi.pr_id = pr.id
JOIN public.mr_items i ON i.id = pi.mr_item_id
WHERE po.po_kode = 'DEMO-PO-001';

-- Approval snapshots used by the three WO status examples.
CREATE TEMP TABLE demo_wo_refs AS
SELECT t.id AS template_id,
       '4e4ce19e-b205-4f1f-a122-b39a4099b420'::uuid AS requester_id,
       '0b657f86-9bec-4937-9259-75f2557777d5'::uuid AS spv_id,
       'a80b3879-eb8b-48fd-98df-07cdc66cccac'::uuid AS manufaktur_id
FROM public.approval_templates t WHERE t.name = 'DEMO - Working Order Approval';

INSERT INTO public.working_orders
  (wo_kode, mr_id, gudang_cabang_id, departemen, wo_tanggal, wo_pic_id, approval_template_id, approvals, wo_status, on_process_at, closed_at, closed_by)
SELECT 'DEMO-WO-001', m.id, 1, 'HO', CURRENT_DATE - 5, r.requester_id, r.template_id,
  jsonb_build_array(
    jsonb_build_object('userid', r.spv_id, 'nama', 'SPV Demo', 'status', 'approved', 'step_order', 1, 'signature_url', 'demo-signature'),
    jsonb_build_object('userid', r.manufaktur_id, 'nama', 'Manufaktur Demo', 'status', 'approved', 'step_order', 2, 'signature_url', 'demo-signature')
  ), 'Closed', CURRENT_DATE - 5, CURRENT_DATE - 2, r.requester_id
FROM public.mrs m CROSS JOIN demo_wo_refs r WHERE m.mr_kode = 'DEMO-MR-001';

INSERT INTO public.working_orders
  (wo_kode, mr_id, gudang_cabang_id, departemen, wo_tanggal, wo_pic_id, approval_template_id, approvals, wo_status, on_process_at)
SELECT 'DEMO-WO-002', m.id, 1, 'HO', CURRENT_DATE - 2, r.requester_id, r.template_id,
  jsonb_build_array(
    jsonb_build_object('userid', r.spv_id, 'nama', 'SPV Demo', 'status', 'approved', 'step_order', 1, 'signature_url', 'demo-signature'),
    jsonb_build_object('userid', r.manufaktur_id, 'nama', 'Manufaktur Demo', 'status', 'pending', 'step_order', 2)
  ), 'On Process', CURRENT_DATE - 1
FROM public.mrs m CROSS JOIN demo_wo_refs r WHERE m.mr_kode = 'DEMO-MR-002';

INSERT INTO public.working_orders
  (wo_kode, mr_id, gudang_cabang_id, departemen, wo_tanggal, wo_pic_id, approval_template_id, approvals, wo_status)
SELECT 'DEMO-WO-003', m.id, 1, 'BPP', CURRENT_DATE, r.requester_id, r.template_id,
  jsonb_build_array(
    jsonb_build_object('userid', r.spv_id, 'nama', 'SPV Demo', 'status', 'pending', 'step_order', 1),
    jsonb_build_object('userid', r.manufaktur_id, 'nama', 'Manufaktur Demo', 'status', 'pending', 'step_order', 2)
  ), 'Pending Approval'
FROM public.mrs m CROSS JOIN demo_wo_refs r WHERE m.mr_kode = 'DEMO-MR-003';

INSERT INTO public.working_order_items
  (wo_id, mr_item_id, part_id, part_number, part_name, satuan, qty, lead_time_days, deadline_date, applied_qty)
SELECT wo.id, mi.id, b.id, b.part_number, b.part_name, b.part_satuan, x.qty, x.lead_time, CURRENT_DATE + x.lead_time, x.applied_qty
FROM (VALUES
  ('DEMO-WO-001', 'DEMO-MR-001', 2, 5, 2),
  ('DEMO-WO-002', 'DEMO-MR-002', 1, 7, 1),
  ('DEMO-WO-003', 'DEMO-MR-003', 1, 10, 0)
) AS x(wo_kode, mr_kode, qty, lead_time, applied_qty)
JOIN public.working_orders wo ON wo.wo_kode = x.wo_kode
JOIN public.mrs m ON m.mr_kode = x.mr_kode
JOIN public.mr_items mi ON mi.mr_id = m.id
JOIN public.barang b ON b.id = mi.part_id;

INSERT INTO public.working_order_item_components
  (wo_item_id, component_part_id, component_part_number, component_part_name, component_satuan, qty_per_unit, qty_required, applied_qty_required)
SELECT woi.id, c.component_part_id, c.component_part_number, c.component_part_name, c.component_satuan,
       c.qty_per_unit, c.qty_per_unit * woi.qty, CASE WHEN wo.wo_status = 'Pending Approval' THEN 0 ELSE c.qty_per_unit * woi.qty END
FROM public.working_order_items woi
JOIN public.working_orders wo ON wo.id = woi.wo_id
JOIN public.wo_formula_components c ON c.formula_id = (SELECT id FROM public.wo_formulas WHERE target_part_id = woi.part_id);

UPDATE public.mr_items mi
SET qty_wo = 2
FROM public.mrs m
WHERE mi.mr_id = m.id AND m.mr_kode = 'DEMO-MR-001';

INSERT INTO public.stock_movements (part_id, cabang_id, qty_change, type, reference_id, created_by, notes)
VALUES
  (1, 1, -4, 'WO_KOMPONEN', 'DEMO-WO-001', '4e4ce19e-b205-4f1f-a122-b39a4099b420', 'Demo material release'),
  (3, 1, -2, 'WO_KOMPONEN', 'DEMO-WO-001', '4e4ce19e-b205-4f1f-a122-b39a4099b420', 'Demo material release'),
  (5, 1, 2, 'WO_PRODUKSI', 'DEMO-WO-001', '4e4ce19e-b205-4f1f-a122-b39a4099b420', 'Demo hasil produksi');

DROP TABLE demo_wo_template;
DROP TABLE demo_wo_refs;
COMMIT;