"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { changeStockQty, sumQtyByPart } from "@/lib/stock-mutation";

// ============================================================
// ITEM KONSINYASI (IK) — dokumen pengiriman fisik barang Consignment dari
// gudang GMI ke SITE CUSTOMER (customer_sites = gudang customer) dengan
// No AWB.
//
// BEDA dari SO Consignment induknya (murni pencatatan, tanpa gerak stok &
// tanpa approval): IK BENAR-BENAR memotong stok Gd Asal begitu disimpan,
// TANPA approval (stock_movements type 'IK'). Barang tidak masuk stok
// cabang mana pun; baru masuk customer_stock saat Penerimaan.
//
// IK lama (sebelum 2026-10-24) memakai ke_cabang_id: stoknya pindah ke
// gudang tujuan. Hapus IK membalik pergerakan yang benar-benar tercatat.
//
// Satu item SO Consignment BISA dikirim lewat lebih dari satu IK (partial
// shipment) — divalidasi terhadap SISA qty yang belum dikirim (qty SO
// dikurangi total qty yang sudah tercatat di IK lain utk item yg sama).
// ============================================================

async function getRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (data || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

export type ConsignmentIkItemInput = {
  so_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  part_number_customer?: string;
  satuan: string;
  qty: number;
};

/**
 * Sisa qty tiap item SO Consignment yang belum dikirim lewat IK manapun
 * (qty SO - total qty yang sudah tercatat di consignment_ik_items).
 * Dipakai form create IK utk cap input & guard race-condition di server.
 */
export async function getConsignmentSoRemainingToShip(soId: number) {
  const supabase = await createClient();

  const { data: soItems, error: soItemsError } = await supabase
    .from("consignment_so_items")
    .select("id, part_id, part_number, part_name, part_number_customer, satuan, qty")
    .eq("so_id", soId);
  if (soItemsError) return { data: [], error: soItemsError.message };

  const soItemIds = (soItems || []).map((i) => i.id);
  const shippedByItem = new Map<number, number>();
  if (soItemIds.length > 0) {
    const { data: ikItems } = await supabase
      .from("consignment_ik_items")
      .select("so_item_id, qty")
      .in("so_item_id", soItemIds);
    for (const row of ikItems || []) {
      shippedByItem.set(
        row.so_item_id,
        (shippedByItem.get(row.so_item_id) || 0) + row.qty,
      );
    }
  }

  const data = (soItems || []).map((item) => ({
    ...item,
    qty_shipped: shippedByItem.get(item.id) || 0,
    qty_remaining: Math.max(0, Number(item.qty) - (shippedByItem.get(item.id) || 0)),
  }));
  return { data, error: null as string | null };
}

/**
 * Stok fisik tiap part di gudang asal — dipakai form create IK utk
 * menampilkan & membatasi qty kirim sesuai stok yang benar-benar ada
 * (bukan cuma sisa qty SO).
 */
export async function getStockByCabang(cabangId: number, partIds: number[]) {
  const supabase = await createClient();
  if (!partIds || partIds.length === 0) return { data: [], error: null as string | null };

  const { data, error } = await supabase
    .from("stock")
    .select("part_id, qty")
    .eq("cabang_id", cabangId)
    .in("part_id", partIds);
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

export async function createConsignmentIk(data: {
  ik_tanggal: string;
  so_id: number;
  dari_cabang_id: number;
  ke_site_id: number;
  no_awb?: string;
  no_po?: string;
  remarks?: string;
  items: ConsignmentIkItemInput[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  if (!data.items || data.items.length === 0)
    return { error: "Daftar item tidak boleh kosong." };
  if (!data.dari_cabang_id) return { error: "Gudang asal wajib dipilih." };
  if (!data.ke_site_id) return { error: "Site tujuan wajib dipilih." };

  for (const item of data.items) {
    if (!item.qty || item.qty <= 0 || !Number.isInteger(Number(item.qty)))
      return { error: `${item.part_number}: qty harus bilangan bulat lebih dari 0.` };
  }

  // Site tujuan wajib site aktif milik customer SO.
  const { data: soHeader } = await supabase
    .from("consignment_so")
    .select("customer_id")
    .eq("id", data.so_id)
    .maybeSingle();
  if (!soHeader) return { error: "SO Consignment tidak ditemukan." };
  const { data: site } = await supabase
    .from("customer_sites")
    .select("id, customer_id, site_name, is_active")
    .eq("id", data.ke_site_id)
    .maybeSingle();
  if (!site || site.customer_id !== soHeader.customer_id || !site.is_active)
    return { error: "Site tujuan bukan site aktif milik customer SO ini." };

  // Guard sisa qty (race-safe — ambil ulang dari DB, bukan percaya payload client).
  const soItemIds = data.items.map((i) => i.so_item_id);
  const { data: soItemRows } = await supabase
    .from("consignment_so_items")
    .select("id, so_id, part_id, part_number, part_name, satuan, qty")
    .in("id", soItemIds);
  const soItemById = new Map((soItemRows || []).map((r: any) => [r.id, r]));
  // Item wajib milik SO ini; data part diambil dari item SO (bukan payload).
  for (const item of data.items) {
    const soItem: any = soItemById.get(item.so_item_id);
    if (!soItem || soItem.so_id !== data.so_id)
      return { error: `${item.part_number}: bukan item dari SO Consignment ini.` };
    item.part_id = soItem.part_id;
    item.part_number = soItem.part_number;
    item.part_name = soItem.part_name;
    item.satuan = soItem.satuan;
  }

  const { data: existingIkItems } = await supabase
    .from("consignment_ik_items")
    .select("so_item_id, qty")
    .in("so_item_id", soItemIds);
  const shippedByItem = new Map<number, number>();
  for (const row of existingIkItems || []) {
    shippedByItem.set(
      row.so_item_id,
      (shippedByItem.get(row.so_item_id) || 0) + row.qty,
    );
  }

  const qtyViolations: string[] = [];
  const requestedBySoItem = new Map<number, number>();
  for (const item of data.items) {
    requestedBySoItem.set(item.so_item_id, (requestedBySoItem.get(item.so_item_id) || 0) + item.qty);
  }
  for (const [soItemId, requested] of requestedBySoItem) {
    const soItem: any = soItemById.get(soItemId);
    const alreadyShipped = shippedByItem.get(soItemId) || 0;
    const remaining = Number(soItem.qty) - alreadyShipped;
    if (requested > remaining) {
      qtyViolations.push(
        `${soItem.part_number}: sisa yang belum dikirim ${remaining}, diminta ${requested}.`,
      );
    }
  }
  if (qtyViolations.length > 0)
    return { error: "Qty melebihi sisa yang belum dikirim:\n" + qtyViolations.join("\n") };

  // Guard stok gudang asal (dijumlah per part).
  const stockViolations: string[] = [];
  const neededByPart = sumQtyByPart(data.items, (i) => i.qty);
  for (const [partId, needed] of neededByPart) {
    const { data: srcStock } = await supabase
      .from("stock")
      .select("qty")
      .eq("part_id", partId)
      .eq("cabang_id", data.dari_cabang_id)
      .maybeSingle();
    const avail = srcStock?.qty ?? 0;
    if (needed > avail) {
      const name = data.items.find((i) => i.part_id === partId)?.part_number;
      stockViolations.push(`${name}: stok gudang asal ${avail}, diminta ${needed}.`);
    }
  }
  if (stockViolations.length > 0)
    return { error: "Stok gudang asal tidak mencukupi:\n" + stockViolations.join("\n") };

  // Generate kode IK lewat SEQUENCE Postgres (nextval, atomik) -- dijamin
  // tidak akan pernah menghasilkan kode yang sama meski dipanggil nyaris
  // bersamaan dari banyak request sekaligus (race-safe di level DB, beda
  // dari pola "cek-lalu-insert" di aplikasi yang punya celah race).
  const { data: generatedKode, error: kodeError } = await supabase.rpc(
    "generate_consignment_ik_kode",
  );
  if (kodeError || !generatedKode)
    return { error: kodeError?.message || "Gagal membuat kode IK." };
  const ikKode = generatedKode as string;

  // Insert header
  const { data: ik, error: ikError } = await supabase
    .from("consignment_ik")
    .insert([
      {
        ik_kode: ikKode,
        ik_tanggal: data.ik_tanggal,
        so_id: data.so_id,
        dari_cabang_id: data.dari_cabang_id,
        ke_site_id: site.id,
        ke_site_name: site.site_name,
        no_awb: data.no_awb?.trim() || null,
        no_po: data.no_po?.trim() || null,
        remarks: data.remarks?.trim() || null,
        created_by: user.id,
      },
    ])
    .select()
    .single();
  if (ikError) return { error: ikError.message };

  const itemsToInsert = data.items.map((item) => ({
    ik_id: ik.id,
    so_item_id: item.so_item_id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    part_number_customer: item.part_number_customer?.trim() || null,
    satuan: item.satuan,
    qty: item.qty,
  }));
  const removeIk = async () => {
    await supabase.from("consignment_ik_items").delete().eq("ik_id", ik.id);
    await supabase.from("consignment_ik").delete().eq("id", ik.id);
  };
  const { error: itemsError } = await supabase
    .from("consignment_ik_items")
    .insert(itemsToInsert);
  if (itemsError) {
    await removeIk();
    return { error: itemsError.message };
  }

  // Verifikasi ulang setelah insert: IK lain yang dibuat bersamaan bisa saja
  // lolos cek sisa yang sama -> kalau total kirim melebihi qty SO, batalkan.
  {
    const { data: shippedRows } = await supabase
      .from("consignment_ik_items")
      .select("so_item_id, qty")
      .in("so_item_id", soItemIds);
    const shippedNow = new Map<number, number>();
    for (const row of shippedRows || []) {
      shippedNow.set(row.so_item_id, (shippedNow.get(row.so_item_id) || 0) + Number(row.qty));
    }
    for (const [soItemId] of requestedBySoItem) {
      const soItem: any = soItemById.get(soItemId);
      if ((shippedNow.get(soItemId) || 0) > Number(soItem.qty)) {
        await removeIk();
        return { error: `${soItem.part_number}: qty kirim melebihi sisa SO (bentrok dengan IK lain yang baru dibuat). Coba lagi.` };
      }
    }
  }

  // Potong stok gudang asal — instan, tanpa approval (beda dari Delivery/
  // Item Transfer yang butuh finalize). Atomik per part; gagal -> potongan
  // yang sudah terjadi dikembalikan.
  const deducted: { partId: number; qty: number }[] = [];
  for (const [partId, qty] of neededByPart) {
    const name = data.items.find((i) => i.part_id === partId)?.part_number;
    const res = await changeStockQty(
      supabase,
      { partId, cabangId: data.dari_cabang_id },
      -qty,
      { label: name },
    );
    if (!res.ok) {
      for (const d of deducted) {
        await changeStockQty(supabase, { partId: d.partId, cabangId: data.dari_cabang_id }, d.qty, { allowNegative: true });
      }
      await removeIk();
      return { error: res.error };
    }
    deducted.push({ partId, qty });
  }
  await supabase.from("stock_movements").insert(
    data.items.map((item) => ({
      part_id: item.part_id,
      cabang_id: data.dari_cabang_id,
      qty_change: -item.qty,
      type: "IK",
      reference_id: ikKode,
      created_by: user.id,
      notes: `IK ${ikKode}: ${item.part_number} ${item.part_name} dikirim ke site ${site.site_name} (consignment)`,
    })),
  );

  revalidatePath("/so-reguler/consignment/ik");
  revalidatePath("/so-reguler/consignment/dashboard");
  revalidatePath("/stock");
  return { success: true, data: ik };
}

export async function getConsignmentIkList() {
  const supabase = await createClient();
  // Dibaca per halaman: PostgREST membatasi 1000 baris per request (IK
  // import riwayat ERP saja sudah ratusan).
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("consignment_ik")
      .select(
        "*, so:consignment_so(so_no), cabang_asal:cabang!consignment_ik_dari_cabang_id_fkey(nama_cabang), cabang_tujuan:cabang!consignment_ik_ke_cabang_id_fkey(nama_cabang), consignment_ik_items(id, part_number, part_name, qty, satuan)",
      )
      .order("ik_tanggal", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return { data: [], error: error.message };
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: all, error: null as string | null };
}

/**
 * Hapus IK (moderator/admin) — membalikkan pergerakan stok yang tercatat
 * untuk IK ini (stock_movements type 'IK'): IK baru cuma gudang asal, IK
 * lama juga gudang tujuan, IK import bisa tanpa pergerakan. Jaring pengaman
 * karena IK memotong stok sungguhan tanpa approval.
 */
export async function deleteConsignmentIk(ikId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const roleNames = await getRoleNames(supabase, user.id);
  if (!roleNames.some((r) => r === "moderator" || r === "admin")) {
    return { error: "Hanya moderator/admin yang dapat menghapus IK." };
  }

  const { data: ik } = await supabase
    .from("consignment_ik")
    .select("id, ik_kode")
    .eq("id", ikId)
    .single();
  if (!ik) return { error: "IK tidak ditemukan." };

  // IK yang sudah punya Penerimaan tidak boleh dihapus: sebagian stoknya
  // sudah pindah ke customer_stock. Hapus Penerimaan-nya dulu. (Dicek SEBELUM
  // stok dibalik -- dulu stok terlanjur dibalik lalu delete gagal di FK.)
  const { count: penerimaanCount } = await supabase
    .from("consignment_penerimaan")
    .select("id", { count: "exact", head: true })
    .eq("ik_id", ikId);
  if (penerimaanCount && penerimaanCount > 0) {
    return { error: "IK ini sudah punya dokumen Penerimaan. Hapus Penerimaan-nya dulu sebelum menghapus IK." };
  }

  const { data: items } = await supabase
    .from("consignment_ik_items")
    .select("part_id, part_number, part_name")
    .eq("ik_id", ikId);
  const { data: moves, error: movesError } = await supabase
    .from("stock_movements")
    .select("part_id, cabang_id, qty_change")
    .eq("type", "IK")
    .eq("reference_id", ik.ik_kode);
  if (movesError) return { error: movesError.message };

  // Saldo bersih per part + gudang (pembatalan sebelumnya ikut terhitung).
  const net = new Map<string, { partId: number; cabangId: number; qty: number }>();
  for (const m of moves || []) {
    const key = `${m.part_id}:${m.cabang_id}`;
    const row = net.get(key) || { partId: m.part_id, cabangId: m.cabang_id, qty: 0 };
    row.qty += Number(m.qty_change) || 0;
    net.set(key, row);
  }

  // Hapus dulu (baru stok dibalik) -> kalau delete gagal, stok tidak ikut
  // berubah; dan request ganda tidak membalik stok dua kali.
  const { data: deleted, error } = await supabase
    .from("consignment_ik")
    .delete()
    .eq("id", ikId)
    .select("id");
  if (error) return { error: error.message };
  if (!deleted || deleted.length === 0) return { error: "IK sudah dihapus." };

  const partById = new Map((items || []).map((i: any) => [i.part_id, i]));
  for (const row of net.values()) {
    if (row.qty === 0) continue;
    const part: any = partById.get(row.partId);
    await changeStockQty(supabase, { partId: row.partId, cabangId: row.cabangId }, -row.qty, {
      allowNegative: true,
    });
    await supabase.from("stock_movements").insert({
      part_id: row.partId,
      cabang_id: row.cabangId,
      qty_change: -row.qty,
      type: "IK",
      reference_id: ik.ik_kode,
      created_by: user.id,
      notes: `Pembatalan IK ${ik.ik_kode}: ${part?.part_number ?? ""} ${part?.part_name ?? ""} ${
        row.qty < 0 ? "dikembalikan ke gudang asal" : "dikeluarkan dari gudang tujuan"
      }`,
    });
  }

  revalidatePath("/so-reguler/consignment/ik");
  revalidatePath("/so-reguler/consignment/dashboard");
  revalidatePath("/stock");
  return { success: true };
}
