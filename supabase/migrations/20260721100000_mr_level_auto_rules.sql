-- Konfigurasi dinamis untuk threshold auto-deteksi level progres MR
-- (bucket OPEN_1/OPEN_2/OPEN_3_5/CLOSE_1/CLOSE_2 di lib/mr-level.ts).
--
-- Sebelumnya threshold ini hardcoded di computeMrAutoBucket(). Moderator
-- sekarang bisa mengubahnya lewat halaman /mr-level-settings tanpa perlu
-- deploy kode baru. Singleton row (id selalu 1) karena hanya ada satu set
-- aturan aktif untuk seluruh sistem.

CREATE TABLE public.mr_level_auto_rules (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pending_convert_statuses TEXT[] NOT NULL DEFAULT ARRAY['pending'],
  close_start_min_received_pct NUMERIC(6, 2) NOT NULL DEFAULT 0,
  close_done_min_received_pct NUMERIC(6, 2) NOT NULL DEFAULT 100,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_close_pct_order CHECK (close_done_min_received_pct >= close_start_min_received_pct),
  CONSTRAINT chk_close_start_nonneg CHECK (close_start_min_received_pct >= 0)
);

INSERT INTO public.mr_level_auto_rules (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.mr_level_auto_rules IS
'Singleton row (id=1) menyimpan threshold auto-deteksi level progres MR yang bisa diubah moderator.';

ALTER TABLE public.mr_level_auto_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read mr_level_auto_rules"
  ON public.mr_level_auto_rules FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Moderators can update mr_level_auto_rules"
  ON public.mr_level_auto_rules FOR UPDATE
  USING (public.is_moderator()) WITH CHECK (public.is_moderator());

-- RLS policies alone are not enough — PostgREST also requires the base table
-- GRANT. Confirmed missing on other RBAC tables (roles/user_roles) in this
-- project's migration history, which only works in production because
-- someone patched it there directly outside of migrations. Granting
-- explicitly here so this table works on any freshly-provisioned instance.
GRANT SELECT ON public.mr_level_auto_rules TO authenticated;
GRANT UPDATE ON public.mr_level_auto_rules TO authenticated;
