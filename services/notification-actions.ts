"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ============================================================
// TYPES
// ============================================================

export type NotificationType =
  | "approval_needed"
  | "approved"
  | "rejected"
  | "document_completed"
  | "general";

export interface Notification {
  id: number;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  document_type: string | null;
  document_id: number | null;
  document_url: string | null;
  is_read: boolean;
  read_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PendingApproval {
  document_type: string;
  document_id: number;
  document_number: string;
  document_url: string;
  status_col: string;
  created_at: string;
  step_level: string | null;
}

// ============================================================
// CREATE NOTIFICATION (server-only helper, used by other actions)
// ============================================================

export async function createNotification(payload: {
  userId: string;
  type: NotificationType;
  title: string;
  message?: string;
  documentType?: string;
  documentId?: number;
  documentUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const adminClient = createAdminClient();
    const { error } = await adminClient.from("notifications").insert({
      user_id: payload.userId,
      type: payload.type,
      title: payload.title,
      message: payload.message ?? null,
      document_type: payload.documentType ?? null,
      document_id: payload.documentId ?? null,
      document_url: payload.documentUrl ?? null,
      metadata: payload.metadata ?? null,
      is_read: false,
    });

    if (error) {
      console.error("[createNotification] error:", error.message);
    }
  } catch (err) {
    console.error("[createNotification] unexpected error:", err);
  }
}

/**
 * Notify all pending approvers of a document when it is first submitted.
 * Pass the full approvals JSONB array from the document.
 */
export async function notifyApprovers(
  approvals: Array<{
    userid?: string;
    user_id?: string;
    status: string;
    nama?: string;
    level?: string;
  }>,
  documentType: string,
  documentId: number,
  documentNumber: string,
  documentUrl: string,
) {
  const adminClient = createAdminClient();

  const pending = approvals.filter((a) => a.status === "pending");

  if (pending.length === 0) return;

  const rows = pending
    .map((a) => ({
      user_id: a.user_id ?? a.userid,
      type: "approval_needed" as NotificationType,
      title: `Perlu persetujuan: ${documentType}`,
      message: `Dokumen ${documentNumber} memerlukan persetujuan Anda sebagai ${a.level === "menyetujui" ? "penyetuju" : "pengetahui"}.`,
      document_type: documentType,
      document_id: documentId,
      document_url: documentUrl,
      is_read: false,
      metadata: { document_number: documentNumber, level: a.level },
    }))
    .filter((r) => !!r.user_id);

  if (rows.length === 0) return;

  const { error } = await adminClient.from("notifications").insert(rows);
  if (error) {
    console.error("[notifyApprovers] error:", error.message);
  }
}

/**
 * Notify the document creator when their document gets approved/rejected/completed.
 */
export async function notifyDocumentOwner(
  ownerId: string,
  eventType: "approved" | "rejected" | "document_completed",
  documentType: string,
  documentId: number,
  documentNumber: string,
  documentUrl: string,
  actorName?: string,
  rejectionReason?: string,
) {
  const titleMap = {
    approved: `Dokumen disetujui: ${documentType}`,
    rejected: `Dokumen ditolak: ${documentType}`,
    document_completed: `Dokumen selesai: ${documentType}`,
  };

  const messageMap = {
    approved: `${documentNumber} telah disetujui${actorName ? ` oleh ${actorName}` : ""}.`,
    rejected: `${documentNumber} ditolak${actorName ? ` oleh ${actorName}` : ""}${rejectionReason ? `: ${rejectionReason}` : ""}.`,
    document_completed: `${documentNumber} telah melewati semua tahap persetujuan.`,
  };

  await createNotification({
    userId: ownerId,
    type: eventType,
    title: titleMap[eventType],
    message: messageMap[eventType],
    documentType,
    documentId,
    documentUrl,
    metadata: { document_number: documentNumber, actor: actorName },
  });
}

// ============================================================
// GET NOTIFICATIONS (paginated)
// ============================================================

export async function getNotifications({
  page = 1,
  limit = 20,
  isRead,
}: {
  page?: number;
  limit?: number;
  isRead?: boolean;
} = {}) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthenticated" };

    let query = supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (isRead !== undefined) {
      query = query.eq("is_read", isRead);
    }

    const { data, error, count } = await query;

    if (error) return { error: error.message };

    return {
      success: true,
      data: (data ?? []) as Notification[],
      count: count ?? 0,
      page,
      limit,
    };
  } catch (err) {
    return { error: "Unexpected error fetching notifications" };
  }
}

// ============================================================
// GET PENDING APPROVALS (real-time, queries all document tables)
// ============================================================

export async function getPendingApprovals() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthenticated" };

    const { data, error } = await supabase.rpc(
      "get_pending_approvals_for_user",
      { user_uuid: user.id },
    );

    if (error) return { error: error.message };

    return { success: true, data: (data ?? []) as PendingApproval[] };
  } catch (err) {
    return { error: "Unexpected error fetching pending approvals" };
  }
}

// ============================================================
// GET UNREAD COUNT (for sidebar badge)
// ============================================================

export async function getUnreadNotificationsCount() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { count: 0 };

    const { data, error } = await supabase.rpc(
      "get_unread_notifications_count",
      { user_uuid: user.id },
    );

    if (error) return { count: 0 };

    return { count: (data as number) ?? 0 };
  } catch {
    return { count: 0 };
  }
}

// ============================================================
// MARK AS READ / UNREAD
// ============================================================

export async function markNotificationRead(id: number, isRead: boolean) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthenticated" };

    const { error } = await supabase
      .from("notifications")
      .update({
        is_read: isRead,
        read_at: isRead ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) return { error: error.message };

    revalidatePath("/notifications");
    return { success: true };
  } catch {
    return { error: "Unexpected error" };
  }
}

export async function markAllNotificationsRead() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthenticated" };

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("is_read", false);

    if (error) return { error: error.message };

    revalidatePath("/notifications");
    return { success: true };
  } catch {
    return { error: "Unexpected error" };
  }
}
