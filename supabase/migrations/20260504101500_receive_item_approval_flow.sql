-- Chapter C4: Receive Item approval flow (template-required, step approval, completed final state)

-- Extend approval template type support for Receive Item.
ALTER TABLE public.approval_templates
  DROP CONSTRAINT IF EXISTS valid_type;

ALTER TABLE public.approval_templates
  ADD CONSTRAINT valid_type
  CHECK (type IN (
    'Material Request',
    'Purchase Request',
    'Purchase Order',
    'Item Transfer',
    'Receive Item'
  ));

-- Add approval metadata + status state to receives.
ALTER TABLE public.receives
  ADD COLUMN IF NOT EXISTS approval_template_id BIGINT REFERENCES public.approval_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ri_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.receives
  DROP CONSTRAINT IF EXISTS receives_ri_status_check;

ALTER TABLE public.receives
  ADD CONSTRAINT receives_ri_status_check
  CHECK (ri_status IN ('open', 'rejected', 'completed'));

CREATE INDEX IF NOT EXISTS idx_receives_approval_template_id
  ON public.receives(approval_template_id);

CREATE INDEX IF NOT EXISTS idx_receives_ri_status
  ON public.receives(ri_status);

-- Existing receive rows were historically posted immediately; mark as completed for compatibility.
UPDATE public.receives
SET ri_status = 'completed',
    completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE COALESCE(ri_status, 'open') = 'open'
  AND (approvals IS NULL OR approvals = '[]'::jsonb);
