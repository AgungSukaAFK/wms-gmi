-- Update Web: balas komentar + notifikasi ke pemilik komentar yang dibalas.
--
-- add_update_web_post_comment dapat parameter baru p_reply_to JSONB
-- ({user_id, timestamp} komentar yang dibalas). Snapshot reply_to
-- (user_name + excerpt) dibangun di SERVER dari komentar asli di post yang
-- sama, jadi client tidak bisa memalsukan nama/kutipan. Notifikasi ke pemilik
-- komentar asli juga dibuat di sini (atomic dengan komentarnya), kecuali
-- membalas diri sendiri.
--
-- BACKWARD-COMPAT: p_reply_to DEFAULT NULL, jadi build production lama yang
-- masih memanggil (p_id, p_message) tetap resolve ke fungsi ini. Fungsi lama
-- 2-argumen di-DROP dulu supaya tidak ada overload ambigu di PostgREST.
-- Komentar lama tanpa reply_to tetap valid.

DROP FUNCTION IF EXISTS public.add_update_web_post_comment(BIGINT, TEXT);

CREATE OR REPLACE FUNCTION public.add_update_web_post_comment(
  p_id BIGINT,
  p_message TEXT,
  p_reply_to JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_name TEXT;
  v_message TEXT := trim(COALESCE(p_message, ''));
  v_post public.update_web_posts%ROWTYPE;
  v_target JSONB;
  v_reply_to JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Session expired.';
  END IF;
  IF v_message = '' THEN
    RAISE EXCEPTION 'Komentar tidak boleh kosong.';
  END IF;
  IF length(v_message) > 2000 THEN
    RAISE EXCEPTION 'Komentar maksimal 2000 karakter.';
  END IF;

  -- Kunci baris post: komentar append ke jsonb, dan lookup komentar yang
  -- dibalas harus melihat array yang sama dengan yang di-update.
  SELECT * INTO v_post
  FROM public.update_web_posts
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Postingan Update Web tidak ditemukan.';
  END IF;

  SELECT COALESCE(nama, email, 'Unknown User') INTO v_name
  FROM public.profiles WHERE id = v_uid;

  IF p_reply_to IS NOT NULL AND jsonb_typeof(p_reply_to) = 'object' THEN
    -- Timestamp dibandingkan sebagai waktu (dipotong ke milidetik), bukan
    -- string: NOW() tersimpan mikrodetik, sedangkan Date di JS cuma milidetik.
    SELECT c INTO v_target
    FROM jsonb_array_elements(COALESCE(v_post.comments, '[]'::jsonb)) AS c
    WHERE c->>'user_id' = p_reply_to->>'user_id'
      AND date_trunc('milliseconds', (c->>'timestamp')::timestamptz)
        = date_trunc('milliseconds', (p_reply_to->>'timestamp')::timestamptz)
    LIMIT 1;

    IF v_target IS NULL THEN
      RAISE EXCEPTION 'Komentar yang dibalas tidak ditemukan.';
    END IF;

    v_reply_to := jsonb_build_object(
      'user_id', v_target->>'user_id',
      'user_name', COALESCE(v_target->>'user_name', 'Unknown User'),
      'timestamp', v_target->>'timestamp',
      'excerpt', left(regexp_replace(COALESCE(v_target->>'message', ''), '\s+', ' ', 'g'), 120)
    );
  END IF;

  UPDATE public.update_web_posts
  SET comments = COALESCE(comments, '[]'::jsonb) || jsonb_build_array(
    jsonb_strip_nulls(jsonb_build_object('reply_to', v_reply_to)) ||
    jsonb_build_object(
      'user_id', v_uid,
      'user_name', v_name,
      'message', v_message,
      'timestamp', NOW()
    )
  )
  WHERE id = p_id;

  -- Notifikasi balasan (bukan ke diri sendiri). Insert langsung karena fungsi
  -- ini SECURITY DEFINER; actor_id = pembalas, sama seperti create_notifications.
  -- Cek auth.users: akun pemilik komentar yang sudah dihapus tidak boleh
  -- bikin komentar balasannya gagal karena FK notifications.user_id.
  IF v_reply_to IS NOT NULL
     AND (v_reply_to->>'user_id')::uuid <> v_uid
     AND EXISTS (SELECT 1 FROM auth.users WHERE id = (v_reply_to->>'user_id')::uuid) THEN
    INSERT INTO public.notifications
      (user_id, actor_id, type, title, message, document_type, document_id, document_url, metadata, is_read)
    VALUES (
      (v_reply_to->>'user_id')::uuid,
      v_uid,
      'general',
      'Balasan komentar di Update Web',
      v_name || ' membalas komentar Anda di v' || v_post.version || ': "' ||
        left(regexp_replace(v_message, '\s+', ' ', 'g'), 120) || '"',
      'update_web',
      p_id,
      '/update-web?post=' || p_id,
      jsonb_build_object('post_title', v_post.title, 'post_version', v_post.version),
      false
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_update_web_post_comment(BIGINT, TEXT, JSONB) TO authenticated;
