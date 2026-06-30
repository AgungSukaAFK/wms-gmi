"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { createNotification } from "./notification-actions";
import { businessToday } from "@/lib/business-date";

// ============================================================
// FREEZE MR — terkait fitur Planning Supply / Deadline Share Stock
//
// MR ter-freeze (lazy, dicek saat server action terkait dipanggil) bila ada
// alokasi share stock yang sudah lewat deadline DAN belum ada delivery sama
// sekali untuk item tsb (delivery 'cancelled' tidak dihitung). Freeze berlaku
// untuk SELURUH MR beserta alurnya. Hanya moderator yang dapat unfreeze/reset.
// ============================================================

async function fetchRoleNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (data || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

async function notifyModerators(payload: {
  title: string;
  message: string;
  documentId: number;
  documentUrl: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_roles")
    .select("user_id, roles!inner(name)")
    .eq("roles.name", "moderator");
  const ids = Array.from(
    new Set((data || []).map((r: any) => r.user_id).filter(Boolean)),
  );
  for (const id of ids) {
    await createNotification({
      userId: id as string,
      type: "general",
      title: payload.title,
      message: payload.message,
      documentType: "MR",
      documentId: payload.documentId,
      documentUrl: payload.documentUrl,
    });
  }
}

/**
 * Evaluasi & set status freeze MR (lazy). Tidak pernah auto-unfreeze —
 * hanya moderator yang bisa membuka. Mengembalikan status frozen terkini.
 */
export async function evaluateMrFreeze(mrId: number): Promise<boolean> {
  if (!mrId) return false;
  const supabase = await createClient();

  const { data: mr } = await supabase
    .from("mrs")
    .select("id, is_frozen")
    .eq("id", mrId)
    .maybeSingle();
  if (!mr) return false;
  if (mr.is_frozen) return true;

  const today = businessToday();

  // Alokasi share stock MR ini yang deadline-nya sudah lewat.
  const { data: allocs } = await supabase
    .from("mr_sharestock_allocations")
    .select("mr_item_id, deadline, mr_items!inner(mr_id)")
    .eq("mr_items.mr_id", mrId)
    .not("deadline", "is", null)
    .lt("deadline", today);

  const overdueItemIds = Array.from(
    new Set((allocs || []).map((a: any) => a.mr_item_id)),
  );
  if (overdueItemIds.length === 0) return false;

  // Item yang sudah punya delivery (selain yang dibatalkan) tidak memicu freeze.
  const { data: delivered } = await supabase
    .from("delivery_items")
    .select("mr_item_id, deliveries!inner(status)")
    .in("mr_item_id", overdueItemIds)
    .neq("deliveries.status", "cancelled");
  const deliveredSet = new Set(
    (delivered || []).map((d: any) => d.mr_item_id),
  );

  const pendingOverdue = overdueItemIds.filter((id) => !deliveredSet.has(id));
  if (pendingOverdue.length === 0) return false;

  const reason = `Freeze otomatis: ${pendingOverdue.length} item share stock melewati deadline tanpa delivery dibuat.`;
  await supabase
    .from("mrs")
    .update({
      is_frozen: true,
      frozen_at: new Date().toISOString(),
      frozen_reason: reason,
    })
    .eq("id", mrId);

  revalidatePath("/mr");
  revalidatePath(`/mr/${mrId}`);
  return true;
}

/**
 * Pembuat MR melaporkan kendala atas MR yang ter-freeze. Laporan masuk ke
 * moderator (notifikasi). Tidak bisa melakukan apa-apa selain melapor.
 */
export async function reportFrozenMr(mrId: number, kendala: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const trimmed = kendala?.trim();
  if (!trimmed) return { error: "Keterangan kendala wajib diisi." };

  const { data: mr } = await supabase
    .from("mrs")
    .select("id, mr_kode, is_frozen, mr_pic_id")
    .eq("id", mrId)
    .single();
  if (!mr) return { error: "MR tidak ditemukan" };
  if (!mr.is_frozen) return { error: "MR ini tidak dalam status freeze." };
  if (mr.mr_pic_id !== user.id) {
    return { error: "Hanya pembuat MR yang dapat melaporkan kendala." };
  }

  const { data: existing } = await supabase
    .from("mr_freeze_reports")
    .select("id")
    .eq("mr_id", mrId)
    .eq("status", "open")
    .maybeSingle();
  if (existing) {
    return {
      error: "Sudah ada laporan kendala yang menunggu tindakan moderator.",
    };
  }

  const { error } = await supabase.from("mr_freeze_reports").insert({
    mr_id: mrId,
    reporter_id: user.id,
    kendala: trimmed,
    status: "open",
  });
  if (error) return { error: error.message };

  await notifyModerators({
    title: `Laporan MR Freeze: ${mr.mr_kode}`,
    message: `MR ${mr.mr_kode} ter-freeze. Kendala: ${trimmed}`,
    documentId: mrId,
    documentUrl: `/mr/${mrId}`,
  });

  revalidatePath("/mr");
  revalidatePath(`/mr/${mrId}`);
  return { success: true };
}

/**
 * Moderator membuka freeze MR.
 *   - action 'unfreeze' : lanjut dari posisi terakhir.
 *   - action 'reset'    : set deadline baru per item lalu unfreeze.
 */
export async function resolveFrozenMr(params: {
  mrId: number;
  action: "unfreeze" | "reset";
  resolution?: string;
  deadlines?: { mr_item_id: number; deadline: string }[];
}) {
  const { mrId, action, resolution, deadlines } = params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const roleNames = await fetchRoleNames(supabase, user.id);
  if (!roleNames.includes("moderator")) {
    return { error: "Hanya moderator yang dapat membuka freeze MR." };
  }

  const { data: mr } = await supabase
    .from("mrs")
    .select("id, mr_kode, is_frozen, mr_pic_id")
    .eq("id", mrId)
    .single();
  if (!mr) return { error: "MR tidak ditemukan" };
  if (!mr.is_frozen) return { error: "MR ini tidak dalam status freeze." };

  if (action === "reset") {
    const today = businessToday();
    for (const d of deadlines || []) {
      if (!d.deadline || d.deadline < today) {
        return {
          error: "Deadline baru harus diisi dan tidak boleh tanggal lampau.",
        };
      }
      const { error: dErr } = await supabase
        .from("mr_sharestock_allocations")
        .update({ deadline: d.deadline })
        .eq("mr_item_id", d.mr_item_id);
      if (dErr) return { error: dErr.message };
    }
  }

  const { error: unfreezeError } = await supabase
    .from("mrs")
    .update({ is_frozen: false, frozen_at: null, frozen_reason: null })
    .eq("id", mrId);
  if (unfreezeError) return { error: unfreezeError.message };

  await supabase
    .from("mr_freeze_reports")
    .update({
      status: "resolved",
      resolution_action: action,
      resolution: resolution?.trim() || null,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("mr_id", mrId)
    .eq("status", "open");

  if (mr.mr_pic_id) {
    await createNotification({
      userId: mr.mr_pic_id,
      type: "general",
      title: `MR ${mr.mr_kode} di-${action === "reset" ? "reset" : "unfreeze"}`,
      message:
        action === "reset"
          ? `Moderator mereset deadline MR ${mr.mr_kode}. Alur dapat dilanjutkan.`
          : `Moderator membuka freeze MR ${mr.mr_kode}. Alur dapat dilanjutkan.`,
      documentType: "MR",
      documentId: mrId,
      documentUrl: `/mr/${mrId}`,
    });
  }

  revalidatePath("/mr");
  revalidatePath(`/mr/${mrId}`);
  return { success: true };
}

/**
 * Info freeze untuk UI MR detail: status freeze, daftar laporan, dan alokasi
 * (untuk form reset deadline). Sekaligus mengevaluasi freeze (lazy).
 */
export async function getMrFreezeInfo(mrId: number) {
  await evaluateMrFreeze(mrId);
  const supabase = await createClient();

  const { data: mr } = await supabase
    .from("mrs")
    .select("id, mr_kode, is_frozen, frozen_at, frozen_reason, mr_pic_id")
    .eq("id", mrId)
    .single();

  const { data: reports } = await supabase
    .from("mr_freeze_reports")
    .select("*, reporter:profiles!reporter_id(nama)")
    .eq("mr_id", mrId)
    .order("created_at", { ascending: false });

  const { data: allocItems } = await supabase
    .from("mr_sharestock_allocations")
    .select("mr_item_id, deadline, mr_items!inner(part_number, part_name, mr_id)")
    .eq("mr_items.mr_id", mrId);

  // Ringkas per item (deadline sama untuk semua sumber dalam 1 item).
  const itemMap = new Map<number, any>();
  for (const a of allocItems || []) {
    if (!itemMap.has(a.mr_item_id)) {
      itemMap.set(a.mr_item_id, {
        mr_item_id: a.mr_item_id,
        deadline: a.deadline,
        part_number: (a as any).mr_items?.part_number,
        part_name: (a as any).mr_items?.part_name,
      });
    }
  }

  return {
    mr,
    reports: reports || [],
    items: Array.from(itemMap.values()),
  };
}
