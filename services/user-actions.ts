"use server";

import { createAdminClient, createClient } from "@/lib/supabase/server";
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

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Tidak terautentikasi." };
  }

  // Allow only moderator/admin to change user management data.
  const { data: callerRoles, error: callerRolesError } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  if (callerRolesError) {
    return { error: callerRolesError.message };
  }

  const roleNames = (callerRoles ?? []).map((r: any) => r.roles?.name);
  const isAllowed =
    roleNames.includes("moderator") || roleNames.includes("admin");

  if (!isAllowed) {
    return {
      error:
        "Unauthorized: hanya moderator atau admin yang dapat mengubah data pengguna.",
    };
  }

  // Prefer service-role client for bypassing RLS, but gracefully fallback
  // to caller JWT client when key is not configured in local setup.
  let writeClient: any = supabase;
  try {
    writeClient = createAdminClient();
  } catch {
    writeClient = supabase;
  }

  // 1. Update cabang_id di profiles
  const { error: profileError } = await writeClient
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
  const { data: existingRoles, error: existingRolesError } = await writeClient
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
  ) as number[];
  currentRoleIds.sort((a, b) => a - b);

  const rolesChanged =
    requestedRoleIds.length !== currentRoleIds.length ||
    requestedRoleIds.some((roleId, idx) => roleId !== currentRoleIds[idx]);

  if (rolesChanged) {
    const currentRoleIdSet = new Set(currentRoleIds);
    const requestedRoleIdSet = new Set(requestedRoleIds);

    const roleIdsToAdd = requestedRoleIds.filter(
      (roleId) => !currentRoleIdSet.has(roleId),
    );
    const roleIdsToRemove = currentRoleIds.filter(
      (roleId) => !requestedRoleIdSet.has(roleId),
    );

    // Insert first so existing roles are preserved if insert fails.
    if (roleIdsToAdd.length > 0) {
      const inserts = roleIdsToAdd.map((roleId) => ({
        user_id: userId,
        role_id: roleId,
      }));

      const { error: insertError } = await writeClient
        .from("user_roles")
        .insert(inserts);

      if (insertError) {
        console.error("Error inserting new roles:", insertError);
        return { error: insertError.message };
      }
    }

    // Then remove roles that are no longer selected.
    if (roleIdsToRemove.length > 0) {
      const { error: deleteError } = await writeClient
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .in("role_id", roleIdsToRemove);

      if (deleteError) {
        console.error("Error deleting old roles:", deleteError);
        return { error: deleteError.message };
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
