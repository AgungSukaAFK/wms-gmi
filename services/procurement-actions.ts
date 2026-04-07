"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * MATERIAL REQUEST (MR) SERVICES
 */
export async function createMaterialRequest(data: {
  mr_kode: string;
  cabang_id: number;
  mr_pic: string;
  mr_pic_id: string;
  mr_tanggal: string;
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_request: number;
    prioritas?: string;
  }[];
}) {
  const supabase = await createClient();

  // 1. Insert MR Header
  const { data: mr, error: mrError } = await supabase
    .from("mrs")
    .insert([{
      mr_kode: data.mr_kode,
      cabang_id: data.cabang_id,
      mr_pic: data.mr_pic,
      mr_pic_id: data.mr_pic_id,
      mr_tanggal: data.mr_tanggal,
      mr_status: "open"
    }])
    .select()
    .single();

  if (mrError) return { error: mrError.message };

  // 2. Insert MR Items
  const itemsToInsert = data.items.map(item => ({
    mr_id: mr.id,
    ...item
  }));

  const { error: itemsError } = await supabase.from("mr_items").insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  revalidatePath("/(With Sidebar)/material-request");
  return { success: true, data: mr };
}

/**
 * RECEIVE (Goods Receipt) SERVICES
 */
export async function createReceive(data: {
  ri_kode: string;
  po_id: number;
  cabang_id: number;
  ri_pic: string;
  ri_tanggal: string;
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty: number;
    po_id: number;
    mr_id: number;
  }[];
}) {
  const supabase = await createClient();

  // 1. Insert Receive Header
  const { data: ri, error: riError } = await supabase
    .from("receives")
    .insert([{
      ri_kode: data.ri_kode,
      po_id: data.po_id,
      cabang_id: data.cabang_id,
      ri_pic: data.ri_pic,
      ri_tanggal: data.ri_tanggal
    }])
    .select()
    .single();

  if (riError) return { error: riError.message };

  // 2. Insert Receive Items
  const itemsToInsert = data.items.map(item => ({
    ri_id: ri.id,
    ...item
  }));

  const { error: itemsError } = await supabase.from("receive_items").insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // 3. Update Stock (Server Action Logic as requested)
  for (const item of data.items) {
    // Check if stock exists for this part and cabang
    const { data: existingStock, error: stockQueryError } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", data.cabang_id)
      .maybeSingle();

    if (stockQueryError) {
      console.error("Stock query error:", stockQueryError);
      continue;
    }

    if (existingStock) {
      // Update existing stock
      await supabase
        .from("stock")
        .update({ qty: existingStock.qty + item.qty })
        .eq("id", existingStock.id);
    } else {
      // Create new stock entry
      await supabase
        .from("stock")
        .insert([{
          part_id: item.part_id,
          cabang_id: data.cabang_id,
          qty: item.qty,
          location: "Gudang Utama" // Default location for the cabang
        }]);
    }
  }

  revalidatePath("/(With Sidebar)/inventory");
  return { success: true };
}
