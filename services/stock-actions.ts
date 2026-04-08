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

  const { error } = await supabase
    .from("stock")
    .update(data)
    .eq("id", id);

  if (error) {
    console.error("Error updating stock:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/stock");
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
