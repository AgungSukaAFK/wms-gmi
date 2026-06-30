"use server";

import { createClient } from "@/lib/supabase/server";
import { evaluateMrFreeze } from "./freeze-actions";
import { revalidatePath } from "next/cache";
import { toCompletedIfLegacy } from "@/lib/document-status";

const DELIVERY_ACTIVE_STATUSES = [
  "open",
  "approved",
  "completed",
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
  estimasi_hari?: number; // estimasi lama pengiriman dalam hari
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

  // Guard freeze: MR yang ter-freeze tidak boleh membuat delivery baru.
  if (data.mr_id && (await evaluateMrFreeze(data.mr_id))) {
    return {
      error:
        "MR ini sedang di-FREEZE (lewat deadline share stock). Hubungi moderator untuk unfreeze/reset.",
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const deliveryCode = data.dlv_kode?.trim();
  if (!deliveryCode) {
    return { error: "Kode Delivery wajib diisi manual." };
  }

  const { data: existingDelivery } = await supabase
    .from("deliveries")
    .select("id")
    .eq("dlv_kode", deliveryCode)
    .maybeSingle();

  if (existingDelivery) {
    return { error: "Kode Delivery sudah digunakan. Gunakan kode lain." };
  }

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
        shipment_type: data.shipment_type || "ekspedisi_laut",
        sender_name: data.sender_name || null,
        eksternal_provider: data.eksternal_provider || null,
        eksternal_id: data.eksternal_id || null,
        estimasi_hari: data.estimasi_hari ?? 1,
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
      // Barang baru keluar/dalam pengiriman — belum diterima. qty_delivered
      // diisi penuh saat finalizeDelivery (barang diterima di tujuan).
      qty_delivered: 0,
      qty_pending: item.qty_on_delivery,
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
        qty_delivered: 0,
        qty_pending: item.qty_on_delivery,
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

  // 4. Catat Planning Supply (barang akan masuk ke cabang tujuan).
  //    Saldo "in_transit" sampai barang diterima (finalizeDelivery) atau
  //    dibatalkan (cancelDelivery).
  {
    // Ambil deadline per mr_item dari alokasi share stock (kalau ada).
    const planningMrItemIds = Array.from(
      new Set(
        data.items
          .map((item) => item.mr_item_id)
          .filter((id): id is number => typeof id === "number"),
      ),
    );
    const deadlineByItemId = new Map<number, string | null>();
    if (planningMrItemIds.length > 0) {
      const { data: deadlineRows } = await supabase
        .from("mr_sharestock_allocations")
        .select("mr_item_id, deadline")
        .in("mr_item_id", planningMrItemIds);
      for (const row of deadlineRows || []) {
        if (row.deadline && !deadlineByItemId.get(row.mr_item_id)) {
          deadlineByItemId.set(row.mr_item_id, row.deadline);
        }
      }
    }

    const planningRows = data.items.map((item) => ({
      mr_id: data.mr_id ?? null,
      mr_item_id: typeof item.mr_item_id === "number" ? item.mr_item_id : null,
      dlv_id: dlv.id,
      part_id: item.part_id,
      part_number: item.part_number,
      part_name: item.part_name,
      satuan: item.satuan,
      source_cabang_id: data.dari_cabang_id,
      dest_cabang_id: data.ke_cabang_id,
      qty: item.qty_on_delivery,
      deadline:
        typeof item.mr_item_id === "number"
          ? deadlineByItemId.get(item.mr_item_id) ?? null
          : null,
      status: "in_transit",
      created_by: user?.id || null,
    }));

    // Tabel planning_supplies bisa belum ada di DB lama → jangan gagalkan delivery.
    const { error: planningError } = await supabase
      .from("planning_supplies")
      .insert(planningRows);
    if (planningError) {
      console.error("Gagal mencatat planning supply:", planningError.message);
    }
  }

  revalidatePath("/deliveries");
  revalidatePath("/share-stock");
  revalidatePath("/mr");
  revalidatePath("/stock");
  revalidatePath("/planning-supply");
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

  // Guard freeze: kunci progres tracking bila MR ter-freeze.
  const { data: dlvForFreeze } = await supabase
    .from("deliveries")
    .select("mr_id")
    .eq("id", deliveryId)
    .maybeSingle();
  if (dlvForFreeze?.mr_id && (await evaluateMrFreeze(dlvForFreeze.mr_id))) {
    return {
      error:
        "MR ini sedang di-FREEZE. Update tracking ditahan sampai moderator unfreeze/reset.",
    };
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

export async function updateDeliveryTrackingModerator(
  deliveryId: number,
  trackingStatus: string,
  trackingNote: string,
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Session expired" };
  }

  const TRACKING_ORDER = [
    "created",
    "packing",
    "ready_pickup",
    "in_transit",
    "delivered",
  ] as const;

  if (!TRACKING_ORDER.includes(trackingStatus as any)) {
    return { error: "Status tracking tidak valid" };
  }

  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  if (roleError) {
    return { error: roleError.message };
  }

  const roleNames = (roleRows || [])
    .map((row: any) => row?.roles?.name)
    .filter((role: string | undefined): role is string => Boolean(role));

  const isModeratorOrAdmin = roleNames.some(
    (role) => role === "moderator" || role === "admin",
  );

  if (!isModeratorOrAdmin) {
    return {
      error:
        "Hanya moderator/admin yang dapat override status dan catatan tracking.",
    };
  }

  const safeTrackingNote = trackingNote?.trim() || null;
  if (safeTrackingNote && safeTrackingNote.length > 1000) {
    return { error: "Catatan tracking maksimal 1000 karakter." };
  }

  // Guard freeze: walau moderator, alur ditahan sampai MR di-unfreeze/reset.
  const { data: dlvForFreeze } = await supabase
    .from("deliveries")
    .select("mr_id")
    .eq("id", deliveryId)
    .maybeSingle();
  if (dlvForFreeze?.mr_id && (await evaluateMrFreeze(dlvForFreeze.mr_id))) {
    return {
      error:
        "MR ini sedang di-FREEZE. Unfreeze/reset MR dulu sebelum mengubah tracking.",
    };
  }

  const { error: updateError } = await supabase
    .from("deliveries")
    .update({
      tracking_status: trackingStatus,
      tracking_note: safeTrackingNote,
      tracking_note_updated_by: user.id,
      tracking_note_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);

  if (updateError) {
    return { error: updateError.message };
  }

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
      "id, dlv_kode, ke_cabang_id, dari_cabang_id, tracking_status, signature_receiver_id, status, mr_id",
    )
    .eq("id", deliveryId)
    .single();
  if (dlvError || !delivery) return { error: "Delivery tidak ditemukan" };

  // Guard freeze: MR ter-freeze mengunci seluruh alur termasuk penerimaan.
  if (delivery.mr_id && (await evaluateMrFreeze(delivery.mr_id))) {
    return {
      error:
        "MR ini sedang di-FREEZE. Penerimaan barang ditahan sampai moderator unfreeze/reset.",
    };
  }

  if (delivery.signature_receiver_id) {
    if (
      delivery.status === "completed" &&
      delivery.tracking_status === "completed"
    ) {
      return {
        success: true,
        alreadyFinalized: true,
      };
    }

    const { error: syncCompletedError } = await supabase
      .from("deliveries")
      .update({
        status: "completed",
        tracking_status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliveryId);

    if (syncCompletedError) {
      return { error: syncCompletedError.message };
    }

    revalidatePath("/deliveries");
    revalidatePath("/share-stock");
    revalidatePath("/mr");
    revalidatePath("/stock");
    return {
      success: true,
      alreadyFinalized: true,
    };
  }

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
    .select("id, part_id, part_number, part_name, qty_on_delivery, mr_item_id")
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

    // Tandai item benar-benar diterima (sebelumnya 0 / pending saat dibuat).
    await supabase
      .from("delivery_items")
      .update({ qty_delivered: item.qty_on_delivery, qty_pending: 0 })
      .eq("id", item.id);
  }

  // Update delivery: signature + status
  const { error: finalizeUpdateError } = await supabase
    .from("deliveries")
    .update({
      signature_receiver_id: signatureId,
      signed_by_receiver_at: new Date().toISOString(),
      uid_receiver: user.id,
      status: "completed",
      tracking_status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);

  if (finalizeUpdateError) {
    return { error: finalizeUpdateError.message };
  }

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

  // Tutup saldo planning supply: barang sudah diterima di cabang tujuan.
  const { error: planningReceivedError } = await supabase
    .from("planning_supplies")
    .update({ status: "received" })
    .eq("dlv_id", deliveryId)
    .eq("status", "in_transit");
  if (planningReceivedError) {
    console.error(
      "Gagal update planning supply jadi received:",
      planningReceivedError.message,
    );
  }

  revalidatePath("/deliveries");
  revalidatePath("/share-stock");
  revalidatePath("/mr");
  revalidatePath("/stock");
  revalidatePath("/planning-supply");
  return { success: true };
}

/**
 * BATALKAN DELIVERY (share stock) — moderator/admin.
 *
 * Dipakai bila pengiriman batal (tidak diapprove / kendala lain) SEBELUM barang
 * diterima. Qty dikembalikan ke stok cabang sumber, saldo planning supply
 * di-void (status 'cancelled') dengan keterangan, dan delivery jadi 'cancelled'.
 * Delivery yang sudah selesai (barang diterima) tidak bisa dibatalkan lewat sini.
 */
export async function cancelDelivery(deliveryId: number, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  const roleNames = (roleRows || [])
    .map((row: any) => row?.roles?.name)
    .filter((role: string | undefined): role is string => Boolean(role));
  const isModeratorOrAdmin = roleNames.some(
    (role) => role === "moderator" || role === "admin",
  );
  if (!isModeratorOrAdmin) {
    return {
      error: "Hanya moderator atau admin yang dapat membatalkan delivery.",
    };
  }

  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    return { error: "Alasan pembatalan wajib diisi." };
  }

  const { data: delivery } = await supabase
    .from("deliveries")
    .select("id, dlv_kode, dari_cabang_id, status, tracking_status")
    .eq("id", deliveryId)
    .single();
  if (!delivery) return { error: "Delivery tidak ditemukan" };
  if (delivery.status === "cancelled") {
    return { error: "Delivery ini sudah dibatalkan." };
  }
  if (
    delivery.status === "completed" ||
    delivery.tracking_status === "completed"
  ) {
    return {
      error:
        "Delivery sudah selesai (barang diterima) dan tidak bisa dibatalkan dari sini.",
    };
  }

  const { data: dlvItems } = await supabase
    .from("delivery_items")
    .select("part_id, part_number, part_name, qty_on_delivery, mr_item_id")
    .eq("dlv_id", deliveryId);

  // Kembalikan qty ke stok cabang sumber (saat createDelivery stok sumber dipotong).
  for (const item of dlvItems || []) {
    const { data: srcStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", delivery.dari_cabang_id)
      .maybeSingle();
    if (srcStock) {
      await supabase
        .from("stock")
        .update({ qty: srcStock.qty + item.qty_on_delivery })
        .eq("id", srcStock.id);
    } else {
      await supabase.from("stock").insert([
        {
          part_id: item.part_id,
          cabang_id: delivery.dari_cabang_id,
          qty: item.qty_on_delivery,
        },
      ]);
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: delivery.dari_cabang_id,
      qty_change: item.qty_on_delivery,
      type: "SS",
      reference_id: delivery.dlv_kode,
      created_by: user.id,
      notes: `Pembatalan Delivery ${delivery.dlv_kode}: ${item.part_number} ${item.part_name} dikembalikan ke cabang ${delivery.dari_cabang_id}. Alasan: ${trimmedReason}`,
    });
  }

  // Void saldo planning supply dengan keterangan.
  const { error: planningCancelError } = await supabase
    .from("planning_supplies")
    .update({ status: "cancelled", note: trimmedReason })
    .eq("dlv_id", deliveryId)
    .eq("status", "in_transit");
  if (planningCancelError) {
    console.error(
      "Gagal membatalkan planning supply:",
      planningCancelError.message,
    );
  }

  const { error: updateError } = await supabase
    .from("deliveries")
    .update({
      status: "cancelled",
      cancel_reason: trimmedReason,
      cancelled_by: user.id,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);
  if (updateError) return { error: updateError.message };

  // Recompute status share stock item terkait (alokasi kembali tersedia).
  const mrItemIds = Array.from(
    new Set(
      (dlvItems || [])
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
  revalidatePath("/planning-supply");
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

  // Guard freeze: bypass termasuk alur MR yang ikut terkunci saat freeze.
  const bypassMrId = (mrItem.mrs as any)?.id;
  if (bypassMrId && (await evaluateMrFreeze(bypassMrId))) {
    return {
      error:
        "MR ini sedang di-FREEZE. Hubungi moderator untuk unfreeze/reset sebelum bypass.",
    };
  }

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
    status?: "open" | "approved" | "done" | "closed" | "completed";
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
    payload.status = toCompletedIfLegacy(updates.status);
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

  if (!["completed", "done", "closed"].includes(delivery.status)) {
    return {
      error: "Penerima hanya dapat sign setelah delivery berstatus completed",
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
