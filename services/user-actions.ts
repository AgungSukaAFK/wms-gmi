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
 * Update user's role and cabang_id
 */
export async function updateUserDetail(
  userId: string,
  data: { role: string; cabang_id: number }
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ 
      role: data.role as any, // Cast to any to handle custom enum type
      cabang_id: data.cabang_id 
    })
    .eq("id", userId);

  if (error) {
    console.error("Error updating user detail:", error);
    return { error: error.message };
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
