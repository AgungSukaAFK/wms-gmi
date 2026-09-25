-- Notifications: add actor_id, add safe RPC-only insert path, enable realtime
-- Context: unify notification inserts behind a SECURITY DEFINER RPC (actor forced
-- from auth.uid(), never from client input) and enable Postgres realtime so the
-- in-app notification bell/toast/sound can update live without a page reload.

-- ============================================================
-- actor_id column (nullable + additive: old rows and any code path that still
-- inserts without an actor keep working untouched)
-- ============================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_actor_id
  ON public.notifications(actor_id);

-- ============================================================
-- create_notifications RPC
-- SECURITY DEFINER: bypasses RLS (there is no INSERT policy for `authenticated`,
-- so this becomes the only way a client role can insert into notifications).
-- actor_id is always forced from auth.uid(), never trusted from the payload.
-- Rows targeting the caller themselves are skipped (no self-notifications).
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_notifications(p_notifications jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_notifications IS NULL OR jsonb_typeof(p_notifications) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notifications
    (user_id, actor_id, type, title, message, document_type, document_id, document_url, metadata, is_read)
  SELECT
    (elem->>'user_id')::uuid,
    v_actor,
    elem->>'type',
    elem->>'title',
    NULLIF(elem->>'message', ''),
    elem->>'document_type',
    NULLIF(elem->>'document_id', '')::bigint,
    elem->>'document_url',
    (elem->'metadata'),
    false
  FROM jsonb_array_elements(p_notifications) AS elem
  WHERE coalesce(elem->>'user_id', '') <> ''
    AND (elem->>'user_id')::uuid <> v_actor;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notifications(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notifications(jsonb) TO authenticated;

-- ============================================================
-- Enable realtime on notifications (idempotent: ALTER PUBLICATION ... ADD TABLE
-- has no native IF NOT EXISTS, so guard it manually)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
