"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * INVENTORY & STOCK SERVICES
 */
export async function getStockByCabang(cabang_id: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock")
    .select("*, barang(part_number, part_name, part_satuan)")
    .eq("cabang_id", cabang_id);

  if (error) {
    console.error("Error fetching stock:", error);
    return [];
  }
  return data;
}

/**
 * DELIVERY SERVICES
 */
export async function createDelivery(data: {
  dlv_kode: string;
  mr_id?: number;
  dari_cabang_id: number;
  ke_cabang_id: number;
  ekspedisi: string;
  jumlah_koli: number;
  pic: string;
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_on_delivery: number;
  }[];
}) {
  const supabase = await createClient();

  // 1. Insert Delivery Header
  const { data: dlv, error: dlvError } = await supabase
    .from("deliveries")
    .insert([{
      dlv_kode: data.dlv_kode,
      mr_id: data.mr_id,
      dari_cabang_id: data.dari_cabang_id,
      ke_cabang_id: data.ke_cabang_id,
      ekspedisi: data.ekspedisi,
      jumlah_koli: data.jumlah_koli,
      pic: data.pic,
      status: "open"
    }])
    .select()
    .single();

  if (dlvError) return { error: dlvError.message };

  // 2. Insert Delivery Items
  const itemsToInsert = data.items.map(item => ({
    dlv_id: dlv.id,
    ...item
  }));

  const { error: itemsError } = await supabase.from("delivery_items").insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // 3. Update Stocks (Subtraction from Source, Addition to Destination)
  for (const item of data.items) {
    // Subtract from Source
    const { data: sourceStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", data.dari_cabang_id)
      .maybeSingle();

    if (sourceStock) {
      await supabase
        .from("stock")
        .update({ qty: sourceStock.qty - item.qty_on_delivery })
        .eq("id", sourceStock.id);
    }

    // Add to Destination
    const { data: destStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", data.ke_cabang_id)
      .maybeSingle();

    if (destStock) {
      await supabase
        .from("stock")
        .update({ qty: destStock.qty + item.qty_on_delivery })
        .eq("id", destStock.id);
    } else {
      await supabase
        .from("stock")
        .insert([{
          part_id: item.part_id,
          cabang_id: data.ke_cabang_id,
          qty: item.qty_on_delivery,
          location: "Gudang Utama"
        }]);
    }
  }

  revalidatePath("/(With Sidebar)/deliveries");
  revalidatePath("/(With Sidebar)/inventory");
  return { success: true };
}
