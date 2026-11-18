"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { fetchPrItemConvertedQty, isPrItemRejected } from "@/lib/pr-po-coverage";
import {
  applyPrCompletionStatus,
  applyPrConversionStatus,
  fetchPoItemPendingReceiveQty,
  syncPoReceiveAndCompletion,
} from "@/lib/procurement-status";
import {
  computeSoItemRemaining,
  fetchPoSoIds,
  fetchSoItemFulfillment,
  refreshSoStatuses,
} from "@/lib/so-reguler";
import { normalizePoCurrency } from "@/lib/po-currency";
import { PO_APPROVER_EDITABLE_STATUSES, isPoApprover } from "@/lib/po-item-status";
import { normalizeItemTax, normalizePoTaxMode } from "@/lib/po-tax";
import {
  PO_ITEM_SELECT,
  buildPoRevisionSnapshot,
  canRevisePO,
  diffPoRevision,
  flattenPoItems,
  summarizePoRevision,
} from "@/lib/po-revision";
import {
  createNotification,
  notifyApprovers,
} from "@/services/notification-actions";

export type PoRevisionItemInput = {
  // id po_items untuk item lama; null = item baru.
  po_item_id: number | null;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  harga: number;
  vendor_id: number | null;
  mr_id: number | null;
  pr_item_id: number | null;
  pr_id: number | null;
  so_item_id?: number | null;
  // Tarif pajak item (dipakai kalau po_tax_mode = 'item').
  item_ppn_rate?: number;
  item_pph_type?: string | null;
  item_pph_rate?: number;
};

export type PoRevisionPayload = {
  reason: string;
  po_kode: string;
  po_tanggal: string;
  po_estimasi?: string | null;
  po_payment_term?: string | null;
  po_keterangan?: string | null;
  po_currency?: "IDR" | "USD" | "AUD";
  po_tax_mode?: "document" | "item";
  po_harga_termasuk_pajak?: boolean;
  po_ppn_mode?: "percent" | "amount";
  po_ppn_rate?: number;
  po_ppn_amount?: number;
  po_diskon_mode?: "percent" | "amount";
  po_diskon_value?: number;
  po_ongkir?: number;
  po_pph_type?: string | null;
  po_pph_mode?: "percent" | "amount";
  po_pph_rate?: number;
  po_pph_amount?: number;
  po_pr_referensi?: string | null;
  approvals: any[];
  items: PoRevisionItemInput[];
  // "revisi" (default) = purchasing/moderator, approval diulang dari awal.
  // "approver" = approver PO mengedit sebelum ada RI, approval TIDAK diulang.
  mode?: "revisi" | "approver";
};

// Field header yang mengandung harga/pajak -- dikunci untuk edit approver
// yang tidak punya akses harga (nilai diambil dari DB, bukan payload).
const PRICE_HEADER_KEYS = [
  "po_currency",
  "po_tax_mode",
  "po_harga_termasuk_pajak",
  "po_ppn_mode",
  "po_ppn_rate",
  "po_ppn_amount",
  "po_diskon_mode",
  "po_diskon_value",
  "po_ongkir",
  "po_pph_type",
  "po_pph_mode",
  "po_pph_rate",
  "po_pph_amount",
] as const;

function itemTaxColumns(i: PoRevisionItemInput) {
  const t = normalizeItemTax({
    ppnRate: i.item_ppn_rate,
    pphType: i.item_pph_type,
    pphRate: i.item_pph_rate,
  });
  return { item_ppn_rate: t.ppnRate, item_pph_type: t.pphType, item_pph_rate: t.pphRate };
}

/**
 * Edit / Revisi PO oleh purchasing atau moderator. Semua input PO boleh
 * diubah (header, harga/pajak, vendor, item, tambah referensi PR baru); jenis
 * PO dan SO sumber tidak bisa diganti. Setelah disimpan, alur approval diulang
 * dari awal (approvals baru dari template yang dipilih, step pertama
 * ditandatangani editor), dan revisinya dicatat lengkap di po_revisions.
 *
 * Batasan untuk PO yang sudah ada penerimaan: item yang sudah diterima / sudah
 * dipakai RI, Job Costing, atau link PR tidak bisa dihapus, dan qty tidak boleh
 * di bawah qty yang sudah diterima.
 */
export async function revisePurchaseOrder(poId: number, payload: PoRevisionPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("id, nama, email, user_roles(roles(name))")
    .eq("id", user.id)
    .single();
  const roleNames: string[] = ((myProfile as any)?.user_roles || [])
    .map((ur: any) => (Array.isArray(ur.roles) ? ur.roles[0]?.name : ur.roles?.name))
    .filter(Boolean);
  const isApproverMode = payload.mode === "approver";
  const hasPriceAccess = canRevisePO(roleNames);
  if (!isApproverMode && !hasPriceAccess) {
    return { error: "Hanya purchasing atau moderator yang dapat mengedit PO." };
  }
  const editorRole = isApproverMode
    ? "approver"
    : roleNames.includes("purchasing")
      ? "purchasing"
      : "moderator";

  const reason = payload.reason?.trim();
  if (!reason) return { error: "Alasan revisi wajib diisi." };

  const { data: po } = await supabase.from("pos").select("*").eq("id", poId).single();
  if (!po) return { error: "PO tidak ditemukan." };
  if (po.po_status === "closed") {
    return {
      error:
        "PO sudah CLOSED (ada item yang dibatalkan), tidak bisa diedit lagi. Item yang masih aktif tetap bisa diterima lewat RI.",
    };
  }
  if (isApproverMode) {
    const access = await checkApproverEditAccess(supabase, po, user.id);
    if (access) return { error: access };
  }
  // Approver tanpa akses harga: harga, pajak, diskon & ongkir dikunci ke
  // nilai di DB (payload diabaikan) dan item baru tidak bisa ditambah.
  const priceLocked = isApproverMode && !hasPriceAccess;
  // PO rejected sudah membebaskan qty PR/SO-nya (bisa sudah di-PO ulang di PO
  // lain), jadi saat dihidupkan lagi lewat revisi, SELURUH qty item wajib
  // lolos cek sisa PR/SO -- tidak ada pengecualian "qty tidak dinaikkan".
  const wasRejected = po.po_status === "rejected";

  const poKode = payload.po_kode?.trim();
  if (!poKode) return { error: "Kode PO wajib diisi." };
  if (poKode !== po.po_kode) {
    const { data: dup } = await supabase
      .from("pos")
      .select("id")
      .eq("po_kode", poKode)
      .neq("id", poId)
      .maybeSingle();
    if (dup) return { error: "Kode PO sudah digunakan. Gunakan kode lain." };
  }
  if (!payload.po_tanggal) return { error: "Tanggal PO wajib diisi." };

  const items = payload.items || [];
  if (items.length === 0) return { error: "PO harus punya minimal 1 item." };

  const { data: currentRows } = await supabase
    .from("po_items")
    .select(PO_ITEM_SELECT)
    .eq("po_id", poId);
  const currentItems = flattenPoItems(currentRows || []);
  const currentById = new Map(currentItems.map((i: any) => [i.id, i]));

  if (priceLocked) {
    if (items.some((i) => !i.po_item_id)) {
      return {
        error:
          "Approver tanpa akses harga tidak bisa menambah item baru (harga wajib diisi). Minta purchasing untuk menambah item.",
      };
    }
    for (const i of items) {
      const cur: any = currentById.get(i.po_item_id as number);
      if (!cur) continue;
      i.harga = num(cur.harga);
      i.item_ppn_rate = num(cur.item_ppn_rate);
      i.item_pph_type = cur.item_pph_type || null;
      i.item_pph_rate = num(cur.item_pph_rate);
    }
    for (const k of PRICE_HEADER_KEYS) (payload as any)[k] = po[k];
  }

  // PO Outstanding (import ERP) boleh punya harga 0 apa adanya dari ERP.
  const hargaOk = (h: number) => (po.po_is_outstanding ? h >= 0 : h > 0);
  const incomplete = items.filter((i) => !i.vendor_id || !hargaOk(i.harga) || !(i.qty > 0));
  if (incomplete.length > 0) {
    return {
      error: `Vendor, qty, dan harga wajib diisi untuk semua item: ${incomplete
        .map((i) => i.part_number)
        .join(", ")}`,
    };
  }

  // Item lama: link (PR/SO/barang) diambil dari DB, yang bisa diubah cuma
  // qty, harga, vendor. Item baru: dari payload.
  for (const i of items) {
    if (i.po_item_id && !currentById.has(i.po_item_id)) {
      return { error: `Item ${i.part_number} bukan bagian dari PO ini.` };
    }
  }
  const keptIds = new Set(items.map((i) => i.po_item_id).filter(Boolean) as number[]);
  const removed = currentItems.filter((i: any) => !keptIds.has(i.id));
  const newItems = items.filter((i) => !i.po_item_id);

  const poJenis: string = po.po_jenis || "reguler";
  // PO Rekonsil Konsinyasi: item & qty terkunci ke hasil rekonsil (FIFO PR).
  if (poJenis === "konsinyasi") {
    return {
      error:
        "PO Rekonsil Konsinyasi tidak bisa direvisi. Hapus PO-nya (moderator) lalu buat ulang dari Rekonsil.",
    };
  }
  if (poJenis === "so") {
    if (newItems.some((i) => i.pr_item_id || i.mr_id || i.pr_id)) {
      return { error: "PO dari SO tidak boleh berisi item dari PR." };
    }
  } else if (newItems.some((i) => i.so_item_id)) {
    return { error: "Item SO hanya bisa diproses lewat PO jenis SO." };
  } else if (poJenis === "non_pr") {
    if (newItems.some((i) => i.pr_item_id || i.mr_id || i.pr_id)) {
      return {
        error:
          "PO Non-PR tidak boleh berisi item dari PR. Gunakan fitur Hubungkan ke PR di detail PO.",
      };
    }
    if (newItems.some((i) => !i.part_id)) {
      return { error: "Barang wajib dipilih untuk semua item." };
    }
  } else if (po.po_is_outstanding) {
    // PO Outstanding: item baru dari master barang, link ke PR lewat
    // "Hubungkan ke PR" di detail PO (services/po-outstanding-actions.ts).
    if (newItems.some((i) => i.pr_item_id || i.mr_id || i.pr_id)) {
      return {
        error:
          "Item baru PO Outstanding ditambah dari master barang. Hubungkan ke PR dari detail PO.",
      };
    }
    if (newItems.some((i) => !i.part_id)) {
      return { error: "Barang wajib dipilih untuk semua item." };
    }
  } else if (newItems.some((i) => !i.pr_item_id || !i.mr_id)) {
    return { error: "Item PO reguler wajib berasal dari PR." };
  }

  // Guard item yang dihapus: tidak boleh sudah diterima / dipakai dokumen lain.
  if (removed.length > 0) {
    const removedIds = removed.map((i: any) => i.id);
    const received = removed.find((i: any) => num(i.qty_received) > 0);
    if (received) {
      return {
        error: `Item ${received.part_number} sudah ada barang diterima (${received.qty_received}), tidak bisa dihapus.`,
      };
    }
    const [{ data: riRefs }, { data: jcRefs }, { data: linkRefs }] = await Promise.all([
      supabase.from("receive_items").select("po_item_id").in("po_item_id", removedIds).limit(1),
      supabase.from("job_costing_items").select("po_item_id").in("po_item_id", removedIds).limit(1),
      supabase.from("po_item_pr_links").select("po_item_id").in("po_item_id", removedIds).limit(1),
    ]);
    const blocker = (rows: any[] | null, what: string) => {
      const ref = rows?.[0];
      if (!ref) return null;
      const item = removed.find((i: any) => i.id === ref.po_item_id);
      return `Item ${item?.part_number ?? ""} sudah dipakai ${what}, tidak bisa dihapus.`;
    };
    const msg =
      blocker(riRefs, "dokumen Receive Item") ||
      blocker(jcRefs, "Job Costing") ||
      blocker(linkRefs, "link PR (Hubungkan ke PR) — hapus link-nya dulu");
    if (msg) return { error: msg };
  }

  // Guard qty item lama: tidak boleh di bawah qty yang sudah diterima +
  // qty di RI yang masih menunggu approval (kalau tidak, RI itu nanti
  // memposting penerimaan melebihi qty PO).
  if (items.some((i) => !Number.isInteger(Number(i.qty)))) {
    return { error: "Qty item harus bilangan bulat." };
  }
  const pendingRi = await fetchPoItemPendingReceiveQty(
    supabase,
    currentItems.map((i: any) => i.id),
  );
  for (const i of items) {
    if (!i.po_item_id) continue;
    const cur = currentById.get(i.po_item_id);
    const floor = num(cur.qty_received) + (pendingRi.get(i.po_item_id) || 0);
    if (i.qty < floor) {
      return {
        error: `Qty ${cur.part_number} tidak boleh di bawah qty yang sudah diterima + RI yang menunggu approval (${floor}).`,
      };
    }
  }

  // Guard sisa qty PR (tanpa menghitung PO ini sendiri). Item lama yang
  // qty-nya tidak dinaikkan tetap lolos walau datanya legacy melebihi sisa.
  const effPrItemId = (i: PoRevisionItemInput) =>
    i.po_item_id ? currentById.get(i.po_item_id)?.pr_item_id : i.pr_item_id;
  const allPrItemIds = items
    .map(effPrItemId)
    .filter((id): id is number => Boolean(id));
  const prItemIds = Array.from(new Set(allPrItemIds));
  if (prItemIds.length !== allPrItemIds.length) {
    return { error: "Item PR yang sama tidak boleh muncul dua kali di PO." };
  }
  if (prItemIds.length > 0) {
    const [{ data: prItemRows }, converted] = await Promise.all([
      supabase
        .from("pr_items")
        .select("id, qty, status, prs!inner(pr_status)")
        .in("id", prItemIds),
      fetchPrItemConvertedQty(supabase, prItemIds, { excludePoId: poId }),
    ]);
    const qtyMap = new Map((prItemRows || []).map((r: any) => [r.id, num(r.qty)]));
    const prItemRowById = new Map((prItemRows || []).map((r: any) => [r.id, r]));
    for (const i of items) {
      const prItemId = effPrItemId(i);
      if (!prItemId) continue;
      const pri: any = prItemRowById.get(prItemId);
      const isNewLink = !i.po_item_id || wasRejected;
      if (isNewLink && pri) {
        const prStatus = Array.isArray(pri.prs) ? pri.prs[0]?.pr_status : pri.prs?.pr_status;
        if (prStatus !== "approved") {
          return { error: `PR untuk item ${i.part_number} tidak berstatus approved (status: ${prStatus}).` };
        }
        if (isPrItemRejected(pri)) {
          return { error: `Item ${i.part_number} ditolak approver PR, tidak bisa di-PO.` };
        }
      }
      const remaining = Math.max(0, (qtyMap.get(prItemId) ?? 0) - (converted.get(prItemId) || 0));
      const original =
        i.po_item_id && !wasRejected ? num(currentById.get(i.po_item_id).qty) : 0;
      if (i.qty > remaining && i.qty > original) {
        return {
          error: `Qty ${i.part_number} melebihi sisa yang bisa dikonversi dari PR (sisa ${remaining}).`,
        };
      }
    }
  }

  // Guard sisa qty SO (tanpa menghitung PO ini sendiri). PO dari SO boleh
  // merujuk banyak SO (2026-11-18): item baru boleh dari SO mana pun yang
  // masih open/partial; item lama tetap terikat ke item SO-nya.
  let soIdsBefore: number[] = [];
  let soIdsAfter: number[] = [];
  if (poJenis === "so") {
    soIdsBefore = await fetchPoSoIds(supabase, poId);
    const effSoItemId = (i: PoRevisionItemInput): number | null => {
      const id = i.po_item_id ? currentById.get(i.po_item_id)?.so_item_id : i.so_item_id;
      return id ? Number(id) : null;
    };
    if (items.some((i) => !effSoItemId(i))) {
      return { error: "Semua item PO dari SO harus berasal dari item SO Reguler." };
    }
    const soItemIds = Array.from(new Set(items.map((i) => effSoItemId(i)!)));
    const { data: soItemRows } = await supabase
      .from("so_reguler_items")
      .select("id, qty, part_id, so_id, so_reguler(id, so_kode, so_status)")
      .in("id", soItemIds);
    const soItems = new Map<number, any>(
      (soItemRows || []).map((r: any) => [Number(r.id), r]),
    );
    const soOf = (r: any) => (Array.isArray(r?.so_reguler) ? r.so_reguler[0] : r?.so_reguler);
    for (const i of items) {
      const row = soItems.get(effSoItemId(i)!);
      const so = soOf(row);
      if (!row || !so) return { error: `Item SO untuk ${i.part_number} tidak ditemukan.` };
      if (!i.po_item_id) {
        if (so.so_status === "cancelled" || so.so_status === "completed") {
          return {
            error: `SO ${so.so_kode} sudah ${so.so_status === "cancelled" ? "dibatalkan" : "selesai"}, item ${i.part_number} tidak bisa ditambahkan.`,
          };
        }
        if (Number(row.part_id) !== Number(i.part_id)) {
          return { error: `Barang ${i.part_number} tidak sama dengan item SO ${so.so_kode}.` };
        }
      }
    }
    const fulfillment = await fetchSoItemFulfillment(supabase, soItemIds, {
      excludePoId: poId,
    });
    // Dijumlah per item SO (baris ganda tidak boleh lolos satu per satu).
    const totals = new Map<number, { qty: number; original: number; part: string }>();
    for (const i of items) {
      const id = effSoItemId(i)!;
      const t = totals.get(id) || { qty: 0, original: 0, part: i.part_number };
      t.qty += num(i.qty);
      t.original += i.po_item_id && !wasRejected ? num(currentById.get(i.po_item_id).qty) : 0;
      totals.set(id, t);
    }
    for (const [id, t] of totals) {
      const row = soItems.get(id);
      const { sisaPo } = computeSoItemRemaining(num(row.qty), fulfillment.get(id));
      if (t.qty > sisaPo && t.qty > t.original) {
        return {
          error: `Qty ${t.part} (SO ${soOf(row).so_kode}) melebihi sisa SO yang belum di-PO/DO (sisa ${sisaPo}).`,
        };
      }
    }
    // SO utama dipertahankan selama masih dipakai item; kalau tidak, SO
    // pertama yang tersisa.
    const used = new Set(Array.from(soItems.values()).map((r: any) => Number(soOf(r).id)));
    soIdsAfter = [
      ...(po.so_id && used.has(Number(po.so_id)) ? [Number(po.so_id)] : []),
      ...items
        .map((i) => Number(soOf(soItems.get(effSoItemId(i)!)).id))
        .filter((id) => id !== Number(po.so_id)),
    ].filter((id, idx, arr) => arr.indexOf(id) === idx);
  }

  // Revisi: approval diulang dari awal -- step pertama (editor) approved +
  // TTD, sisanya dipaksa pending supaya payload client tidak bisa melompati
  // approval. Edit approver: approval & status PO tetap seperti di DB.
  let approvals: any[];
  let newStatus: string;
  if (isApproverMode) {
    approvals = po.approvals || [];
    newStatus = po.po_status;
  } else {
    approvals = (payload.approvals || []).map((a: any, idx: number) =>
      idx === 0
        ? a
        : { ...a, status: "pending", processed_at: null, signature_url: null, notes: null, snapshot: null },
    );
    const allApproved = approvals.every((a: any) => a.status === "approved");
    newStatus = approvals.length === 0 || allApproved ? "approved" : "open";
  }

  const snapshotBefore = buildPoRevisionSnapshot(po, currentItems);

  // ---- Mutasi ----
  if (removed.length > 0) {
    const { error } = await supabase
      .from("po_items")
      .delete()
      .in("id", removed.map((i: any) => i.id))
      .eq("po_id", poId);
    if (error) return { error: `Gagal hapus item: ${error.message}` };
  }
  for (const i of items) {
    if (!i.po_item_id) continue;
    const cur = currentById.get(i.po_item_id);
    const tax = itemTaxColumns(i);
    if (
      num(cur.qty) === i.qty &&
      num(cur.harga) === i.harga &&
      cur.vendor_id === i.vendor_id &&
      num(cur.item_ppn_rate) === tax.item_ppn_rate &&
      (cur.item_pph_type || null) === tax.item_pph_type &&
      num(cur.item_pph_rate) === tax.item_pph_rate
    )
      continue;
    const { error } = await supabase
      .from("po_items")
      .update({ qty: i.qty, harga: i.harga, vendor_id: i.vendor_id, ...tax })
      .eq("id", i.po_item_id)
      .eq("po_id", poId);
    if (error) return { error: `Gagal update item ${i.part_number}: ${error.message}` };
  }
  if (newItems.length > 0) {
    const { error } = await supabase.from("po_items").insert(
      newItems.map((i) => ({
        po_id: poId,
        mr_id: i.mr_id ?? null,
        pr_item_id: i.pr_item_id ?? null,
        so_item_id: poJenis === "so" ? (i.so_item_id ?? null) : null,
        part_id: i.part_id,
        part_number: i.part_number,
        part_name: i.part_name,
        satuan: i.satuan,
        qty: i.qty,
        harga: i.harga,
        vendor_id: i.vendor_id,
        ...itemTaxColumns(i),
        qty_received: 0,
      })),
    );
    if (error) return { error: `Gagal tambah item: ${error.message}` };
  }

  const { data: afterRows } = await supabase
    .from("po_items")
    .select(PO_ITEM_SELECT)
    .eq("po_id", poId);
  const afterItems = flattenPoItems(afterRows || []);

  const allReceived = afterItems.every((i: any) => num(i.qty_received) >= num(i.qty));
  const someReceived = afterItems.some((i: any) => num(i.qty_received) > 0);
  const receiveStatus = allReceived ? "complete" : someReceived ? "partial" : "pending";

  // pr_id header = PR pertama (referensi tampilan lama), sama seperti create.
  const firstPrId =
    poJenis === "reguler"
      ? (afterItems.find((i: any) => i.pr_id)?.pr_id ??
        (po.po_is_outstanding ? null : po.pr_id))
      : po.pr_id;

  const nextRevision = num(po.po_revision) + 1;
  const headerPatch: Record<string, any> = {
    po_kode: poKode,
    pr_id: firstPrId,
    po_tanggal: payload.po_tanggal,
    po_estimasi: payload.po_estimasi || null,
    po_payment_term: payload.po_payment_term || null,
    po_keterangan: payload.po_keterangan || null,
    po_currency: normalizePoCurrency(payload.po_currency),
    po_tax_mode: normalizePoTaxMode(payload.po_tax_mode),
    po_harga_termasuk_pajak: payload.po_harga_termasuk_pajak ?? false,
    po_ppn_mode: payload.po_ppn_mode ?? "percent",
    po_ppn_rate: payload.po_ppn_rate ?? 0,
    po_ppn_amount: payload.po_ppn_amount ?? 0,
    po_diskon_mode: payload.po_diskon_mode ?? "percent",
    po_diskon_value: payload.po_diskon_value ?? 0,
    po_ongkir: payload.po_ongkir ?? 0,
    po_pph_type: payload.po_pph_type || null,
    po_pph_mode: payload.po_pph_mode ?? "percent",
    po_pph_rate: payload.po_pph_type ? (payload.po_pph_rate ?? 0) : 0,
    po_pph_amount: payload.po_pph_type ? (payload.po_pph_amount ?? 0) : 0,
    po_pr_referensi:
      poJenis === "non_pr" ? payload.po_pr_referensi?.trim() || null : po.po_pr_referensi,
    approvals,
    po_status: newStatus,
    po_receive_status: receiveStatus,
    po_revision: nextRevision,
    ...(poJenis === "so" && soIdsAfter.length > 0 ? { so_id: soIdsAfter[0] } : {}),
  };
  const { error: headerErr } = await supabase.from("pos").update(headerPatch).eq("id", poId);
  if (headerErr) return { error: headerErr.message };

  // Progres konversi PR (lama & baru) + status SO.
  const involvedPrIds = Array.from(
    new Set(
      [...currentItems, ...afterItems].map((i: any) => i.pr_id).filter(Boolean) as number[],
    ),
  );
  for (const prId of involvedPrIds) {
    await applyPrConversionStatus(supabase, prId);
  }
  // PO tanpa step approval tersisa langsung approved -> bisa langsung
  // completed kalau penerimaannya sudah penuh. PR sumber (yang mungkin
  // completed) dievaluasi ulang: qty PO yang naik / PO yang kembali open
  // berarti PR belum selesai.
  if (newStatus === "approved") await syncPoReceiveAndCompletion(supabase, poId);
  for (const prId of involvedPrIds) {
    await applyPrCompletionStatus(supabase, prId);
  }
  // SO yang dilepas dari PO juga disegarkan (qty-nya bebas lagi).
  if (poJenis === "so") await refreshSoStatuses(supabase, [...soIdsBefore, ...soIdsAfter]);

  // Riwayat.
  const snapshotAfter = buildPoRevisionSnapshot({ ...po, ...headerPatch }, afterItems);
  const changes = diffPoRevision(snapshotBefore, snapshotAfter);
  const summary = summarizePoRevision(changes);
  const editorName = myProfile?.nama || user.email || "User";
  const { error: logErr } = await supabase.from("po_revisions").insert({
    po_id: poId,
    revision_no: nextRevision,
    edited_by: user.id,
    edited_by_nama: editorName,
    edited_by_role: editorRole,
    reason,
    summary,
    changes,
    snapshot_before: snapshotBefore,
    snapshot_after: snapshotAfter,
    revision_kind: isApproverMode ? "edit_approver" : "revisi",
    approval_reset: !isApproverMode,
  });
  if (logErr) console.error("Gagal mencatat po_revisions:", logErr.message);

  if (isApproverMode) {
    // Approval tidak diulang: cukup kabari PIC + approver lain bahwa isi PO
    // berubah (bukan permintaan approval baru).
    const recipients = new Set<string>();
    if (po.po_pic_id) recipients.add(po.po_pic_id);
    for (const a of approvals) {
      const uid = a?.userid || a?.user_id;
      if (uid) recipients.add(uid);
    }
    recipients.delete(user.id);
    for (const uid of recipients) {
      createNotification({
        userId: uid,
        type: "general",
        title: `PO diedit approver (Rev. ${nextRevision})`,
        message: `PO ${poKode} diedit oleh ${editorName}: ${reason}. Perubahan: ${summary}. Approval tidak diulang.`,
        documentType: "PO",
        documentId: poId,
        documentUrl: `/po/${poId}`,
        metadata: { document_number: poKode, revision_no: nextRevision },
      }).catch(console.error);
    }
    revalidatePath("/po");
    revalidatePath(`/po/${poId}`);
    revalidatePath("/pr");
    if (poJenis === "so") revalidatePath("/so-reguler/so");
    return { success: true, revision: nextRevision };
  }

  // Notifikasi: approver yang pending + PIC PO (kalau bukan editornya sendiri).
  notifyApprovers(approvals, "PO", poId, poKode, `/po/${poId}`).catch(console.error);
  if (po.po_pic_id && po.po_pic_id !== user.id) {
    createNotification({
      userId: po.po_pic_id,
      type: "general",
      title: `PO direvisi (Rev. ${nextRevision})`,
      message: `PO ${poKode} direvisi oleh ${editorName}: ${reason}. Approval diulang dari awal.`,
      documentType: "PO",
      documentId: poId,
      documentUrl: `/po/${poId}`,
      metadata: { document_number: poKode, revision_no: nextRevision },
    }).catch(console.error);
  }

  revalidatePath("/po");
  revalidatePath(`/po/${poId}`);
  revalidatePath("/pr");
  if (poJenis === "so") revalidatePath("/so-reguler/so");
  return { success: true, revision: nextRevision };
}

export async function getPoRevisions(poId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("po_revisions")
    .select(
      "id, revision_no, edited_by, edited_by_nama, edited_by_role, reason, summary, changes, snapshot_before, revision_kind, approval_reset, created_at",
    )
    .eq("po_id", poId)
    .order("revision_no", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

function num(v: any) {
  return Number(v) || 0;
}

/**
 * Syarat edit PO oleh approver: user ada di jalur approval (bukan step
 * pertama/pembuat), PO masih open/approved, bukan PO Rekonsil Konsinyasi, dan
 * belum ada Receive Item (RI rejected tidak dihitung). Mengembalikan pesan
 * error atau null kalau boleh.
 */
async function checkApproverEditAccess(
  supabase: any,
  po: any,
  userId: string,
): Promise<string | null> {
  if (!isPoApprover(po.approvals, userId)) {
    return "Anda bukan approver PO ini.";
  }
  if (!(PO_APPROVER_EDITABLE_STATUSES as readonly string[]).includes(po.po_status)) {
    return `PO berstatus ${po.po_status}, tidak bisa diedit approver.`;
  }
  if (po.po_jenis === "konsinyasi") {
    return "PO Rekonsil Konsinyasi tidak bisa diedit.";
  }
  const { count } = await supabase
    .from("receives")
    .select("id", { count: "exact", head: true })
    .eq("po_id", po.id)
    .neq("ri_status", "rejected");
  if (count && count > 0) {
    return "PO sudah memiliki dokumen Receive Item, tidak bisa diedit approver lagi.";
  }
  return null;
}

/**
 * Hak edit PO untuk user yang login -- dipakai halaman detail (tombol Edit)
 * dan form edit (mode revisi vs mode approver).
 */
export async function getPoEditAccess(poId: number): Promise<{
  mode: "revisi" | "approver" | null;
  priceLocked: boolean;
  reason?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { mode: null, priceLocked: true, reason: "Session expired." };

  const [{ data: profile }, { data: po }] = await Promise.all([
    supabase.from("profiles").select("id, user_roles(roles(name))").eq("id", user.id).single(),
    supabase
      .from("pos")
      .select("id, po_status, po_jenis, approvals")
      .eq("id", poId)
      .maybeSingle(),
  ]);
  if (!po) return { mode: null, priceLocked: true, reason: "PO tidak ditemukan." };
  const roleNames: string[] = ((profile as any)?.user_roles || [])
    .map((ur: any) => (Array.isArray(ur.roles) ? ur.roles[0]?.name : ur.roles?.name))
    .filter(Boolean);
  const hasPriceAccess = canRevisePO(roleNames);

  if (po.po_status === "closed") {
    return {
      mode: null,
      priceLocked: !hasPriceAccess,
      reason: "PO sudah CLOSED (ada item yang dibatalkan), tidak bisa diedit lagi.",
    };
  }
  if (isPoApprover(po.approvals, user.id)) {
    const blocked = await checkApproverEditAccess(supabase, po, user.id);
    if (!blocked) return { mode: "approver", priceLocked: !hasPriceAccess };
    if (!hasPriceAccess) return { mode: null, priceLocked: true, reason: blocked };
  }
  if (hasPriceAccess) return { mode: "revisi", priceLocked: false };
  return {
    mode: null,
    priceLocked: true,
    reason: "Hanya approver PO, purchasing, atau moderator yang dapat mengedit PO.",
  };
}
