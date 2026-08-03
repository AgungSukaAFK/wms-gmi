"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type UpdateLogChangeType = "feature" | "fix" | "improvement";

export interface UpdateLogChange {
  type: UpdateLogChangeType;
  description: string;
}

export interface UpdateLog {
  id: number;
  version: string;
  title: string;
  release_date: string;
  changes: UpdateLogChange[];
  created_at: string;
  updated_at: string;
}

const VERSION_PATTERN = /^\d\.\d{2}\.\d{3}$/;

/** Verifikasi caller adalah moderator DAN punya role "it". */
async function requireModeratorIT(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Session expired";

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  const roles = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
  if (!roles.includes("moderator") || !roles.includes("it")) {
    return "Akses ditolak. Halaman ini hanya untuk moderator dengan role IT.";
  }
  return null;
}

export async function getUpdateLogs(): Promise<
  { success: true; logs: UpdateLog[] } | { success: false; error: string }
> {
  const denied = await requireModeratorIT();
  if (denied) return { success: false, error: denied };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("update_logs")
    .select("*")
    .order("release_date", { ascending: false })
    .order("id", { ascending: false });
  if (error) return { success: false, error: error.message };
  return { success: true, logs: (data || []) as UpdateLog[] };
}

export async function createUpdateLog(data: {
  version: string;
  title: string;
  release_date: string;
  changes: UpdateLogChange[];
}): Promise<{ success: boolean; error?: string }> {
  const denied = await requireModeratorIT();
  if (denied) return { success: false, error: denied };

  const version = data.version.trim();
  if (!VERSION_PATTERN.test(version)) {
    return {
      success: false,
      error: "Format versi harus x.xx.xxx, contoh: 1.00.000",
    };
  }
  const title = data.title.trim();
  if (!title) return { success: false, error: "Judul wajib diisi." };
  const changes = (data.changes || []).filter((c) => c.description.trim());
  if (changes.length === 0) {
    return { success: false, error: "Minimal isi 1 baris perubahan." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("update_logs").insert({
    version,
    title,
    release_date: data.release_date,
    changes,
    created_by: user?.id,
  });
  if (error) {
    if (error.code === "23505") {
      return { success: false, error: `Versi ${version} sudah ada.` };
    }
    return { success: false, error: error.message };
  }

  revalidatePath("/update-logs");
  return { success: true };
}

export async function updateUpdateLog(
  id: number,
  data: {
    version: string;
    title: string;
    release_date: string;
    changes: UpdateLogChange[];
  },
): Promise<{ success: boolean; error?: string }> {
  const denied = await requireModeratorIT();
  if (denied) return { success: false, error: denied };

  const version = data.version.trim();
  if (!VERSION_PATTERN.test(version)) {
    return {
      success: false,
      error: "Format versi harus x.xx.xxx, contoh: 1.00.000",
    };
  }
  const title = data.title.trim();
  if (!title) return { success: false, error: "Judul wajib diisi." };
  const changes = (data.changes || []).filter((c) => c.description.trim());
  if (changes.length === 0) {
    return { success: false, error: "Minimal isi 1 baris perubahan." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("update_logs")
    .update({
      version,
      title,
      release_date: data.release_date,
      changes,
    })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") {
      return { success: false, error: `Versi ${version} sudah ada.` };
    }
    return { success: false, error: error.message };
  }

  revalidatePath("/update-logs");
  return { success: true };
}

export async function deleteUpdateLog(
  id: number,
): Promise<{ success: boolean; error?: string }> {
  const denied = await requireModeratorIT();
  if (denied) return { success: false, error: denied };

  const supabase = await createClient();
  const { error } = await supabase.from("update_logs").delete().eq("id", id);
  if (error) return { success: false, error: error.message };

  revalidatePath("/update-logs");
  return { success: true };
}

/** Tandai semua update log terbaru sudah dibaca oleh user saat ini. */
export async function markUpdateLogsRead(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("profiles")
    .update({ last_seen_update_log_at: new Date().toISOString() })
    .eq("id", user.id);
}

/**
 * Dipakai sidebar untuk titik merah: true kalau ada entri update_logs yang
 * lebih baru dari terakhir kali user ini membuka /update-logs. Aman dipanggil
 * oleh user mana pun -- kalau bukan moderator+it, RLS bikin query log kosong
 * jadi otomatis hasilnya false (menu-nya juga tidak akan tampil).
 */
export async function getHasUnreadUpdateLogs(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("last_seen_update_log_at")
    .eq("id", user.id)
    .single();

  const { data: latest } = await supabase
    .from("update_logs")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) return false;
  if (!profile?.last_seen_update_log_at) return true;
  return (
    new Date(latest.created_at).getTime() >
    new Date(profile.last_seen_update_log_at).getTime()
  );
}
