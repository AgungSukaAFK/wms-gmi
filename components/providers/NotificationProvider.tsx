"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import type { Notification } from "@/services/notification-actions";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/services/notification-actions";
import { playSound, unlockAudio } from "@/lib/notifications/sound";
import { useNotifSettings } from "@/hooks/use-notif-settings";

type NotificationContextType = {
  unreadCount: number;
  notifications: Notification[];
  refreshNotifications: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined,
);

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const supabase = createClient();
  const router = useRouter();
  const { settings } = useNotifSettings();
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Unlock AudioContext dari user gesture pertama - browser blokir resume()
  // sebelum ada interaksi user sama sekali.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const fetchNotifications = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) {
      const rows = data as Notification[];
      setNotifications(rows);
      setUnreadCount(rows.filter((n) => !n.is_read).length);
    }
  };

  useEffect(() => {
    fetchNotifications();

    let isMounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupRealtime = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user || !isMounted) return;

      // WAJIB - tanpa ini socket realtime connect sebagai anon, RLS blokir semua event
      await supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`notifications:${session.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${session.user.id}`,
          },
          (payload: RealtimePostgresInsertPayload<Notification>) => {
            const newNotif = payload.new;

            setNotifications((prev) => [newNotif, ...prev]);
            setUnreadCount((prev) => prev + 1);

            const current = settingsRef.current;
            if (!current.enabled) return;

            if (current.sound) {
              try {
                playSound(current.soundType, current.volume);
              } catch (err) {
                console.error("[NotificationProvider] playSound error:", err);
              }
            }

            if (
              current.browser &&
              typeof window !== "undefined" &&
              "Notification" in window &&
              window.Notification.permission === "granted"
            ) {
              try {
                new window.Notification(newNotif.title, {
                  body: newNotif.message ?? undefined,
                });
              } catch (err) {
                console.error(
                  "[NotificationProvider] browser notification error:",
                  err,
                );
              }
            }

            toast.info(newNotif.title, {
              description: newNotif.message ?? undefined,
              action: newNotif.document_url
                ? {
                    label: "Lihat",
                    onClick: () => router.push(newNotif.document_url as string),
                  }
                : undefined,
            });
          },
        )
        .subscribe();
    };

    setupRealtime();

    // Access token expire tiap jam - tanpa re-set, realtime diam-diam berhenti
    // menerima event RLS-protected setelah token lama basi.
    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "TOKEN_REFRESHED" && session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      if (event === "SIGNED_OUT" && channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    });

    return () => {
      isMounted = false;
      authSubscription.unsubscribe();
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [router]);

  const markAsRead = async (id: number) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, is_read: true, read_at: new Date().toISOString() }
          : n,
      ),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    await markNotificationRead(id, true);
  };

  const markAllRead = async () => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() })),
    );
    setUnreadCount(0);

    await markAllNotificationsRead();
  };

  return (
    <NotificationContext.Provider
      value={{
        unreadCount,
        notifications,
        refreshNotifications: fetchNotifications,
        markAsRead,
        markAllRead,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error(
      "useNotification must be used within a NotificationProvider",
    );
  }
  return context;
};
