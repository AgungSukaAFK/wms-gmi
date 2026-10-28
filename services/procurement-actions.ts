"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { canViewPOPrice, maskPOPriceItems } from "@/lib/po-price-access";
import { toCompletedIfLegacy } from "@/lib/document-status";
import { canCreateMR } from "@/lib/mr-permissions";
import { fetchPrItemConvertedQty, isPrItemRejected } from "@/lib/pr-po-coverage";
import { prepareConsignmentPoItems } from "@/lib/vendor-consignment";
import {
  applyMrConversionStatus,
  applyPrCompletionStatus,
  applyPrConversionStatus,
  fetchMrItemPrConvertedQty,
  fetchPoItemPendingReceiveQty,
  fetchPoSourcePrIds,
  syncPoReceiveAndCompletion,
} from "@/lib/procurement-status";
import { applyReceiveCompletion } from "@/lib/receive-posting";
import {
  NON_PR_RECEIVE_CABANG_MISSING_MESSAGE,
  resolveNonPrReceiveCabang,
} from "@/lib/po-non-pr";
import {
  notifyApprovers,
  notifyDocumentOwner,
  createNotification,
} from "@/services/notification-actions";
import { evaluateMrFreeze, evaluateMrItemFreeze } from "@/services/freeze-actions";
import { normalizePoCurrency } from "@/lib/po-currency";
import { normalizeItemTax, normalizePoTaxMode } from "@/lib/po-tax";
import {
  computeSoItemRemaining,
  fetchSoItemFulfillment,
  refreshSoStatus,
} from "@/lib/so-reguler";

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
 * Approval berurutan: hanya pemilik step PENDING PERTAMA yang boleh
 * approve/reject. Tanpa ini approver step belakang bisa "mendahului", atau
 * menghidupkan lagi dokumen yang sudah ditolak di step sebelumnya.
 */
function _isUsersTurn(approvals: any[], userId: string): boolean {
  const next = (approvals || []).find((a: any) => a.status === "pending");
  return !!next && (next.userid === userId || next.user_id === userId);
}

/**
 * MATERIAL REQUEST (MR) SERVICES
 */
const MR_KATEGORI_VALUES = [
  "New Item",
  "Replace Item",
  "Fix & Repair",
  "Upgrade",
] as const;

export async function createMaterialRequest(data: {
  mr_kode: string;
  cabang_id: number;
  mr_pic: string;
  mr_pic_id: string;
  mr_tanggal: string;
  mr_due_date?: string;
  kategori: string;
  accurate?: boolean;
  approvals?: any[];
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_request: number;
    item_priority?: string;
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

  if (!MR_KATEGORI_VALUES.includes(data.kategori as any)) {
    return { error: "Kategori MR wajib dipilih." };
  }

  if (!data.items?.length) {
    return { error: "Daftar barang tidak boleh kosong." };
  }
  if (data.items.some((i) => !i.qty_request || i.qty_request <= 0)) {
    return { error: "Semua qty barang tidak boleh 0." };
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
        kategori: data.kategori,
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

  // 2. Insert MR Items. MR yang langsung approved (template tanpa step
  // approver) tidak melewati Final Decision alokasi, jadi seluruh qty-nya
  // otomatis jatah PR -- tanpa ini qty_pr = 0 dan item "gantung".
  const autoApproved = mr.mr_status === "approved";
  const itemsToInsert = data.items.map((item) => ({
    mr_id: mr.id,
    ...item,
    ...(autoApproved ? { qty_pr: item.qty_request, qty_sharestock_total: 0 } : {}),
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
  if (mr.mr_status !== "open") {
    return { error: `MR sudah berstatus ${mr.mr_status}, tidak bisa di-approve.` };
  }

  // 2. Identify current pending approval step -- wajib milik user ini.
  const originalApprovals = mr.approvals ?? [];
  const approvals = originalApprovals.map((a: any) => ({ ...a }));
  const currentStepIndex = approvals.findIndex((a: any) => a.status === "pending");

  if (currentStepIndex === -1) return { error: "No pending approval steps" };
  if (!_isUsersTurn(approvals, user.id)) {
    return { error: "Bukan giliran Anda untuk approval MR ini." };
  }

  // Update current step
  approvals[currentStepIndex].status = "approved";
  approvals[currentStepIndex].signature_url = signatureUrl;
  approvals[currentStepIndex].processed_at = new Date().toISOString();

  // 3. Check if this is the last step
  const isLastStep = currentStepIndex === approvals.length - 1;
  const status = isLastStep ? "approved" : "open";

  // Final Decision (alokasi PR vs Share Stock) per item. Scheduled MR sudah
  // memutuskan alokasinya saat create (services/scheduled-mr-actions.ts).
  type ItemPlan = {
    mr_item_id: number;
    qty_pr: number;
    qty_sharestock_total: number;
    sharestocks: { source_cabang_id: number; qty: number; deadline: string | null }[];
    // Ditolak per item oleh approver terakhir (wajib keterangan).
    reject_reason?: string;
  };
  const plans: ItemPlan[] = [];

  if (isLastStep && mr.mr_type !== "scheduled") {
    const mrDueDate = mr?.mr_due_date
      ? String(mr.mr_due_date).slice(0, 10)
      : null;

    // ---------- VALIDATE ALL FIRST (belum ada mutasi DB) ----------
    // Semua item MR wajib punya keputusan; item tanpa entri alokasi = seluruh
    // qty_request jadi jatah PR (tidak boleh ada qty yang tidak terdistribusi).
    const { data: mrItemRows, error: mrItemsError } = await supabase
      .from("mr_items")
      .select("id, part_number, qty_request")
      .eq("mr_id", mrId);
    if (mrItemsError) return { error: mrItemsError.message };
    const allocByItem = new Map<number, any>(
      (allocations || []).map((a: any) => [Number(a.mr_item_id), a]),
    );
    for (const id of allocByItem.keys()) {
      if (!(mrItemRows || []).some((r: any) => r.id === id)) {
        return { error: `Item MR (id ${id}) bukan bagian dari MR ini.` };
      }
    }

    for (const mrItemRow of mrItemRows || []) {
      const alloc = allocByItem.get(mrItemRow.id);
      const qtyRequest = Number(mrItemRow.qty_request) || 0;
      if (alloc?.rejected) {
        const reason = String(alloc.reject_reason || "").trim();
        if (!reason) {
          return {
            error: `Keterangan penolakan item ${mrItemRow.part_number} wajib diisi.`,
          };
        }
        plans.push({
          mr_item_id: mrItemRow.id,
          qty_pr: 0,
          qty_sharestock_total: 0,
          sharestocks: [],
          reject_reason: reason,
        });
        continue;
      }
      if (!alloc) {
        plans.push({
          mr_item_id: mrItemRow.id,
          qty_pr: qtyRequest,
          qty_sharestock_total: 0,
          sharestocks: [],
        });
        continue;
      }

      const allocationDeadline = alloc?.deadline
        ? String(alloc.deadline).slice(0, 10)
        : null;
      const sharestocks = (alloc.sharestocks || []).filter(
        (ss: any) => Number(ss.qty || 0) > 0,
      );
      const requestedShare = sharestocks.reduce(
        (s: number, ss: any) => s + Number(ss.qty || 0),
        0,
      );

      if (
        mrDueDate &&
        requestedShare > 0 &&
        allocationDeadline &&
        allocationDeadline > mrDueDate
      ) {
        return {
          error: `Deadline supply item ${mrItemRow.part_number} tidak boleh melewati due date MR (${mrDueDate}).`,
        };
      }
      if (sharestocks.some((ss: any) => ss.source_cabang_id === mr.cabang_id)) {
        return {
          error: `Gudang sumber untuk item ${mrItemRow.part_number} tidak boleh sama dengan gudang tujuan MR.`,
        };
      }
      if (sharestocks.some((ss: any) => !Number.isInteger(Number(ss.qty)) || Number(ss.qty) < 0)) {
        return { error: `Qty share stock item ${mrItemRow.part_number} tidak valid.` };
      }
      // Total share stock tidak boleh melebihi qty_request OTORITATIF (DB).
      if (requestedShare > qtyRequest) {
        return {
          error: `Total share stock item ${mrItemRow.part_number} (${requestedShare}) melebihi qty yang diminta MR (${qtyRequest}).`,
        };
      }
      if (
        alloc.qty_sharestock_total !== undefined &&
        Number(alloc.qty_sharestock_total || 0) !== requestedShare
      ) {
        return {
          error: `Data alokasi item ${mrItemRow.part_number} tidak konsisten (total baris ${requestedShare} != ${alloc.qty_sharestock_total}).`,
        };
      }
      // PR + Share Stock wajib persis = qty_request: qty_pr dihitung server,
      // tidak dipercaya dari payload.
      const qtyPr = qtyRequest - requestedShare;
      if (alloc.qty_pr !== undefined && Number(alloc.qty_pr) !== qtyPr) {
        return {
          error: `Alokasi item ${mrItemRow.part_number} tidak konsisten: PR ${alloc.qty_pr} + share stock ${requestedShare} harus = qty request ${qtyRequest}.`,
        };
      }
      plans.push({
        mr_item_id: mrItemRow.id,
        qty_pr: qtyPr,
        qty_sharestock_total: requestedShare,
        sharestocks: sharestocks.map((ss: any) => ({
          source_cabang_id: ss.source_cabang_id,
          qty: Number(ss.qty),
          deadline: ss.deadline ?? alloc.deadline ?? null,
        })),
      });
    }

    if (
      plans.length > 0 &&
      plans.every((p) => p.reject_reason !== undefined)
    ) {
      return { error: "Semua item ditolak -- gunakan Tolak Request." };
    }
  }

  // 4. Update MR -- conditional pada status 'open': di step terakhir status
  // berubah open -> approved, jadi dua klik / dua request bersamaan hanya
  // satu yang lolos (alokasi share stock tidak ter-insert dobel). Step
  // non-terakhir idempotent (hasil approve step yang sama selalu sama).
  const { data: claimed, error: updateError } = await supabase
    .from("mrs")
    .update({
      approvals,
      mr_status: toCompletedIfLegacy(status) as any,
    })
    .eq("id", mrId)
    .eq("mr_status", "open")
    .select("id");

  if (updateError) return { error: updateError.message };
  if (!claimed || claimed.length === 0) {
    return { error: "MR ini baru saja diproses oleh request lain. Muat ulang halaman." };
  }

  // 5. Apply alokasi (hanya step terakhir). Gagal -> kembalikan MR ke kondisi
  // sebelum approve supaya tidak ada MR approved dengan alokasi setengah jadi.
  if (plans.length > 0) {
    const rollback = async (message: string) => {
      await supabase
        .from("mr_sharestock_allocations")
        .delete()
        .in("mr_item_id", plans.map((p) => p.mr_item_id));
      await supabase
        .from("mr_items")
        .update({
          item_status: "active",
          item_reject_reason: null,
          item_rejected_by: null,
          item_rejected_at: null,
        })
        .in("id", plans.map((p) => p.mr_item_id));
      await supabase
        .from("mrs")
        .update({ approvals: originalApprovals, mr_status: "open" })
        .eq("id", mrId);
      return { error: message };
    };
    for (const plan of plans) {
      if (plan.sharestocks.length > 0) {
        const { error: insErr } = await supabase
          .from("mr_sharestock_allocations")
          .insert(
            plan.sharestocks.map((ss) => ({
              mr_item_id: plan.mr_item_id,
              source_cabang_id: ss.source_cabang_id,
              qty: ss.qty,
              // Deadline per item (diisi approver terakhir); dipakai freeze MR.
              deadline: ss.deadline,
            })),
          );
        if (insErr) return rollback(insErr.message);
      }

      const rejected = plan.reject_reason !== undefined;
      const { error: updErr } = await supabase
        .from("mr_items")
        .update({
          qty_pr: plan.qty_pr,
          qty_sharestock_total: plan.qty_sharestock_total,
          item_status: rejected ? "rejected" : "active",
          item_reject_reason: rejected ? plan.reject_reason : null,
          item_rejected_by: rejected ? user.id : null,
          item_rejected_at: rejected ? new Date().toISOString() : null,
        })
        .eq("id", plan.mr_item_id);
      if (updErr) return rollback(updErr.message);
    }
  }

  const mrUrl = mr.mr_type === "scheduled" ? `/mr/scheduled/${mrId}` : `/mr/${mrId}`;

  // Notify owner about approval progress
  notifyDocumentOwner(
    mr.mr_pic_id,
    isLastStep ? "document_completed" : "approved",
    "MR",
    mrId,
    mr.mr_kode,
    mrUrl,
    approvals[currentStepIndex].nama,
  ).catch(console.error);

  // If more steps remain, notify the next pending approver
  if (!isLastStep) {
    const remaining = approvals.filter((a: any) => a.status === "pending");
    notifyApprovers(remaining, "MR", mrId, mr.mr_kode, mrUrl).catch(
      console.error,
    );
  }

  revalidatePath(mr.mr_type === "scheduled" ? "/mr/scheduled" : "/mr");
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
    .select("mr_kode, mr_pic_id, approvals, mr_type, mr_status")
    .eq("id", mrId)
    .single();
  if (!mr) return { error: "MR not found" };
  if (mr.mr_status !== "open") {
    return { error: `MR sudah berstatus ${mr.mr_status}, tidak bisa ditolak.` };
  }
  if (!_isUsersTurn(mr.approvals ?? [], user.id)) {
    return { error: "Bukan giliran Anda untuk approval MR ini." };
  }

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
    .eq("id", mrId)
    .eq("mr_status", "open");

  if (error) return { error: error.message };

  // Notify document owner about rejection
  const rejecter = currentStepIndex !== -1 ? approvals[currentStepIndex] : null;
  notifyDocumentOwner(
    mr.mr_pic_id,
    "rejected",
    "MR",
    mrId,
    mr.mr_kode,
    mr.mr_type === "scheduled" ? `/mr/scheduled/${mrId}` : `/mr/${mrId}`,
    rejecter?.nama,
    reason,
  ).catch(console.error);

  revalidatePath(mr.mr_type === "scheduled" ? "/mr/scheduled" : "/mr");
  return { success: true };
}

type MrEditPayload = {
  mr_tanggal?: string;
  updatedItems?: {
    id: number;
    qty_request: number;
    remarks?: string;
    item_priority?: string;
  }[];
  newItems?: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_request: number;
    remarks?: string;
    item_priority?: string;
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
      if (item.item_priority !== undefined)
        itemPatch.item_priority = item.item_priority;
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
    over_mr_note?: string | null;
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

  for (const item of data.items) {
    if (!item.qty || item.qty <= 0 || !Number.isInteger(Number(item.qty))) {
      return { error: `Qty ${item.part_number} harus bilangan bulat lebih dari 0.` };
    }
    if (!item.mr_item_id) {
      return { error: `Item ${item.part_number} wajib berasal dari item MR.` };
    }
  }

  // Data item (MR, part) diambil dari DB -- payload client tidak dipercaya.
  {
    const ids = Array.from(new Set(data.items.map((i) => i.mr_item_id)));
    const { data: rows } = await supabase
      .from("mr_items")
      .select("id, mr_id, part_id, part_number, part_name, satuan, mrs!inner(mr_status)")
      .in("id", ids);
    const byId = new Map((rows || []).map((r: any) => [r.id, r]));
    for (const item of data.items) {
      const mi: any = byId.get(item.mr_item_id);
      if (!mi) return { error: `Item MR ${item.part_number} tidak ditemukan.` };
      const mrStatus = Array.isArray(mi.mrs) ? mi.mrs[0]?.mr_status : mi.mrs?.mr_status;
      if (mrStatus !== "approved") {
        return { error: `MR item ${mi.part_number} tidak berstatus approved (status: ${mrStatus}).` };
      }
      item.mr_id = mi.mr_id;
      item.part_id = mi.part_id;
      item.part_number = mi.part_number;
      item.part_name = mi.part_name;
      item.satuan = mi.satuan;
    }
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

  // Scheduled MR: freeze dievaluasi per-item, bukan per dokumen.
  if (sourceMrIds.length > 0) {
    const { data: scheduledMrRows } = await supabase
      .from("mrs")
      .select("id")
      .in("id", sourceMrIds)
      .eq("mr_type", "scheduled");
    const scheduledMrIdSet = new Set((scheduledMrRows || []).map((r) => r.id));
    if (scheduledMrIdSet.size > 0) {
      for (const item of data.items) {
        if (!scheduledMrIdSet.has(item.mr_id)) continue;
        if (await evaluateMrItemFreeze(item.mr_item_id)) {
          return {
            error: `Item ${item.part_number} sedang di-FREEZE (lewat due date item tanpa delivery). Hubungi moderator untuk unfreeze/reset.`,
          };
        }
      }
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

  // Qty PR boleh melebihi sisa qty_pr MR (over-request disengaja, mis.
  // pembulatan MOQ vendor / safety stock) -- tidak di-cap, tapi WAJIB disertai
  // keterangan (pr_items.over_mr_note). Distribusinya tetap terlihat lewat
  // mr_convert_status ("complete" begitu qty_pr asli sudah terkonversi,
  // lihat applyMrConversionStatus).
  const mrItemIds = Array.from(
    new Set(data.items.map((i) => i.mr_item_id).filter(Boolean)),
  );
  if (mrItemIds.length > 0) {
    const { data: mrItemRows } = await supabase
      .from("mr_items")
      .select("id, qty_pr")
      .in("id", mrItemIds);
    // Item PR yang ditolak per-item tidak dihitung "sudah di-PR".
    const convertedMap = await fetchMrItemPrConvertedQty(supabase, mrItemIds);
    const qtyPrById = new Map(
      (mrItemRows || []).map((r: any) => [r.id, r.qty_pr || 0]),
    );

    // Akumulasi per mr_item_id dalam PR ini (antisipasi item MR yang sama
    // muncul lebih dari sekali di payload).
    const usedInThisPr = new Map<number, number>();
    for (const item of data.items) {
      item.over_mr_note = item.over_mr_note?.trim() || null;
      const used = usedInThisPr.get(item.mr_item_id) || 0;
      usedInThisPr.set(item.mr_item_id, used + item.qty);
      const remaining = Math.max(
        0,
        (qtyPrById.get(item.mr_item_id) || 0) -
          (convertedMap.get(item.mr_item_id) || 0) -
          used,
      );
      if (item.qty > remaining) {
        if (!item.over_mr_note) {
          return {
            error: `Qty ${item.part_number} (${item.qty}) melebihi sisa MR (${remaining}). Keterangan wajib diisi.`,
          };
        }
      } else {
        item.over_mr_note = null;
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
  // over_mr_note hanya dikirim bila terisi, supaya PR biasa tetap bisa dibuat
  // walau migration kolomnya belum jalan di DB (deploy tidak atomik).
  const itemsToInsert = data.items.map(({ over_mr_note, ...item }) => ({
    pr_id: pr.id,
    ...item,
    ...(over_mr_note ? { over_mr_note } : {}),
  }));

  const { error: itemsError } = await supabase
    .from("pr_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // Recompute conversion progress for every source MR involved.
  await Promise.all(
    sourceMrIds.map((mrId) => applyMrConversionStatus(supabase, mrId)),
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

async function _isModeratorOrAdmin(supabase: any): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  const ok = (data || []).some((r: any) =>
    ["moderator", "admin"].includes(r?.roles?.name),
  );
  return ok ? user.id : null;
}

/**
 * UPDATE PR STATUS (override manual moderator/admin).
 * Dijaga supaya qty tidak bocor: PR yang sudah ter-PO tidak boleh keluar dari
 * approved, PR rejected yang dihidupkan lagi harus muat di sisa MR, dan
 * "completed" hanya mengikuti kondisi nyata (semua ter-PO & diterima).
 */
export async function updatePRStatus(prId: number, status: string) {
  const supabase = await createClient();
  if (!(await _isModeratorOrAdmin(supabase))) {
    return { error: "Hanya moderator/admin yang dapat mengubah status PR secara manual." };
  }
  const normalizedStatus = toCompletedIfLegacy(status);
  if (!["open", "approved", "rejected", "completed"].includes(normalizedStatus)) {
    return { error: "Status tidak valid." };
  }

  const { data: pr } = await supabase
    .from("prs")
    .select("pr_status")
    .eq("id", prId)
    .maybeSingle();
  if (!pr) return { error: "PR tidak ditemukan" };

  const { data: items } = await supabase
    .from("pr_items")
    .select("id, mr_id, mr_item_id, qty, status, part_number")
    .eq("pr_id", prId);
  const itemIds = (items || []).map((i: any) => i.id);
  const converted = await fetchPrItemConvertedQty(supabase, itemIds);
  const hasPo = Array.from(converted.values()).some((q) => q > 0);

  if (["open", "rejected"].includes(normalizedStatus) && hasPo) {
    return { error: "PR ini sudah dikonversi ke PO. Urus PO-nya dulu sebelum mengubah status keluar dari approved." };
  }
  if (pr.pr_status === "rejected" && normalizedStatus !== "rejected") {
    // Qty PR rejected sudah dibebaskan ke MR -- wajib muat di sisa qty_pr.
    const active = (items || []).filter((i: any) => !isPrItemRejected(i) && i.mr_item_id);
    const mrItemIds = Array.from(new Set(active.map((i: any) => i.mr_item_id)));
    if (mrItemIds.length > 0) {
      const { data: mrRows } = await supabase.from("mr_items").select("id, qty_pr").in("id", mrItemIds);
      const qtyPr = new Map((mrRows || []).map((r: any) => [r.id, r.qty_pr || 0]));
      const elsewhere = await fetchMrItemPrConvertedQty(supabase, mrItemIds, { excludePrId: prId });
      const used = new Map<number, number>();
      for (const i of active) used.set(i.mr_item_id, (used.get(i.mr_item_id) || 0) + Number(i.qty));
      for (const [mrItemId, q] of used) {
        const sisa = Math.max(0, (qtyPr.get(mrItemId) || 0) - (elsewhere.get(mrItemId) || 0));
        if (q > sisa) {
          return { error: `PR tidak bisa dihidupkan lagi: qty melebihi sisa MR yang belum di-PR (${sisa}).` };
        }
      }
    }
  }

  const { error } = await supabase
    .from("prs")
    .update({
      // "completed" manual dievaluasi ulang di bawah (tidak bisa dipaksa).
      pr_status: (normalizedStatus === "completed" ? "approved" : normalizedStatus) as any,
      updated_at: new Date().toISOString(),
    })
    .eq("id", prId);

  if (error) return { error: error.message };

  await applyPrConversionStatus(supabase, prId);
  await applyPrCompletionStatus(supabase, prId);
  const mrIds = Array.from(new Set((items || []).map((i: any) => i.mr_id).filter(Boolean))) as number[];
  for (const mrId of mrIds) await applyMrConversionStatus(supabase, mrId);

  revalidatePath("/pr");
  return { success: true };
}

/**
 * UPDATE PR ITEM STATUS (override manual moderator/admin).
 * Stock is NOT adjusted here. Stock additions happen via Receive Item (RI) from a PO.
 * Item yang sudah ter-PO tidak boleh ditolak (qty PO-nya jadi yatim).
 */
export async function updatePRItemStatus(itemId: number, status: string) {
  const supabase = await createClient();
  if (!(await _isModeratorOrAdmin(supabase))) {
    return { error: "Hanya moderator/admin yang dapat mengubah status item PR secara manual." };
  }

  const { data: item } = await supabase
    .from("pr_items")
    .select("id, pr_id, mr_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { error: "Item PR tidak ditemukan." };
  if (status === "rejected") {
    const converted = await fetchPrItemConvertedQty(supabase, [itemId]);
    if ((converted.get(itemId) || 0) > 0) {
      return { error: "Item ini sudah di-PO, tidak bisa ditolak. Urus PO-nya dulu." };
    }
  }

  const { error } = await supabase
    .from("pr_items")
    .update({
      status: status as any,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);

  if (error) return { error: error.message };

  // Item ditolak/diaktifkan lagi mengubah kebutuhan PR & jatah MR.
  await applyPrConversionStatus(supabase, item.pr_id);
  await applyPrCompletionStatus(supabase, item.pr_id);
  if (item.mr_id) await applyMrConversionStatus(supabase, item.mr_id);

  revalidatePath("/pr");
  return { success: true };
}

/**
 * UPDATE MR ITEM SHARE STOCK STATUS (override manual moderator/admin).
 * Stock movement for Share Stock is handled by Delivery transactions.
 */
export async function updateMRItemSSStatus(itemId: number, status: string) {
  const supabase = await createClient();
  if (!(await _isModeratorOrAdmin(supabase))) {
    return { error: "Hanya moderator/admin yang dapat mengubah status share stock secara manual." };
  }

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
    // null untuk item PO Non-PR (tidak terikat MR).
    mr_id: number | null;
    po_item_id?: number | null;
    cabang_penerima_id: number;
  }[];
}) {
  const supabase = await createClient();

  const riKode = data.ri_kode?.trim();
  if (!riKode) {
    return { error: "Kode Receive wajib diisi manual." };
  }

  // PO Non-PR: gudang penerima dikunci ke GMI-JAKARTA (lihat lib/po-non-pr.ts),
  // divalidasi ulang di server -- jangan percaya payload client.
  const { data: poHeader } = await supabase
    .from("pos")
    .select("po_jenis, cabang_id, po_status")
    .eq("id", data.po_id)
    .maybeSingle();
  if (!poHeader) return { error: "PO tidak ditemukan." };
  if (poHeader.po_status !== "approved") {
    return { error: `PO berstatus ${poHeader.po_status}, tidak bisa diterima.` };
  }
  if (!data.items?.length) return { error: "Tidak ada item yang diterima." };

  // Validasi qty per item PO di server: data item diambil dari po_items (bukan
  // payload), dan qty tidak boleh melebihi sisa = qty PO - sudah diterima -
  // qty di RI lain yang masih menunggu approval (supaya dua RI pending tidak
  // sama-sama menerima qty yang sama).
  {
    if (data.items.some((i) => !i.po_item_id)) {
      return { error: "Setiap item RI wajib merujuk item PO." };
    }
    if (data.items.some((i) => !(i.qty > 0) || !Number.isInteger(Number(i.qty)))) {
      return { error: "Qty terima harus bilangan bulat lebih dari 0." };
    }
    if (data.items.some((i) => !i.cabang_penerima_id)) {
      return { error: "Gudang penerima wajib dipilih untuk setiap item." };
    }
    const poItemIds = Array.from(new Set(data.items.map((i) => Number(i.po_item_id))));
    const { data: poItemRows } = await supabase
      .from("po_items")
      .select("id, po_id, part_id, part_number, part_name, satuan, qty, qty_received, mr_id")
      .in("id", poItemIds);
    const poItemById = new Map((poItemRows || []).map((r: any) => [r.id, r]));
    const pending = await fetchPoItemPendingReceiveQty(supabase, poItemIds);
    const requested = new Map<number, number>();
    for (const item of data.items) {
      const pi: any = poItemById.get(Number(item.po_item_id));
      if (!pi || pi.po_id !== data.po_id) {
        return { error: `Item ${item.part_number} bukan bagian dari PO ini.` };
      }
      item.po_id = pi.po_id;
      item.part_id = pi.part_id;
      item.part_number = pi.part_number;
      item.part_name = pi.part_name;
      item.satuan = pi.satuan;
      item.mr_id = pi.mr_id ?? null;
      requested.set(pi.id, (requested.get(pi.id) || 0) + Number(item.qty));
    }
    for (const [poItemId, qty] of requested) {
      const pi: any = poItemById.get(poItemId);
      const sisa =
        (Number(pi.qty) || 0) - (Number(pi.qty_received) || 0) - (pending.get(poItemId) || 0);
      if (qty > sisa) {
        return {
          error: `Qty terima ${pi.part_number} (${qty}) melebihi sisa PO yang belum diterima (${Math.max(0, sisa)}, sudah termasuk RI lain yang masih menunggu approval).`,
        };
      }
    }
  }
  // PO dari SO: barang wajib mendarat di gudang penerima PO (pos.cabang_id),
  // dari sana baru dikirim ke customer lewat DO Reguler.
  if (
    poHeader?.po_jenis === "so" &&
    data.items.some(
      (i) => Number(i.cabang_penerima_id) !== Number(poHeader.cabang_id),
    )
  ) {
    return { error: "Barang PO dari SO wajib diterima di gudang penerima PO." };
  }
  if (poHeader?.po_jenis === "non_pr") {
    const nonPrCabang = await resolveNonPrReceiveCabang(supabase);
    if (!nonPrCabang) return { error: NON_PR_RECEIVE_CABANG_MISSING_MESSAGE };
    if (data.items.some((i) => i.cabang_penerima_id !== nonPrCabang.id)) {
      return {
        error: `Barang PO Non-PR wajib diterima di gudang ${nonPrCabang.nama_cabang}.`,
      };
    }
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
    mr_id: item.mr_id ?? null,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    qty: item.qty,
    po_item_id: item.po_item_id ?? null,
    cabang_penerima_id: item.cabang_penerima_id,
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
    .select("id, approvals, ri_status, ri_kode, ri_pic_id, completed_at")
    .eq("id", riId)
    .single();
  if (!receive) return { error: "Receive tidak ditemukan" };

  if (receive.ri_status === "completed") {
    return { error: "Receive sudah completed." };
  }
  if (receive.ri_status === "rejected") {
    return { error: "Receive sudah rejected dan tidak bisa di-approve." };
  }
  if (!_isUsersTurn(receive.approvals ?? [], user.id)) {
    return { error: "Bukan giliran Anda untuk approval Receive ini." };
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

  // Claim status dulu (open -> completed, kondisional) SEBELUM posting stok,
  // supaya dua klik / dua request bersamaan tidak memposting stok dua kali.
  const { data: claimed, error: updateError } = await supabase
    .from("receives")
    .update({
      approvals: updatedApprovals as any,
      ri_status: isAllDone ? "completed" : "open",
      rejection_reason: null,
      completed_at: isAllDone ? new Date().toISOString() : null,
    })
    .eq("id", riId)
    .eq("ri_status", "open")
    .select("id");

  if (updateError) return { error: updateError.message };
  if (!claimed || claimed.length === 0) {
    return { error: "Receive ini baru saja diproses oleh request lain. Muat ulang halaman." };
  }

  if (isAllDone) {
    const completionResult = await applyReceiveCompletion(supabase, riId);
    if ((completionResult as any)?.error) {
      // Posting gagal -> kembalikan ke status sebelum approve.
      await supabase
        .from("receives")
        .update({
          approvals: receive.approvals as any,
          ri_status: "open",
          completed_at: null,
        })
        .eq("id", riId);
      return completionResult;
    }
  }

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
  if (!_isUsersTurn(receive.approvals ?? [], user.id)) {
    return { error: "Bukan giliran Anda untuk approval Receive ini." };
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
    .eq("id", riId)
    .eq("ri_status", "open");

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
  if (pr.pr_status !== "open") {
    return { error: `PR sudah berstatus ${pr.pr_status}, tidak bisa di-approve.` };
  }
  if (!_isUsersTurn(pr.approvals ?? [], user.id)) {
    return { error: "Bukan giliran Anda untuk approval PR ini." };
  }

  const { data: prItemRows } = await supabase
    .from("pr_items")
    .select("id, mr_id")
    .eq("pr_id", prId);
  const prItemIdSet = new Set((prItemRows || []).map((r: any) => r.id));
  if (
    (itemDecisions || []).some(
      (d) => !prItemIdSet.has(d.itemId) || !["approved", "rejected"].includes(d.status),
    )
  ) {
    return { error: "Keputusan per-item tidak valid untuk PR ini." };
  }
  if (
    prItemIdSet.size > 0 &&
    (itemDecisions || []).filter((d) => d.status === "rejected").length >= prItemIdSet.size
  ) {
    return { error: "Semua item ditolak -- gunakan Tolak PR." };
  }

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

  // Kondisional status 'open': step terakhir mengubah open -> approved,
  // jadi request ganda hanya satu yang lolos.
  const { data: claimed, error } = await supabase
    .from("prs")
    .update({ approvals: updatedApprovals as any, pr_status: newStatus as any })
    .eq("id", prId)
    .eq("pr_status", "open")
    .select("id");
  if (error) return { error: error.message };
  if (!claimed || claimed.length === 0) {
    return { error: "PR ini baru saja diproses oleh request lain. Muat ulang halaman." };
  }

  // When it's the final approval step, apply per-item decisions
  if (isLastStep && itemDecisions.length > 0) {
    for (const decision of itemDecisions) {
      await supabase
        .from("pr_items")
        .update({ status: decision.status as any })
        .eq("id", decision.itemId)
        .eq("pr_id", prId);
    }
  }
  if (isLastStep) {
    // Item yang ditolak membebaskan jatah qty_pr MR-nya & tidak dihitung
    // sebagai kebutuhan PR.
    const mrIds = Array.from(
      new Set((prItemRows || []).map((r: any) => r.mr_id).filter(Boolean)),
    ) as number[];
    await Promise.all(mrIds.map((mrId) => applyMrConversionStatus(supabase, mrId)));
    await applyPrConversionStatus(supabase, prId);
  }

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
    .select("approvals, pr_kode, pr_pic_id, pr_status")
    .eq("id", prId)
    .single();
  if (!pr) return { error: "PR tidak ditemukan" };
  // Hanya PR yang masih dalam proses approval yang bisa ditolak -- PR yang
  // sudah approved bisa jadi sudah di-PO (qty-nya tidak boleh dibebaskan).
  if (pr.pr_status !== "open") {
    return { error: `PR sudah berstatus ${pr.pr_status}, tidak bisa ditolak.` };
  }
  if (!_isUsersTurn(pr.approvals ?? [], user.id)) {
    return { error: "Bukan giliran Anda untuk approval PR ini." };
  }

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
    .eq("id", prId)
    .eq("pr_status", "open");
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
    affectedMrIds.map((mrId) => applyMrConversionStatus(supabase, mrId)),
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
  // "non_pr": item dipilih bebas dari master barang (PN/satuan pembelian beda
  // dengan PR), PR cuma referensi teks di po_pr_referensi.
  // "so": item ditarik dari SO Reguler (so_id + so_item_id per item), barang
  // nanti diterima di gudang penerima (so_cabang_id) lalu dikirim ke
  // customer via DO Reguler.
  // "konsinyasi": PO Rekonsil ke vendor konsinyasi. Item dihitung ulang di
  // server dari rekonsil (FIFO item PR Konsinyasi), barang sudah diterima
  // lewat GR Konsinyasi jadi PO langsung "diterima penuh" (tanpa RI).
  po_jenis?: "reguler" | "non_pr" | "so" | "konsinyasi";
  vendor_consignment_rekonsil_id?: number | null;
  po_pr_referensi?: string;
  so_id?: number | null;
  // PO dari SO: gudang penerima barang (dipilih di form, default gudang akun).
  so_cabang_id?: number | null;
  approvals?: any[];
  items: {
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
    item_ppn_rate?: number;
    item_pph_type?: string | null;
    item_pph_rate?: number;
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

  const poJenis =
    data.po_jenis === "non_pr" || data.po_jenis === "so" || data.po_jenis === "konsinyasi"
      ? data.po_jenis
      : "reguler";
  // PO dari SO: lokasi PO = gudang penerima pilihan pembuat PO (RI dikunci ke
  // sini). SO sendiri tidak punya lokasi sejak revisi 2026-10-16.
  let soCabangId: number | null = null;
  if (poJenis === "so") {
    if (!data.so_id) return { error: "PO dari SO wajib memilih SO Reguler." };
    if (!data.so_cabang_id)
      return { error: "PO dari SO wajib memilih gudang penerima." };
    if (data.items.some((i) => i.pr_item_id || i.mr_id || i.pr_id)) {
      return { error: "PO dari SO tidak boleh berisi item dari PR." };
    }
    const { data: so } = await supabase
      .from("so_reguler")
      .select("id, so_kode, so_status, so_reguler_items(id, qty)")
      .eq("id", data.so_id)
      .maybeSingle();
    if (!so) return { error: "SO Reguler tidak ditemukan." };
    if (so.so_status === "cancelled" || so.so_status === "completed") {
      return { error: `SO ${so.so_kode} sudah ${so.so_status === "cancelled" ? "dibatalkan" : "selesai"}.` };
    }
    const soItems = new Map<number, number>(
      (so.so_reguler_items || []).map((i: any) => [i.id, i.qty]),
    );
    if (data.items.some((i) => !i.so_item_id || !soItems.has(i.so_item_id))) {
      return { error: `Semua item PO harus berasal dari SO ${so.so_kode}.` };
    }
    // Guard sisa qty SO yang belum di-PO / di-DO (race-condition guard).
    const fulfillment = await fetchSoItemFulfillment(
      supabase,
      Array.from(soItems.keys()),
    );
    for (const item of data.items) {
      const { sisaPo } = computeSoItemRemaining(
        soItems.get(item.so_item_id!)!,
        fulfillment.get(item.so_item_id!),
      );
      if (!(item.qty > 0) || item.qty > sisaPo) {
        return {
          error: `Qty ${item.part_number} melebihi sisa SO yang belum di-PO/DO (sisa ${sisaPo}).`,
        };
      }
    }
    soCabangId = Number(data.so_cabang_id);
  } else if (data.items.some((i) => i.so_item_id)) {
    return { error: "Item SO hanya bisa diproses lewat PO jenis SO." };
  } else if (poJenis === "konsinyasi") {
    const prep = await prepareConsignmentPoItems(
      supabase,
      data.vendor_consignment_rekonsil_id,
      data.items,
    );
    if ("error" in prep) return { error: prep.error };
    data.items = prep.items;
  } else if (poJenis === "non_pr") {
    if (data.items.some((i) => i.pr_item_id || i.mr_id || i.pr_id)) {
      return {
        error:
          "PO Non-PR tidak boleh berisi item dari PR. Gunakan fitur Hubungkan ke PR setelah PO dibuat.",
      };
    }
    if (data.items.some((i) => !i.part_id || !(i.qty > 0))) {
      return { error: "Barang dan qty (> 0) wajib diisi untuk semua item." };
    }
  } else if (data.items.some((i) => !i.pr_item_id || !i.mr_id)) {
    return { error: "Item PO reguler wajib berasal dari PR." };
  }


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
  const prItemIds = data.items
    .map((i) => i.pr_item_id)
    .filter((id): id is number => Boolean(id));
  if (prItemIds.length > 0) {
    const { data: prItemRows } = await supabase
      .from("pr_items")
      .select("id, pr_id, mr_id, qty, status, part_number, prs!inner(pr_status)")
      .in("id", prItemIds);
    // Termasuk qty dari link manual PO Non-PR (po_item_pr_links).
    const convertedMap = await fetchPrItemConvertedQty(supabase, prItemIds);

    const prItemById = new Map((prItemRows ?? []).map((r: any) => [r.id, r]));
    const usedInThisPo = new Map<number, number>();

    for (const item of data.items) {
      if (!item.pr_item_id) continue;
      const pri: any = prItemById.get(item.pr_item_id);
      if (!pri) return { error: `Item PR ${item.part_number} tidak ditemukan.` };
      const prStatus = Array.isArray(pri.prs) ? pri.prs[0]?.pr_status : pri.prs?.pr_status;
      if (prStatus !== "approved") {
        return { error: `PR untuk item ${item.part_number} tidak berstatus approved (status: ${prStatus}).` };
      }
      if (isPrItemRejected(pri)) {
        return { error: `Item ${item.part_number} ditolak approver PR, tidak bisa di-PO.` };
      }
      if (!Number.isInteger(Number(item.qty)) || !(item.qty > 0)) {
        return { error: `Qty ${item.part_number} harus bilangan bulat lebih dari 0.` };
      }
      // Lineage diambil dari DB, bukan payload.
      item.pr_id = pri.pr_id;
      item.mr_id = pri.mr_id;
      const used = usedInThisPo.get(item.pr_item_id) || 0;
      usedInThisPo.set(item.pr_item_id, used + item.qty);
      const already = convertedMap.get(item.pr_item_id) || 0;
      const remaining = Math.max(0, (Number(pri.qty) || 0) - already - used);
      if (item.qty > remaining) {
        return {
          error: `Qty ${item.part_number} melebihi sisa yang bisa dikonversi ke PO (sisa ${remaining}).`,
        };
      }
    }
  }

  // Setelah guard di atas, pr_id per item sudah diambil dari DB.
  const sourcePrIds = Array.from(
    new Set(
      data.items
        .map((i) => i.pr_id)
        .filter((id): id is number => Boolean(id)),
    ),
  );

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
        po_jenis: poJenis,
        po_pr_referensi:
          poJenis === "non_pr" ? data.po_pr_referensi?.trim() || null : null,
        so_id: poJenis === "so" ? data.so_id : null,
        // Reguler: biarkan NULL -> trigger pos_fill_cabang_from_pr mengisi dari
        // PR (lokasi PO reguler = lokasi PR, seperti sebelumnya). Non-PR:
        // lokasi pembuat PO. SO: gudang penerima yang dipilih.
        cabang_id:
          poJenis === "so"
            ? soCabangId
            : poJenis === "non_pr"
              ? (data.cabang_id ?? null)
              : null,
        po_pic: data.po_pic,
        po_pic_id: data.po_pic_id,
        po_tanggal: data.po_tanggal,
        po_estimasi: data.po_estimasi ?? null,
        po_payment_term: data.po_payment_term ?? null,
        po_keterangan: data.po_keterangan ?? null,
        po_currency: normalizePoCurrency(data.po_currency),
        po_tax_mode: normalizePoTaxMode(data.po_tax_mode),
        po_harga_termasuk_pajak: data.po_harga_termasuk_pajak ?? false,
        po_ppn_mode: data.po_ppn_mode ?? "percent",
        po_ppn_rate: data.po_ppn_rate ?? 0,
        po_ppn_amount: data.po_ppn_amount ?? 0,
        po_diskon_mode: data.po_diskon_mode ?? "percent",
        po_diskon_value: data.po_diskon_value ?? 0,
        po_ongkir: data.po_ongkir ?? 0,
        po_pph_type: data.po_pph_type ?? null,
        po_pph_mode: data.po_pph_mode ?? "percent",
        po_pph_rate: data.po_pph_rate ?? 0,
        po_pph_amount: data.po_pph_amount ?? 0,
        po_status: approvals.length === 0 ? "approved" : "open",
        po_receive_status: poJenis === "konsinyasi" ? "complete" : "pending",
        approvals: approvals as any,
      },
    ])
    .select()
    .single();

  if (poError) return { error: poError.message };

  // 3. Insert PO items
  const itemsToInsert = normalizedItems.map((item) => ({
    po_id: po.id,
    mr_id: item.mr_id ?? null,
    pr_item_id: item.pr_item_id ?? null,
    so_item_id: poJenis === "so" ? (item.so_item_id ?? null) : null,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    qty: item.qty,
    harga: item.harga,
    vendor_id: item.vendor_id,
    ...(() => {
      const t = normalizeItemTax({
        ppnRate: item.item_ppn_rate,
        pphType: item.item_pph_type,
        pphRate: item.item_pph_rate,
      });
      return { item_ppn_rate: t.ppnRate, item_pph_type: t.pphType, item_pph_rate: t.pphRate };
    })(),
    qty_received: poJenis === "konsinyasi" ? item.qty : 0,
  }));

  const { error: itemsError } = await supabase
    .from("po_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // PO Rekonsil: kunci rekonsil ke PO ini (kondisional -- dua submit
  // bersamaan cuma satu yang menang; yang kalah PO-nya dihapus lagi).
  if (poJenis === "konsinyasi") {
    const { data: claimed } = await supabase
      .from("vendor_consignment_rekonsil")
      .update({ po_id: po.id })
      .eq("id", data.vendor_consignment_rekonsil_id)
      .eq("status", "final")
      .is("po_id", null)
      .select("id");
    if (!claimed || claimed.length === 0) {
      await supabase.from("pos").delete().eq("id", po.id);
      return { error: "Rekonsil ini baru saja dibuatkan PO oleh request lain. Muat ulang halaman." };
    }
    // Tanpa langkah approval: PO langsung approved & sudah diterima penuh.
    if (approvals.length === 0) await syncPoReceiveAndCompletion(supabase, po.id);
  }

  // Recompute conversion progress for every source PR involved.
  await Promise.all(
    sourcePrIds.map((prId) => applyPrConversionStatus(supabase, prId)),
  );
  if (poJenis === "so") await refreshSoStatus(supabase, data.so_id);

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
  if (poJenis === "so") revalidatePath("/so-reguler/so");
  if (poJenis === "konsinyasi") revalidatePath("/vendor-consignment/rekonsil");
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
  if (po.po_status !== "open") {
    return { error: `PO sudah berstatus ${po.po_status}, tidak bisa di-approve.` };
  }
  if (!_isUsersTurn(po.approvals ?? [], user.id)) {
    return { error: "Bukan giliran Anda untuk approval PO ini." };
  }

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

  const { data: claimed, error } = await supabase
    .from("pos")
    .update({ approvals: updatedApprovals as any, po_status: newStatus as any })
    .eq("id", poId)
    .eq("po_status", "open")
    .select("id");

  if (error) return { error: error.message };
  if (!claimed || claimed.length === 0) {
    return { error: "PO ini baru saja diproses oleh request lain. Muat ulang halaman." };
  }
  // PO hasil revisi yang penerimaannya sudah penuh langsung jadi completed
  // (dan PR sumbernya ikut dievaluasi).
  if (isAllDone) await syncPoReceiveAndCompletion(supabase, poId);

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
    .select("approvals, po_kode, po_pic_id, so_id, po_status")
    .eq("id", poId)
    .single();
  if (!po) return { error: "PO tidak ditemukan" };
  // Hanya PO yang masih dalam proses approval yang bisa ditolak -- PO
  // approved bisa sudah ada penerimaan (qty PR-nya tidak boleh dibebaskan).
  if (po.po_status !== "open") {
    return { error: `PO sudah berstatus ${po.po_status}, tidak bisa ditolak.` };
  }
  if (!_isUsersTurn(po.approvals ?? [], user.id)) {
    return { error: "Bukan giliran Anda untuk approval PO ini." };
  }

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
    .eq("id", poId)
    .eq("po_status", "open");

  if (error) return { error: error.message };

  // Rejection frees up the converted qty on source PR(s) for reconversion.
  for (const prId of await fetchPoSourcePrIds(supabase, poId)) {
    await applyPrConversionStatus(supabase, prId);
  }
  // Rejection juga membebaskan qty SO untuk di-PO ulang / langsung DO.
  await refreshSoStatus(supabase, po.so_id);

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
    .select("po_status, po_receive_status, so_id")
    .eq("id", poId)
    .single();
  if (!po) return { error: "PO tidak ditemukan" };
  if (po.po_receive_status !== "pending") {
    return {
      error: "PO tidak bisa dihapus karena sudah ada penerimaan barang",
    };
  }
  // RI yang masih menunggu approval juga dihitung "ada penerimaan".
  const { count: riCount } = await supabase
    .from("receives")
    .select("id", { count: "exact", head: true })
    .eq("po_id", poId)
    .neq("ri_status", "rejected");
  if (riCount && riCount > 0) {
    return {
      error: "PO tidak bisa dihapus karena sudah ada dokumen Receive Item (termasuk yang masih menunggu approval).",
    };
  }
  // PR sumber dicatat SEBELUM PO dihapus supaya progres konversinya bisa
  // dihitung ulang (PO yang hilang membebaskan qty PR).
  const sourcePrIds = await fetchPoSourcePrIds(supabase, poId);
  const { error } = await supabase.from("pos").delete().eq("id", poId);
  if (error) return { error: error.message };
  for (const prId of sourcePrIds) {
    await applyPrConversionStatus(supabase, prId);
    await applyPrCompletionStatus(supabase, prId);
  }
  await refreshSoStatus(supabase, po.so_id);
  revalidatePath("/po");
  revalidatePath("/pr");
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
