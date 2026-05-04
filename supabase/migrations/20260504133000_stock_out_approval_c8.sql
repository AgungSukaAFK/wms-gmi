-- Chapter C8: Approval flow for all Stock Out documents

-- Extend supported approval template types.
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
    'Return SPB'
  ));

-- Add approval metadata to SPB.
ALTER TABLE public.spb
  ADD COLUMN IF NOT EXISTS approval_template_id BIGINT REFERENCES public.approval_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.spb
  DROP CONSTRAINT IF EXISTS spb_approval_status_check;

ALTER TABLE public.spb
  ADD CONSTRAINT spb_approval_status_check
  CHECK (approval_status IN ('open', 'rejected', 'completed'));

CREATE INDEX IF NOT EXISTS idx_spb_approval_template_id
  ON public.spb(approval_template_id);

CREATE INDEX IF NOT EXISTS idx_spb_approval_status
  ON public.spb(approval_status);

-- Add approval metadata to SPB PO.
ALTER TABLE public.spb_po
  ADD COLUMN IF NOT EXISTS approval_template_id BIGINT REFERENCES public.approval_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.spb_po
  DROP CONSTRAINT IF EXISTS spb_po_approval_status_check;

ALTER TABLE public.spb_po
  ADD CONSTRAINT spb_po_approval_status_check
  CHECK (approval_status IN ('open', 'rejected', 'completed'));

CREATE INDEX IF NOT EXISTS idx_spb_po_approval_template_id
  ON public.spb_po(approval_template_id);

CREATE INDEX IF NOT EXISTS idx_spb_po_approval_status
  ON public.spb_po(approval_status);

-- Add approval metadata to SPB DO.
ALTER TABLE public.spb_do
  ADD COLUMN IF NOT EXISTS approval_template_id BIGINT REFERENCES public.approval_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.spb_do
  DROP CONSTRAINT IF EXISTS spb_do_approval_status_check;

ALTER TABLE public.spb_do
  ADD CONSTRAINT spb_do_approval_status_check
  CHECK (approval_status IN ('open', 'rejected', 'completed'));

CREATE INDEX IF NOT EXISTS idx_spb_do_approval_template_id
  ON public.spb_do(approval_template_id);

CREATE INDEX IF NOT EXISTS idx_spb_do_approval_status
  ON public.spb_do(approval_status);

-- Add approval metadata to SPB Invoice.
ALTER TABLE public.spb_invoice
  ADD COLUMN IF NOT EXISTS approval_template_id BIGINT REFERENCES public.approval_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.spb_invoice
  DROP CONSTRAINT IF EXISTS spb_invoice_approval_status_check;

ALTER TABLE public.spb_invoice
  ADD CONSTRAINT spb_invoice_approval_status_check
  CHECK (approval_status IN ('open', 'rejected', 'completed'));

CREATE INDEX IF NOT EXISTS idx_spb_invoice_approval_template_id
  ON public.spb_invoice(approval_template_id);

CREATE INDEX IF NOT EXISTS idx_spb_invoice_approval_status
  ON public.spb_invoice(approval_status);

-- Add approval metadata to Return SPB.
ALTER TABLE public.return_spb
  ADD COLUMN IF NOT EXISTS approval_template_id BIGINT REFERENCES public.approval_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.return_spb
  DROP CONSTRAINT IF EXISTS return_spb_approval_status_check;

ALTER TABLE public.return_spb
  ADD CONSTRAINT return_spb_approval_status_check
  CHECK (approval_status IN ('open', 'rejected', 'completed'));

CREATE INDEX IF NOT EXISTS idx_return_spb_approval_template_id
  ON public.return_spb(approval_template_id);

CREATE INDEX IF NOT EXISTS idx_return_spb_approval_status
  ON public.return_spb(approval_status);

-- Existing stock out rows were historically posted immediately.
UPDATE public.spb
SET approval_status = 'completed',
    completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE COALESCE(approval_status, 'open') = 'open'
  AND (approvals IS NULL OR approvals = '[]'::jsonb);

UPDATE public.spb_po
SET approval_status = 'completed',
    completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE COALESCE(approval_status, 'open') = 'open'
  AND (approvals IS NULL OR approvals = '[]'::jsonb);

UPDATE public.spb_do
SET approval_status = 'completed',
    completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE COALESCE(approval_status, 'open') = 'open'
  AND (approvals IS NULL OR approvals = '[]'::jsonb);

UPDATE public.spb_invoice
SET approval_status = 'completed',
    completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE COALESCE(approval_status, 'open') = 'open'
  AND (approvals IS NULL OR approvals = '[]'::jsonb);

UPDATE public.return_spb
SET approval_status = 'completed',
    completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE COALESCE(approval_status, 'open') = 'open'
  AND (approvals IS NULL OR approvals = '[]'::jsonb);
