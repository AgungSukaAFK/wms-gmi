"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
  data: { roleIds: number[]; cabang_id: number }
) {
  const supabase = await createClient();

  // 1. Update cabang_id di profiles
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ 
      cabang_id: data.cabang_id 
    })
    .eq("id", userId);

  if (profileError) {
    console.error("Error updating profile cabang:", profileError);
    return { error: profileError.message };
  }

  // 2. Update roles via user_roles (Hapus lama, insert baru)
  const { error: deleteError } = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", userId);

  if (deleteError) {
    console.error("Error deleting old roles:", deleteError);
    return { error: deleteError.message };
  }

  if (data.roleIds.length > 0) {
    const inserts = data.roleIds.map((roleId) => ({
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
  const { error } = await supabase
    .from("profiles")
    .delete()
    .eq("id", userId);

  if (error) {
    console.error("Error deleting user profile:", error);
    return { error: error.message };
  }

  revalidatePath("/users");
  return { success: true };
}
