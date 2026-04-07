-- Enable RLS for all core tables
ALTER TABLE public.cabang ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barang ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mr_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receive_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.job_costing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spb ENABLE ROW LEVEL SECURITY;

-- Creating a generic policy allowing authenticated users access for now.
-- In Phase 2, this can be swapped with user_role assertions (e.g. auth.uid() in profiles role='admin').

CREATE POLICY "Allow authenticated users to read everything" 
ON public.profiles FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow users to update own profile" 
ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Fallback for operational data currently
DO $$ 
DECLARE
    tbl text;
BEGIN
    FOR tbl IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name != 'profiles'
    LOOP
        EXECUTE format('CREATE POLICY "Allow authenticated full access to %I" ON public.%I FOR ALL USING (auth.role() = ''authenticated'');', tbl, tbl);
    END LOOP;
END $$;
