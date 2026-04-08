"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function createBarang(data: {
  part_number: string;
  part_name: string;
  part_satuan: string;
}) {
  const supabase = await createClient();

  const { error } = await supabase.from("barang").insert([data]);

  if (error) {
    console.error("Error creating barang:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/barang");
  return { success: true };
}

export async function updateBarang(
  id: number,
  data: {
    part_number: string;
    part_name: string;
    part_satuan: string;
  }
) {
  const supabase = await createClient();

  const { error } = await supabase.from("barang").update(data).eq("id", id);

  if (error) {
    console.error("Error updating barang:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/barang");
  return { success: true };
}

export async function deleteBarang(id: number) {
  const supabase = await createClient();

  // Check if there is stock with qty > 0
  const { data: stockData, error: stockError } = await supabase
    .from("stock")
    .select("qty")
    .eq("part_id", id);

  if (stockError) {
    return { success: false, error: stockError.message };
  }

  const hasStock = stockData?.some((s) => s.qty > 0);
  if (hasStock) {
    return {
      success: false,
      error: "Tidak dapat menghapus barang yang masih memiliki stok aktif di cabang.",
    };
  }

  const { error } = await supabase.from("barang").delete().eq("id", id);

  if (error) {
    console.error("Error deleting barang:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/barang");
  return { success: true };
}

export async function getBarangStockDetails(partId: number) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_stock_with_status")
    .select("*")
    .eq("part_id", partId)
    .order("nama_cabang", { ascending: true });

  if (error) {
    console.error("Error fetching stock details:", error);
    return [];
  }

  return data;
}

