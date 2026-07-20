"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { MR_LEVEL_BY_CODE, MrLevelCode, MrLevelAutoRules } from "@/lib/mr-level";

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

/**
 * Set atau hapus override manual untuk level progres MR (OPEN/CLOSE).
 * level = null mengembalikan tampilan ke hasil hitung otomatis.
 * Hanya moderator yang boleh melakukan ini.
 */
export async function setMrManualLevel(params: {
  mrId: number;
  level: MrLevelCode | null;
  note?: string;
}) {
  const { mrId, level, note } = params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const roleNames = await fetchRoleNames(supabase, user.id);
  if (!roleNames.includes("moderator")) {
    return { error: "Hanya moderator yang dapat mengubah status MR secara manual." };
  }

  if (level && !MR_LEVEL_BY_CODE[level]) {
    return { error: "Level tidak valid." };
  }

  const { error } = await supabase
    .from("mrs")
    .update({
      manual_level: level,
      manual_level_note: level ? note || null : null,
      manual_level_set_by: level ? user.id : null,
      manual_level_set_at: level ? new Date().toISOString() : null,
    })
    .eq("id", mrId);
  if (error) return { error: error.message };

  revalidatePath("/mr");
  revalidatePath(`/mr/${mrId}`);
  return { success: true };
}

/**
 * Ambil aturan auto-deteksi level MR yang aktif (singleton row id=1).
 */
export async function getMrLevelAutoRules(): Promise<{
  data: (MrLevelAutoRules & { updatedAt: string | null }) | null;
  error?: string;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mr_level_auto_rules")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) return { data: null, error: error.message };

  return {
    data: {
      pendingConvertStatuses: data.pending_convert_statuses || ["pending"],
      closeStartMinReceivedPct: Number(data.close_start_min_received_pct),
      closeDoneMinReceivedPct: Number(data.close_done_min_received_pct),
      updatedAt: data.updated_at,
    },
  };
}

/**
 * Ubah aturan auto-deteksi level MR (threshold di computeMrAutoBucket).
 * Hanya moderator yang boleh melakukan ini.
 */
export async function updateMrLevelAutoRules(params: {
  pendingConvertStatuses: string[];
  closeStartMinReceivedPct: number;
  closeDoneMinReceivedPct: number;
}) {
  const { pendingConvertStatuses, closeStartMinReceivedPct, closeDoneMinReceivedPct } =
    params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const roleNames = await fetchRoleNames(supabase, user.id);
  if (!roleNames.includes("moderator")) {
    return { error: "Hanya moderator yang dapat mengubah aturan trigger level MR." };
  }

  if (closeStartMinReceivedPct < 0) {
    return { error: "Threshold CLOSE 1 tidak boleh kurang dari 0." };
  }
  if (closeDoneMinReceivedPct < closeStartMinReceivedPct) {
    return { error: "Threshold CLOSE 2 harus lebih besar atau sama dengan threshold CLOSE 1." };
  }
  if (pendingConvertStatuses.length === 0) {
    return { error: "Pilih minimal satu status konversi untuk OPEN 1." };
  }

  const { error } = await supabase
    .from("mr_level_auto_rules")
    .update({
      pending_convert_statuses: pendingConvertStatuses,
      close_start_min_received_pct: closeStartMinReceivedPct,
      close_done_min_received_pct: closeDoneMinReceivedPct,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/mr-level-settings");
  revalidatePath("/mr");
  return { success: true };
}
