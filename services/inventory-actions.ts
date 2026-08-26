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

function isMissingMrItemColumnError(error: unknown): boolean {
  const err = error as { message?: string; details?: string; hint?: string };
  const text = `${err?.message || ""} ${err?.details || ""} ${err?.hint || ""}`
    .toLowerCase()
    .trim();
  return text.includes("mr_item_id") && text.includes("does not exist");
}

/**
 * Daftar mr_id unik yang jadi sumber suatu delivery, dilihat dari
 * delivery_items.mr_item_id (bukan cuma deliveries.mr_id, yang cuma nyimpan
 * MR pertama sebagai referensi utama). Dipakai buat guard freeze yang harus
 * ikut MR mana pun yang jadi sumber, bukan cuma MR pertama.
 */
async function getDeliverySourceMrIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  deliveryId: number,
): Promise<number[]> {
  const { data } = await supabase
    .from("delivery_items")
    .select("mr_items(mr_id)")
    .eq("dlv_id", deliveryId);
  return Array.from(
    new Set(
      (data || [])
        .map((row: any) =>
          Array.isArray(row.mr_items) ? row.mr_items[0]?.mr_id : row.mr_items?.mr_id,
        )
        .filter((id: unknown): id is number => typeof id === "number"),
    ),
  );
}

/**
 * Sisa alokasi share stock (mr_sharestock_allocations.qty dikurangi qty yang
 * sudah "aktif" ter-delivery — lihat DELIVERY_ACTIVE_STATUSES), per pasangan
 * (mr_item_id, source_cabang_id).
 *
 * - sourceCabangId diisi  -> scope ke satu cabang sumber (dipakai createDelivery
 *   dan getShareStockRemaining, yang memang hanya peduli satu dari_cabang_id).
 * - sourceCabangId kosong -> hitung untuk SEMUA cabang sumber yang punya
 *   alokasi ke item-item ini (dipakai bypassShareStockCompletion).
 *
 * Nilai balik BELUM di-clamp ke >=0 -- caller yang memutuskan.
 */
async function computeShareStockRemaining(
  supabase: Awaited<ReturnType<typeof createClient>>,
  mrItemIds: number[],
  sourceCabangId?: number,
): Promise<{
  remaining: Map<number, Map<number, number>>;
  error?: string;
  missingMrItemColumn?: boolean;
}> {
  const remaining = new Map<number, Map<number, number>>();
  if (mrItemIds.length === 0) return { remaining };

  let allocQuery = supabase
    .from("mr_sharestock_allocations")
    .select("mr_item_id, source_cabang_id, qty")
    .in("mr_item_id", mrItemIds);
  if (sourceCabangId) {
    allocQuery = allocQuery.eq("source_cabang_id", sourceCabangId);
  }
  const { data: allocations, error: allocationError } = await allocQuery;
  if (allocationError) return { remaining, error: allocationError.message };

  for (const a of allocations || []) {
    if (!remaining.has(a.mr_item_id)) remaining.set(a.mr_item_id, new Map());
    const m = remaining.get(a.mr_item_id)!;
    m.set(a.source_cabang_id, (m.get(a.source_cabang_id) || 0) + a.qty);
  }

  let dlvQuery = supabase
    .from("delivery_items")
    .select(
      "mr_item_id, qty_on_delivery, deliveries!inner(dari_cabang_id, status)",
    )
    .in("mr_item_id", mrItemIds)
    .in("deliveries.status", [...DELIVERY_ACTIVE_STATUSES]);
  if (sourceCabangId) {
    dlvQuery = dlvQuery.eq("deliveries.dari_cabang_id", sourceCabangId);
  }
  const { data: deliveredItems, error: deliveredError } = await dlvQuery;
  if (deliveredError) {
    if (isMissingMrItemColumnError(deliveredError)) {
      return { remaining, missingMrItemColumn: true };
    }
    return { remaining, error: deliveredError.message };
  }

  for (const d of deliveredItems || []) {
    if (!d.mr_item_id) continue;
    const src = (d.deliveries as any)?.dari_cabang_id;
    if (!src) continue;
    if (!remaining.has(d.mr_item_id)) remaining.set(d.mr_item_id, new Map());
    const m = remaining.get(d.mr_item_id)!;
    m.set(src, (m.get(src) || 0) - d.qty_on_delivery);
  }

  return { remaining };
}

/**
 * Sisa alokasi share stock (belum terkirim lewat delivery aktif) untuk
 * sekumpulan mr_item dari SATU cabang sumber. Dipakai form create-delivery
 * untuk cap qty input & tampilan "sisa" sebelum submit.
 */
export async function getShareStockRemaining(
  mrItemIds: number[],
  sourceCabangId: number,
): Promise<{ data: Record<number, number> } | { error: string }> {
  const supabase = await createClient();
  const ids = Array.from(
    new Set(
      (mrItemIds || []).filter((id): id is number => typeof id === "number"),
    ),
  );
  if (ids.length === 0 || !sourceCabangId) return { data: {} };

  const result = await computeShareStockRemaining(
    supabase,
    ids,
    sourceCabangId,
  );
  if (result.error) return { error: result.error };

  const data: Record<number, number> = {};
  for (const id of ids) {
    data[id] = Math.max(0, result.remaining.get(id)?.get(sourceCabangId) ?? 0);
  }
  return { data };
}

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

type DeliveryMrItemInfo = {
  id: number;
  part_number: string;
  qty_request: number;
  mr_id: number | null;
};

/**
 * Resolve mr_item_id → { qty_request, mr_id } untuk item-item delivery, dan
 * derive daftar mr_id unik (sourceMrIds) dari situ. Dipakai sebelum guard
 * freeze (createDelivery, moderatorEditDelivery) dan sebagai basis validasi
 * qty_request di _validateAndApplyDeliveryItems.
 */
async function _resolveDeliveryItemsMrInfo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  items: { mr_item_id?: number }[],
): Promise<{
  error?: string;
  mrItemById: Map<number, DeliveryMrItemInfo>;
  sourceMrIds: number[];
}> {
  const requestedMrItemIds = Array.from(
    new Set(
      items
        .map((item) => item.mr_item_id)
        .filter((itemId): itemId is number => typeof itemId === "number"),
    ),
  );

  const mrItemById = new Map<number, DeliveryMrItemInfo>();
  if (requestedMrItemIds.length > 0) {
    const { data: mrItemRows, error: mrItemError } = await supabase
      .from("mr_items")
      .select("id, part_number, qty_request, mr_id")
      .in("id", requestedMrItemIds);
    if (mrItemError) return { error: mrItemError.message, mrItemById, sourceMrIds: [] };
    for (const row of mrItemRows || []) mrItemById.set(row.id, row);
  }

  const sourceMrIds = Array.from(
    new Set(
      requestedMrItemIds
        .map((id) => mrItemById.get(id)?.mr_id)
        .filter((id): id is number => typeof id === "number"),
    ),
  );

  return { mrItemById, sourceMrIds };
}

/**
 * Validasi (stok sumber, sisa alokasi share-stock, cap qty_request) LALU
 * apply (insert delivery_items, potong stock sumber + stock_movements, insert
 * planning_supplies) untuk sekumpulan item delivery. Diekstrak verbatim dari
 * createDelivery supaya moderatorEditDelivery bisa reuse logika yang SAMA
 * PERSIS saat menerapkan ulang item baru setelah reversal — bukan menulis
 * ulang aritmatika stok/alokasi dari nol.
 */
async function _validateAndApplyDeliveryItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    dariCabangId: number;
    keCabangId: number;
    items: {
      mr_item_id?: number;
      part_id: number;
      part_number: string;
      part_name: string;
      satuan: string;
      qty_on_delivery: number;
    }[];
    mrItemById: Map<number, DeliveryMrItemInfo>;
    userId?: string;
    // Fallback mr_id untuk baris planning_supplies dari item TANPA mr_item_id
    // (dipertahankan buat backward-compat createDelivery yang masih terima
    // `mr_id` di top-level payload; moderatorEditDelivery tidak memakainya).
    fallbackMrId?: number;
    // Dipanggil SETELAH semua validasi di bawah lolos, SEBELUM item/stok/
    // planning-supply dimutasi — createDelivery insert header delivery-nya di
    // titik ini (supaya kalau validasi gagal, header TIDAK ikut dibuat).
    // moderatorEditDelivery yang delivery-nya sudah ada tinggal return
    // id/kode yang sudah ada tanpa insert apa-apa.
    getDelivery: () => Promise<{ error: string } | { dlvId: number; dlvKode: string }>;
  },
): Promise<{ error: string } | { success: true; dlvId: number; dlvKode: string }> {
  const { dariCabangId, keCabangId, items, mrItemById, userId, fallbackMrId, getDelivery } =
    params;

  let hasMrItemColumn = true;
  let mrItemIds = Array.from(
    new Set(
      items
        .map((item) => item.mr_item_id)
        .filter((itemId): itemId is number => typeof itemId === "number"),
    ),
  );

  const allocationByItemId = new Map<number, number>();
  if (mrItemIds.length > 0) {
    const remainResult = await computeShareStockRemaining(supabase, mrItemIds, dariCabangId);
    if (remainResult.error) return { error: remainResult.error };

    if (remainResult.missingMrItemColumn) {
      hasMrItemColumn = false;
      mrItemIds = [];
    } else {
      for (const id of mrItemIds) {
        allocationByItemId.set(id, remainResult.remaining.get(id)?.get(dariCabangId) ?? 0);
      }
    }
  }

  const sourceStockList = await Promise.all(
    items.map(async (item) => {
      const { data: sourceStock, error } = await supabase
        .from("stock")
        .select("id, qty")
        .eq("part_id", item.part_id)
        .eq("cabang_id", dariCabangId)
        .maybeSingle();

      return { item, sourceStock, error };
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
      const remainingAllocation = allocationByItemId.get(stockInfo.item.mr_item_id) || 0;
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

  // Defense-in-depth #2 (independen dari validasi qty_request di approveMR/
  // moderatorEditMR): total qty yang sudah "aktif" ter-delivery untuk suatu
  // mr_item, LINTAS SEMUA cabang sumber (bukan cuma dari_cabang_id delivery
  // ini) + qty yang mau dikirim sekarang, tidak boleh melebihi qty_request
  // MR-nya. Jaring pengaman terhadap data lama/jalur lain yang mungkin belum
  // tunduk pada validasi qty_request di alur alokasi.
  if (mrItemIds.length > 0) {
    const { data: activeAcrossAll, error: activeError } = await supabase
      .from("delivery_items")
      .select("mr_item_id, qty_on_delivery, deliveries!inner(status)")
      .in("mr_item_id", mrItemIds)
      .in("deliveries.status", [...DELIVERY_ACTIVE_STATUSES]);
    if (activeError) return { error: activeError.message };

    const activeTotalByItem = new Map<number, number>();
    for (const row of activeAcrossAll || []) {
      if (!row.mr_item_id) continue;
      activeTotalByItem.set(
        row.mr_item_id,
        (activeTotalByItem.get(row.mr_item_id) || 0) + row.qty_on_delivery,
      );
    }

    const requestedNowByItem = new Map<number, number>();
    for (const item of items) {
      if (typeof item.mr_item_id !== "number") continue;
      requestedNowByItem.set(
        item.mr_item_id,
        (requestedNowByItem.get(item.mr_item_id) || 0) + item.qty_on_delivery,
      );
    }

    for (const [itemId, requestedNow] of requestedNowByItem) {
      const mrItemRow = mrItemById.get(itemId);
      if (!mrItemRow) continue;
      const alreadyActive = activeTotalByItem.get(itemId) || 0;
      if (alreadyActive + requestedNow > mrItemRow.qty_request) {
        return {
          error: `Qty share stock ${mrItemRow.part_number} melebihi qty yang diminta MR (qty request: ${mrItemRow.qty_request}, sudah ter-delivery aktif: ${alreadyActive}, diminta sekarang: ${requestedNow}).`,
        };
      }
    }
  }

  // Semua valid -> baru buat/ambil delivery header.
  const dlvResult = await getDelivery();
  if ("error" in dlvResult) return { error: dlvResult.error };
  const { dlvId, dlvKode } = dlvResult;

  // 1. Insert Delivery Items
  const itemsToInsert = items.map((item) => {
    const baseItem = {
      dlv_id: dlvId,
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

  const { error: itemsError } = await supabase.from("delivery_items").insert(itemsToInsert);

  if (itemsError) {
    if (isMissingMrItemColumnError(itemsError)) {
      hasMrItemColumn = false;
      const simpleItems = items.map((item) => ({
        dlv_id: dlvId,
        part_id: item.part_id,
        part_number: item.part_number,
        part_name: item.part_name,
        satuan: item.satuan,
        qty_on_delivery: item.qty_on_delivery,
        qty_delivered: 0,
        qty_pending: item.qty_on_delivery,
      }));
      const { error: retryError } = await supabase.from("delivery_items").insert(simpleItems);
      if (retryError) return { error: retryError.message };
    } else {
      return { error: itemsError.message };
    }
  }

  // 2. Subtract Stock from Source (goods are now in transit; destination gets stock on finalizeDelivery)
  for (const item of items) {
    const { data: sourceStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", dariCabangId)
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
        cabang_id: dariCabangId,
        qty_change: -item.qty_on_delivery,
        type: "SS",
        reference_id: dlvKode,
        created_by: userId,
        notes: `Delivery ${dlvKode}: ${item.part_number} ${item.part_name} keluar dari cabang ${dariCabangId} (dalam pengiriman)`,
      });
    }
  }

  // 3. Catat Planning Supply (barang akan masuk ke cabang tujuan).
  //    Saldo "in_transit" sampai barang diterima (finalizeDelivery) atau
  //    dibatalkan (cancelDelivery).
  {
    // Ambil deadline per mr_item dari alokasi share stock (kalau ada).
    const planningMrItemIds = Array.from(
      new Set(
        items
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

    const planningRows = items.map((item) => ({
      // mr_id per-baris ikut MR asal item itu sendiri (bukan header
      // delivery), karena satu delivery bisa berisi item dari beberapa MR.
      mr_id:
        typeof item.mr_item_id === "number"
          ? (mrItemById.get(item.mr_item_id)?.mr_id ?? null)
          : (fallbackMrId ?? null),
      mr_item_id: typeof item.mr_item_id === "number" ? item.mr_item_id : null,
      dlv_id: dlvId,
      part_id: item.part_id,
      part_number: item.part_number,
      part_name: item.part_name,
      satuan: item.satuan,
      source_cabang_id: dariCabangId,
      dest_cabang_id: keCabangId,
      qty: item.qty_on_delivery,
      deadline:
        typeof item.mr_item_id === "number"
          ? (deadlineByItemId.get(item.mr_item_id) ?? null)
          : null,
      status: "in_transit",
      created_by: userId || null,
    }));

    // Tabel planning_supplies bisa belum ada di DB lama → jangan gagalkan delivery.
    const { error: planningError } = await supabase
      .from("planning_supplies")
      .insert(planningRows);
    if (planningError) {
      console.error("Gagal mencatat planning supply:", planningError.message);
    }
  }

  return { success: true, dlvId, dlvKode };
}

/**
 * Kembalikan qty ke stok cabang sumber (kebalikan dari _validateAndApplyDeliveryItems
 * langkah 2) + catat stock_movements. Diekstrak verbatim dari cancelDelivery
 * supaya moderatorEditDelivery/deleteDelivery bisa reuse reversal yang SAMA
 * PERSIS, bukan menulis ulang.
 */
async function _returnDeliveryStockToSource(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    dariCabangId: number;
    dlvKode: string;
    items: {
      part_id: number;
      part_number: string;
      part_name: string;
      qty_on_delivery: number;
    }[];
    userId?: string;
    buildNote: (item: {
      part_id: number;
      part_number: string;
      part_name: string;
      qty_on_delivery: number;
    }) => string;
  },
) {
  const { dariCabangId, dlvKode, items, userId, buildNote } = params;
  for (const item of items) {
    const { data: srcStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", dariCabangId)
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
          cabang_id: dariCabangId,
          qty: item.qty_on_delivery,
        },
      ]);
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: dariCabangId,
      qty_change: item.qty_on_delivery,
      type: "SS",
      reference_id: dlvKode,
      created_by: userId,
      notes: buildNote(item),
    });
  }
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

  if (data.items.length === 0) {
    return { error: "Item delivery tidak boleh kosong" };
  }

  if (data.dari_cabang_id === data.ke_cabang_id) {
    return { error: "Cabang asal dan tujuan tidak boleh sama" };
  }

  const mrInfo = await _resolveDeliveryItemsMrInfo(supabase, data.items);
  if (mrInfo.error) return { error: mrInfo.error };
  const { mrItemById, sourceMrIds } = mrInfo;

  // Guard freeze: MR yang ter-freeze (salah satu, kalau lebih dari 1 MR
  // sumber) tidak boleh membuat delivery baru.
  for (const mrId of sourceMrIds) {
    if (await evaluateMrFreeze(mrId)) {
      return {
        error:
          "Salah satu MR sumber sedang di-FREEZE (lewat deadline share stock). Hubungi moderator untuk unfreeze/reset.",
      };
    }
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

  const applyResult = await _validateAndApplyDeliveryItems(supabase, {
    dariCabangId: data.dari_cabang_id,
    keCabangId: data.ke_cabang_id,
    items: data.items,
    mrItemById,
    userId: user?.id,
    fallbackMrId: data.mr_id,
    getDelivery: async () => {
      // Insert Delivery Header — cuma dipanggil setelah semua validasi item
      // di atas lolos, supaya kalau ada yang gagal, header TIDAK ikut dibuat.
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
            // mr_id diisi MR pertama sebagai referensi utama (backward-compat
            // display) — sumber kebenaran tetap delivery_items.mr_item_id.
            mr_id: sourceMrIds[0] ?? data.mr_id ?? null,
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
      return { dlvId: dlv.id, dlvKode: dlv.dlv_kode };
    },
  });
  if ("error" in applyResult) return { error: applyResult.error };

  revalidatePath("/deliveries");
  revalidatePath("/share-stock");
  revalidatePath("/mr");
  revalidatePath("/stock");
  revalidatePath("/planning-supply");
  return { success: true, dlv_kode: applyResult.dlvKode };
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

  // Guard freeze: kunci progres tracking bila salah satu MR sumber ter-freeze.
  const sourceMrIdsForTracking = await getDeliverySourceMrIds(
    supabase,
    deliveryId,
  );
  for (const mrId of sourceMrIdsForTracking) {
    if (await evaluateMrFreeze(mrId)) {
      return {
        error:
          "Salah satu MR sumber sedang di-FREEZE. Update tracking ditahan sampai moderator unfreeze/reset.",
      };
    }
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

  // Guard freeze: walau moderator, alur ditahan sampai semua MR sumber di-unfreeze/reset.
  const sourceMrIdsForModTracking = await getDeliverySourceMrIds(
    supabase,
    deliveryId,
  );
  for (const mrId of sourceMrIdsForModTracking) {
    if (await evaluateMrFreeze(mrId)) {
      return {
        error:
          "Salah satu MR sumber sedang di-FREEZE. Unfreeze/reset MR dulu sebelum mengubah tracking.",
      };
    }
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
      "id, dlv_kode, ke_cabang_id, dari_cabang_id, tracking_status, signature_receiver_id, status",
    )
    .eq("id", deliveryId)
    .single();
  if (dlvError || !delivery) return { error: "Delivery tidak ditemukan" };

  // Guard freeze: MR ter-freeze (salah satu MR sumber) mengunci seluruh alur
  // termasuk penerimaan.
  const sourceMrIdsForFinalize = await getDeliverySourceMrIds(
    supabase,
    deliveryId,
  );
  for (const mrId of sourceMrIdsForFinalize) {
    if (await evaluateMrFreeze(mrId)) {
      return {
        error:
          "Salah satu MR sumber sedang di-FREEZE. Penerimaan barang ditahan sampai moderator unfreeze/reset.",
      };
    }
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
  await _returnDeliveryStockToSource(supabase, {
    dariCabangId: delivery.dari_cabang_id,
    dlvKode: delivery.dlv_kode,
    items: dlvItems || [],
    userId: user.id,
    buildNote: (item) =>
      `Pembatalan Delivery ${delivery.dlv_kode}: ${item.part_number} ${item.part_name} dikembalikan ke cabang ${delivery.dari_cabang_id}. Alasan: ${trimmedReason}`,
  });

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

export type ModeratorEditDeliveryPayload = {
  reason: string;
  header?: {
    dlv_kode?: string;
    ekspedisi?: string;
    shipment_type?: string;
    sender_name?: string | null;
    eksternal_provider?: string | null;
    eksternal_id?: string | null;
    no_resi?: string | null;
    estimasi_hari?: number;
    jumlah_koli?: number;
    uid_pic?: string | null;
    uid_receiver?: string | null;
  };
  // undefined = item tidak disentuh (edit logistik-only, skip jalur
  // reverse/reapply stok sama sekali).
  items?: {
    mr_item_id?: number;
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_on_delivery: number;
  }[];
};

/**
 * MODERATOR EDIT DELIVERY
 * Override item/qty dan/atau info logistik delivery yang sudah ada, di luar
 * cancel/finalize normal. Item lama di-reverse (qty balik ke stok cabang
 * asal) lalu item baru divalidasi & diterapkan dari kondisi bersih — reuse
 * _returnDeliveryStockToSource (sama seperti cancelDelivery) dan
 * _validateAndApplyDeliveryItems (sama seperti createDelivery), BUKAN
 * aritmatika delta baru. Cabang asal/tujuan TIDAK bisa diubah lewat sini —
 * kalau salah cabang, itu kasus cancel + buat ulang, bukan edit. Dikunci
 * setelah delivery completed atau cancelled (persis batasan cancelDelivery).
 */
export async function moderatorEditDelivery(
  deliveryId: number,
  payload: ModeratorEditDeliveryPayload,
) {
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
    return { error: "Hanya moderator atau admin yang dapat mengedit delivery." };
  }

  const reason = payload.reason?.trim();
  if (!reason) {
    return { error: "Alasan perubahan wajib diisi." };
  }

  if (!payload.header && !payload.items) {
    return { error: "Tidak ada perubahan untuk disimpan." };
  }

  const { data: delivery, error: dlvFetchError } = await supabase
    .from("deliveries")
    .select(
      "id, dlv_kode, dari_cabang_id, ke_cabang_id, status, tracking_status",
    )
    .eq("id", deliveryId)
    .single();
  if (dlvFetchError || !delivery) return { error: "Delivery tidak ditemukan" };

  if (
    delivery.status === "completed" ||
    delivery.status === "cancelled" ||
    delivery.tracking_status === "completed"
  ) {
    return {
      error: "Delivery yang sudah selesai atau dibatalkan tidak bisa diedit dari sini.",
    };
  }

  // Validasi nomor delivery baru (kalau diubah) di awal, sebelum ada mutasi
  // apapun — dicek terhadap SEMUA delivery lain (persis pola createDelivery),
  // kecuali dirinya sendiri.
  let newDlvKode: string | undefined;
  if (payload.header?.dlv_kode !== undefined) {
    newDlvKode = payload.header.dlv_kode.trim();
    if (!newDlvKode) {
      return { error: "Nomor Delivery tidak boleh kosong." };
    }
    if (newDlvKode !== delivery.dlv_kode) {
      const { data: dupDelivery } = await supabase
        .from("deliveries")
        .select("id")
        .eq("dlv_kode", newDlvKode)
        .neq("id", deliveryId)
        .maybeSingle();
      if (dupDelivery) {
        return { error: "Nomor Delivery sudah dipakai delivery lain. Gunakan nomor lain." };
      }
    }
  }

  // Guard freeze: MR sumber SEBELUM edit (item lama) — kalau salah satu MR
  // sedang freeze, jangan biarkan delivery-nya diapa-apain lagi.
  const currentSourceMrIds = await getDeliverySourceMrIds(supabase, deliveryId);
  for (const mrId of currentSourceMrIds) {
    if (await evaluateMrFreeze(mrId)) {
      return {
        error:
          "Salah satu MR sumber sedang di-FREEZE. Edit delivery ditahan sampai moderator unfreeze/reset.",
      };
    }
  }

  let itemsBefore: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_on_delivery: number;
    mr_item_id: number | null;
  }[] = [];
  let itemsAfterCount: number | null = null;

  if (payload.items) {
    if (payload.items.length === 0) {
      return { error: "Item delivery tidak boleh kosong." };
    }

    const newMrInfo = await _resolveDeliveryItemsMrInfo(supabase, payload.items);
    if (newMrInfo.error) return { error: newMrInfo.error };

    // Guard freeze tambahan: MR sumber dari item set BARU.
    for (const mrId of newMrInfo.sourceMrIds) {
      if (await evaluateMrFreeze(mrId)) {
        return {
          error:
            "Salah satu MR sumber (item baru) sedang di-FREEZE. Edit item ditahan sampai moderator unfreeze/reset.",
        };
      }
    }

    const { data: oldItems } = await supabase
      .from("delivery_items")
      .select("part_id, part_number, part_name, satuan, qty_on_delivery, mr_item_id")
      .eq("dlv_id", deliveryId);
    itemsBefore = oldItems || [];

    // Reverse: kembalikan qty item LAMA ke stok cabang asal (persis logika
    // cancelDelivery, cuma beda teks notes).
    await _returnDeliveryStockToSource(supabase, {
      dariCabangId: delivery.dari_cabang_id,
      dlvKode: delivery.dlv_kode,
      items: itemsBefore,
      userId: user.id,
      buildNote: (item) =>
        `Edit Delivery ${delivery.dlv_kode}: ${item.part_number} ${item.part_name} dikembalikan sementara untuk divalidasi ulang. Alasan: ${reason}`,
    });

    // Hapus item & planning_supplies lama supaya item baru divalidasi dari
    // kondisi bersih (tidak dobel-hitung terhadap delivery ini sendiri).
    await supabase.from("delivery_items").delete().eq("dlv_id", deliveryId);
    await supabase.from("planning_supplies").delete().eq("dlv_id", deliveryId);

    const applyResult = await _validateAndApplyDeliveryItems(supabase, {
      dariCabangId: delivery.dari_cabang_id,
      keCabangId: delivery.ke_cabang_id,
      items: payload.items,
      mrItemById: newMrInfo.mrItemById,
      userId: user.id,
      getDelivery: async () => ({ dlvId: delivery.id, dlvKode: delivery.dlv_kode }),
    });
    if ("error" in applyResult) return { error: applyResult.error };

    itemsAfterCount = payload.items.length;

    const { error: mrIdUpdateError } = await supabase
      .from("deliveries")
      .update({ mr_id: newMrInfo.sourceMrIds[0] ?? null })
      .eq("id", deliveryId);
    if (mrIdUpdateError) return { error: mrIdUpdateError.message };

    const unionMrItemIds = Array.from(
      new Set([
        ...itemsBefore
          .map((i) => i.mr_item_id)
          .filter((id): id is number => typeof id === "number"),
        ...payload.items
          .map((i) => i.mr_item_id)
          .filter((id): id is number => typeof id === "number"),
      ]),
    );
    if (unionMrItemIds.length > 0) {
      await syncShareStockStatuses(unionMrItemIds);
    }
  }

  if (payload.header) {
    const h = payload.header;
    const headerPatch: Record<string, string | number | null> = {
      updated_at: new Date().toISOString(),
    };
    if (newDlvKode !== undefined) headerPatch.dlv_kode = newDlvKode;
    if (h.ekspedisi !== undefined) headerPatch.ekspedisi = h.ekspedisi;
    if (h.shipment_type !== undefined) headerPatch.shipment_type = h.shipment_type;
    if (h.sender_name !== undefined) headerPatch.sender_name = h.sender_name || null;
    if (h.eksternal_provider !== undefined)
      headerPatch.eksternal_provider = h.eksternal_provider || null;
    if (h.eksternal_id !== undefined) headerPatch.eksternal_id = h.eksternal_id || null;
    if (h.no_resi !== undefined) headerPatch.no_resi = h.no_resi?.trim() || null;
    if (typeof h.estimasi_hari === "number") headerPatch.estimasi_hari = h.estimasi_hari;
    if (typeof h.jumlah_koli === "number") headerPatch.jumlah_koli = h.jumlah_koli;
    if (h.uid_pic !== undefined) headerPatch.uid_pic = h.uid_pic || null;
    if (h.uid_receiver !== undefined) headerPatch.uid_receiver = h.uid_receiver || null;

    const { error: headerError } = await supabase
      .from("deliveries")
      .update(headerPatch)
      .eq("id", deliveryId);
    if (headerError) {
      // Jaring pengaman terhadap race condition (dua rename bentrok di waktu
      // yang sama) — constraint UNIQUE di DB (deliveries.dlv_kode) yang
      // akhirnya menolak, bukan pre-check di atas.
      if (headerError.message.toLowerCase().includes("dlv_kode")) {
        return { error: "Nomor Delivery sudah dipakai delivery lain. Gunakan nomor lain." };
      }
      return { error: headerError.message };
    }
  }

  // Audit log.
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .single();

  const summaryParts: string[] = [];
  if (newDlvKode !== undefined && newDlvKode !== delivery.dlv_kode) {
    summaryParts.push(`nomor: ${delivery.dlv_kode} → ${newDlvKode}`);
  }
  if (payload.items)
    summaryParts.push(`item diubah (${itemsBefore.length} → ${itemsAfterCount} baris)`);
  if (payload.header) {
    const otherHeaderChanged = Object.keys(payload.header).some(
      (k) => k !== "dlv_kode",
    );
    if (otherHeaderChanged) summaryParts.push("info logistik diubah");
  }

  await supabase.from("moderator_edit_logs").insert({
    doc_type: "delivery",
    // dlv_kode boleh berubah di tengah proses ini — pakai kode LAMA sebagai
    // penanda dokumen di summary supaya konsisten dengan riwayat sebelumnya,
    // tapi nomor barunya tetap tercatat jelas di summaryParts & changes.header.
    doc_id: deliveryId,
    user_id: user.id,
    user_nama: myProfile?.nama || user.email,
    summary: `Edit Delivery ${delivery.dlv_kode}: ${summaryParts.join(", ")}. Alasan: ${reason}`,
    changes: {
      reason,
      dlv_kode_before: delivery.dlv_kode,
      dlv_kode_after: newDlvKode ?? undefined,
      header: payload.header ?? null,
      items_before: payload.items ? itemsBefore : undefined,
      items_after: payload.items ?? undefined,
    },
  });

  revalidatePath("/deliveries");
  revalidatePath("/share-stock");
  revalidatePath("/mr");
  revalidatePath("/stock");
  revalidatePath("/planning-supply");
  revalidatePath("/pr");
  return { success: true };
}

/**
 * HAPUS DELIVERY (hard delete) — moderator/admin.
 *
 * Kalau delivery belum di-cancel, qty di-reverse dulu ke stok cabang sumber
 * (reuse _returnDeliveryStockToSource, sama seperti cancelDelivery) sebelum
 * record-nya dihapus permanen. Kalau sudah cancelled, stok udah balik dari
 * proses cancel — langsung dihapus tanpa reverse dobel. delivery_items dan
 * planning_supplies ikut terhapus otomatis (ON DELETE CASCADE). Dikunci
 * untuk delivery yang sudah completed (barang sudah diterima).
 */
export async function deleteDelivery(deliveryId: number, reason: string) {
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
    return { error: "Hanya moderator atau admin yang dapat menghapus delivery." };
  }

  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    return { error: "Alasan penghapusan wajib diisi." };
  }

  const { data: delivery } = await supabase
    .from("deliveries")
    .select("id, dlv_kode, dari_cabang_id, status, tracking_status")
    .eq("id", deliveryId)
    .single();
  if (!delivery) return { error: "Delivery tidak ditemukan" };

  if (delivery.status === "completed" || delivery.tracking_status === "completed") {
    return {
      error: "Delivery sudah selesai (barang diterima) dan tidak bisa dihapus.",
    };
  }

  const { data: dlvItems } = await supabase
    .from("delivery_items")
    .select("part_id, part_number, part_name, qty_on_delivery, mr_item_id")
    .eq("dlv_id", deliveryId);

  if (delivery.status !== "cancelled") {
    await _returnDeliveryStockToSource(supabase, {
      dariCabangId: delivery.dari_cabang_id,
      dlvKode: delivery.dlv_kode,
      items: dlvItems || [],
      userId: user.id,
      buildNote: (item) =>
        `Hapus Delivery ${delivery.dlv_kode}: ${item.part_number} ${item.part_name} dikembalikan ke cabang ${delivery.dari_cabang_id}. Alasan: ${trimmedReason}`,
    });

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
  }

  // Catat audit log SEBELUM delete — datanya mau hilang begitu delivery dihapus.
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .single();

  await supabase.from("moderator_edit_logs").insert({
    doc_type: "delivery",
    doc_id: deliveryId,
    user_id: user.id,
    user_nama: myProfile?.nama || user.email,
    summary: `Hapus Delivery ${delivery.dlv_kode} (${(dlvItems || []).length} item). Alasan: ${trimmedReason}`,
    changes: {
      reason: trimmedReason,
      items: dlvItems || [],
      was_already_cancelled: delivery.status === "cancelled",
    },
  });

  const { error: deleteError } = await supabase
    .from("deliveries")
    .delete()
    .eq("id", deliveryId);
  if (deleteError) return { error: deleteError.message };

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

  // Sisa per source_cabang yang belum terkirim lewat delivery aktif -- formula
  // sama persis dengan yang dipakai createDelivery, supaya Bypass tidak
  // memindahkan qty yang sudah dipindah delivery normal (double-count).
  const remainResult = await computeShareStockRemaining(supabase, [mrItemId]);
  if (remainResult.error) return { error: remainResult.error };

  const remainingBySource = new Map<number, number>();
  let anyRemaining = false;
  for (const alloc of allocations) {
    const raw = remainResult.missingMrItemColumn
      ? alloc.qty
      : (remainResult.remaining.get(mrItemId)?.get(alloc.source_cabang_id) ??
        alloc.qty);
    const remainingQty = Math.max(0, Math.min(raw, alloc.qty));
    remainingBySource.set(alloc.source_cabang_id, remainingQty);
    if (remainingQty > 0) anyRemaining = true;
  }
  if (!anyRemaining) {
    return {
      error:
        "Semua alokasi share stock item ini sudah terkirim penuh lewat delivery normal. Tidak ada sisa untuk di-bypass.",
    };
  }

  const bypassRef = `BYPASS-${(mrItem.mrs as any)?.mr_kode || mrItemId}`;

  // Move stock from each source to destination (hanya sisa yang belum
  // terkirim lewat delivery normal)
  for (const alloc of allocations) {
    const remainingQty = remainingBySource.get(alloc.source_cabang_id) || 0;
    if (remainingQty <= 0) continue;

    const { data: srcStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", mrItem.part_id)
      .eq("cabang_id", alloc.source_cabang_id)
      .maybeSingle();

    // Skip if source doesn't have enough (best-effort bypass)
    if (!srcStock || srcStock.qty < remainingQty) continue;

    await supabase
      .from("stock")
      .update({ qty: srcStock.qty - remainingQty })
      .eq("id", srcStock.id);

    await supabase.from("stock_movements").insert({
      part_id: mrItem.part_id,
      cabang_id: alloc.source_cabang_id,
      qty_change: -remainingQty,
      type: "SS",
      reference_id: bypassRef,
      created_by: user.id,
      notes: `Bypass SS: ${mrItem.part_number} keluar dari cabang ${alloc.source_cabang_id} (sisa ${remainingQty} dari alokasi ${alloc.qty})`,
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
        .update({ qty: dstStock.qty + remainingQty })
        .eq("id", dstStock.id);
    } else {
      await supabase.from("stock").insert([
        {
          part_id: mrItem.part_id,
          cabang_id: destCabangId,
          qty: remainingQty,
        },
      ]);
    }

    await supabase.from("stock_movements").insert({
      part_id: mrItem.part_id,
      cabang_id: destCabangId,
      qty_change: remainingQty,
      type: "SS",
      reference_id: bypassRef,
      created_by: user.id,
      notes: `Bypass SS: ${mrItem.part_number} masuk ke cabang ${destCabangId} (sisa ${remainingQty} dari alokasi ${alloc.qty})`,
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

export async function syncShareStockStatuses(mrItemIds: number[]) {
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
