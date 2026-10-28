"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { notifyApprovers } from "@/services/notification-actions";
import { computeMrItemsOutstandingForTransfer } from "@/lib/mr-fulfillment";
import { fetchPrItemConvertedQty, isPrItemRejected } from "@/lib/pr-po-coverage";
import {
  allocateFifoPrItems,
  applyConsignmentChanges,
  changeConsignmentStock,
  fetchConsignmentNet,
  fetchConsignmentStockMap,
  fetchPrItemGrQty,
  fetchRekonsilQtyByPart,
} from "@/lib/vendor-consignment";

// ============================================================
// KONSINYASI VENDOR (AC Part) -- supplier menitipkan barang di gudang GMI.
// Acuan: 3 flowchart user di folder "Vendor Cons/".
//
//   PR Konsinyasi (prs.pr_jenis='konsinyasi', tanpa MR, di-share ke supplier)
//   -> GR Konsinyasi di WH HO/Branch (barang sesuai masuk stok konsinyasi,
//      sisanya komplain & retur)
//   -> Item Transfer mode konsinyasi ke site (services/item-transfer-actions)
//   -> SPB mode konsinyasi, barang keluar ke customer (lib/spb-posting)
//   -> Rekonsil Site per periode + BAST
//   -> PO Rekonsil ke vendor, FIFO dari item PR Konsinyasi
//      (createPurchaseOrder po_jenis 'konsinyasi')
//   -> invoice & payment (dicatat di rekonsil).
//
// GR & Rekonsil tanpa approval digital (konsisten dengan IK/Penerimaan
// Konsinyasi customer); BAST ditandatangani fisik setelah dicetak.
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

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function rel(row: any, key: string) {
  const v = row?.[key];
  return Array.isArray(v) ? v[0] : v;
}

function isPositiveInt(n: unknown) {
  return Number.isInteger(Number(n)) && Number(n) > 0;
}

function revalidateConsignment() {
  revalidatePath("/vendor-consignment/pr");
  revalidatePath("/vendor-consignment/gr");
  revalidatePath("/vendor-consignment/stock");
  revalidatePath("/vendor-consignment/rekonsil");
}

// ============================================================
// PR KONSINYASI
// ============================================================

export async function createConsignmentPr(data: {
  pr_kode: string;
  pr_tanggal: string;
  cabang_id: number;
  vendor_id: number;
  approvals?: any[];
  items: { part_id: number; qty: number }[];
}) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const prKode = data.pr_kode?.trim();
  if (!prKode) return { error: "Kode PR wajib diisi manual." };
  if (!data.cabang_id) return { error: "Gudang penerima wajib dipilih." };
  if (!data.vendor_id) return { error: "Vendor (supplier) wajib dipilih." };
  if (!data.items || data.items.length === 0) return { error: "Daftar item tidak boleh kosong." };
  if (data.items.some((i) => !isPositiveInt(i.qty)))
    return { error: "Qty item harus bilangan bulat lebih dari 0." };
  if (new Set(data.items.map((i) => i.part_id)).size !== data.items.length)
    return { error: "Part yang sama tidak boleh muncul dua kali." };

  const { data: existingPr } = await supabase
    .from("prs")
    .select("id")
    .eq("pr_kode", prKode)
    .maybeSingle();
  if (existingPr) return { error: "Kode PR sudah digunakan. Gunakan kode lain." };

  // Data part diambil dari master barang, bukan payload.
  const { data: parts } = await supabase
    .from("barang")
    .select("id, part_number, part_name, part_satuan")
    .in(
      "id",
      data.items.map((i) => i.part_id),
    );
  const partById = new Map((parts || []).map((p: any) => [p.id, p]));
  if (data.items.some((i) => !partById.has(i.part_id)))
    return { error: "Ada barang yang tidak ditemukan di master barang." };

  const approvals = data.approvals ?? [];
  const { data: pr, error: prError } = await supabase
    .from("prs")
    .insert([
      {
        pr_kode: prKode,
        pr_jenis: "konsinyasi",
        pr_vendor_id: data.vendor_id,
        mr_id: null,
        cabang_id: data.cabang_id,
        pr_pic_id: user.id,
        pr_tanggal: data.pr_tanggal,
        pr_status:
          approvals.length === 0 || approvals.every((a: any) => a.status !== "pending")
            ? "approved"
            : "open",
        approvals,
      },
    ])
    .select()
    .single();
  if (prError) return { error: prError.message };

  const { error: itemsError } = await supabase.from("pr_items").insert(
    data.items.map((i) => {
      const p: any = partById.get(i.part_id);
      return {
        pr_id: pr.id,
        mr_id: null,
        mr_item_id: null,
        part_id: p.id,
        part_number: p.part_number,
        part_name: p.part_name,
        satuan: p.part_satuan,
        qty: Number(i.qty),
      };
    }),
  );
  if (itemsError) {
    await supabase.from("prs").delete().eq("id", pr.id);
    return { error: itemsError.message };
  }

  if (approvals.length > 0) {
    notifyApprovers(approvals, "PR", pr.id, pr.pr_kode, `/pr/${pr.id}`).catch(console.error);
  }

  revalidatePath("/pr");
  revalidateConsignment();
  return { success: true, data: pr };
}

/**
 * Progres item PR Konsinyasi: sudah diterima lewat GR (qty_terima) dan sudah
 * ter-PO (PO Rekonsil). Dipakai list PR Konsinyasi & form GR.
 */
async function buildPrItemProgress(supabase: any, prItems: any[]) {
  const ids = prItems.map((i) => i.id);
  const [grMap, poMap] = await Promise.all([
    fetchPrItemGrQty(supabase, ids),
    fetchPrItemConvertedQty(supabase, ids),
  ]);
  return prItems.map((i) => {
    const qty = Number(i.qty) || 0;
    const qtyGr = grMap.get(i.id) || 0;
    return {
      ...i,
      rejected: isPrItemRejected(i),
      qty_gr: qtyGr,
      qty_po: poMap.get(i.id) || 0,
      sisa_gr: isPrItemRejected(i) ? 0 : Math.max(0, qty - qtyGr),
    };
  });
}

export async function getConsignmentPrList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prs")
    .select(
      "id, pr_kode, pr_tanggal, pr_status, pr_convert_status, cabang_id, pr_vendor_id, created_at, cabang(nama_cabang), vendors:pr_vendor_id(vendor_name, vendor_no), profiles(nama), pr_items(id, part_id, part_number, part_name, satuan, qty, status)",
    )
    .eq("pr_jenis", "konsinyasi")
    .order("pr_tanggal", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);
  if (error) return { data: [], error: error.message };

  const allItems = (data || []).flatMap((pr: any) => pr.pr_items || []);
  const progress = await buildPrItemProgress(supabase, allItems);
  const byId = new Map(progress.map((p) => [p.id, p]));
  const rows = (data || []).map((pr: any) => {
    const items = (pr.pr_items || []).map((i: any) => byId.get(i.id));
    const active = items.filter((i: any) => !i.rejected);
    const sum = (k: string) => active.reduce((acc: number, i: any) => acc + (Number(i[k]) || 0), 0);
    return {
      ...pr,
      pr_items: items,
      total_qty: sum("qty"),
      total_gr: sum("qty_gr"),
      total_po: sum("qty_po"),
    };
  });
  return { data: rows, error: null as string | null };
}

/** PR Konsinyasi approved yang masih punya sisa belum diterima (untuk GR). */
export async function getConsignmentPrOptionsForGr() {
  const { data, error } = await getConsignmentPrList();
  if (error) return { data: [], error };
  return {
    data: data.filter(
      (pr: any) =>
        ["approved", "completed"].includes(pr.pr_status) &&
        (pr.pr_items || []).some((i: any) => i.sisa_gr > 0),
    ),
    error: null as string | null,
  };
}

// ============================================================
// GR KONSINYASI
// ============================================================

export type ConsignmentGrItemInput = {
  pr_item_id: number;
  qty_kirim: number;
  qty_terima: number;
  status: "sesuai" | "komplain";
  catatan_komplain?: string;
};

export async function createConsignmentGr(data: {
  gr_tanggal: string;
  pr_id: number;
  no_surat_jalan: string;
  catatan?: string;
  items: ConsignmentGrItemInput[];
}) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const noSj = data.no_surat_jalan?.trim();
  if (!noSj) return { error: "No. surat jalan supplier wajib diisi." };
  const items = (data.items || []).filter((i) => Number(i.qty_kirim) > 0);
  if (items.length === 0) return { error: "Isi qty kirim minimal satu item." };

  for (const i of items) {
    if (!isPositiveInt(i.qty_kirim) || !Number.isInteger(Number(i.qty_terima)) || Number(i.qty_terima) < 0)
      return { error: "Qty kirim harus bilangan bulat > 0 dan qty diterima bilangan bulat >= 0." };
    if (Number(i.qty_terima) > Number(i.qty_kirim))
      return { error: "Qty diterima tidak boleh melebihi qty kirim." };
    // Barang kurang/rusak/tidak sesuai = komplain, wajib ada catatannya.
    if (Number(i.qty_terima) < Number(i.qty_kirim)) i.status = "komplain";
    if (i.status === "komplain" && !i.catatan_komplain?.trim())
      return { error: "Catatan komplain wajib diisi untuk item yang tidak sesuai." };
  }

  const { data: pr } = await supabase
    .from("prs")
    .select("id, pr_kode, pr_status, pr_jenis, pr_vendor_id, cabang_id")
    .eq("id", data.pr_id)
    .maybeSingle();
  if (!pr || pr.pr_jenis !== "konsinyasi") return { error: "PR Konsinyasi tidak ditemukan." };
  if (!["approved", "completed"].includes(pr.pr_status))
    return { error: `PR ${pr.pr_kode} belum approved (status: ${pr.pr_status}).` };

  const prItemIds = items.map((i) => i.pr_item_id);
  const { data: prItemRows } = await supabase
    .from("pr_items")
    .select("id, pr_id, part_id, part_number, part_name, satuan, qty, status")
    .in("id", prItemIds);
  const prItemById = new Map((prItemRows || []).map((r: any) => [r.id, r]));
  for (const i of items) {
    const pri: any = prItemById.get(i.pr_item_id);
    if (!pri || pri.pr_id !== pr.id) return { error: "Ada item yang bukan bagian dari PR ini." };
    if (isPrItemRejected(pri)) return { error: `${pri.part_number}: item ditolak approver PR.` };
  }

  // Sisa yang belum diterima (race-safe: diambil ulang dari DB).
  const checkRemaining = async () => {
    const received = await fetchPrItemGrQty(supabase, prItemIds);
    for (const i of items) {
      const pri: any = prItemById.get(i.pr_item_id);
      const sisa = Number(pri.qty) - (received.get(i.pr_item_id) || 0);
      if (sisa < 0) return `${pri.part_number}: qty diterima melebihi qty PR (bentrok dengan GR lain). Coba lagi.`;
    }
    return null;
  };
  {
    const received = await fetchPrItemGrQty(supabase, prItemIds);
    const thisGr = new Map<number, number>();
    for (const i of items) thisGr.set(i.pr_item_id, (thisGr.get(i.pr_item_id) || 0) + Number(i.qty_terima));
    for (const [prItemId, qty] of thisGr) {
      const pri: any = prItemById.get(prItemId);
      const sisa = Number(pri.qty) - (received.get(prItemId) || 0);
      if (qty > sisa)
        return { error: `${pri.part_number}: sisa PR yang belum diterima ${Math.max(0, sisa)}, diterima ${qty}.` };
    }
  }

  const { data: kode, error: kodeError } = await supabase.rpc("generate_vendor_consignment_gr_kode");
  if (kodeError || !kode) return { error: kodeError?.message || "Gagal membuat kode GR." };
  const grKode = kode as string;

  const { data: gr, error: grError } = await supabase
    .from("vendor_consignment_gr")
    .insert([
      {
        gr_kode: grKode,
        gr_tanggal: data.gr_tanggal,
        pr_id: pr.id,
        vendor_id: pr.pr_vendor_id,
        cabang_id: pr.cabang_id,
        no_surat_jalan: noSj,
        catatan: data.catatan?.trim() || null,
        created_by: user.id,
      },
    ])
    .select()
    .single();
  if (grError) return { error: grError.message };

  const removeGr = async () => {
    await supabase.from("vendor_consignment_gr").delete().eq("id", gr.id);
  };
  const { error: itemsError } = await supabase.from("vendor_consignment_gr_items").insert(
    items.map((i) => {
      const pri: any = prItemById.get(i.pr_item_id);
      return {
        gr_id: gr.id,
        pr_item_id: pri.id,
        part_id: pri.part_id,
        part_number: pri.part_number,
        part_name: pri.part_name,
        satuan: pri.satuan,
        qty_kirim: Number(i.qty_kirim),
        qty_terima: Number(i.qty_terima),
        status: i.status,
        catatan_komplain: i.status === "komplain" ? i.catatan_komplain?.trim() || null : null,
        resolution_status: i.status === "komplain" ? "open" : null,
      };
    }),
  );
  if (itemsError) {
    await removeGr();
    return { error: itemsError.message };
  }

  // Verifikasi ulang setelah insert: GR lain yang dibuat bersamaan bisa
  // lolos cek sisa yang sama.
  const raceError = await checkRemaining();
  if (raceError) {
    await removeGr();
    return { error: raceError };
  }

  const posting = await applyConsignmentChanges(
    supabase,
    items
      .filter((i) => Number(i.qty_terima) > 0)
      .map((i) => {
        const pri: any = prItemById.get(i.pr_item_id);
        return {
          vendorId: pr.pr_vendor_id,
          cabangId: pr.cabang_id,
          partId: pri.part_id,
          delta: Number(i.qty_terima),
          label: pri.part_number,
          notes: `GR ${grKode} (PR ${pr.pr_kode}): ${pri.part_number} ${pri.part_name} diterima`,
        };
      }),
    { type: "GR", referenceId: grKode, actorId: user.id },
  );
  if (!posting.ok) {
    await removeGr();
    return { error: posting.error };
  }

  revalidateConsignment();
  return { success: true, data: gr };
}

export async function getConsignmentGrList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_consignment_gr")
    .select(
      "*, prs(pr_kode), vendors(vendor_name, vendor_no), cabang(nama_cabang), vendor_consignment_gr_items(*)",
    )
    .order("gr_tanggal", { ascending: false })
    .order("id", { ascending: false })
    .limit(1000);
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

export async function resolveConsignmentGrComplaint(itemId: number, catatanResolusi: string) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Session expired" };
  const catatan = catatanResolusi?.trim();
  if (!catatan) return { error: "Catatan penyelesaian wajib diisi." };

  const { data, error } = await supabase
    .from("vendor_consignment_gr_items")
    .update({ resolution_status: "selesai", catatan_resolusi: catatan })
    .eq("id", itemId)
    .eq("status", "komplain")
    .eq("resolution_status", "open")
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Komplain tidak ditemukan atau sudah selesai." };

  revalidatePath("/vendor-consignment/gr");
  return { success: true };
}

/**
 * Hapus GR (moderator/admin): stok konsinyasi yang masuk lewat GR ini
 * dikurangi lagi. Ditolak kalau barangnya sudah ditransfer/dipakai (stok
 * konsinyasi di gudang itu tidak cukup) -- jaring pengaman salah input, bukan
 * jalur retur.
 */
export async function deleteConsignmentGr(grId: number) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Session expired" };
  const roles = await getRoleNames(supabase, user.id);
  if (!roles.some((r) => r === "moderator" || r === "admin"))
    return { error: "Hanya moderator/admin yang dapat menghapus GR Konsinyasi." };

  const { data: gr } = await supabase
    .from("vendor_consignment_gr")
    .select("id, gr_kode")
    .eq("id", grId)
    .maybeSingle();
  if (!gr) return { error: "GR tidak ditemukan." };

  const net = await fetchConsignmentNet(supabase, ["GR", "GR_CANCEL"], gr.gr_kode);
  const reverse = Array.from(net.values())
    .filter((r) => r.qty !== 0)
    .map((r) => ({ ...r, delta: -r.qty, notes: `Pembatalan GR ${gr.gr_kode}` }));
  const res = await applyConsignmentChanges(supabase, reverse, {
    type: "GR_CANCEL",
    referenceId: gr.gr_kode,
    actorId: user.id,
  });
  if (!res.ok) {
    return {
      error: `Tidak bisa menghapus: sebagian barang GR ini sudah ditransfer/dipakai. ${res.error}`,
    };
  }

  const { error } = await supabase.from("vendor_consignment_gr").delete().eq("id", grId);
  if (error) {
    // Kembalikan stok yang tadi dibalik.
    await applyConsignmentChanges(
      supabase,
      reverse.map((r) => ({ ...r, delta: -r.delta, notes: `Batal hapus GR ${gr.gr_kode}` })),
      { type: "GR", referenceId: gr.gr_kode, actorId: user.id },
    );
    return { error: error.message };
  }

  revalidateConsignment();
  return { success: true };
}

// ============================================================
// STOK KONSINYASI
// ============================================================

export async function getConsignmentStockList(params?: {
  vendorId?: number | null;
  cabangId?: number | null;
  hideEmpty?: boolean;
}) {
  const supabase = await createClient();
  let q = supabase
    .from("vendor_consignment_stock")
    .select(
      "id, vendor_id, cabang_id, part_id, qty, updated_at, vendors(vendor_name, vendor_no), cabang(nama_cabang), barang(part_number, part_name, part_satuan)",
    )
    .order("updated_at", { ascending: false })
    .limit(5000);
  if (params?.vendorId) q = q.eq("vendor_id", params.vendorId);
  if (params?.cabangId) q = q.eq("cabang_id", params.cabangId);
  if (params?.hideEmpty !== false) q = q.neq("qty", 0);
  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

export async function getConsignmentMovements(key: {
  vendorId: number;
  cabangId: number;
  partId: number;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_consignment_movements")
    .select("id, qty_change, type, reference_id, notes, created_at, profiles:created_by(nama)")
    .eq("vendor_id", key.vendorId)
    .eq("cabang_id", key.cabangId)
    .eq("part_id", key.partId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);
  if (error) {
    // Relasi created_by -> profiles belum tentu terdeteksi PostgREST.
    const { data: plain, error: plainError } = await supabase
      .from("vendor_consignment_movements")
      .select("id, qty_change, type, reference_id, notes, created_at")
      .eq("vendor_id", key.vendorId)
      .eq("cabang_id", key.cabangId)
      .eq("part_id", key.partId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    if (plainError) return { data: [], error: plainError.message };
    return { data: plain || [], error: null as string | null };
  }
  return { data: data || [], error: null as string | null };
}

/**
 * Stock opname konsinyasi (per 3 bulan): set qty aktual hasil hitung fisik.
 * Selisihnya dicatat sebagai ADJUSTMENT di kartu stok. Moderator/admin.
 */
export async function adjustConsignmentStock(data: {
  vendorId: number;
  cabangId: number;
  partId: number;
  qtyAktual: number;
  catatan: string;
}) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Session expired" };
  const roles = await getRoleNames(supabase, user.id);
  if (!roles.some((r) => r === "moderator" || r === "admin"))
    return { error: "Hanya moderator/admin yang dapat melakukan stock opname konsinyasi." };
  if (!Number.isInteger(Number(data.qtyAktual)) || Number(data.qtyAktual) < 0)
    return { error: "Qty aktual harus bilangan bulat >= 0." };
  const catatan = data.catatan?.trim();
  if (!catatan) return { error: "Catatan stock opname wajib diisi." };

  const key = { vendorId: data.vendorId, cabangId: data.cabangId, partId: data.partId };
  const current = await changeConsignmentStock(supabase, key, 0);
  if (!current.ok) return { error: current.error };
  const delta = Number(data.qtyAktual) - current.before;
  if (delta === 0) return { success: true, delta: 0 };

  const ref = `OPNAME-${new Date().toISOString().slice(0, 10)}`;
  const res = await applyConsignmentChanges(
    supabase,
    [{ ...key, delta, notes: `Stock opname: ${current.before} -> ${data.qtyAktual}. ${catatan}` }],
    { type: "ADJUSTMENT", referenceId: ref, actorId: user.id },
  );
  if (!res.ok) return { error: res.error };

  revalidatePath("/vendor-consignment/stock");
  return { success: true, delta };
}

/**
 * Item MR site tujuan yang masih outstanding + stok konsinyasi vendor di
 * gudang asal -- untuk tombol "Ambil dari MR Site" di Item Transfer
 * konsinyasi ("Monitoring MR Site -> kirim barang ke site").
 */
export async function getConsignmentMrOutstanding(params: {
  keCabangId: number;
  dariCabangId: number;
  vendorId: number;
}) {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("mr_items")
    .select("id, part_id, part_number, part_name, satuan, item_status, mrs!inner(id, mr_kode, mr_tanggal, mr_status, cabang_id)")
    .eq("mrs.cabang_id", params.keCabangId)
    .eq("mrs.mr_status", "approved")
    .limit(1000);
  if (error) return { data: [], error: error.message };

  const active = (rows || []).filter((r: any) => r.item_status !== "rejected");
  const [outstanding, stockMap] = await Promise.all([
    computeMrItemsOutstandingForTransfer(
      supabase,
      active.map((r: any) => r.id),
    ),
    fetchConsignmentStockMap(
      supabase,
      params.vendorId,
      params.dariCabangId,
      Array.from(new Set(active.map((r: any) => r.part_id))),
    ),
  ]);

  const data = active
    .map((r: any) => {
      const mr = rel(r, "mrs");
      return {
        mr_item_id: r.id,
        mr_id: mr?.id,
        mr_kode: mr?.mr_kode,
        mr_tanggal: mr?.mr_tanggal,
        part_id: r.part_id,
        part_number: r.part_number,
        part_name: r.part_name,
        satuan: r.satuan,
        outstanding: outstanding.get(r.id)?.outstanding ?? 0,
        stok_konsinyasi: stockMap.get(r.part_id) || 0,
      };
    })
    .filter((r) => r.outstanding > 0)
    .sort(
      (a, b) =>
        Number(b.stok_konsinyasi > 0) - Number(a.stok_konsinyasi > 0) ||
        String(a.mr_tanggal).localeCompare(String(b.mr_tanggal)),
    );
  return { data, error: null as string | null };
}

// ============================================================
// REKONSIL SITE + BAST
// ============================================================

function nextDay(ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Baris SPB konsinyasi (site + vendor + periode) yang belum direkonsil.
 * Qty = qty SPB - yang sudah diretur. Baris yang masih punya Return SPB
 * menunggu approval dilewati dulu supaya qty-nya tidak berubah setelah
 * direkonsil.
 */
export async function getRekonsilCandidates(params: {
  cabangId: number;
  vendorId: number;
  periodeAwal: string;
  periodeAkhir: string;
}) {
  const supabase = await createClient();
  if (!params.cabangId || !params.vendorId || !params.periodeAwal || !params.periodeAkhir)
    return { data: [], skipped: [], error: "Site, vendor, dan periode wajib diisi." };
  if (params.periodeAwal > params.periodeAkhir)
    return { data: [], skipped: [], error: "Periode awal tidak boleh setelah periode akhir." };

  const { data: rows, error } = await supabase
    .from("spb_details")
    .select(
      "id, spb_id, part_id, dtl_spb_part_number, dtl_spb_part_name, dtl_spb_part_satuan, dtl_spb_qty, dtl_spb_qty_returned, spb!inner(spb_no, spb_tanggal, spb_status, spb_is_deleted, cabang_id, spb_is_consignment, spb_vendor_id, spb_kode_unit)",
    )
    .eq("spb.spb_is_consignment", true)
    .eq("spb.spb_vendor_id", params.vendorId)
    .eq("spb.cabang_id", params.cabangId)
    .eq("spb.spb_is_deleted", false)
    .neq("spb.spb_status", "CANCELLED")
    .gte("spb.spb_tanggal", params.periodeAwal)
    .lt("spb.spb_tanggal", nextDay(params.periodeAkhir))
    .limit(2000);
  if (error) return { data: [], skipped: [], error: error.message };

  const ids = (rows || []).map((r: any) => r.id);
  const [{ data: reconciled }, { data: openReturns }] = await Promise.all([
    ids.length
      ? supabase.from("vendor_consignment_rekonsil_items").select("spb_detail_id").in("spb_detail_id", ids)
      : Promise.resolve({ data: [] as any[] }),
    ids.length
      ? supabase
          .from("return_spb_details")
          .select("spb_dtl_id, return_spb!inner(rtn_kode, approval_status)")
          .in("spb_dtl_id", ids)
          .eq("return_spb.approval_status", "open")
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const reconciledSet = new Set((reconciled || []).map((r: any) => r.spb_detail_id));
  const openReturnSet = new Set((openReturns || []).map((r: any) => r.spb_dtl_id));

  const data: any[] = [];
  const skipped: { spb_no: string; part_number: string; alasan: string }[] = [];
  for (const r of rows || []) {
    if (reconciledSet.has(r.id)) continue;
    const spb = rel(r, "spb");
    const qty = (Number(r.dtl_spb_qty) || 0) - (Number(r.dtl_spb_qty_returned) || 0);
    if (openReturnSet.has(r.id)) {
      skipped.push({
        spb_no: spb?.spb_no,
        part_number: r.dtl_spb_part_number,
        alasan: "Return SPB masih menunggu approval",
      });
      continue;
    }
    if (qty <= 0) continue;
    data.push({
      spb_detail_id: r.id,
      spb_id: r.spb_id,
      spb_no: spb?.spb_no,
      spb_tanggal: spb?.spb_tanggal ? String(spb.spb_tanggal).slice(0, 10) : null,
      kode_unit: spb?.spb_kode_unit ?? null,
      part_id: r.part_id,
      part_number: r.dtl_spb_part_number,
      part_name: r.dtl_spb_part_name,
      satuan: r.dtl_spb_part_satuan,
      qty,
    });
  }
  data.sort((a, b) => String(a.spb_tanggal).localeCompare(String(b.spb_tanggal)) || a.spb_id - b.spb_id);
  return { data, skipped, error: null as string | null };
}

export async function createRekonsil(data: {
  rk_tanggal: string;
  cabang_id: number;
  vendor_id: number;
  periode_awal: string;
  periode_akhir: string;
  pic_admin?: string;
  pic_pjo?: string;
  catatan?: string;
  spb_detail_ids: number[];
}) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Tidak terautentikasi." };
  if (!data.spb_detail_ids || data.spb_detail_ids.length === 0)
    return { error: "Pilih minimal satu baris SPB." };

  const candidates = await getRekonsilCandidates({
    cabangId: data.cabang_id,
    vendorId: data.vendor_id,
    periodeAwal: data.periode_awal,
    periodeAkhir: data.periode_akhir,
  });
  if (candidates.error) return { error: candidates.error };
  const byId = new Map(candidates.data.map((c: any) => [c.spb_detail_id, c]));
  const chosen = Array.from(new Set(data.spb_detail_ids)).map((id) => byId.get(id));
  if (chosen.some((c) => !c))
    return { error: "Sebagian baris SPB sudah direkonsil atau tidak lagi memenuhi syarat. Muat ulang data." };

  const { data: kode, error: kodeError } = await supabase.rpc("generate_vendor_consignment_rekonsil_kode");
  if (kodeError || !kode) return { error: kodeError?.message || "Gagal membuat kode rekonsil." };

  const { data: rk, error: rkError } = await supabase
    .from("vendor_consignment_rekonsil")
    .insert([
      {
        rk_kode: kode as string,
        rk_tanggal: data.rk_tanggal,
        cabang_id: data.cabang_id,
        vendor_id: data.vendor_id,
        periode_awal: data.periode_awal,
        periode_akhir: data.periode_akhir,
        pic_admin: data.pic_admin?.trim() || null,
        pic_pjo: data.pic_pjo?.trim() || null,
        catatan: data.catatan?.trim() || null,
        created_by: user.id,
      },
    ])
    .select()
    .single();
  if (rkError) return { error: rkError.message };

  const { error: itemsError } = await supabase.from("vendor_consignment_rekonsil_items").insert(
    chosen.map((c: any) => ({
      rekonsil_id: rk.id,
      spb_detail_id: c.spb_detail_id,
      spb_id: c.spb_id,
      spb_no: c.spb_no,
      spb_tanggal: c.spb_tanggal,
      part_id: c.part_id,
      part_number: c.part_number,
      part_name: c.part_name,
      satuan: c.satuan,
      qty: c.qty,
    })),
  );
  if (itemsError) {
    await supabase.from("vendor_consignment_rekonsil").delete().eq("id", rk.id);
    // UNIQUE spb_detail_id: rekonsil lain baru saja mengambil baris yang sama.
    return {
      error: itemsError.code === "23505"
        ? "Sebagian baris SPB baru saja direkonsil oleh dokumen lain. Muat ulang data."
        : itemsError.message,
    };
  }

  revalidatePath("/vendor-consignment/rekonsil");
  return { success: true, data: rk };
}

export async function getRekonsilList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_consignment_rekonsil")
    .select(
      "*, cabang(nama_cabang), vendors(vendor_name, vendor_no), pos(po_kode, po_status), vendor_consignment_rekonsil_items(id, qty)",
    )
    .order("rk_tanggal", { ascending: false })
    .order("id", { ascending: false })
    .limit(1000);
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

export async function getRekonsilDetail(id: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_consignment_rekonsil")
    .select(
      "*, cabang(nama_cabang), vendors(vendor_name, vendor_no, address, pic_name, contact_name, telephone), pos(id, po_kode, po_status, po_tanggal), vendor_consignment_rekonsil_items(*)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: "Rekonsil tidak ditemukan." };
  data.vendor_consignment_rekonsil_items = (data.vendor_consignment_rekonsil_items || []).sort(
    (a: any, b: any) =>
      String(a.spb_tanggal).localeCompare(String(b.spb_tanggal)) || a.spb_id - b.spb_id || a.id - b.id,
  );
  return { data, error: null as string | null };
}

/** BAST ditandatangani -> final, siap dibuatkan PO oleh purchasing. */
export async function finalizeRekonsil(id: number) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Session expired" };
  const { data, error } = await supabase
    .from("vendor_consignment_rekonsil")
    .update({ status: "final", finalized_at: new Date().toISOString(), finalized_by: user.id })
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Rekonsil sudah final atau tidak ditemukan." };
  revalidatePath("/vendor-consignment/rekonsil");
  return { success: true };
}

/** Kembalikan ke draft (koreksi feedback), selama belum ada PO. */
export async function reopenRekonsil(id: number) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Session expired" };
  const roles = await getRoleNames(supabase, user.id);
  if (!roles.some((r) => ["moderator", "admin", "purchasing"].includes(r)))
    return { error: "Hanya purchasing/moderator/admin yang dapat membuka kembali rekonsil." };
  const { data, error } = await supabase
    .from("vendor_consignment_rekonsil")
    .update({ status: "draft", finalized_at: null, finalized_by: null })
    .eq("id", id)
    .eq("status", "final")
    .is("po_id", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Rekonsil tidak bisa dibuka kembali (belum final atau sudah ada PO)." };
  revalidatePath("/vendor-consignment/rekonsil");
  return { success: true };
}

export async function deleteRekonsil(id: number) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Session expired" };
  const { data: rk } = await supabase
    .from("vendor_consignment_rekonsil")
    .select("id, status, po_id, created_by")
    .eq("id", id)
    .maybeSingle();
  if (!rk) return { error: "Rekonsil tidak ditemukan." };
  if (rk.po_id) return { error: "Rekonsil sudah punya PO. Hapus PO-nya dulu." };
  const roles = await getRoleNames(supabase, user.id);
  const isMod = roles.some((r) => r === "moderator" || r === "admin");
  if (!isMod && !(rk.status === "draft" && rk.created_by === user.id))
    return { error: "Hanya pembuat (selama draft) atau moderator/admin yang dapat menghapus rekonsil." };

  const { data, error } = await supabase
    .from("vendor_consignment_rekonsil")
    .delete()
    .eq("id", id)
    .is("po_id", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Rekonsil sudah punya PO atau sudah dihapus." };
  revalidatePath("/vendor-consignment/rekonsil");
  return { success: true };
}

/** Invoice & payment vendor atas PO Rekonsil (purchasing/finance). */
export async function updateRekonsilBilling(
  id: number,
  data: {
    invoice_no?: string | null;
    invoice_tanggal?: string | null;
    payment_status: "unpaid" | "paid";
    paid_at?: string | null;
  },
) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Session expired" };
  const roles = await getRoleNames(supabase, user.id);
  if (!roles.some((r) => ["purchasing", "finance", "moderator", "admin"].includes(r)))
    return { error: "Hanya purchasing/finance/moderator/admin yang dapat mengubah tagihan." };
  if (!["unpaid", "paid"].includes(data.payment_status)) return { error: "Status payment tidak valid." };

  const { data: rk } = await supabase
    .from("vendor_consignment_rekonsil")
    .select("id, po_id")
    .eq("id", id)
    .maybeSingle();
  if (!rk) return { error: "Rekonsil tidak ditemukan." };
  if (!rk.po_id) return { error: "Buat PO Rekonsil dulu sebelum mencatat invoice/payment." };

  const { error } = await supabase
    .from("vendor_consignment_rekonsil")
    .update({
      invoice_no: data.invoice_no?.trim() || null,
      invoice_tanggal: data.invoice_tanggal || null,
      payment_status: data.payment_status,
      paid_at: data.payment_status === "paid" ? data.paid_at || new Date().toISOString().slice(0, 10) : null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/vendor-consignment/rekonsil");
  return { success: true };
}

/**
 * Pratinjau PO Rekonsil: qty rekonsil per part dialokasikan FIFO ke item PR
 * Konsinyasi vendor yang sama. Server mengulang alokasi yang sama saat PO
 * benar-benar dibuat (createPurchaseOrder po_jenis 'konsinyasi').
 */
export async function getRekonsilPoPreview(id: number) {
  const supabase = await createClient();
  const detail = await getRekonsilDetail(id);
  if (detail.error || !detail.data) return { data: null, error: detail.error };
  const rk: any = detail.data;
  if (rk.status !== "final") return { data: null, error: "Rekonsil belum final (BAST belum ditandatangani)." };
  if (rk.po_id) return { data: null, error: `Rekonsil ini sudah punya PO ${rk.pos?.po_kode ?? ""}.` };

  const qtyByPart = await fetchRekonsilQtyByPart(supabase, id);
  const { lines, shortages } = await allocateFifoPrItems(supabase, rk.vendor_id, qtyByPart);
  const partInfo = new Map(
    (rk.vendor_consignment_rekonsil_items || []).map((i: any) => [i.part_id, i]),
  );
  return {
    data: {
      rekonsil: rk,
      lines,
      shortages: shortages.map((s) => ({
        ...s,
        part_number: (partInfo.get(s.part_id) as any)?.part_number ?? String(s.part_id),
      })),
    },
    error: null as string | null,
  };
}
