"use server";

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Ambil semua roles yang ada di sistem
 */
export async function getAllRoles() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("*")
    .order("name");
  if (error) return { error: error.message, data: null };
  return { data, error: null };
}

/**
 * Ambil semua halaman yang boleh diakses oleh user tertentu
 * berdasarkan roles dan cabang mereka (via view v_user_permissions)
 */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_user_permissions")
    .select("page_path")
    .eq("user_id", userId);

  if (error) {
    console.error("Error fetching user permissions:", error);
    return [];
  }

  // De-duplikasi page_path
  const uniquePaths = [...new Set(data?.map((r) => r.page_path) ?? [])];
  return uniquePaths;
}

/**
 * Ambil roles yang dimiliki user tertentu
 */
export async function getUserRoles(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_roles")
    .select("role_id, roles(id, name, label, color, description)")
    .eq("user_id", userId);

  if (error) return { error: error.message, data: null };
  // Flattening data
  return {
    data: data?.map((r: any) => r.roles).filter(Boolean) ?? [],
    error: null,
  };
}

/**
 * Update roles yang dimiliki user (replace semua)
 */
export async function updateUserRoles(userId: string, roleIds: number[]) {
  const supabase = await createClient();

  // Hapus semua role lama
  // Verify caller is moderator or admin
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: callerRoles } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  const roleNames = (callerRoles ?? []).map((r: any) => r.roles?.name);
  const isAllowed =
    roleNames.includes("moderator") || roleNames.includes("admin");
  if (!isAllowed)
    return {
      error:
        "Unauthorized: hanya moderator atau admin yang dapat mengubah roles.",
    };

  // Prefer service-role client, fallback to JWT client on local env without key.
  let writeClient: any = supabase;
  try {
    writeClient = createAdminClient();
  } catch {
    writeClient = supabase;
  }

  const { data: existingRoles, error: existingRolesError } = await writeClient
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);

  if (existingRolesError) return { error: existingRolesError.message };

  const requestedRoleIds = Array.from(new Set(roleIds)).sort((a, b) => a - b);
  const currentRoleIds = Array.from(
    new Set((existingRoles || []).map((r: any) => Number(r.role_id))),
  ) as number[];
  currentRoleIds.sort((a, b) => a - b);

  const currentRoleIdSet = new Set(currentRoleIds);
  const requestedRoleIdSet = new Set(requestedRoleIds);

  const roleIdsToAdd = requestedRoleIds.filter(
    (roleId) => !currentRoleIdSet.has(roleId),
  );
  const roleIdsToRemove = currentRoleIds.filter(
    (roleId) => !requestedRoleIdSet.has(roleId),
  );

  // Insert first to avoid data loss if insert fails.
  if (roleIdsToAdd.length > 0) {
    const inserts = roleIdsToAdd.map((roleId) => ({
      user_id: userId,
      role_id: roleId,
    }));

    const { error: insertError } = await writeClient
      .from("user_roles")
      .insert(inserts);

    if (insertError) return { error: insertError.message };
  }

  if (roleIdsToRemove.length > 0) {
    const { error: deleteError } = await writeClient
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .in("role_id", roleIdsToRemove);

    if (deleteError) return { error: deleteError.message };
  }

  revalidatePath("/users");
  return { success: true };
}

/**
 * CRUD Role & Permissions (Admin Only)
 */
export async function createRole(data: {
  name: string;
  label: string;
  description?: string;
  color?: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("roles").insert({
    name: data.name.toLowerCase().replace(/\s+/g, "_"),
    label: data.label,
    description: data.description ?? null,
    color: data.color ?? "default",
  });

  if (error) return { error: error.message };
  revalidatePath("/role-management");
  return { success: true };
}

export async function deleteRole(roleId: number) {
  const supabase = await createClient();
  const { error } = await supabase.from("roles").delete().eq("id", roleId);
  if (error) return { error: error.message };
  revalidatePath("/role-management");
  return { success: true };
}

export async function getRolePermissions(roleId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("role_permissions")
    .select("page_path, cabang_id")
    .eq("role_id", roleId);

  if (error) return { error: error.message, data: null };
  return { data, error: null };
}

export async function setRolePermissions(
  roleId: number,
  permissions: { page_path: string; cabang_id: number | null }[],
) {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("role_permissions")
    .delete()
    .eq("role_id", roleId);

  if (deleteError) return { error: deleteError.message };

  if (permissions.length > 0) {
    const inserts = permissions.map((p) => ({
      role_id: roleId,
      page_path: p.page_path,
      cabang_id: p.cabang_id,
    }));

    const { error: insertError } = await supabase
      .from("role_permissions")
      .insert(inserts);

    if (insertError) return { error: insertError.message };
  }

  revalidatePath("/role-management");
  return { success: true };
}
