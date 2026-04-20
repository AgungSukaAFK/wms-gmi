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

  // 1. Get current stock for change calculation
  const { data: currentStock } = await supabase
    .from("stock")
    .select("qty, part_id, cabang_id")
    .eq("id", id)
    .single();

  if (!currentStock) return { success: false, error: "Stock record not found" };

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
