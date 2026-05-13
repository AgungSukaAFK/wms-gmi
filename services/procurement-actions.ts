"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { canViewPOPrice, maskPOPriceItems } from "@/lib/po-price-access";
import { toCompletedIfLegacy } from "@/lib/document-status";
import {
  notifyApprovers,
  notifyDocumentOwner,
} from "@/services/notification-actions";

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
  mr_remarks?: string;
  accurate?: boolean;
  approvals?: any[];
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_request: number;
    prioritas?: string;
  }[];
}) {
  const supabase = await createClient();

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
        mr_remarks: data.mr_remarks ?? null,
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
    status = "approved";

    // Process allocations if provided
    if (allocations && allocations.length > 0) {
      for (const alloc of allocations) {
        // Create sharestock entries
        if (alloc.sharestocks && alloc.sharestocks.length > 0) {
          const sharestockEntries = alloc.sharestocks.map((ss: any) => ({
            mr_item_id: alloc.mr_item_id,
            source_cabang_id: ss.source_cabang_id,
            qty: ss.qty,
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
  mr_remarks?: string;
  updatedItems?: { id: number; qty_request: number }[];
  newItems?: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty_request: number;
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
      (a.userid === user.id || a.user_id === user.id) &&
      a.status === "pending",
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
  if (payload.mr_tanggal !== undefined) headerPatch.mr_tanggal = payload.mr_tanggal;
  if (payload.mr_priority !== undefined) headerPatch.mr_priority = payload.mr_priority;
  if (payload.mr_remarks !== undefined) headerPatch.mr_remarks = payload.mr_remarks;

  if (Object.keys(headerPatch).length > 0) {
    const { error: headerErr } = await supabase
      .from("mrs")
      .update(headerPatch)
      .eq("id", mrId);
    if (headerErr) return { error: `Gagal update header MR: ${headerErr.message}` };
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

  // 3. Update qty existing items
  if (payload.updatedItems && payload.updatedItems.length > 0) {
    for (const item of payload.updatedItems) {
      const { error: itemErr } = await supabase
        .from("mr_items")
        .update({ qty_request: item.qty_request })
        .eq("id", item.id)
        .eq("mr_id", mrId);
      if (itemErr) return { error: `Gagal update item: ${itemErr.message}` };
    }
  }

  // 4. Insert new items
  if (payload.newItems && payload.newItems.length > 0) {
    const toInsert = payload.newItems.map((i) => ({ ...i, mr_id: mrId }));
    const { error: insertErr } = await supabase.from("mr_items").insert(toInsert);
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
  mr_id: number;
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
  }[];
}) {
  const supabase = await createClient();

  const prKode = data.pr_kode?.trim();
  if (!prKode) {
    return { error: "Kode PR wajib diisi manual." };
  }

  const { data: existingPr } = await supabase
    .from("prs")
    .select("id")
    .eq("pr_kode", prKode)
    .maybeSingle();

  if (existingPr) {
    return { error: "Kode PR sudah digunakan. Gunakan kode lain." };
  }

  const prApprovals = data.approvals ?? [];

  // Insert PR Header
  const { data: pr, error: prError } = await supabase
    .from("prs")
    .insert([
      {
        pr_kode: prKode,
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
    .select("id, approvals, ri_status")
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
    .select("id, approvals, ri_status")
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
    .select("approvals, pr_status")
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
    .select("approvals")
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
  pr_id: number;
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
  }[];
}) {
  const supabase = await createClient();

  const poKode = data.po_kode?.trim();
  if (!poKode) {
    return { error: "Kode PO wajib diisi manual." };
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

  // 2. Insert PO header
  const { data: po, error: poError } = await supabase
    .from("pos")
    .insert([
      {
        po_kode: poKode,
        pr_id: data.pr_id,
        po_pic: data.po_pic,
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
    .select("approvals, po_status")
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
    .select("approvals")
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
