"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateStock(
  id: number,
  data: {
    qty: number;
    min_qty: number;
    max_qty: number;
  }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Session expired" };

  // 1. Get current stock for change calculation & cabang scope check
  const { data: currentStock } = await supabase
    .from("stock")
    .select("qty, part_id, cabang_id")
    .eq("id", id)
    .single();

  if (!currentStock) return { success: false, error: "Stock record not found" };

  // RBAC: hanya PPIC, PJO, atau Moderator yang boleh mengubah min/max stock.
  // PPIC & PJO hanya untuk gudang di lokasinya sendiri; Moderator global.
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  const roles = (roleRows || [])
    .map((r: any) => r.roles?.name)
    .filter(Boolean);
  const isModerator = roles.includes("moderator");
  const isPpicOrPjo = roles.includes("ppic") || roles.includes("pjo");

  if (!isModerator && !isPpicOrPjo) {
    return {
      success: false,
      error:
        "Akses ditolak. Hanya PPIC, PJO, atau Moderator yang dapat mengubah stok.",
    };
  }

  if (!isModerator) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("cabang_id")
      .eq("id", user.id)
      .single();
    if (!profile?.cabang_id || profile.cabang_id !== currentStock.cabang_id) {
      return {
        success: false,
        error:
          "Akses ditolak. PPIC/PJO hanya dapat mengubah stok di gudang lokasinya sendiri.",
      };
    }
  }

  const qtyChange = data.qty - currentStock.qty;

  // 2. Perform Update
  const { error } = await supabase
    .from("stock")
    .update(data)
    .eq("id", id);

  if (error) {
    console.error("Error updating stock:", error);
    return { success: false, error: error.message };
  }

  // 3. Log Movement if qty changed
  if (qtyChange !== 0) {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("stock_movements").insert({
      part_id: currentStock.part_id,
      cabang_id: currentStock.cabang_id,
      qty_change: qtyChange,
      type: 'ADJUSTMENT',
      reference_id: 'MANUAL',
      created_by: user?.id,
      notes: 'Manual stock adjustment'
    });
  }

  revalidatePath("/stock");
  revalidatePath("/barang");
  return { success: true };
}

/**
 * Upsert stock record. Used when receiving items.
 */
export async function upsertStock(data: {
  part_id: number;
  cabang_id: number;
  qty: number;
  min_qty?: number;
  max_qty?: number;
}) {
  const supabase = await createClient();

  // We use the UNIQUE constraint on (part_id, cabang_id)
  const { error } = await supabase.from("stock").upsert(data, {
    onConflict: "part_id,cabang_id",
  });

  if (error) {
    console.error("Error upserting stock:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/stock");
  return { success: true };
}
