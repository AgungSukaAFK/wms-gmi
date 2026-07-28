-- Same class of bug as 20260728120000_fix_missing_table_grants.sql, but for
-- VIEWS: these were created after 20260407230007_grant_schema_usage_to_anon.sql
-- (which only granted access to objects existing at that time) and never
-- received their own GRANT. Result: "permission denied for view X" for any
-- authenticated user, e.g. opening /stock (v_stock_summary).

GRANT SELECT ON TABLE
    public.v_stock_summary,
    public.v_stock_with_status,
    public.v_spb_report,
    public.v_user_permissions
TO anon, authenticated, authenticator;
