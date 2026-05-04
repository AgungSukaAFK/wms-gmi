"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Bell,
  BellOff,
  CheckCheck,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Content } from "@/components/content";
import {
  getNotifications,
  getPendingApprovals,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
  type PendingApproval,
} from "@/services/notification-actions";

// ============================================================
// Helpers
// ============================================================

const notifTypeColor: Record<string, string> = {
  approval_needed:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  approved:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  document_completed:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  general: "bg-muted text-muted-foreground",
};

const notifTypeLabel: Record<string, string> = {
  approval_needed: "Perlu Tindakan",
  approved: "Disetujui",
  rejected: "Ditolak",
  document_completed: "Selesai",
  general: "Info",
};

function formatRelativeTime(dateStr: string) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return "Baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  if (diffHour < 24) return `${diffHour} jam lalu`;
  if (diffDay === 1) return "Kemarin";
  if (diffDay < 7) return `${diffDay} hari lalu`;
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: diffDay > 365 ? "numeric" : undefined,
  });
}

const levelLabel: Record<string, string> = {
  menyetujui: "Menyetujui",
  mengetahui: "Mengetahui",
};

// ============================================================
// Sub-components
// ============================================================

function NotificationItem({
  notif,
  onMarkRead,
}: {
  notif: Notification;
  onMarkRead: (id: number, isRead: boolean) => void;
}) {
  return (
    <div
      className={`flex gap-3 rounded-lg border p-4 transition-colors hover:bg-accent/40 ${
        !notif.is_read ? "bg-primary/5 border-primary/20" : "border-border"
      }`}
    >
      <div className="pt-1 shrink-0">
        {!notif.is_read ? (
          <Circle className="h-2 w-2 fill-primary text-primary" />
        ) : (
          <Circle className="h-2 w-2 text-transparent" />
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                notifTypeColor[notif.type] ?? notifTypeColor.general
              }`}
            >
              {notifTypeLabel[notif.type] ?? notif.type}
            </span>
            {notif.document_type && (
              <span className="text-[10px] font-bold text-muted-foreground uppercase">
                {notif.document_type}
              </span>
            )}
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap shrink-0">
            {formatRelativeTime(notif.created_at)}
          </span>
        </div>

        <p className="text-sm font-semibold text-foreground leading-tight">
          {notif.title}
        </p>
        {notif.message && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {notif.message}
          </p>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          {notif.document_url && (
            <Link href={notif.document_url}>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] font-bold uppercase gap-1.5"
              >
                <ExternalLink className="h-3 w-3" />
                Buka Dokumen
              </Button>
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] font-bold uppercase gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => onMarkRead(notif.id, !notif.is_read)}
          >
            {notif.is_read ? (
              <>
                <BellOff className="h-3 w-3" />
                Tandai Belum Dibaca
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3" />
                Tandai Dibaca
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PendingApprovalItem({ item }: { item: PendingApproval }) {
  return (
    <div className="flex gap-3 rounded-lg border border-yellow-200 bg-yellow-50/60 dark:border-yellow-900/40 dark:bg-yellow-900/10 p-4">
      <div className="pt-0.5 shrink-0 text-yellow-600 dark:text-yellow-400">
        <FileText className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-yellow-700 dark:text-yellow-400 uppercase">
              {item.document_type}
            </span>
            {item.step_level && (
              <Badge
                variant="outline"
                className="h-4 text-[9px] font-bold px-1.5 uppercase"
              >
                {levelLabel[item.step_level] ?? item.step_level}
              </Badge>
            )}
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap shrink-0">
            {formatRelativeTime(item.created_at)}
          </span>
        </div>

        <p className="text-sm font-bold text-foreground">
          {item.document_number}
        </p>
        <p className="text-[10px] font-bold text-muted-foreground uppercase">
          Status:{" "}
          <span className="font-bold text-foreground capitalize">
            {item.status_col}
          </span>
        </p>

        <div className="pt-0.5">
          <Link href={item.document_url}>
            <Button
              size="sm"
              className="h-7 text-[10px] font-bold uppercase gap-1.5"
            >
              <ExternalLink className="h-3 w-3" />
              Buka &amp; Proses
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState("pending");

  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifPage, setNotifPage] = useState(1);
  const [notifTotal, setNotifTotal] = useState(0);
  const [notifFilter, setNotifFilter] = useState<"all" | "unread">("all");
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const LIMIT = 20;

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    const result = await getPendingApprovals();
    if (result.success) setPending(result.data ?? []);
    setPendingLoading(false);
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotifLoading(true);
    const result = await getNotifications({
      page: notifPage,
      limit: LIMIT,
      isRead: notifFilter === "unread" ? false : undefined,
    });
    if (result.success) {
      setNotifications(result.data ?? []);
      setNotifTotal(result.count ?? 0);
    }
    setNotifLoading(false);
  }, [notifPage, notifFilter]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleMarkRead = async (id: number, isRead: boolean) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id
          ? {
              ...n,
              is_read: isRead,
              read_at: isRead ? new Date().toISOString() : null,
            }
          : n,
      ),
    );
    await markNotificationRead(id, isRead);
  };

  const handleMarkAllRead = async () => {
    setMarkingAllRead(true);
    await markAllNotificationsRead();
    await loadNotifications();
    setMarkingAllRead(false);
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const totalPages = Math.ceil(notifTotal / LIMIT);

  return (
    <>
      {/* Page Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                NOTIFIKASI
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Dokumen Pending &amp; Riwayat Aktivitas Akun
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase"
            onClick={() => {
              loadPending();
              loadNotifications();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            REFRESH
          </Button>
        </div>
      </Content>

      {/* Tabs */}
      <Content>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <TabsList className="h-9">
              <TabsTrigger
                value="pending"
                className="gap-1.5 text-xs font-bold uppercase"
              >
                <Clock className="h-3.5 w-3.5" />
                Perlu Tindakan
                {pending.length > 0 && (
                  <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {pending.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="gap-1.5 text-xs font-bold uppercase"
              >
                <Bell className="h-3.5 w-3.5" />
                Riwayat
                {unreadCount > 0 && (
                  <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-bold text-muted-foreground">
                    {unreadCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Context actions per tab */}
            {activeTab === "history" && (
              <div className="flex items-center gap-2">
                <div className="flex rounded-md border overflow-hidden">
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase transition-colors ${
                      notifFilter === "all"
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent text-muted-foreground"
                    }`}
                    onClick={() => {
                      setNotifFilter("all");
                      setNotifPage(1);
                    }}
                  >
                    Semua
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase border-l transition-colors ${
                      notifFilter === "unread"
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent text-muted-foreground"
                    }`}
                    onClick={() => {
                      setNotifFilter("unread");
                      setNotifPage(1);
                    }}
                  >
                    Belum Dibaca
                  </button>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-3 text-[10px] font-bold text-muted-foreground hover:text-foreground gap-1.5 uppercase"
                  onClick={handleMarkAllRead}
                  disabled={
                    markingAllRead || notifications.every((n) => n.is_read)
                  }
                >
                  {markingAllRead ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCheck className="h-3.5 w-3.5" />
                  )}
                  Tandai Semua Dibaca
                </Button>
              </div>
            )}

            {activeTab === "pending" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-3 text-[10px] font-bold text-muted-foreground hover:text-foreground gap-1.5 uppercase"
                onClick={loadPending}
                disabled={pendingLoading}
              >
                {pendingLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Perbarui
              </Button>
            )}
          </div>

          {/* ── Pending Tab ── */}
          <TabsContent value="pending" className="mt-0">
            {pendingLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-[10px] font-bold uppercase">
                  Memuat Data...
                </span>
              </div>
            ) : pending.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <CheckCheck className="h-12 w-12 opacity-20" />
                <div className="text-center">
                  <p className="text-sm font-bold text-foreground">
                    Tidak Ada Dokumen Pending
                  </p>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground mt-1">
                    Semua dokumen yang memerlukan persetujuan Anda sudah
                    diproses.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-3">
                  {pending.length} dokumen menunggu persetujuan Anda
                </p>
                {pending.map((item, i) => (
                  <PendingApprovalItem
                    key={`${item.document_type}-${item.document_id}-${i}`}
                    item={item}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── History Tab ── */}
          <TabsContent value="history" className="mt-0">
            {notifLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-[10px] font-bold uppercase">
                  Memuat Notifikasi...
                </span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <BellOff className="h-12 w-12 opacity-20" />
                <div className="text-center">
                  <p className="text-sm font-bold text-foreground">
                    {notifFilter === "unread"
                      ? "Tidak Ada Notifikasi Belum Dibaca"
                      : "Belum Ada Notifikasi"}
                  </p>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground mt-1">
                    Notifikasi akan muncul saat ada aktivitas terkait akun Anda.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-3">
                  {notifTotal} notifikasi
                  {notifFilter === "unread" ? " belum dibaca" : " total"}
                </p>
                <div className="space-y-2">
                  {notifications.map((notif) => (
                    <NotificationItem
                      key={notif.id}
                      notif={notif}
                      onMarkRead={handleMarkRead}
                    />
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Halaman {notifPage} dari {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 text-[10px] font-bold uppercase"
                        disabled={notifPage <= 1}
                        onClick={() => setNotifPage((p) => p - 1)}
                      >
                        Sebelumnya
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 text-[10px] font-bold uppercase"
                        disabled={notifPage >= totalPages}
                        onClick={() => setNotifPage((p) => p + 1)}
                      >
                        Berikutnya
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </Content>
    </>
  );
}
