// "Ada post Update Web baru yang belum dilihat?" - dipakai titik merah di
// sidebar & banner dashboard. Baru = post terbaru dibuat < 7 hari lalu DAN
// id-nya > last_seen_post_id user (tabel update_web_seen, per akun).
//
// markSeen() juga broadcast event window supaya instance hook lain (mis.
// sidebar, yang tidak remount saat pindah halaman) ikut padam seketika.

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchLatestUpdateWebPost,
  fetchUpdateWebSeenState,
  markUpdateWebSeen,
} from "@/services/update-web-client";
import { UpdateWebPost } from "@/type/update-web";

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SEEN_EVENT = "update-web:seen";

export function useUpdateWebBadge(userId: string | null | undefined) {
  const [latestPost, setLatestPost] = useState<UpdateWebPost | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const [post, lastSeenId] = await Promise.all([
          fetchLatestUpdateWebPost(),
          fetchUpdateWebSeenState(userId),
        ]);
        if (cancelled) return;
        setLatestPost(post);
        setIsNew(
          !!post &&
            Date.now() - new Date(post.created_at).getTime() < NEW_WINDOW_MS &&
            (lastSeenId === null || lastSeenId < post.id),
        );
      } catch {
        // Best-effort: badge bukan fitur kritikal.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const onSeen = () => setIsNew(false);
    window.addEventListener(SEEN_EVENT, onSeen);
    return () => {
      cancelled = true;
      window.removeEventListener(SEEN_EVENT, onSeen);
    };
  }, [userId]);

  const markSeen = useCallback(async () => {
    if (!userId || !latestPost) return;
    setIsNew(false);
    window.dispatchEvent(new Event(SEEN_EVENT));
    try {
      await markUpdateWebSeen(userId, latestPost.id);
    } catch {
      // Best-effort, akan tersinkron di kunjungan berikutnya.
    }
  }, [userId, latestPost]);

  return { latestPost, isNew, loading, markSeen };
}
