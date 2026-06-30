"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { createNotification } from "./notification-actions";

// ============================================================
// REQUEST PENGATURAN STOK (min/max)
// Dipakai saat user tidak bisa menambah item di MR karena kebijakan stok
// belum di-set atau stok sudah mentok max. Notifikasi & daftar ditujukan ke
// pengelola stok: moderator, ppic, pjo.
// ============================================================

const STOCK_MANAGER_ROLES = ["moderator", "ppic", "pjo"];

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

async function notifyStockManagers(payload: {
  title: string;
  message: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_roles")
    .select("user_id, roles!inner(name)")
    .in("roles.name", STOCK_MANAGER_ROLES);
  const ids = Array.from(
    new Set((data || []).map((r: any) => r.user_id).filter(Boolean)),
  );
  for (const id of ids) {
    await createNotification({
      userId: id as string,
      type: "general",
      title: payload.title,
      message: payload.message,
      documentType: "STOCK_REQUEST",
      documentUrl: "/stock-requests",
    });
  }
}

/**
 * Kirim request agar atasan menetapkan kebijakan stok (min/max) untuk sebuah
 * PN di sebuah cabang. Hanya 1 request open per (part, cabang).
 */
export async function requestStockSetting(data: {
  part_id: number;
  part_number?: string;
  part_name?: string;
  cabang_id: number;
  reason: "no_policy" | "limit_reached";
  note?: string;
  current_qty?: number;
  max_qty?: number;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  if (!data.part_id || !data.cabang_id) {
    return { error: "Data part / cabang tidak lengkap." };
  }

  const { error } = await supabase.from("stock_setting_requests").insert({
    part_id: data.part_id,
    cabang_id: data.cabang_id,
    part_number: data.part_number ?? null,
    part_name: data.part_name ?? null,
    requested_by: user.id,
    reason: data.reason,
    note: data.note?.trim() || null,
    current_qty: data.current_qty ?? null,
    max_qty: data.max_qty ?? null,
    status: "open",
  });

  if (error) {
    // 23505 = unique violation (sudah ada request open untuk part+cabang ini).
    if ((error as any).code === "23505") {
      return {
        alreadyExists: true,
        success: true,
      };
    }
    return { error: error.message };
  }

  await notifyStockManagers({
    title: "Request Pengaturan Stok",
    message: `${data.part_number || "Sebuah PN"} perlu di-set kebijakan stok (min/max).`,
  });

  revalidatePath("/stock-requests");
  return { success: true };
}

/**
 * Daftar request pengaturan stok (untuk pengelola stok).
 */
export async function getStockSettingRequests(status: "open" | "resolved" | "all" = "open") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired", data: [] };

  const roleNames = await fetchRoleNames(supabase, user.id);
  const allowed = roleNames.some((r) => STOCK_MANAGER_ROLES.includes(r));
  if (!allowed) {
    return { error: "Tidak memiliki akses.", data: [] };
  }

  let query = supabase
    .from("stock_setting_requests")
    .select(
      "*, cabang(nama_cabang), requester:profiles!requested_by(nama), barang(part_number, part_name)",
    )
    .order("created_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query.limit(500);
  if (error) return { error: error.message, data: [] };
  return { data: data || [] };
}

/**
 * Set min/max stok langsung dari halaman request, lalu tandai request selesai.
 * Membuat row stok jika PN belum punya (qty default 0), tanpa menimpa qty yang ada.
 * RBAC: moderator (global) / ppic / pjo (hanya cabang sendiri).
 */
export async function setMinMaxFromRequest(
  requestId: number,
  minQty: number,
  maxQty: number,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const min = Math.trunc(Number(minQty));
  const max = Math.trunc(Number(maxQty));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) {
    return { error: "Min/Max harus angka tidak negatif." };
  }
  if (max < 1) {
    return { error: "Max stok harus minimal 1 agar PN bisa diminta." };
  }
  if (max < min) {
    return { error: "Max stok tidak boleh lebih kecil dari Min." };
  }

  const roleNames = await fetchRoleNames(supabase, user.id);
  const isModerator = roleNames.includes("moderator");
  const isPpicOrPjo =
    roleNames.includes("ppic") || roleNames.includes("pjo");
  if (!isModerator && !isPpicOrPjo) {
    return { error: "Hanya moderator/PPIC/PJO yang dapat mengatur stok." };
  }

  const { data: req } = await supabase
    .from("stock_setting_requests")
    .select("id, part_id, cabang_id, status")
    .eq("id", requestId)
    .single();
  if (!req) return { error: "Request tidak ditemukan" };

  // PPIC/PJO hanya boleh untuk cabang lokasinya sendiri.
  if (!isModerator) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("cabang_id")
      .eq("id", user.id)
      .single();
    if (!profile?.cabang_id || profile.cabang_id !== req.cabang_id) {
      return {
        error: "PPIC/PJO hanya dapat mengatur stok di gudang lokasinya sendiri.",
      };
    }
  }

  // Upsert min/max tanpa menimpa qty yang sudah ada.
  const { data: existing } = await supabase
    .from("stock")
    .select("id")
    .eq("part_id", req.part_id)
    .eq("cabang_id", req.cabang_id)
    .maybeSingle();

  if (existing) {
    const { error: updErr } = await supabase
      .from("stock")
      .update({ min_qty: min, max_qty: max })
      .eq("id", existing.id);
    if (updErr) return { error: updErr.message };
  } else {
    const { error: insErr } = await supabase.from("stock").insert({
      part_id: req.part_id,
      cabang_id: req.cabang_id,
      qty: 0,
      min_qty: min,
      max_qty: max,
    });
    if (insErr) return { error: insErr.message };
  }

  await supabase
    .from("stock_setting_requests")
    .update({
      status: "resolved",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  revalidatePath("/stock-requests");
  revalidatePath("/stock");
  return { success: true };
}

/**
 * Tandai request selesai (sudah di-set) — moderator/ppic/pjo.
 */
export async function resolveStockSettingRequest(id: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const roleNames = await fetchRoleNames(supabase, user.id);
  const allowed = roleNames.some((r) => STOCK_MANAGER_ROLES.includes(r));
  if (!allowed) {
    return { error: "Hanya pengelola stok yang dapat menyelesaikan request." };
  }

  const { error } = await supabase
    .from("stock_setting_requests")
    .update({
      status: "resolved",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/stock-requests");
  return { success: true };
}
