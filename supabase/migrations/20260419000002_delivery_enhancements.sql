-- Migration: Delivery Enhancements
-- Date: 2026-04-19
-- Description:
--   1. Add shipment_type column (handcarry_internal | handcarry_eksternal | ekspedisi)
--   2. Add sender_name for handcarry_internal (free text carrier name)
--   3. Add eksternal_provider & eksternal_id for handcarry_eksternal (Gojek etc + order ID)
--   4. Add tracking_status for physical delivery progress (5 stages)
--
-- Stock movement behavior change:
--   - createDelivery now only subtracts from source (goods in transit)
--   - finalizeDelivery adds to destination when receiver admin signs
--   - Existing deliveries with signature_receiver_id are already finalized

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS shipment_type     TEXT NOT NULL DEFAULT 'ekspedisi',
    -- 'handcarry_internal' | 'handcarry_eksternal' | 'ekspedisi'
  ADD COLUMN IF NOT EXISTS sender_name       TEXT,
    -- handcarry_internal: free text name of the person delivering
  ADD COLUMN IF NOT EXISTS eksternal_provider TEXT,
    -- handcarry_eksternal: Gojek | Grab | Maxim | Lalamove
  ADD COLUMN IF NOT EXISTS eksternal_id      TEXT,
    -- handcarry_eksternal: order/booking ID
  ADD COLUMN IF NOT EXISTS tracking_status   TEXT NOT NULL DEFAULT 'created';
    -- 'created' | 'packing' | 'ready_pickup' | 'in_transit' | 'delivered'

-- Backfill existing rows: they are already 'ekspedisi' type and at various tracking stages.
-- Those with signature_receiver_id are 'delivered', others stay 'created'.
UPDATE public.deliveries
SET tracking_status = 'delivered'
WHERE signature_receiver_id IS NOT NULL AND tracking_status = 'created';

CREATE INDEX IF NOT EXISTS idx_deliveries_tracking_status ON public.deliveries(tracking_status);
CREATE INDEX IF NOT EXISTS idx_deliveries_shipment_type   ON public.deliveries(shipment_type);
