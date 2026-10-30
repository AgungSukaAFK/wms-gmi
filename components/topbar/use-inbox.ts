"use client";

// Inbox top bar = quick access yg menggabungkan sumber notif:
//  - Notifikasi umum (NotificationProvider, 20 terbaru).
//  - Update Web: postingan terbaru (hooks/use-update-web-badge.ts).
// Item otomatis keluar dari Inbox setelah INBOX_MAX_AGE_DAYS hari, atau
// tergeser kalau jumlahnya melewati INBOX_MAX_ITEMS. Datanya sendiri tetap
// ada di halaman masing-masing (/notifications, /update-web).

import { useCallback, useMemo, useState } from "react";
import { useNotification } from "@/components/providers/NotificationProvider";
import { useUpdateWebBadge } from "@/hooks/use-update-web-badge";

export const INBOX_MAX_AGE_DAYS = 7;
export const INBOX_MAX_ITEMS = 20;
const MAX_AGE_MS = INBOX_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export type InboxSource = "notification" | "update";

export type InboxItem = {
  key: string;
  source: InboxSource;
  title: string;
  message: string;
  time: string;
  unread: boolean;
  href: string;
  // Tandai dibaca saat item dibuka.
  markRead: () => void;
};

export function useInbox(userId: string | null | undefined) {
  const { notifications, markAsRead } = useNotification();
  const { latestPost, isNew: updateIsNew, markSeen } = useUpdateWebBadge(userId);
  // Dihitung ulang tiap Inbox dibuka - cukup utk batas 7 hari.
  const [now, setNow] = useState(() => Date.now());

  const items = useMemo<InboxItem[]>(() => {
    if (!userId) return [];
    const all: InboxItem[] = [];

    for (const n of notifications) {
      all.push({
        key: `notif-${n.id}`,
        source: "notification",
        title: n.title,
        message: n.message ?? "",
        time: n.created_at,
        unread: !n.is_read,
        href: n.document_url || "/notifications",
        markRead: () => {
          if (!n.is_read) markAsRead(n.id);
        },
      });
    }

    if (latestPost) {
      all.push({
        key: `update-${latestPost.id}`,
        source: "update",
        title: `Update Web v${latestPost.version}`,
        message: latestPost.title,
        time: latestPost.created_at,
        unread: updateIsNew,
        href: "/update-web",
        markRead: () => {
          if (updateIsNew) markSeen();
        },
      });
    }

    return all
      .filter((i) => now - new Date(i.time).getTime() < MAX_AGE_MS)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, INBOX_MAX_ITEMS);
  }, [userId, notifications, latestPost, updateIsNew, now, markAsRead, markSeen]);

  const unreadCount = items.filter((i) => i.unread).length;

  const markAllRead = useCallback(() => {
    items.filter((i) => i.unread).forEach((i) => i.markRead());
  }, [items]);

  // Dipanggil saat popover dibuka: segarkan batas umur.
  const onOpen = useCallback(() => setNow(Date.now()), []);

  return { items, unreadCount, markAllRead, onOpen };
}
