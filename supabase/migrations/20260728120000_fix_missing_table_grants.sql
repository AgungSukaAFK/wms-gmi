-- Fix: several tables created after 20260407230007_grant_schema_usage_to_anon.sql
-- never received the base table GRANT (GRANT is not retroactive to tables created
-- later, unlike a schema-level ALTER DEFAULT PRIVILEGES). Each of these already has
-- an RLS policy written for `authenticated` (or `auth.uid() = user_id`), so the
-- policies were designed for normal client access -- the base GRANT was simply
-- forgotten in the migration that created the table. Without it, PostgREST/Supabase
-- rejects every query with "permission denied for table X" regardless of RLS.
--
-- Excluded on purpose:
--   - stock_minmax_import_staging: intentionally service_role-only
--     (see 20260608130000_secure_minmax_staging.sql).
--   - stock_import_staging: not referenced anywhere in the app code yet
--     (no server action/RPC call uses it), left untouched.

GRANT ALL ON TABLE
    public.spb,
    public.spb_details,
    public.spb_po,
    public.spb_po_details,
    public.spb_do,
    public.spb_do_details,
    public.spb_invoice,
    public.spb_invoice_details,
    public.return_spb,
    public.return_spb_details,
    public.do_reguler,
    public.do_reguler_items,
    public.item_transfers,
    public.item_transfer_items,
    public.job_costing_items,
    public.mr_freeze_reports,
    public.mr_sharestock_allocations,
    public.planning_supplies,
    public.stock_setting_requests,
    public.stock_movements,
    public.notifications,
    public.user_signatures,
    public.approval_templates,
    public.approval_template_steps
TO anon, authenticated, authenticator;
