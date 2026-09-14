"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { canCreateMR } from "@/lib/mr-permissions";
import { notifyApprovers } from "@/services/notification-actions";
import { businessToday } from "@/lib/business-date";

// ============================================================
// SCHEDULED MR — MR untuk perencanaan kebutuhan sampai 3 bulan ke depan,
// item bisa sangat banyak. Beda dengan MR biasa:
//   - Setiap item punya due date/priority/site sendiri (bukan cuma level
//     dokumen).
//   - Alokasi PR vs Share Stock per item diputuskan REQUESTER saat input
//     ini (bukan approver terakhir seperti MR biasa) — supaya approver
//     tidak harus mengisi form alokasi untuk ratusan item satu-satu.
//   - Freeze dievaluasi PER ITEM (lihat services/freeze-actions.ts:
//     evaluateMrItemFreeze/evaluateMrItemFreezeForMr), bukan per dokumen.
//
// TETAP memakai tabel mrs/mr_items/mr_sharestock_allocations yang sama
// dengan MR biasa (dibedakan lewat mrs.mr_type='scheduled') supaya PR/PO/
// Share Stock yang sudah keyed by mr_item_id otomatis mendukung tanpa
// perubahan skema. Approve/reject dokumen tetap pakai approveMR/rejectMR
// dari services/procurement-actions.ts — tidak difork.
// ============================================================

export type ScheduledMrItemInput = {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_request: number;
  item_due_date: string; // wajib — dasar freeze & deadline share stock
  item_priority?: string;
  item_site_cabang_id?: number | null;
  remarks?: string;
  qty_pr: number;
  qty_sharestock_total: number;
  sharestocks?: { source_cabang_id: number; qty: number }[];
};

export async function createScheduledMaterialRequest(data: {
  mr_kode: string;
  cabang_id: number;
  mr_pic: string;
  mr_pic_id: string;
  mr_tanggal: string;
  approvals?: any[];
  items: ScheduledMrItemInput[];
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const { data: callerRoles } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  const roleNames = (callerRoles ?? [])
    .map((r: any) => r.roles?.name)
    .filter(Boolean);
  if (!canCreateMR(roleNames)) {
    return { error: "Akses ditolak. Role Anda tidak diizinkan membuat MR." };
  }

  const mrKode = data.mr_kode?.trim();
  if (!mrKode) return { error: "Kode MR wajib diisi manual." };
  if (!data.items || data.items.length === 0)
    return { error: "Daftar item tidak boleh kosong." };

  const { data: existingMr } = await supabase
    .from("mrs")
    .select("id")
    .eq("mr_kode", mrKode)
    .maybeSingle();
  if (existingMr) return { error: "Kode MR sudah digunakan. Gunakan kode lain." };

  // Bulan pembuatan (bukan mr_tanggal yang bisa diedit user — supaya aturan
  // ini tidak bisa dielakkan dengan mundurin tanggal input) — Scheduled MR
  // khusus perencanaan ke depan, jadi item untuk bulan berjalan harus lewat
  // MR biasa.
  const currentMonth = businessToday().slice(0, 7); // YYYY-MM

  // Validasi per item: due date wajib & tidak boleh di bulan berjalan, split
  // PR/Share-Stock harus konsisten dengan qty_request, gudang sumber share
  // stock tidak boleh = gudang MR.
  for (const item of data.items) {
    if (!item.item_due_date) {
      return { error: `${item.part_number}: due date item wajib diisi.` };
    }
    if (item.item_due_date.slice(0, 7) === currentMonth) {
      return {
        error: `${item.part_number}: due date tidak boleh di bulan yang sama dengan bulan pembuatan Scheduled MR ini (${currentMonth}). Scheduled MR khusus perencanaan bulan depan atau lebih — kalau kebutuhannya untuk bulan ini, gunakan MR biasa.`,
      };
    }
    const qtyPr = Number(item.qty_pr || 0);
    const qtySs = Number(item.qty_sharestock_total || 0);
    if (qtyPr + qtySs !== Number(item.qty_request)) {
      return {
        error: `${item.part_number}: total alokasi PR (${qtyPr}) + Share Stock (${qtySs}) harus sama dengan qty diminta (${item.qty_request}).`,
      };
    }
    if (qtySs > 0) {
      const sumSs = (item.sharestocks || []).reduce(
        (s, ss) => s + Number(ss.qty || 0),
        0,
      );
      if (sumSs !== qtySs) {
        return {
          error: `${item.part_number}: total baris alokasi Share Stock (${sumSs}) tidak konsisten dengan qty_sharestock_total (${qtySs}).`,
        };
      }
      const sameWarehouse = (item.sharestocks || []).find(
        (ss) => ss.source_cabang_id === data.cabang_id,
      );
      if (sameWarehouse) {
        return {
          error: `${item.part_number}: gudang sumber share stock tidak boleh sama dengan gudang tujuan MR.`,
        };
      }
    }
  }

  // Guard batas maksimum stok (sama seperti createMaterialRequest): qty_request
  // + stok saat ini tidak boleh melebihi max_qty PN di gudang tujuan.
  const partIds = data.items.map((i) => i.part_id);
  if (partIds.length > 0) {
    const { data: stockRows } = await supabase
      .from("stock")
      .select("part_id, qty, max_qty")
      .eq("cabang_id", data.cabang_id)
      .in("part_id", partIds);
    const stockMap = new Map((stockRows || []).map((s: any) => [s.part_id, s]));

    const violations: string[] = [];
    for (const item of data.items) {
      const s: any = stockMap.get(item.part_id);
      const maxQty = s?.max_qty ?? 0;
      const curQty = s?.qty ?? 0;
      const allowedMax = Math.max(0, maxQty - curQty);
      if (item.qty_request > allowedMax) {
        violations.push(
          maxQty <= 0
            ? `${item.part_number}: belum ada kebijakan max stock di gudang ini, tidak bisa diminta`
            : `${item.part_number}: maksimal ${allowedMax} (stok ${curQty}/${maxQty}), diminta ${item.qty_request}`,
        );
      }
    }
    if (violations.length > 0) {
      return {
        error:
          "Qty melebihi batas maksimum stok gudang:\n" + violations.join("\n"),
      };
    }
  }

  const mrApprovals = data.approvals ?? [];
  // mr_due_date scheduled MR = due date item paling akhir (informasional /
  // tampilan ringkas saja — freeze tidak pakai field ini untuk tipe ini).
  const mrDueDate = data.items
    .map((i) => i.item_due_date)
    .sort()
    .pop()!;

  const { data: mr, error: mrError } = await supabase
    .from("mrs")
    .insert([
      {
        mr_kode: mrKode,
        mr_type: "scheduled",
        cabang_id: data.cabang_id,
        mr_pic: data.mr_pic,
        mr_pic_id: data.mr_pic_id,
        mr_tanggal: data.mr_tanggal,
        mr_due_date: mrDueDate,
        mr_status:
          mrApprovals.length === 0 ||
          mrApprovals.every((a: any) => a.status !== "pending")
            ? "approved"
            : "open",
        approvals: mrApprovals as any,
      },
    ])
    .select()
    .single();
  if (mrError) return { error: mrError.message };

  const itemsToInsert = data.items.map((item) => ({
    mr_id: mr.id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    qty_request: item.qty_request,
    qty_pr: item.qty_pr,
    qty_sharestock_total: item.qty_sharestock_total,
    item_due_date: item.item_due_date,
    item_priority: item.item_priority || null,
    item_site_cabang_id: item.item_site_cabang_id || null,
    remarks: item.remarks || null,
  }));

  const { data: insertedItems, error: itemsError } = await supabase
    .from("mr_items")
    .insert(itemsToInsert)
    .select("id");
  if (itemsError) return { error: itemsError.message };

  // Insert alokasi share stock per item (deadline = due date item itu sendiri).
  const allocationRows: {
    mr_item_id: number;
    source_cabang_id: number;
    qty: number;
    deadline: string;
  }[] = [];
  data.items.forEach((item, idx) => {
    const insertedId = insertedItems?.[idx]?.id;
    if (!insertedId || !item.qty_sharestock_total) return;
    for (const ss of item.sharestocks || []) {
      allocationRows.push({
        mr_item_id: insertedId,
        source_cabang_id: ss.source_cabang_id,
        qty: ss.qty,
        deadline: item.item_due_date,
      });
    }
  });
  if (allocationRows.length > 0) {
    const { error: allocError } = await supabase
      .from("mr_sharestock_allocations")
      .insert(allocationRows);
    if (allocError) return { error: allocError.message };
  }

  if (mrApprovals.length > 0) {
    notifyApprovers(
      mrApprovals,
      "MR",
      mr.id,
      mr.mr_kode,
      `/mr/scheduled/${mr.id}`,
    ).catch(console.error);
  }

  revalidatePath("/mr/scheduled");
  return { success: true, data: mr };
}

/**
 * Daftar Scheduled MR (list page).
 */
export async function getScheduledMaterialRequests() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mrs")
    .select(
      "id, mr_kode, mr_tanggal, mr_due_date, mr_status, mr_pic, cabang(nama_cabang), mr_items(id, item_due_date, item_priority, is_item_frozen)",
    )
    .eq("mr_type", "scheduled")
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}
