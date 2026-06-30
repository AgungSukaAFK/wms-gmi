UPDATE delivery_items di
SET qty_delivered = 0, qty_pending = qty_on_delivery
FROM deliveries d
WHERE di.dlv_id = d.id
  AND d.status <> 'completed'        -- jangan sentuh yang udah benar2 diterima
  AND di.qty_delivered > 0;
