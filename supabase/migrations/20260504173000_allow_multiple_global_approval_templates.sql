-- Allow multiple global approval templates per document type
-- Previous migration enforced only one global template per type.
-- We drop that partial unique index so global templates can be duplicated.

DROP INDEX IF EXISTS public.unique_global_approval_template;
