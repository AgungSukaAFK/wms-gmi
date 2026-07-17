"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { canViewPOPrice, maskPOPriceItems } from "@/lib/po-price-access";
import { toCompletedIfLegacy } from "@/lib/document-status";
import { canCreateMR } from "@/lib/mr-permissions";
import {
  notifyApprovers,
  notifyDocumentOwner,
  createNotification,
} from "@/services/notification-actions";
import { evaluateMrFreeze } from "@/services/freeze-actions";

// ============================================================
// PRIVATE HELPERS (server-side, uses authenticated server client)
// ============================================================

/**
 * Build approval flow from template — runs in server context using the
 * already-authenticated Supabase server client.
 */
async function _buildApprovalFlow(
  supabase: any,
  type: string,
  cabang_id: number,
  requesterId: string,
  templateId?: number,
): Promise<any[]> {
  let templateQuery = supabase
    .from("approval_templates")
    .select("id, cabang_id")
    .eq("type", type);

  if (templateId) {
    templateQuery = templateQuery.eq("id", templateId);
  } else {
    templateQuery = templateQuery
      .or(`cabang_id.eq.${cabang_id},cabang_id.is.null`)
      .order("cabang_id", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(1);
  }

  const { data: templateRows } = await templateQuery;
  const template = Array.isArray(templateRows) ? templateRows[0] : templateRows;

  if (!template) return [];

  if (
    template.cabang_id !== null &&
    typeof template.cabang_id === "number" &&
    template.cabang_id !== cabang_id
  ) {
    return [];
  }

  const { data: steps } = await supabase
    .from("approval_template_steps")
    .select("*, profiles(*)")
    .eq("template_id", template.id)
    .order("step_order");

  if (!steps || steps.length === 0) return [];

  let requesterProfile: any = null;
  if (steps.some((s: any) => s.approver_type === "requester")) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", requesterId)
      .single();
    requesterProfile = data;
  }

  return steps.map((step: any) => {
    const isRequester = step.approver_type === "requester";
    const profile = isRequester ? requesterProfile : step.profiles;
    return {
      type: isRequester
        ? "Requester"
        : profile?.nama || step.approver_type || "Approver",
      status: "pending",
      userid: profile?.id || "",
      nama: profile?.nama || "Unknown",
      email: profile?.email || "",
      level: step.step_order,
      // "menyetujui" | "mengetahui" — preserved from template step
      approval_role: isRequester ? "menyetujui" : (step.level ?? "menyetujui"),
      processed_at: null,
      notes: null,
      snapshot: null,
    };
  });
}

/**
 * Advance one approval step (approve or reject), capturing a snapshot of
 * the approver's profile. Pure in-memory — no Supabase calls.
 */
function _processStep(
  approvals: any[],
  userId: string,
  userProfile: any,
  action: "approved" | "rejected",
  notes?: string,
): any[] {
  const newApprovals = [...approvals];
  const idx = newApprovals.findIndex(
    (a) => a.userid === userId && a.status === "pending",
  );
  if (idx === -1) return newApprovals;
  newApprovals[idx] = {
    ...newApprovals[idx],
    status: action,
    processed_at: new Date().toISOString(),
    notes: notes || null,
    snapshot: {
      nama: userProfile?.nama || "",
      email: userProfile?.email || "",
      lokasi: userProfile?.cabang?.nama_cabang || "",
    },
  };
  return newApprovals;
}

/**
 * MATERIAL REQUEST (MR) SERVICES
 */
export async function createMaterialRequest(data: {
  mr_kode: string;
  cabang_id: number;
  mr_pic: string;
  mr_pic_id: string;
  mr_tanggal: string;
  mr_due_date?: string;
  mr_priority?: string;
  accurate?: boolean;
  approvals?: any[];
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_request: number;
    prioritas?: string;
    remarks?: string;
  }[];
}) {
  const supabase = await createClient();

  // Guard: hanya role yang diizinkan (lihat MR_CREATE_ROLES) yang boleh bikin MR.
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
  if (!mrKode) {
    return { error: "Kode MR wajib diisi manual." };
  }

  const { data: existingMr } = await supabase
    .from("mrs")
    .select("id")
    .eq("mr_kode", mrKode)
    .maybeSingle();

  if (existingMr) {
    return { error: "Kode MR sudah digunakan. Gunakan kode lain." };
  }

  // Guard batas maksimum stok: qty_request + stok saat ini tidak boleh
  // melebihi max_qty masing-masing PN di gudang tujuan (cabang requester).
  // Hanya berlaku untuk PN yang punya kebijakan max (max_qty > 0).
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
        if (maxQty <= 0) {
          violations.push(
            `${item.part_number}: belum ada kebijakan max stock di gudang ini, tidak bisa diminta`,
          );
        } else {
          violations.push(
            `${item.part_number}: maksimal ${allowedMax} (stok ${curQty}/${maxQty}), diminta ${item.qty_request}`,
          );
        }
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

  // 1. Insert MR Header
  const { data: mr, error: mrError } = await supabase
    .from("mrs")
    .insert([
      {
        mr_kode: mrKode,
        cabang_id: data.cabang_id,
        mr_pic: data.mr_pic,
        mr_pic_id: data.mr_pic_id,
        mr_tanggal: data.mr_tanggal,
        mr_due_date: data.mr_due_date ?? null,
        mr_priority: data.mr_priority ?? null,
        accurate: data.accurate ?? false,
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

  // 2. Insert MR Items
  const itemsToInsert = data.items.map((item) => ({
    mr_id: mr.id,
    ...item,
  }));

  const { error: itemsError } = await supabase
    .from("mr_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // Notify pending approvers
  if (mrApprovals.length > 0) {
    notifyApprovers(mrApprovals, "MR", mr.id, mr.mr_kode, `/mr/${mr.id}`).catch(
      console.error,
    );
  }

  revalidatePath("/mr");
  return { success: true, data: mr };
}

/**
 * CEK CONSTRAINT SAAT MENAMBAHKAN PN KE MR
 *
 * Dipakai oleh form create MR ketika user menambahkan sebuah PN.
 * Mengembalikan:
 *  1. duplicateMrCodes — daftar KODE MR aktif (belum closed & bukan rejected)
 *     di gudang tujuan yang sama yang sudah mengandung PN ini.
 *     Hanya kode yang dikembalikan (tanpa id) agar tidak memberi akses ke MR
 *     milik departemen lain.
 *  2. stock — batas maksimum qty yang boleh diminta untuk PN ini di gudang
 *     tujuan. allowedMax = max_qty - qty_saat_ini (minimal 0). Jika max_qty
 *     tidak dikonfigurasi (0) maka allowedMax = null (tanpa batas).
 */
export async function getMrItemConstraint(cabangId: number, partId: number) {
  const supabase = await createClient();

  // 1. Deteksi duplikat: MR aktif di cabang yang sama mengandung PN ini.
  const { data: dupRows } = await supabase
    .from("mr_items")
    .select("mrs!inner(mr_kode, mr_status, cabang_id)")
    .eq("part_id", partId)
    .eq("mrs.cabang_id", cabangId)
    .in("mrs.mr_status", ["open", "approved", "done"]);

  const duplicateMrCodes = Array.from(
    new Set(
      (dupRows || [])
        .map((r: any) => r.mrs?.mr_kode)
        .filter((k: any): k is string => Boolean(k)),
    ),
  );

  // 2. Batas maksimum qty (max stock - stock saat ini) di gudang tujuan.
  const { data: stockRow } = await supabase
    .from("stock")
    .select("qty, max_qty")
    .eq("part_id", partId)
    .eq("cabang_id", cabangId)
    .maybeSingle();

  const currentQty = stockRow?.qty ?? 0;
  const maxQty = stockRow?.max_qty ?? 0;
  const hasPolicy = maxQty > 0;
  // Jika max_qty belum dikonfigurasi (0) berarti belum ada kebijakan stok dari
  // atasan → PN tidak boleh diminta sama sekali (allowedMax = 0).
  const allowedMax = Math.max(0, maxQty - currentQty);

  return {
    duplicateMrCodes,
    stock: { currentQty, maxQty, allowedMax, hasPolicy },
  };
}

/**
 * APPROVE MATERIAL REQUEST
 */
export async function approveMR(
  mrId: number,
  signatureUrl: string,
  allocations?: any[],
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  // 1. Fetch current MR and its items
  const { data: mr, error: mrError } = await supabase
    .from("mrs")
    .select("*")
    .eq("id", mrId)
    .single();

  if (mrError || !mr) return { error: "MR not found" };

  // 2. Identify current pending approval step
  const approvals = [...mr.approvals];
  const currentStepIndex = approvals.findIndex((a) => a.status === "pending");

  if (currentStepIndex === -1) return { error: "No pending approval steps" };

  // Update current step
  approvals[currentStepIndex].status = "approved";
  approvals[currentStepIndex].signature_url = signatureUrl;
  approvals[currentStepIndex].processed_at = new Date().toISOString();

  // 3. Check if this is the last step
  const isLastStep = currentStepIndex === approvals.length - 1;
  let status = "open";

  if (isLastStep) {
    const mrDueDate = mr?.mr_due_date
      ? String(mr.mr_due_date).slice(0, 10)
      : null;

    status = "approved";

    // Process allocations if provided
    if (allocations && allocations.length > 0) {
      for (const alloc of allocations) {
        const allocationDeadline = alloc?.deadline
          ? String(alloc.deadline).slice(0, 10)
          : null;

        if (
          mrDueDate &&
          Number(alloc?.qty_sharestock_total || 0) > 0 &&
          allocationDeadline &&
          allocationDeadline > mrDueDate
        ) {
          return {
            error: `Deadline supply item ${alloc?.part_number || "-"} tidak boleh melewati due date MR (${mrDueDate}).`,
          };
        }

        // Gudang sumber tidak boleh sama dengan gudang tujuan MR ini.
        if (alloc.sharestocks && alloc.sharestocks.length > 0) {
          const sameWarehouse = alloc.sharestocks.find(
            (ss: any) => ss.source_cabang_id === mr.cabang_id,
          );
          if (sameWarehouse) {
            return {
              error: `Gudang sumber untuk item ${alloc?.part_number || "-"} tidak boleh sama dengan gudang tujuan MR.`,
            };
          }
        }

        // Create sharestock entries
        if (alloc.sharestocks && alloc.sharestocks.length > 0) {
          const sharestockEntries = alloc.sharestocks.map((ss: any) => ({
            mr_item_id: alloc.mr_item_id,
            source_cabang_id: ss.source_cabang_id,
            qty: ss.qty,
            // Deadline per item (diisi approver terakhir). Berlaku untuk semua
            // sumber alokasi item ini; dipakai mekanisme freeze MR.
            deadline: ss.deadline ?? alloc.deadline ?? null,
          }));
          await supabase
            .from("mr_sharestock_allocations")
            .insert(sharestockEntries);
        }

        // Update mr_items with qty_pr and qty_sharestock_total
        await supabase
          .from("mr_items")
          .update({
            qty_pr: alloc.qty_pr,
            qty_sharestock_total: alloc.qty_sharestock_total,
          })
          .eq("id", alloc.mr_item_id);
      }
    }
  }

  // 4. Update MR
  const { error: updateError } = await supabase
    .from("mrs")
    .update({
      approvals,
      mr_status: toCompletedIfLegacy(status) as any,
    })
    .eq("id", mrId);

  if (updateError) return { error: updateError.message };

  // Notify owner about approval progress
  notifyDocumentOwner(
    mr.mr_pic_id,
    isLastStep ? "document_completed" : "approved",
    "MR",
    mrId,
    mr.mr_kode,
    `/mr/${mrId}`,
    approvals[currentStepIndex].nama,
  ).catch(console.error);

  // If more steps remain, notify the next pending approver
  if (!isLastStep) {
    const remaining = approvals.filter((a: any) => a.status === "pending");
    notifyApprovers(remaining, "MR", mrId, mr.mr_kode, `/mr/${mrId}`).catch(
      console.error,
    );
  }

  revalidatePath("/mr");
  return { success: true };
}

/**
 * REJECT MATERIAL REQUEST
 */
export async function rejectMR(mrId: number, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: mr } = await supabase
    .from("mrs")
    .select("mr_kode, mr_pic_id, approvals")
    .eq("id", mrId)
    .single();
  if (!mr) return { error: "MR not found" };

  const approvals = [...mr.approvals];
  const currentStepIndex = approvals.findIndex((a) => a.status === "pending");

  if (currentStepIndex !== -1) {
    approvals[currentStepIndex].status = "rejected";
    approvals[currentStepIndex].processed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("mrs")
    .update({
      mr_status: "rejected",
      rejection_reason: reason,
      approvals,
    })
    .eq("id", mrId);

  if (error) return { error: error.message };

  // Notify document owner about rejection
  const rejecter = currentStepIndex !== -1 ? approvals[currentStepIndex] : null;
  notifyDocumentOwner(
    mr.mr_pic_id,
    "rejected",
    "MR",
    mrId,
    mr.mr_kode,
    `/mr/${mrId}`,
    rejecter?.nama,
    reason,
  ).catch(console.error);

  revalidatePath("/mr");
  return { success: true };
}

type MrEditPayload = {
  mr_tanggal?: string;
  mr_priority?: string;
  updatedItems?: { id: number; qty_request: number; remarks?: string }[];
  newItems?: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_request: number;
    remarks?: string;
  }[];
  deletedItemIds?: number[];
};

/**
 * Edit MR (header + items) by an approver whose level is "menyetujui".
 * After editing, approval resets from step index 1 (requester/step-0 stays).
 */
export async function editMrByApprover(mrId: number, payload: MrEditPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const { data: mr, error: mrError } = await supabase
    .from("mrs")
    .select("id, mr_kode, mr_pic_id, mr_status, approvals")
    .eq("id", mrId)
    .single();

  if (mrError || !mr) return { error: "MR tidak ditemukan." };
  if (mr.mr_status !== "open")
    return { error: "MR sudah tidak dalam status open." };

  const approvals: any[] = mr.approvals ?? [];
  // Handle both field schemas:
  // - MR create page  → user_id  + level ("menyetujui"/"mengetahui")
  // - _buildApprovalFlow → userid + approval_role
  const myStepIndex = approvals.findIndex(
    (a) =>
      (a.userid === user.id || a.user_id === user.id) && a.status === "pending",
  );

  if (myStepIndex === -1)
    return { error: "Bukan giliran Anda untuk approval MR ini." };

  // "mengetahui" tidak boleh edit — check both field names
  const myRole =
    approvals[myStepIndex].approval_role ??
    approvals[myStepIndex].level ??
    "menyetujui";
  if (myRole === "mengetahui")
    return { error: "Level 'Mengetahui' tidak dapat mengedit isi MR." };

  // 1. Update MR header fields (only fields explicitly provided)
  const headerPatch: Record<string, any> = {};
  if (payload.mr_tanggal !== undefined)
    headerPatch.mr_tanggal = payload.mr_tanggal;
  if (payload.mr_priority !== undefined)
    headerPatch.mr_priority = payload.mr_priority;

  if (Object.keys(headerPatch).length > 0) {
    const { error: headerErr } = await supabase
      .from("mrs")
      .update(headerPatch)
      .eq("id", mrId);
    if (headerErr)
      return { error: `Gagal update header MR: ${headerErr.message}` };
  }

  // 2. Delete removed items
  if (payload.deletedItemIds && payload.deletedItemIds.length > 0) {
    const { error: delErr } = await supabase
      .from("mr_items")
      .delete()
      .in("id", payload.deletedItemIds)
      .eq("mr_id", mrId);
    if (delErr) return { error: `Gagal hapus item: ${delErr.message}` };
  }

  // 3. Update qty + remarks existing items
  if (payload.updatedItems && payload.updatedItems.length > 0) {
    for (const item of payload.updatedItems) {
      const itemPatch: Record<string, any> = {
        qty_request: item.qty_request,
      };
      if (item.remarks !== undefined) itemPatch.remarks = item.remarks || null;
      const { error: itemErr } = await supabase
        .from("mr_items")
        .update(itemPatch)
        .eq("id", item.id)
        .eq("mr_id", mrId);
      if (itemErr) return { error: `Gagal update item: ${itemErr.message}` };
    }
  }

  // 4. Insert new items
  if (payload.newItems && payload.newItems.length > 0) {
    const toInsert = payload.newItems.map((i) => ({ ...i, mr_id: mrId }));
    const { error: insertErr } = await supabase
      .from("mr_items")
      .insert(toInsert);
    if (insertErr) return { error: `Gagal tambah item: ${insertErr.message}` };
  }

  // 5. Reset approvals dari index 1 ke atas (skip step-0 / requester / pembuat)
  const resetApprovals = approvals.map((a, idx) => {
    if (idx === 0) return a;
    return {
      ...a,
      status: "pending",
      processed_at: null,
      signature_url: null,
      notes: null,
      snapshot: null,
    };
  });

  const { error: updateErr } = await supabase
    .from("mrs")
    .update({ approvals: resetApprovals as any })
    .eq("id", mrId);

  if (updateErr) return { error: updateErr.message };

  // Notify next pending approver (step index 1)
  const nextPending = resetApprovals
    .slice(1)
    .filter((a) => a.status === "pending");
  notifyApprovers(nextPending, "MR", mrId, mr.mr_kode, `/mr/${mrId}`).catch(
    console.error,
  );

  revalidatePath("/mr");
  return { success: true };
}

/**
 * Recompute mrs.mr_convert_status from qty_pr vs qty actually converted into
 * non-rejected PRs. Mirrors the po_receive_status pattern (pending/partial/complete).
 */
async function _applyMrConversionStatus(mrId: number, supabase: any) {
  const { data: items } = await supabase
    .from("mr_items")
    .select("id, qty_pr")
    .eq("mr_id", mrId)
    .gt("qty_pr", 0);

  if (!items || items.length === 0) return;

  const itemIds = items.map((i: any) => i.id);
  const { data: prItemRows } = await supabase
    .from("pr_items")
    .select("mr_item_id, qty, prs!inner(pr_status)")
    .in("mr_item_id", itemIds);

  const convertedMap = new Map<number, number>();
  for (const row of prItemRows ?? []) {
    const prStatus = Array.isArray(row.prs) ? row.prs[0]?.pr_status : row.prs?.pr_status;
    if (prStatus === "rejected") continue;
    convertedMap.set(row.mr_item_id, (convertedMap.get(row.mr_item_id) || 0) + row.qty);
  }

  const totalQtyPr = items.reduce((s: number, i: any) => s + (i.qty_pr || 0), 0);
  const totalConverted = items.reduce(
    (s: number, i: any) =>
      s + Math.min(i.qty_pr || 0, convertedMap.get(i.id) || 0),
    0,
  );

  const status =
    totalConverted <= 0 ? "pending" : totalConverted < totalQtyPr ? "partial" : "complete";

  await supabase.from("mrs").update({ mr_convert_status: status }).eq("id", mrId);
}

/**
 * Recompute prs.pr_convert_status from pr_items.qty vs qty actually
 * converted into non-rejected POs.
 */
async function _applyPrConversionStatus(prId: number, supabase: any) {
  const { data: items } = await supabase
    .from("pr_items")
    .select("id, qty")
    .eq("pr_id", prId);

  if (!items || items.length === 0) return;

  const itemIds = items.map((i: any) => i.id);
  const { data: poItemRows } = await supabase
    .from("po_items")
    .select("pr_item_id, qty, pos!inner(po_status)")
    .in("pr_item_id", itemIds);

  const convertedMap = new Map<number, number>();
  for (const row of poItemRows ?? []) {
    const poStatus = Array.isArray(row.pos) ? row.pos[0]?.po_status : row.pos?.po_status;
    if (poStatus === "rejected") continue;
    convertedMap.set(row.pr_item_id, (convertedMap.get(row.pr_item_id) || 0) + row.qty);
  }

  const totalQty = items.reduce((s: number, i: any) => s + (i.qty || 0), 0);
  const totalConverted = items.reduce(
    (s: number, i: any) => s + Math.min(i.qty || 0, convertedMap.get(i.id) || 0),
    0,
  );

  const status =
    totalConverted <= 0 ? "pending" : totalConverted < totalQty ? "partial" : "complete";

  await supabase.from("prs").update({ pr_convert_status: status }).eq("id", prId);
}

/**
 * PURCHASE REQUEST (PR) SERVICES
 */
export async function createPurchaseRequest(data: {
  pr_kode: string;
  cabang_id: number;
  pr_pic_id: string;
  pr_tanggal: string;
  accurate?: boolean;
  approvals?: any[];
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty: number;
    mr_id: number;
    mr_item_id: number;
  }[];
}) {
  const supabase = await createClient();

  const prKode = data.pr_kode?.trim();
  if (!prKode) {
    return { error: "Kode PR wajib diisi manual." };
  }
  if (!data.items || data.items.length === 0) {
    return { error: "Tidak ada item untuk diproses ke PR." };
  }

  const sourceMrIds = Array.from(
    new Set(data.items.map((i) => i.mr_id).filter(Boolean)),
  );

  // Guard freeze: MR ter-freeze mengunci seluruh alur, termasuk pembuatan PR.
  for (const mrId of sourceMrIds) {
    if (await evaluateMrFreeze(mrId)) {
      return {
        error:
          "Salah satu MR referensi sedang di-FREEZE (lewat deadline share stock). Hubungi moderator untuk unfreeze/reset.",
      };
    }
  }

  const { data: existingPr } = await supabase
    .from("prs")
    .select("id")
    .eq("pr_kode", prKode)
    .maybeSingle();

  if (existingPr) {
    return { error: "Kode PR sudah digunakan. Gunakan kode lain." };
  }

  // Guard sisa qty: cegah konversi melebihi qty_pr yang belum terpakai
  // (race-condition guard; client sudah cap tapi tetap divalidasi di server).
  const mrItemIds = data.items.map((i) => i.mr_item_id).filter(Boolean);
  if (mrItemIds.length > 0) {
    const { data: mrItemRows } = await supabase
      .from("mr_items")
      .select("id, qty_pr")
      .in("id", mrItemIds);
    const { data: existingPrItems } = await supabase
      .from("pr_items")
      .select("mr_item_id, qty, prs!inner(pr_status)")
      .in("mr_item_id", mrItemIds);

    const qtyPrMap = new Map((mrItemRows ?? []).map((r: any) => [r.id, r.qty_pr]));
    const convertedMap = new Map<number, number>();
    for (const row of existingPrItems ?? []) {
      const prStatus = Array.isArray((row as any).prs)
        ? (row as any).prs[0]?.pr_status
        : (row as any).prs?.pr_status;
      if (prStatus === "rejected") continue;
      convertedMap.set(
        row.mr_item_id,
        (convertedMap.get(row.mr_item_id) || 0) + row.qty,
      );
    }

    for (const item of data.items) {
      const qtyPr = qtyPrMap.get(item.mr_item_id) ?? 0;
      const already = convertedMap.get(item.mr_item_id) || 0;
      const remaining = Math.max(0, qtyPr - already);
      if (item.qty > remaining) {
        return {
          error: `Qty ${item.part_number} melebihi sisa yang bisa dikonversi ke PR (sisa ${remaining}).`,
        };
      }
    }
  }

  const prApprovals = data.approvals ?? [];

  // Insert PR Header. mr_id diisi MR pertama sebagai referensi utama
  // (backward-compat display) — sumber kebenaran tetap pr_items.mr_item_id.
  const { data: pr, error: prError } = await supabase
    .from("prs")
    .insert([
      {
        pr_kode: prKode,
        mr_id: sourceMrIds[0] ?? null,
        cabang_id: data.cabang_id,
        pr_pic_id: data.pr_pic_id,
        pr_tanggal: data.pr_tanggal,
        accurate: data.accurate ?? false,
        pr_status:
          prApprovals.length === 0 ||
          prApprovals.every((a: any) => a.status !== "pending")
            ? "approved"
            : "open",
        approvals: prApprovals as any,
      },
    ])
    .select()
    .single();

  if (prError) return { error: prError.message };

  // Insert PR Items
  const itemsToInsert = data.items.map((item) => ({
    pr_id: pr.id,
    ...item,
  }));

  const { error: itemsError } = await supabase
    .from("pr_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // Recompute conversion progress for every source MR involved.
  await Promise.all(
    sourceMrIds.map((mrId) => _applyMrConversionStatus(mrId, supabase)),
  );

  // Notify pending PR approvers
  if (prApprovals.length > 0) {
    notifyApprovers(prApprovals, "PR", pr.id, pr.pr_kode, `/pr/${pr.id}`).catch(
      console.error,
    );
  }

  // Notify owner(s) of the source MR(s) that a PR was generated from their MR.
  if (sourceMrIds.length > 0) {
    const { data: sourceMrs } = await supabase
      .from("mrs")
      .select("id, mr_kode, mr_pic_id")
      .in("id", sourceMrIds);
    for (const srcMr of sourceMrs ?? []) {
      if (!srcMr.mr_pic_id) continue;
      createNotification({
        userId: srcMr.mr_pic_id,
        type: "general",
        title: "PR dibuat dari MR Anda",
        message: `PR ${pr.pr_kode} dibuat berdasarkan MR ${srcMr.mr_kode}.`,
        documentType: "PR",
        documentId: pr.id,
        documentUrl: `/pr/${pr.id}`,
        metadata: { document_number: pr.pr_kode, source_mr: srcMr.mr_kode },
      }).catch(console.error);
    }
  }

  revalidatePath("/pr");
  return { success: true, data: pr };
}

/**
 * UPDATE PR STATUS
 */
export async function updatePRStatus(prId: number, status: string) {
  const supabase = await createClient();
  const normalizedStatus = toCompletedIfLegacy(status);
  const { error } = await supabase
    .from("prs")
    .update({
      pr_status: normalizedStatus as any,
      updated_at: new Date().toISOString(),
    })
    .eq("id", prId);

  if (error) return { error: error.message };

  revalidatePath("/pr");
  return { success: true };
}

/**
 * UPDATE PR ITEM STATUS
 * Stock is NOT adjusted here. Stock additions happen via Receive Item (RI) from a PO.
 */
export async function updatePRItemStatus(itemId: number, status: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("pr_items")
    .update({
      status: status as any,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);

  if (error) return { error: error.message };

  revalidatePath("/pr");
  return { success: true };
}

/**
 * UPDATE MR ITEM SHARE STOCK STATUS
 * Stock movement for Share Stock is handled by Delivery transactions.
 */
export async function updateMRItemSSStatus(itemId: number, status: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("mr_items")
    .update({
      ss_status: status as any,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);

  if (error) return { error: error.message };

  revalidatePath("/share-stock");
  revalidatePath("/mr");
  return { success: true };
}

/**
 * PRIVATE HELPER: Adjust Stock for a given MR, Part and Quantity
 */
async function adjustItemStock(
  mrId: number,
  partId: number,
  partNumber: string | null,
  quantity: number,
  mode: "add" | "subtract",
  type: "PR" | "SS" | "RI",
  fromStatus: string,
  toStatus: string,
) {
  const supabase = await createClient();

  // A. Find the requesting branch from the MR
  const { data: mr } = await supabase
    .from("mrs")
    .select("cabang_id, mr_kode, cabang(nama_cabang)")
    .eq("id", mrId)
    .single();

  if (!mr) return { error: "MR tidak ditemukan saat update stok." };

  const branchId = mr.cabang_id;
  const mrCabang = Array.isArray(mr.cabang) ? mr.cabang[0] : mr.cabang;
  const mrLocationName = mrCabang?.nama_cabang || "Unknown Site";

  // Resolve canonical part_id using part_number when available.
  let canonicalPartId = partId;
  if (partNumber) {
    const { data: partByNumber } = await supabase
      .from("barang")
      .select("id")
      .eq("part_number", partNumber)
      .maybeSingle();

    if (partByNumber?.id) {
      canonicalPartId = partByNumber.id;
    }
  }
  const qtyChange = mode === "add" ? quantity : -quantity;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: partInfo } = await supabase
    .from("barang")
    .select("part_number, part_name, part_satuan")
    .eq("id", canonicalPartId)
    .maybeSingle();

  let actorLabel = "System";
  if (user?.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("nama")
      .eq("id", user.id)
      .maybeSingle();
    actorLabel = profile?.nama || user.email || user.id;
  }

  // B. Fetch Current Stock for Upsert/Update logic
  const { data: existingStock } = await supabase
    .from("stock")
    .select("qty")
    .eq("part_id", canonicalPartId)
    .eq("cabang_id", branchId)
    .maybeSingle();

  const qtyBefore = existingStock?.qty || 0;
  const qtyAfter = qtyBefore + qtyChange;

  if (mode === "subtract" && !existingStock) {
    return {
      error:
        "Riwayat gagal dicatat karena stok awal tidak ditemukan untuk pengurangan.",
    };
  }

  if (mode === "subtract" && qtyAfter < 0) {
    return {
      error:
        "Riwayat gagal dicatat karena pengurangan membuat stok menjadi negatif.",
    };
  }

  if (existingStock) {
    // Update existing
    const { error: updateStockError } = await supabase
      .from("stock")
      .update({
        qty: qtyAfter,
        updated_at: new Date().toISOString(),
      })
      .eq("part_id", canonicalPartId)
      .eq("cabang_id", branchId);

    if (updateStockError) {
      return { error: `Gagal update stok: ${updateStockError.message}` };
    }
  } else if (mode === "add") {
    // Initialize new stock record only if adding
    const { error: insertStockError } = await supabase.from("stock").insert({
      part_id: canonicalPartId,
      cabang_id: branchId,
      qty: quantity,
    });

    if (insertStockError) {
      return { error: `Gagal membuat stok baru: ${insertStockError.message}` };
    }
  }

  // C. Log Movement
  const movementNote = [
    `${mode === "add" ? "STOK DITAMBAH" : "STOK DIKURANGI"} via ${type}`,
    `Status: ${fromStatus} -> ${toStatus}`,
    `Part: ${partInfo?.part_number || partNumber || "N/A"} - ${partInfo?.part_name || "Unknown Part"}`,
    `Lokasi MR: ${mrLocationName}`,
    `Qty: ${qtyBefore} ${partInfo?.part_satuan || ""} -> ${qtyAfter} ${partInfo?.part_satuan || ""}`,
    `Ref: ${mr.mr_kode}`,
    `By: ${actorLabel}`,
  ].join(" | ");

  const { error: movementError } = await supabase
    .from("stock_movements")
    .insert({
      part_id: canonicalPartId,
      cabang_id: branchId,
      qty_change: qtyChange,
      type: type,
      reference_id: mr.mr_kode,
      created_by: user?.id,
      notes: movementNote,
    });

  if (movementError) {
    return {
      error: `Stok terupdate, tapi gagal simpan riwayat: ${movementError.message}`,
    };
  }

  return { success: true };
}

/**
 * RECEIVE (Goods Receipt) SERVICES
 */
export async function createReceive(data: {
  ri_kode: string;
  po_id: number;
  cabang_id: number;
  ri_pic: string;
  ri_pic_id?: string;
  ri_tanggal: string;
  ri_keterangan?: string;
  approval_template_id: number;
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty: number;
    po_id: number;
    mr_id: number;
    po_item_id?: number | null;
  }[];
}) {
  const supabase = await createClient();

  const riKode = data.ri_kode?.trim();
  if (!riKode) {
    return { error: "Kode Receive wajib diisi manual." };
  }

  const { data: existingRi } = await supabase
    .from("receives")
    .select("id")
    .eq("ri_kode", riKode)
    .maybeSingle();

  if (existingRi) {
    return { error: "Kode Receive sudah digunakan. Gunakan kode lain." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  if (!data.approval_template_id) {
    return { error: "Template approval wajib dipilih." };
  }

  const approvals = await _buildApprovalFlow(
    supabase,
    "Receive Item",
    data.cabang_id,
    user.id,
    data.approval_template_id,
  );

  if (!approvals.length) {
    return {
      error:
        "Template approval Receive Item tidak valid atau tidak tersedia untuk site ini.",
    };
  }

  // 1. Insert Receive Header
  const { data: ri, error: riError } = await supabase
    .from("receives")
    .insert([
      {
        ri_kode: riKode,
        po_id: data.po_id,
        cabang_id: data.cabang_id,
        ri_pic: data.ri_pic,
        ri_pic_id: data.ri_pic_id ?? null,
        ri_tanggal: data.ri_tanggal,
        ri_keterangan: data.ri_keterangan ?? null,
        approval_template_id: data.approval_template_id,
        approvals: approvals as any,
        ri_status: "open",
      },
    ])
    .select()
    .single();

  if (riError) return { error: riError.message };

  // 2. Insert Receive Items
  const itemsToInsert = data.items.map((item) => ({
    ri_id: ri.id,
    po_id: item.po_id,
    mr_id: item.mr_id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    qty: item.qty,
    po_item_id: item.po_item_id ?? null,
  }));

  const { error: itemsError } = await supabase
    .from("receive_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  notifyApprovers(approvals, "RI", ri.id, ri.ri_kode, `/receive`).catch(
    console.error,
  );

  // Stock posting happens after final approval step reaches completed.
  revalidatePath("/receive");
  revalidatePath("/po");
  return { success: true };
}

async function _applyReceiveCompletion(receiveId: number, supabase: any) {
  const { data: ri } = await supabase
    .from("receives")
    .select("id, po_id")
    .eq("id", receiveId)
    .single();

  if (!ri) {
    return { error: "Receive tidak ditemukan" };
  }

  const { data: receiveItems } = await supabase
    .from("receive_items")
    .select("po_id, mr_id, part_id, part_number, qty, po_item_id")
    .eq("ri_id", receiveId);

  if (!receiveItems || receiveItems.length === 0) {
    return { error: "Receive items tidak ditemukan" };
  }

  // Per-item: update po_items.qty_received + stock + mr_items.qty_received
  for (const item of receiveItems) {
    if (item.po_item_id) {
      const { data: poItem } = await supabase
        .from("po_items")
        .select("qty_received")
        .eq("id", item.po_item_id)
        .single();
      if (poItem) {
        await supabase
          .from("po_items")
          .update({ qty_received: poItem.qty_received + item.qty })
          .eq("id", item.po_item_id);
      }
    }

    await adjustItemStock(
      item.mr_id,
      item.part_id,
      item.part_number,
      item.qty,
      "add",
      "RI",
      "pending",
      "received",
    );

    const { data: mrItem } = await supabase
      .from("mr_items")
      .select("qty_request, qty_received")
      .eq("mr_id", item.mr_id)
      .eq("part_id", item.part_id)
      .maybeSingle();
    if (mrItem) {
      const newQtyReceived = Math.min(
        mrItem.qty_request,
        mrItem.qty_received + item.qty,
      );
      await supabase
        .from("mr_items")
        .update({ qty_received: newQtyReceived })
        .eq("mr_id", item.mr_id)
        .eq("part_id", item.part_id);
    }
  }

  const affectedMrIds = [...new Set(receiveItems.map((i: any) => i.mr_id))];
  for (const mrId of affectedMrIds) {
    const { data: mrItems } = await supabase
      .from("mr_items")
      .select("qty_request, qty_received")
      .eq("mr_id", mrId);
    if (mrItems) {
      const totalRequest = mrItems.reduce(
        (s: number, i: any) => s + i.qty_request,
        0,
      );
      const totalReceived = mrItems.reduce(
        (s: number, i: any) => s + i.qty_received,
        0,
      );
      const mrStatus =
        totalReceived <= 0
          ? "open"
          : totalReceived < totalRequest
            ? "approved"
            : "completed";
      await supabase
        .from("mrs")
        .update({ mr_status: mrStatus as any })
        .eq("id", mrId);
    }
  }

  const { data: allPoItems } = await supabase
    .from("po_items")
    .select("qty, qty_received")
    .eq("po_id", ri.po_id);

  if (allPoItems) {
    const allReceived = allPoItems.every((i: any) => i.qty_received >= i.qty);
    const someReceived = allPoItems.some((i: any) => i.qty_received > 0);
    const poReceiveStatus = allReceived
      ? "complete"
      : someReceived
        ? "partial"
        : "pending";

    const poUpdatePayload: Record<string, string> = {
      po_receive_status: poReceiveStatus,
    };

    if (poReceiveStatus === "complete") {
      poUpdatePayload.po_status = "completed";
    }

    await supabase.from("pos").update(poUpdatePayload).eq("id", ri.po_id);

    if (poReceiveStatus === "complete") {
      const { data: poHeader } = await supabase
        .from("pos")
        .select("pr_id")
        .eq("id", ri.po_id)
        .maybeSingle();

      if (poHeader?.pr_id) {
        await supabase
          .from("prs")
          .update({ pr_status: "completed" as any })
          .eq("id", poHeader.pr_id);
      }
    }
  }

  return { success: true };
}

export async function approveReceive(riId: number, signatureUrl: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  if (!signatureUrl?.trim()) {
    return { error: "Tanda tangan approval wajib dipilih." };
  }

  const { data: receive } = await supabase
    .from("receives")
    .select("id, approvals, ri_status, ri_kode, ri_pic_id")
    .eq("id", riId)
    .single();
  if (!receive) return { error: "Receive tidak ditemukan" };

  if (receive.ri_status === "completed") {
    return { error: "Receive sudah completed." };
  }
  if (receive.ri_status === "rejected") {
    return { error: "Receive sudah rejected dan tidak bisa di-approve." };
  }

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang)")
    .eq("id", user.id)
    .single();

  const updatedApprovals = _processStep(
    receive.approvals ?? [],
    user.id,
    userProfile,
    "approved",
  );

  const pendingIndex = updatedApprovals.findIndex(
    (a: any) =>
      a.userid === user.id && a.status === "approved" && !a.signature_url,
  );

  if (pendingIndex === -1) {
    return { error: "Anda tidak memiliki step approval aktif." };
  }

  updatedApprovals[pendingIndex].signature_url = signatureUrl;

  const isAllDone = updatedApprovals.every((a: any) => a.status !== "pending");

  if (isAllDone) {
    const completionResult = await _applyReceiveCompletion(riId, supabase);
    if ((completionResult as any)?.error) {
      return completionResult;
    }
  }

  const { error: updateError } = await supabase
    .from("receives")
    .update({
      approvals: updatedApprovals as any,
      ri_status: isAllDone ? "completed" : "open",
      rejection_reason: null,
      completed_at: isAllDone ? new Date().toISOString() : null,
    })
    .eq("id", riId);

  if (updateError) return { error: updateError.message };

  const justProcessed = updatedApprovals.find(
    (a: any) => a.userid === user.id && a.status === "approved",
  );
  if (receive.ri_pic_id) {
    notifyDocumentOwner(
      receive.ri_pic_id,
      isAllDone ? "document_completed" : "approved",
      "RI",
      riId,
      receive.ri_kode,
      `/receive`,
      justProcessed?.nama,
    ).catch(console.error);
  }
  if (!isAllDone) {
    const remaining = updatedApprovals.filter((a: any) => a.status === "pending");
    notifyApprovers(remaining, "RI", riId, receive.ri_kode, `/receive`).catch(
      console.error,
    );
  }

  revalidatePath("/receive");
  revalidatePath("/po");
  revalidatePath("/stock");
  revalidatePath("/mr");
  return { success: true, isAllDone };
}

export async function rejectReceive(
  riId: number,
  reason: string,
  signatureUrl: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  if (!reason?.trim()) {
    return { error: "Alasan penolakan wajib diisi." };
  }

  if (!signatureUrl?.trim()) {
    return { error: "Tanda tangan penolakan wajib dipilih." };
  }

  const { data: receive } = await supabase
    .from("receives")
    .select("id, approvals, ri_status, ri_kode, ri_pic_id")
    .eq("id", riId)
    .single();
  if (!receive) return { error: "Receive tidak ditemukan" };

  if (receive.ri_status === "completed") {
    return { error: "Receive sudah completed dan tidak bisa ditolak." };
  }

  if (receive.ri_status === "rejected") {
    return { error: "Receive sudah rejected." };
  }

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang)")
    .eq("id", user.id)
    .single();

  const updatedApprovals = _processStep(
    receive.approvals ?? [],
    user.id,
    userProfile,
    "rejected",
    reason.trim(),
  );

  const rejectedIndex = updatedApprovals.findIndex(
    (a: any) =>
      a.userid === user.id &&
      a.status === "rejected" &&
      a.notes === reason.trim() &&
      !a.signature_url,
  );

  if (rejectedIndex === -1) {
    return { error: "Anda tidak memiliki step approval aktif." };
  }

  updatedApprovals[rejectedIndex].signature_url = signatureUrl;

  const { error: updateError } = await supabase
    .from("receives")
    .update({
      approvals: updatedApprovals as any,
      ri_status: "rejected",
      rejection_reason: reason.trim(),
      completed_at: null,
    })
    .eq("id", riId);

  if (updateError) return { error: updateError.message };

  const rejecter = updatedApprovals.find(
    (a: any) => a.userid === user.id && a.status === "rejected",
  );
  if (receive.ri_pic_id) {
    notifyDocumentOwner(
      receive.ri_pic_id,
      "rejected",
      "RI",
      riId,
      receive.ri_kode,
      `/receive`,
      rejecter?.nama,
      reason,
    ).catch(console.error);
  }

  revalidatePath("/receive");
  revalidatePath("/po");
  return { success: true };
}

/**
 * UPDATE MR ACCURATE FLAG
 */
export async function updateMRAccurate(mrId: number, accurate: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("mrs")
    .update({ accurate })
    .eq("id", mrId);
  if (error) return { error: error.message };
  revalidatePath("/mr");
  return { success: true };
}

/**
 * UPDATE PR ACCURATE FLAG
 */
export async function updatePRAccurate(prId: number, accurate: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("prs")
    .update({ accurate })
    .eq("id", prId);
  if (error) return { error: error.message };
  revalidatePath("/pr");
  return { success: true };
}

/**
 * APPROVE PR STEP
 * itemDecisions: per-item approve/reject chosen by the approver.
 * On the final step, pr_items statuses are updated and pr_status becomes "approved".
 */
export async function approvePR(
  prId: number,
  itemDecisions: { itemId: number; status: "approved" | "rejected" }[],
  signatureUrl?: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: pr } = await supabase
    .from("prs")
    .select("approvals, pr_status, pr_kode, pr_pic_id")
    .eq("id", prId)
    .single();
  if (!pr) return { error: "PR tidak ditemukan" };

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang)")
    .eq("id", user.id)
    .single();

  let updatedApprovals = _processStep(
    pr.approvals ?? [],
    user.id,
    userProfile,
    "approved",
  );

  // Attach signature to the step we just processed
  if (signatureUrl) {
    const justProcessedIdx = updatedApprovals.findIndex(
      (a: any) =>
        a.userid === user.id && a.status === "approved" && !a.signature_url,
    );
    if (justProcessedIdx !== -1) {
      updatedApprovals[justProcessedIdx].signature_url = signatureUrl;
    }
  }

  const isLastStep = updatedApprovals.every((a: any) => a.status !== "pending");
  const newStatus = isLastStep ? "approved" : "open";

  // When it's the final approval step, apply per-item decisions
  if (isLastStep && itemDecisions.length > 0) {
    for (const decision of itemDecisions) {
      await supabase
        .from("pr_items")
        .update({ status: decision.status as any })
        .eq("id", decision.itemId);
    }
  }

  const { error } = await supabase
    .from("prs")
    .update({ approvals: updatedApprovals as any, pr_status: newStatus as any })
    .eq("id", prId);
  if (error) return { error: error.message };

  const justProcessed = updatedApprovals.find(
    (a: any) => a.userid === user.id && a.status === "approved",
  );
  notifyDocumentOwner(
    pr.pr_pic_id,
    isLastStep ? "document_completed" : "approved",
    "PR",
    prId,
    pr.pr_kode,
    `/pr/${prId}`,
    justProcessed?.nama,
  ).catch(console.error);

  if (!isLastStep) {
    const remaining = updatedApprovals.filter((a: any) => a.status === "pending");
    notifyApprovers(remaining, "PR", prId, pr.pr_kode, `/pr/${prId}`).catch(
      console.error,
    );
  }

  revalidatePath("/pr");
  return { success: true, isLastStep };
}

/**
 * REJECT PR STEP
 */
export async function rejectPR(prId: number, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: pr } = await supabase
    .from("prs")
    .select("approvals, pr_kode, pr_pic_id")
    .eq("id", prId)
    .single();
  if (!pr) return { error: "PR tidak ditemukan" };

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang)")
    .eq("id", user.id)
    .single();

  const updatedApprovals = _processStep(
    pr.approvals ?? [],
    user.id,
    userProfile,
    "rejected",
    reason,
  );

  const { error } = await supabase
    .from("prs")
    .update({
      approvals: updatedApprovals as any,
      pr_status: "rejected" as any,
    })
    .eq("id", prId);
  if (error) return { error: error.message };

  // Rejection frees up the converted qty on source MR(s) for reconversion.
  const { data: prItems } = await supabase
    .from("pr_items")
    .select("mr_id")
    .eq("pr_id", prId);
  const affectedMrIds = Array.from(
    new Set((prItems ?? []).map((i: any) => i.mr_id).filter(Boolean)),
  );
  await Promise.all(
    affectedMrIds.map((mrId) => _applyMrConversionStatus(mrId, supabase)),
  );

  const rejecter = updatedApprovals.find(
    (a: any) => a.userid === user.id && a.status === "rejected",
  );
  notifyDocumentOwner(
    pr.pr_pic_id,
    "rejected",
    "PR",
    prId,
    pr.pr_kode,
    `/pr/${prId}`,
    rejecter?.nama,
    reason,
  ).catch(console.error);

  revalidatePath("/pr");
  return { success: true };
}

// ============================================================

/**
 * CREATE PURCHASE ORDER
 * - 1 PO links to 1 PR
 * - Items can reference different vendors (sub-PO grouping is UI-level)
 * - Initialises approval flow from template
 */
export async function createPurchaseOrder(data: {
  po_kode: string;
  cabang_id: number;
  po_pic: string;
  po_pic_id: string;
  po_tanggal: string;
  po_estimasi?: string;
  po_payment_term?: string;
  po_keterangan?: string;
  approvals?: any[];
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty: number;
    harga: number;
    vendor_id: number | null;
    mr_id: number;
    pr_item_id: number;
    pr_id: number;
  }[];
}) {
  const supabase = await createClient();

  const poKode = data.po_kode?.trim();
  if (!poKode) {
    return { error: "Kode PO wajib diisi manual." };
  }
  if (!data.items || data.items.length === 0) {
    return { error: "Tidak ada item untuk diproses ke PO." };
  }

  const sourcePrIds = Array.from(
    new Set(data.items.map((i) => i.pr_id).filter(Boolean)),
  );

  const { data: existingPo } = await supabase
    .from("pos")
    .select("id")
    .eq("po_kode", poKode)
    .maybeSingle();

  if (existingPo) {
    return { error: "Kode PO sudah digunakan. Gunakan kode lain." };
  }

  // Defense in depth: non-Purchasing payload cannot persist price values.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let canViewPrice = false;
  if (user?.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, user_roles(roles(name,label))")
      .eq("id", user.id)
      .single();

    const normalizedProfile = profile
      ? {
          ...profile,
          user_roles: (profile.user_roles || []).map((ur: any) => ({
            ...ur,
            roles: Array.isArray(ur.roles) ? ur.roles[0] : ur.roles,
          })),
        }
      : null;

    canViewPrice = canViewPOPrice(normalizedProfile);
  }

  // Hanya user dengan akses harga yang boleh membuat PO baru — vendor & harga
  // wajib diisi lengkap untuk tiap item.
  if (!canViewPrice) {
    return {
      error:
        "Akses ditolak. Hanya user dengan akses harga yang bisa membuat PO.",
    };
  }
  const incompleteItems = data.items.filter(
    (item) => !item.vendor_id || !(item.harga > 0),
  );
  if (incompleteItems.length > 0) {
    return {
      error: `Vendor dan harga wajib diisi untuk semua item: ${incompleteItems
        .map((i) => i.part_number)
        .join(", ")}`,
    };
  }

  // Guard sisa qty: cegah konversi melebihi qty pr_items yang belum terpakai
  // (race-condition guard; client sudah cap tapi tetap divalidasi di server).
  const prItemIds = data.items.map((i) => i.pr_item_id).filter(Boolean);
  if (prItemIds.length > 0) {
    const { data: prItemRows } = await supabase
      .from("pr_items")
      .select("id, qty")
      .in("id", prItemIds);
    const { data: existingPoItems } = await supabase
      .from("po_items")
      .select("pr_item_id, qty, pos!inner(po_status)")
      .in("pr_item_id", prItemIds);

    const qtyMap = new Map((prItemRows ?? []).map((r: any) => [r.id, r.qty]));
    const convertedMap = new Map<number, number>();
    for (const row of existingPoItems ?? []) {
      const poStatus = Array.isArray((row as any).pos)
        ? (row as any).pos[0]?.po_status
        : (row as any).pos?.po_status;
      if (poStatus === "rejected") continue;
      convertedMap.set(
        row.pr_item_id,
        (convertedMap.get(row.pr_item_id) || 0) + row.qty,
      );
    }

    for (const item of data.items) {
      const qty = qtyMap.get(item.pr_item_id) ?? 0;
      const already = convertedMap.get(item.pr_item_id) || 0;
      const remaining = Math.max(0, qty - already);
      if (item.qty > remaining) {
        return {
          error: `Qty ${item.part_number} melebihi sisa yang bisa dikonversi ke PO (sisa ${remaining}).`,
        };
      }
    }
  }

  const normalizedItems = maskPOPriceItems(data.items, canViewPrice);

  // 1. Use provided approvals or fall back to auto-build
  const approvals =
    data.approvals ??
    (await _buildApprovalFlow(
      supabase,
      "Purchase Order",
      data.cabang_id,
      data.po_pic_id,
    ));

  // 2. Insert PO header. pr_id diisi PR pertama sebagai referensi utama
  // (backward-compat display) — sumber kebenaran tetap po_items.pr_item_id.
  const { data: po, error: poError } = await supabase
    .from("pos")
    .insert([
      {
        po_kode: poKode,
        pr_id: sourcePrIds[0] ?? null,
        po_pic: data.po_pic,
        po_pic_id: data.po_pic_id,
        po_tanggal: data.po_tanggal,
        po_estimasi: data.po_estimasi ?? null,
        po_payment_term: data.po_payment_term ?? null,
        po_keterangan: data.po_keterangan ?? null,
        po_status: approvals.length === 0 ? "approved" : "open",
        po_receive_status: "pending",
        approvals: approvals as any,
      },
    ])
    .select()
    .single();

  if (poError) return { error: poError.message };

  // 3. Insert PO items
  const itemsToInsert = normalizedItems.map((item) => ({
    po_id: po.id,
    mr_id: item.mr_id,
    pr_item_id: item.pr_item_id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    qty: item.qty,
    harga: item.harga,
    vendor_id: item.vendor_id,
    qty_received: 0,
  }));

  const { error: itemsError } = await supabase
    .from("po_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // Recompute conversion progress for every source PR involved.
  await Promise.all(
    sourcePrIds.map((prId) => _applyPrConversionStatus(prId, supabase)),
  );

  // Notify pending PO approvers
  if (approvals.length > 0) {
    notifyApprovers(approvals, "PO", po.id, po.po_kode, `/po/${po.id}`).catch(
      console.error,
    );
  }

  // Notify PIC of the source PR(s) that a PO was generated from them.
  if (sourcePrIds.length > 0) {
    const { data: sourcePrs } = await supabase
      .from("prs")
      .select("id, pr_kode, pr_pic_id")
      .in("id", sourcePrIds);
    for (const srcPr of sourcePrs ?? []) {
      if (!srcPr.pr_pic_id) continue;
      createNotification({
        userId: srcPr.pr_pic_id,
        type: "general",
        title: "PO dibuat dari PR Anda",
        message: `PO ${po.po_kode} dibuat berdasarkan PR ${srcPr.pr_kode}.`,
        documentType: "PO",
        documentId: po.id,
        documentUrl: `/po/${po.id}`,
        metadata: { document_number: po.po_kode, source_pr: srcPr.pr_kode },
      }).catch(console.error);
    }
  }

  revalidatePath("/po");
  revalidatePath("/pr");
  return { success: true, data: po };
}

/**
 * APPROVE PO STEP
 */
export async function approvePO(poId: number, signatureUrl?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: po, error: fetchErr } = await supabase
    .from("pos")
    .select("approvals, po_status, po_kode, po_pic_id")
    .eq("id", poId)
    .single();
  if (fetchErr || !po) return { error: "PO tidak ditemukan" };

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang), user_roles(roles(name,label))")
    .eq("id", user.id)
    .single();

  let updatedApprovals = _processStep(
    po.approvals ?? [],
    user.id,
    userProfile,
    "approved",
  );

  if (signatureUrl) {
    const pendingIndex = updatedApprovals.findIndex(
      (a: any) =>
        a.userid === user.id && a.status === "approved" && !a.signature_url,
    );
    if (pendingIndex !== -1) {
      updatedApprovals[pendingIndex].signature_url = signatureUrl;
    }
  }

  const isAllDone = updatedApprovals.every((a: any) => a.status !== "pending");
  const newStatus = isAllDone ? "approved" : "open";

  const { error } = await supabase
    .from("pos")
    .update({ approvals: updatedApprovals as any, po_status: newStatus as any })
    .eq("id", poId);

  if (error) return { error: error.message };

  const justProcessed = updatedApprovals.find(
    (a: any) => a.userid === user.id && a.status === "approved",
  );
  if (po.po_pic_id) {
    notifyDocumentOwner(
      po.po_pic_id,
      isAllDone ? "document_completed" : "approved",
      "PO",
      poId,
      po.po_kode,
      `/po/${poId}`,
      justProcessed?.nama,
    ).catch(console.error);
  }

  if (!isAllDone) {
    const remaining = updatedApprovals.filter((a: any) => a.status === "pending");
    notifyApprovers(remaining, "PO", poId, po.po_kode, `/po/${poId}`).catch(
      console.error,
    );
  }

  revalidatePath("/po");
  return { success: true, isAllDone };
}

/**
 * REJECT PO STEP
 */
export async function rejectPO(poId: number, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: po } = await supabase
    .from("pos")
    .select("approvals, po_kode, po_pic_id")
    .eq("id", poId)
    .single();
  if (!po) return { error: "PO tidak ditemukan" };

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang), user_roles(roles(name,label))")
    .eq("id", user.id)
    .single();

  const updatedApprovals = _processStep(
    po.approvals ?? [],
    user.id,
    userProfile,
    "rejected",
    reason,
  );

  const { error } = await supabase
    .from("pos")
    .update({
      approvals: updatedApprovals as any,
      po_status: "rejected" as any,
    })
    .eq("id", poId);

  if (error) return { error: error.message };

  // Rejection frees up the converted qty on source PR(s) for reconversion.
  const { data: poItems } = await supabase
    .from("po_items")
    .select("pr_item_id")
    .eq("po_id", poId);
  const poPrItemIds = (poItems ?? []).map((i: any) => i.pr_item_id).filter(Boolean);
  if (poPrItemIds.length > 0) {
    const { data: prItemRows } = await supabase
      .from("pr_items")
      .select("pr_id")
      .in("id", poPrItemIds);
    const affectedPrIds = Array.from(
      new Set((prItemRows ?? []).map((r: any) => r.pr_id).filter(Boolean)),
    );
    await Promise.all(
      affectedPrIds.map((prId) => _applyPrConversionStatus(prId, supabase)),
    );
  }

  const rejecter = updatedApprovals.find(
    (a: any) => a.userid === user.id && a.status === "rejected",
  );
  if (po.po_pic_id) {
    notifyDocumentOwner(
      po.po_pic_id,
      "rejected",
      "PO",
      poId,
      po.po_kode,
      `/po/${poId}`,
      rejecter?.nama,
      reason,
    ).catch(console.error);
  }

  revalidatePath("/po");
  return { success: true };
}

/**
 * UPDATE PO DETAIL STATUS (sub-status text + estimasi + keterangan)
 */
export async function updatePODetailStatus(
  poId: number,
  payload: {
    po_detail_status?: string;
    po_keterangan?: string;
    po_estimasi?: string;
  },
) {
  const supabase = await createClient();
  const { error } = await supabase.from("pos").update(payload).eq("id", poId);
  if (error) return { error: error.message };
  revalidatePath("/po");
  return { success: true };
}

/**
 * DELETE PO (only if still open/pending)
 */
export async function deletePO(poId: number) {
  const supabase = await createClient();
  const { data: po } = await supabase
    .from("pos")
    .select("po_status, po_receive_status")
    .eq("id", poId)
    .single();
  if (!po) return { error: "PO tidak ditemukan" };
  if (po.po_receive_status !== "pending") {
    return {
      error: "PO tidak bisa dihapus karena sudah ada penerimaan barang",
    };
  }
  const { error } = await supabase.from("pos").delete().eq("id", poId);
  if (error) return { error: error.message };
  revalidatePath("/po");
  return { success: true };
}

/**
 * DELETE MR — hanya boleh jika belum ada PR atau Delivery/Share Stock yang dibuat.
 */
export async function deleteMR(mrId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const { count: prCount } = await supabase
    .from("pr_items")
    .select("id", { count: "exact", head: true })
    .eq("mr_id", mrId);
  if (prCount && prCount > 0)
    return { error: "MR sudah memiliki PR, tidak dapat dihapus." };

  // Cek via deliveries.mr_id (delivery baru sudah pakai ini)
  const { count: dlvCount } = await supabase
    .from("deliveries")
    .select("id", { count: "exact", head: true })
    .eq("mr_id", mrId);
  if (dlvCount && dlvCount > 0)
    return {
      error: "MR sudah memiliki Delivery/Share Stock, tidak dapat dihapus.",
    };

  // Cek via delivery_items → mr_items (untuk data lama yang mr_id-nya NULL)
  const { data: mrItemRows } = await supabase
    .from("mr_items")
    .select("id")
    .eq("mr_id", mrId);
  const mrItemIds = (mrItemRows || []).map((r: any) => r.id);
  if (mrItemIds.length > 0) {
    const { count: dlvItemCount } = await supabase
      .from("delivery_items")
      .select("id", { count: "exact", head: true })
      .in("mr_item_id", mrItemIds);
    if (dlvItemCount && dlvItemCount > 0)
      return {
        error: "MR sudah memiliki Delivery/Share Stock, tidak dapat dihapus.",
      };
  }

  await supabase.from("mr_items").delete().eq("mr_id", mrId);

  const { error } = await supabase.from("mrs").delete().eq("id", mrId);
  if (error) return { error: `Gagal hapus MR: ${error.message}` };

  revalidatePath("/mr");
  return { success: true };
}
