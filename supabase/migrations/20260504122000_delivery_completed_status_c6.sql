-- Chapter C6: Introduce completed as final doc status and sync delivery finalization

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'completed'
      AND enumtypid = 'doc_status'::regtype
  ) THEN
    ALTER TYPE public.doc_status ADD VALUE 'completed';
  END IF;
END
$$;
