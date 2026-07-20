"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { MR_LEVEL_BY_CODE, MrLevelCode } from "@/lib/mr-level";

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
