"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const DELIVERY_ACTIVE_STATUSES = [
  "open",
  "approved",
  "done",
  "closed",
] as const;

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
  dlv_kode?: string;
  mr_id?: number;
  dari_cabang_id: number;
  ke_cabang_id: number;
  ekspedisi: string; // courier name for ekspedisi type
  shipment_type?: string; // 'handcarry_internal' | 'handcarry_eksternal' | 'ekspedisi'
  sender_name?: string; // handcarry_internal: free text carrier name
  eksternal_provider?: string; // handcarry_eksternal: Gojek | Grab | Maxim | Lalamove
  eksternal_id?: string; // handcarry_eksternal: order/booking ID
  jumlah_koli: number;
  pic?: string;
  uid_pic?: string;
  uid_receiver?: string;
  signature_sender_id?: string;
  no_resi?: string;
  items: {
    mr_item_id?: number;
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_on_delivery: number;
  }[];
}) {
  const supabase = await createClient();
  const isMissingMrItemColumnError = (error: unknown) => {
    const err = error as { message?: string; details?: string; hint?: string };
    const text =
      `${err?.message || ""} ${err?.details || ""} ${err?.hint || ""}`
        .toLowerCase()
        .trim();
    return text.includes("mr_item_id") && text.includes("does not exist");
  };

  let hasMrItemColumn = true;

  if (data.items.length === 0) {
    return { error: "Item delivery tidak boleh kosong" };
  }

  if (data.dari_cabang_id === data.ke_cabang_id) {
    return { error: "Cabang asal dan tujuan tidak boleh sama" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const deliveryCode = data.dlv_kode?.trim() || generateDeliveryCode();

  let mrItemIds = hasMrItemColumn
    ? Array.from(
        new Set(
          data.items
            .map((item) => item.mr_item_id)
            .filter((itemId): itemId is number => typeof itemId === "number"),
        ),
      )
    : [];

  const allocationByItemId = new Map<number, number>();
  if (mrItemIds.length > 0) {
    const { data: allocations, error: allocationError } = await supabase
      .from("mr_sharestock_allocations")
      .select("mr_item_id, qty")
      .eq("source_cabang_id", data.dari_cabang_id)
      .in("mr_item_id", mrItemIds);

    if (allocationError) {
      return { error: allocationError.message };
    }

    for (const allocation of allocations || []) {
      const total = allocationByItemId.get(allocation.mr_item_id) || 0;
      allocationByItemId.set(allocation.mr_item_id, total + allocation.qty);
    }

    const { data: deliveredItems, error: deliveredError } = await supabase
      .from("delivery_items")
      .select(
        "mr_item_id, qty_on_delivery, deliveries!inner(dari_cabang_id, status)",
      )
      .in("mr_item_id", mrItemIds)
      .eq("deliveries.dari_cabang_id", data.dari_cabang_id)
      .in("deliveries.status", [...DELIVERY_ACTIVE_STATUSES]);

    if (deliveredError) {
      if (isMissingMrItemColumnError(deliveredError)) {
        hasMrItemColumn = false;
        mrItemIds = [];
      } else {
        return { error: deliveredError.message };
      }
    }

    if (hasMrItemColumn) {
      for (const deliveredItem of deliveredItems || []) {
        if (!deliveredItem.mr_item_id) {
          continue;
        }
        const currentDelivered =
          allocationByItemId.get(deliveredItem.mr_item_id) || 0;
        allocationByItemId.set(
          deliveredItem.mr_item_id,
          currentDelivered - deliveredItem.qty_on_delivery,
        );
      }
    }
  }

  const sourceStockList = await Promise.all(
    data.items.map(async (item) => {
      const { data: sourceStock, error } = await supabase
        .from("stock")
        .select("id, qty")
        .eq("part_id", item.part_id)
        .eq("cabang_id", data.dari_cabang_id)
        .maybeSingle();

      return {
        item,
        sourceStock,
        error,
      };
    }),
  );

  for (const stockInfo of sourceStockList) {
    if (stockInfo.error) {
      return { error: stockInfo.error.message };
    }

    if (!stockInfo.sourceStock) {
      return {
        error: `Stok sumber untuk ${stockInfo.item.part_name} tidak ditemukan`,
      };
    }

    if (stockInfo.sourceStock.qty < stockInfo.item.qty_on_delivery) {
      return {
        error: `Stok ${stockInfo.item.part_name} di cabang asal tidak mencukupi`,
      };
    }

    if (typeof stockInfo.item.mr_item_id === "number") {
      const remainingAllocation =
        allocationByItemId.get(stockInfo.item.mr_item_id) || 0;
      if (stockInfo.item.qty_on_delivery > remainingAllocation) {
        return {
          error:
            remainingAllocation <= 0
              ? `Alokasi share stock untuk ${stockInfo.item.part_name} sudah habis di cabang asal. Silakan pilih item lain atau ubah cabang asal.`
              : `Qty delivery ${stockInfo.item.part_name} melebihi sisa alokasi share stock (sisa: ${remainingAllocation}, diminta: ${stockInfo.item.qty_on_delivery})`,
        };
      }
    }
  }

  // 1. Insert Delivery Header
  const { data: dlv, error: dlvError } = await supabase
    .from("deliveries")
    .insert([
      {
        dlv_kode: deliveryCode,
        shipment_type: data.shipment_type || "ekspedisi",
        sender_name: data.sender_name || null,
        eksternal_provider: data.eksternal_provider || null,
        eksternal_id: data.eksternal_id || null,
        tracking_status: "created",
        mr_id: data.mr_id,
        dari_cabang_id: data.dari_cabang_id,
        ke_cabang_id: data.ke_cabang_id,
        ekspedisi: data.ekspedisi,
        jumlah_koli: data.jumlah_koli,
        pic: data.pic || "",
        uid_pic: data.uid_pic || null,
        uid_sender: user?.id || null,
        uid_receiver: data.uid_receiver || null,
        signature_sender_id: data.signature_sender_id || null,
        signed_by_sender_at: data.signature_sender_id
          ? new Date().toISOString()
          : null,
        no_resi: data.no_resi?.trim() || null,
        status: "open",
      },
    ])
    .select()
    .single();

  if (dlvError) return { error: dlvError.message };

  // 2. Insert Delivery Items
  const itemsToInsert = data.items.map((item) => {
    const baseItem = {
      dlv_id: dlv.id,
      part_id: item.part_id,
      part_number: item.part_number,
      part_name: item.part_name,
      satuan: item.satuan,
      qty_on_delivery: item.qty_on_delivery,
      qty_delivered: item.qty_on_delivery,
      qty_pending: 0,
    };

    if (!hasMrItemColumn) {
      return baseItem;
    }

    return {
      ...baseItem,
      mr_item_id: item.mr_item_id,
    };
  });

  let { error: itemsError } = await supabase
    .from("delivery_items")
    .insert(itemsToInsert);

  if (itemsError) {
    if (isMissingMrItemColumnError(itemsError)) {
      hasMrItemColumn = false;
      const simpleItems = data.items.map((item) => ({
        dlv_id: dlv.id,
        part_id: item.part_id,
        part_number: item.part_number,
        part_name: item.part_name,
        satuan: item.satuan,
        qty_on_delivery: item.qty_on_delivery,
        qty_delivered: item.qty_on_delivery,
        qty_pending: 0,
      }));
      const { error: retryError } = await supabase
        .from("delivery_items")
        .insert(simpleItems);
      if (retryError) return { error: retryError.message };
    } else {
      return { error: itemsError.message };
    }
  }

  // 3. Subtract Stock from Source (goods are now in transit; destination gets stock on finalizeDelivery)
  for (const item of data.items) {
    const { data: sourceStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", data.dari_cabang_id)
      .maybeSingle();

    if (sourceStock) {
      const { error: sourceUpdateError } = await supabase
        .from("stock")
        .update({ qty: sourceStock.qty - item.qty_on_delivery })
        .eq("id", sourceStock.id);

      if (sourceUpdateError) {
        return { error: sourceUpdateError.message };
      }

      await supabase.from("stock_movements").insert({
        part_id: item.part_id,
        cabang_id: data.dari_cabang_id,
        qty_change: -item.qty_on_delivery,
        type: "SS",
        reference_id: dlv.dlv_kode,
        created_by: user?.id,
        notes: `Delivery ${dlv.dlv_kode}: ${item.part_number} ${item.part_name} keluar dari cabang ${data.dari_cabang_id} (dalam pengiriman)`,
      });
    }
  }

  revalidatePath("/deliveries");
  revalidatePath("/share-stock");
  revalidatePath("/mr");
  revalidatePath("/stock");
  return { success: true, dlv_kode: dlv.dlv_kode };
}

export async function updateDeliveryTracking(
  deliveryId: number,
  trackingStatus: string,
) {
  const supabase = await createClient();

  const TRACKING_ORDER = [
    "created",
    "packing",
    "ready_pickup",
    "in_transit",
    "delivered",
  ];
  if (!TRACKING_ORDER.includes(trackingStatus)) {
    return { error: "Status tracking tidak valid" };
  }

  const { error } = await supabase
    .from("deliveries")
    .update({
      tracking_status: trackingStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);

  if (error) return { error: error.message };

  revalidatePath("/deliveries");
  revalidatePath("/share-stock");
  return { success: true };
}

/**
 * FINALIZE DELIVERY
 * Called by admin from destination warehouse when tracking_status = 'delivered'.
 * Adds stock to destination, records receiver signature, updates ss_status.
 */
export async function finalizeDelivery(
  deliveryId: number,
  signatureId: string,
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  // Validate: user must be from destination warehouse
  const { data: profile } = await supabase
    .from("profiles")
    .select("cabang_id")
    .eq("id", user.id)
    .single();
  if (!profile) return { error: "Profil tidak ditemukan" };

  // Get delivery
  const { data: delivery, error: dlvError } = await supabase
    .from("deliveries")
    .select(
      "id, dlv_kode, ke_cabang_id, dari_cabang_id, tracking_status, signature_receiver_id",
    )
    .eq("id", deliveryId)
    .single();
  if (dlvError || !delivery) return { error: "Delivery tidak ditemukan" };

  if (delivery.signature_receiver_id)
    return { error: "Delivery sudah diselesaikan sebelumnya" };
  if (delivery.tracking_status !== "delivered")
    return {
      error:
        "Delivery belum mencapai status 'Barang Diterima'. Update tracking terlebih dahulu.",
    };
  if (profile.cabang_id !== delivery.ke_cabang_id)
    return {
      error:
        "Hanya admin dari gudang penerima yang dapat menyelesaikan delivery ini",
    };

  // Validate signature belongs to user
  const { data: sig } = await supabase
    .from("user_signatures")
    .select("id")
    .eq("id", signatureId)
    .eq("user_id", user.id)
    .eq("is_hidden", false)
    .single();
  if (!sig) return { error: "Tanda tangan tidak valid" };

  // Get delivery items
  const { data: dlvItems } = await supabase
    .from("delivery_items")
    .select("part_id, part_number, part_name, qty_on_delivery, mr_item_id")
    .eq("dlv_id", deliveryId);
  if (!dlvItems || dlvItems.length === 0)
    return { error: "Tidak ada item delivery" };

  // Add stock to destination for each item
  for (const item of dlvItems) {
    const { data: destStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", delivery.ke_cabang_id)
      .maybeSingle();

    if (destStock) {
      await supabase
        .from("stock")
        .update({ qty: destStock.qty + item.qty_on_delivery })
        .eq("id", destStock.id);
    } else {
      await supabase.from("stock").insert([
        {
          part_id: item.part_id,
          cabang_id: delivery.ke_cabang_id,
          qty: item.qty_on_delivery,
        },
      ]);
    }

    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: delivery.ke_cabang_id,
      qty_change: item.qty_on_delivery,
      type: "SS",
      reference_id: delivery.dlv_kode,
      created_by: user.id,
      notes: `Delivery ${delivery.dlv_kode}: ${item.part_number} ${item.part_name} diterima di cabang ${delivery.ke_cabang_id}`,
    });
  }

  // Update delivery: signature + status
  await supabase
    .from("deliveries")
    .update({
      signature_receiver_id: signatureId,
      signed_by_receiver_at: new Date().toISOString(),
      uid_receiver: user.id,
      status: "done",
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);

  // Sync share stock statuses
  const mrItemIds = Array.from(
    new Set(
      dlvItems
        .map((i) => i.mr_item_id)
        .filter((id): id is number => typeof id === "number"),
    ),
  );
  if (mrItemIds.length > 0) {
    await syncShareStockStatuses(mrItemIds);
  }

  revalidatePath("/deliveries");
  revalidatePath("/share-stock");
  revalidatePath("/mr");
  revalidatePath("/stock");
  return { success: true };
}

/**
 * BYPASS SHARE STOCK COMPLETION
 * Admin shortcut: directly moves stock from source cabangs to destination
 * without going through the delivery tracking flow.
 */
export async function bypassShareStockCompletion(mrItemId: number) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  // Get mr_item with mr.cabang_id (destination)
  const { data: mrItem } = await supabase
    .from("mr_items")
    .select(
      "id, part_id, part_number, part_name, qty_sharestock_total, ss_status, mrs(id, cabang_id, mr_kode)",
    )
    .eq("id", mrItemId)
    .single();
  if (!mrItem) return { error: "Item tidak ditemukan" };
  if (mrItem.ss_status === "closed")
    return { error: "Item share stock ini sudah selesai" };

  const destCabangId = (mrItem.mrs as any)?.cabang_id;
  if (!destCabangId) return { error: "Cabang tujuan tidak ditemukan" };

  // Get allocations (source cabangs)
  const { data: allocations } = await supabase
    .from("mr_sharestock_allocations")
    .select("source_cabang_id, qty")
    .eq("mr_item_id", mrItemId);
  if (!allocations || allocations.length === 0)
    return { error: "Tidak ada alokasi share stock untuk item ini" };

  const bypassRef = `BYPASS-${(mrItem.mrs as any)?.mr_kode || mrItemId}`;

  // Move stock from each source to destination
  for (const alloc of allocations) {
    const { data: srcStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", mrItem.part_id)
      .eq("cabang_id", alloc.source_cabang_id)
      .maybeSingle();

    // Skip if source doesn't have enough (best-effort bypass)
    if (!srcStock || srcStock.qty < alloc.qty) continue;

    await supabase
      .from("stock")
      .update({ qty: srcStock.qty - alloc.qty })
      .eq("id", srcStock.id);

    await supabase.from("stock_movements").insert({
      part_id: mrItem.part_id,
      cabang_id: alloc.source_cabang_id,
      qty_change: -alloc.qty,
      type: "SS",
      reference_id: bypassRef,
      created_by: user.id,
      notes: `Bypass SS: ${mrItem.part_number} keluar dari cabang ${alloc.source_cabang_id}`,
    });

    const { data: dstStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", mrItem.part_id)
      .eq("cabang_id", destCabangId)
      .maybeSingle();

    if (dstStock) {
      await supabase
        .from("stock")
        .update({ qty: dstStock.qty + alloc.qty })
        .eq("id", dstStock.id);
    } else {
      await supabase.from("stock").insert([
        {
          part_id: mrItem.part_id,
          cabang_id: destCabangId,
          qty: alloc.qty,
        },
      ]);
    }

    await supabase.from("stock_movements").insert({
      part_id: mrItem.part_id,
      cabang_id: destCabangId,
      qty_change: alloc.qty,
      type: "SS",
      reference_id: bypassRef,
      created_by: user.id,
      notes: `Bypass SS: ${mrItem.part_number} masuk ke cabang ${destCabangId}`,
    });
  }

  // Mark item as closed
  await supabase
    .from("mr_items")
    .update({ ss_status: "closed", updated_at: new Date().toISOString() })
    .eq("id", mrItemId);

  revalidatePath("/share-stock");
  revalidatePath("/mr");
  revalidatePath("/stock");
  return { success: true };
}

export async function updateDeliveryDocument(
  deliveryId: number,
  updates: {
    status?: "open" | "done" | "closed";
    no_resi?: string | null;
    ekspedisi?: string;
    jumlah_koli?: number;
  },
) {
  const supabase = await createClient();

  const payload: Record<string, string | number | null> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.status) {
    payload.status = updates.status;
  }

  if (updates.no_resi !== undefined) {
    payload.no_resi = updates.no_resi?.trim() || null;
  }

  if (updates.ekspedisi !== undefined) {
    payload.ekspedisi = updates.ekspedisi.trim();
  }

  if (typeof updates.jumlah_koli === "number") {
    payload.jumlah_koli = updates.jumlah_koli;
  }

  const { error } = await supabase
    .from("deliveries")
    .update(payload)
    .eq("id", deliveryId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/deliveries");
  revalidatePath("/share-stock");
  revalidatePath("/mr");
  return { success: true };
}

export async function updateDeliveryReceiverSignature(
  deliveryId: number,
  signatureId: string,
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Session expired" };
  }

  const { data: delivery, error: deliveryError } = await supabase
    .from("deliveries")
    .select("id, uid_receiver, status, signature_receiver_id")
    .eq("id", deliveryId)
    .single();

  if (deliveryError || !delivery) {
    return { error: "Delivery tidak ditemukan" };
  }

  if (!delivery.uid_receiver) {
    return { error: "Delivery ini belum memiliki user penerima" };
  }

  if (delivery.uid_receiver !== user.id) {
    return {
      error: "Hanya user penerima yang dapat menandatangani delivery ini",
    };
  }

  if (delivery.signature_receiver_id) {
    return { error: "Tanda tangan penerima sudah tersimpan" };
  }

  if (!["done", "closed"].includes(delivery.status)) {
    return {
      error: "Penerima hanya dapat sign setelah delivery berstatus done/closed",
    };
  }

  const { data: signature, error: signatureError } = await supabase
    .from("user_signatures")
    .select("id")
    .eq("id", signatureId)
    .eq("user_id", user.id)
    .eq("is_hidden", false)
    .single();

  if (signatureError || !signature) {
    return { error: "Tanda tangan tidak valid untuk user ini" };
  }

  const { error: updateError } = await supabase
    .from("deliveries")
    .update({
      signature_receiver_id: signatureId,
      signed_by_receiver_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath("/deliveries");
  revalidatePath("/mr");
  revalidatePath("/share-stock");
  return { success: true };
}

async function syncShareStockStatuses(mrItemIds: number[]) {
  const supabase = await createClient();

  const { data: mrItems } = await supabase
    .from("mr_items")
    .select("id, qty_sharestock_total")
    .in("id", mrItemIds);

  if (!mrItems || mrItems.length === 0) {
    return;
  }

  // Only count delivery_items from FINALIZED deliveries (receiver has signed)
  const { data: finalizedDlvs } = await supabase
    .from("deliveries")
    .select("id")
    .not("signature_receiver_id", "is", null);

  const finalizedDlvIds = (finalizedDlvs || []).map((d) => d.id);

  const { data: deliveredItems } =
    finalizedDlvIds.length > 0
      ? await supabase
          .from("delivery_items")
          .select("mr_item_id, qty_on_delivery")
          .in("mr_item_id", mrItemIds)
          .in("dlv_id", finalizedDlvIds)
      : { data: [] };

  const deliveredMap = new Map<number, number>();
  for (const deliveredItem of deliveredItems || []) {
    if (!deliveredItem.mr_item_id) {
      continue;
    }
    const currentDelivered = deliveredMap.get(deliveredItem.mr_item_id) || 0;
    deliveredMap.set(
      deliveredItem.mr_item_id,
      currentDelivered + deliveredItem.qty_on_delivery,
    );
  }

  await Promise.all(
    mrItems.map(async (mrItem) => {
      const deliveredQty = deliveredMap.get(mrItem.id) || 0;
      let nextStatus: "open" | "approved" | "closed" = "open";

      if (deliveredQty > 0) {
        nextStatus =
          deliveredQty >= mrItem.qty_sharestock_total ? "closed" : "approved";
      }

      await supabase
        .from("mr_items")
        .update({
          ss_status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", mrItem.id);
    }),
  );
}

function generateDeliveryCode() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `DLV/${y}${m}${d}/${h}${min}${s}`;
}
