"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Update own profile (NRP, nama, nomor_whatsapp) — authenticated user only
 */
export async function updateOwnProfile(data: {
  nama: string;
  nrp: string;
  nomor_whatsapp: string;
}) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Tidak terautentikasi." };
  }

  // Check NRP uniqueness (exclude self)
  if (data.nrp) {
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("nrp", data.nrp)
      .neq("id", user.id)
      .maybeSingle();

    if (existing) {
      return { error: "NRP sudah digunakan oleh pengguna lain." };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      nama: data.nama,
      nrp: data.nrp || null,
      nomor_whatsapp: data.nomor_whatsapp || null,
    })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/profile");
  return { success: true };
}

/**
 * Toggle user's is_active status (Approve/Reject/Suspend)
 */
export async function toggleUserStatus(userId: string, currentStatus: boolean) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ is_active: !currentStatus })
    .eq("id", userId);

  if (error) {
    console.error("Error toggling user status:", error);
    return { error: error.message };
  }

  revalidatePath("/users");
  return { success: true };
}

/**
 * Update user's roles and cabang_id (Multiple roles support)
 */
export async function updateUserDetail(
  userId: string,
  data: { roleIds: number[]; cabang_id: number; updateRoles?: boolean },
) {
  const supabase = await createClient();

  // 1. Update cabang_id di profiles
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      cabang_id: data.cabang_id,
    })
    .eq("id", userId);

  if (profileError) {
    console.error("Error updating profile cabang:", profileError);
    return { error: profileError.message };
  }

  // 2. Skip role update entirely when caller only edits non-role fields.
  if (!data.updateRoles) {
    revalidatePath("/users");
    return { success: true };
  }

  // 3. Update roles only when there is an actual change.
  // This avoids unnecessary writes that may be blocked by RLS.
  const { data: existingRoles, error: existingRolesError } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);

  if (existingRolesError) {
    console.error("Error fetching current roles:", existingRolesError);
    return { error: existingRolesError.message };
  }

  const requestedRoleIds = Array.from(new Set(data.roleIds)).sort(
    (a, b) => a - b,
  );
  const currentRoleIds = Array.from(
    new Set((existingRoles || []).map((r: any) => Number(r.role_id))),
  ).sort((a, b) => a - b);

  const rolesChanged =
    requestedRoleIds.length !== currentRoleIds.length ||
    requestedRoleIds.some((roleId, idx) => roleId !== currentRoleIds[idx]);

  if (rolesChanged) {
    const { error: deleteError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId);

    if (deleteError) {
      console.error("Error deleting old roles:", deleteError);
      return { error: deleteError.message };
    }

    if (requestedRoleIds.length > 0) {
      const inserts = requestedRoleIds.map((roleId) => ({
        user_id: userId,
        role_id: roleId,
      }));

      const { error: insertError } = await supabase
        .from("user_roles")
        .insert(inserts);

      if (insertError) {
        console.error("Error inserting new roles:", insertError);
        return { error: insertError.message };
      }
    }
  }

  revalidatePath("/users");
  return { success: true };
}

/**
 * Delete user profile (and auth user via trigger if configured,
 * but here we just handle profiles for safety)
 */
export async function deleteUserProfile(userId: string) {
  const supabase = await createClient();

  // In Supabase, deleting from profiles will CASCADE to auth.users if set up,
  // or we might need to use admin API to delete from auth.users.
  // For now, let's just use the RPC or handle it carefully.
  const { error } = await supabase.from("profiles").delete().eq("id", userId);

  if (error) {
    console.error("Error deleting user profile:", error);
    return { error: error.message };
  }

  revalidatePath("/users");
  return { success: true };
}
