"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { notifyApprovers, notifyDocumentOwner } from "@/services/notification-actions";

// ============================================================
// WORKING ORDER (WO) — proses assembly/produksi internal: PN target
// "diproduksi" dengan mengonsumsi formula (BOM) komponen dari stok Gudang
// WO. Satu WO merujuk ke SATU MR (1 WO : 1 MR).
//
// Approval memakai approval_templates generic (type "Working Order"),
// dengan pola _buildApprovalFlow/_processStep yang sama persis dengan
// MR/PR/PO/Receive di services/procurement-actions.ts -- diduplikasi di
// sini (bukan di-export dari sana) supaya nol risiko regresi ke flow yang
// sudah berjalan di production.
//
// Mekanika stok mengikuti pola services/consignment-ik-actions.ts: update
// sekuensial plain Supabase calls + insert stock_movements, tanpa DB
// transaction primitive.
// ============================================================

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
    // "cabang_id.eq.null" bukan sintaks PostgREST yang valid untuk null
    // (butuh is.null) -- filter cabang cuma ditambahkan kalau ada nilainya.
    templateQuery = cabang_id
      ? templateQuery.or(`cabang_id.eq.${cabang_id},cabang_id.is.null`)
      : templateQuery.is("cabang_id", null);
    templateQuery = templateQuery
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
      type: isRequester ? "Requester" : profile?.nama || step.approver_type || "Approver",
      status: "pending",
      userid: profile?.id || "",
      nama: profile?.nama || "Unknown",
      email: profile?.email || "",
      level: step.step_order,
      approval_role: isRequester ? "menyetujui" : (step.level ?? "menyetujui"),
      processed_at: null,
      notes: null,
      snapshot: null,
    };
  });
}

function _processStep(
  approvals: any[],
  userId: string,
  userProfile: any,
  action: "approved" | "rejected",
  notes?: string,
): any[] {
  const newApprovals = [...approvals];
  const idx = newApprovals.findIndex((a) => a.userid === userId && a.status === "pending");
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

async function getRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (data || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

/**
 * Total qty WO yang sudah "commit" terhadap satu mr_item (status Pending
 * Approval + On Process + Closed -- semua kecuali Rejected), opsional
 * exclude satu WO (dipakai saat edit, supaya WO itu tidak dobel-hitung
 * terhadap dirinya sendiri).
 */
async function getWoCommittedQty(
  supabase: any,
  mrItemId: number,
  excludeWoId?: number,
): Promise<number> {
  let q = supabase
    .from("working_order_items")
    .select("qty, working_orders!inner(id, wo_status)")
    .eq("mr_item_id", mrItemId)
    .in("working_orders.wo_status", ["Pending Approval", "On Process", "Closed"]);
  const { data } = await q;
  const rows = (data || []).filter(
    (r: any) => !excludeWoId || r.working_orders?.id !== excludeWoId,
  );
  return rows.reduce((sum: number, r: any) => sum + Number(r.qty || 0), 0);
}

export type WorkingOrderItemInput = {
  mr_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  lead_time_days?: number | null;
  deadline_date?: string | null;
};

/**
 * MR + item-itemnya (dengan sisa qty yang masih boleh di-WO-kan) untuk
 * halaman Buat WO. mr_id datang dari query param (?mr_id=) saat masuk dari
 * tombol "Buat WO dari MR ini" di detail MR.
 */
export async function getMrForWo(mrId: number) {
  const supabase = await createClient();
  const { data: mr, error: mrError } = await supabase
    .from("mrs")
    .select("id, mr_kode, mr_status, cabang_id, cabang(nama_cabang)")
    .eq("id", mrId)
    .single();
  if (mrError || !mr) return { data: null, error: "MR tidak ditemukan." };
  if (mr.mr_status !== "approved") {
    return { data: null, error: "WO hanya bisa dibuat dari MR yang sudah approved." };
  }

  const { data: items, error: itemsError } = await supabase
    .from("mr_items")
    .select("id, part_id, part_number, part_name, satuan, qty_request, qty_wo")
    .eq("mr_id", mrId);
  if (itemsError) return { data: null, error: itemsError.message };

  const itemsWithRemaining = await Promise.all(
    (items || []).map(async (item: any) => {
      const committed = await getWoCommittedQty(supabase, item.id);
      return {
        ...item,
        wo_committed: committed,
        wo_remaining: Math.max(0, Number(item.qty_request) - committed),
      };
    }),
  );

  return { data: { mr, items: itemsWithRemaining }, error: null as string | null };
}

export async function createWorkingOrder(data: {
  wo_kode: string;
  mr_id: number;
  gudang_cabang_id: number;
  departemen: "HO" | "BPP";
  wo_tanggal: string;
  approval_template_id: number;
  items: WorkingOrderItemInput[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const woKode = data.wo_kode?.trim();
  if (!woKode) return { error: "Kode WO wajib diisi manual." };
  if (!data.gudang_cabang_id) return { error: "Gudang WO wajib dipilih." };
  if (!data.departemen || !["HO", "BPP"].includes(data.departemen))
    return { error: "Departemen wajib dipilih (HO/BPP)." };
  if (!data.approval_template_id) return { error: "Jalur approval wajib dipilih." };
  if (!data.items || data.items.length === 0)
    return { error: "Pilih minimal 1 item MR untuk di-WO-kan." };

  const { data: existingWo } = await supabase
    .from("working_orders")
    .select("id")
    .eq("wo_kode", woKode)
    .maybeSingle();
  if (existingWo) return { error: "Kode WO sudah digunakan. Gunakan kode lain." };

  const { data: mr } = await supabase
    .from("mrs")
    .select("id, mr_status, cabang_id")
    .eq("id", data.mr_id)
    .single();
  if (!mr) return { error: "MR tidak ditemukan." };
  if (mr.mr_status !== "approved")
    return { error: "WO hanya bisa dibuat dari MR yang sudah approved." };

  // Validasi server-side per item: qty tidak boleh melebihi sisa qty_request
  // MR (independen dari qty_pr/qty_sharestock_total), dan setiap PN target
  // wajib sudah punya formula WO.
  const violations: string[] = [];
  const itemsWithComponents: {
    item: WorkingOrderItemInput;
    components: any[];
  }[] = [];

  for (const item of data.items) {
    if (!item.qty || item.qty <= 0) {
      violations.push(`${item.part_number}: qty harus lebih dari 0.`);
      continue;
    }

    const { data: mrItem } = await supabase
      .from("mr_items")
      .select("id, qty_request, mr_id, part_id")
      .eq("id", item.mr_item_id)
      .single();
    if (!mrItem || mrItem.mr_id !== data.mr_id) {
      violations.push(`${item.part_number}: item MR tidak valid.`);
      continue;
    }

    const committed = await getWoCommittedQty(supabase, item.mr_item_id);
    if (committed + item.qty > mrItem.qty_request) {
      violations.push(
        `${item.part_number}: total WO (${committed + item.qty}) melebihi qty_request MR (${mrItem.qty_request}).`,
      );
      continue;
    }

    const { data: formula } = await supabase
      .from("wo_formulas")
      .select("id, wo_formula_components(*)")
      .eq("target_part_id", item.part_id)
      .maybeSingle();
    if (!formula || !formula.wo_formula_components?.length) {
      violations.push(`${item.part_number}: belum punya formula WO. Buat formula dulu.`);
      continue;
    }

    itemsWithComponents.push({ item, components: formula.wo_formula_components });
  }

  if (violations.length > 0) return { error: violations.join("\n") };

  const { data: requesterProfile } = await supabase
    .from("profiles")
    .select("id, cabang_id")
    .eq("id", user.id)
    .single();
  const requesterCabangId = requesterProfile?.cabang_id ?? mr.cabang_id;

  const approvals = await _buildApprovalFlow(
    supabase,
    "Working Order",
    requesterCabangId,
    user.id,
    data.approval_template_id,
  );
  if (!approvals.length) {
    return { error: "Template approval Working Order tidak valid atau tidak tersedia untuk site ini." };
  }

  const { data: wo, error: woError } = await supabase
    .from("working_orders")
    .insert({
      wo_kode: woKode,
      mr_id: data.mr_id,
      gudang_cabang_id: data.gudang_cabang_id,
      departemen: data.departemen,
      wo_tanggal: data.wo_tanggal,
      wo_pic_id: user.id,
      approval_template_id: data.approval_template_id,
      approvals: approvals as any,
      wo_status: "Pending Approval",
    })
    .select()
    .single();
  if (woError) return { error: woError.message };

  for (const { item, components } of itemsWithComponents) {
    const { data: woItem, error: woItemError } = await supabase
      .from("working_order_items")
      .insert({
        wo_id: wo.id,
        mr_item_id: item.mr_item_id,
        part_id: item.part_id,
        part_number: item.part_number,
        part_name: item.part_name,
        satuan: item.satuan,
        qty: item.qty,
        lead_time_days: item.lead_time_days ?? null,
        deadline_date: item.deadline_date ?? null,
      })
      .select()
      .single();
    if (woItemError) return { error: woItemError.message };

    const componentRows = components.map((c: any) => ({
      wo_item_id: woItem.id,
      component_part_id: c.component_part_id,
      component_part_number: c.component_part_number,
      component_part_name: c.component_part_name,
      component_satuan: c.component_satuan,
      qty_per_unit: c.qty_per_unit,
      qty_required: Number(c.qty_per_unit) * item.qty,
    }));
    const { error: compError } = await supabase
      .from("working_order_item_components")
      .insert(componentRows);
    if (compError) return { error: compError.message };
  }

  notifyApprovers(approvals, "WO", wo.id, wo.wo_kode, `/working-order/${wo.id}`).catch(
    console.error,
  );

  revalidatePath("/working-order");
  revalidatePath("/mr");
  return { success: true, data: wo };
}

/**
 * Terapkan efek stok On Process: kurangi stok komponen, tambah stok PN
 * target, di Gudang WO. Divalidasi dulu (semua-atau-tidak-sama-sekali)
 * karena stok bisa berubah antara WO dibuat & full-approved.
 */
export async function applyWoOnProcess(woId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: wo } = await supabase
    .from("working_orders")
    .select("id, wo_kode, gudang_cabang_id")
    .eq("id", woId)
    .single();
  if (!wo) return { error: "WO tidak ditemukan." };

  const { data: items } = await supabase
    .from("working_order_items")
    .select("id, part_id, part_number, part_name, qty, working_order_item_components(*)")
    .eq("wo_id", woId);
  if (!items || items.length === 0) return { error: "WO tidak punya item." };

  // Agregasi total kebutuhan per komponen (bisa overlap antar item), lalu
  // dibulatkan ke atas SEKALI per komponen -- bukan per baris -- supaya
  // tidak over-provisioning dari pembulatan berulang.
  const requiredByComponent = new Map<number, { total: number; sample: any }>();
  for (const item of items) {
    for (const c of item.working_order_item_components || []) {
      const prev = requiredByComponent.get(c.component_part_id);
      const total = (prev?.total || 0) + Number(c.qty_required);
      requiredByComponent.set(c.component_part_id, { total, sample: c });
    }
  }

  const violations: string[] = [];
  const stockByComponent = new Map<number, { id: number; qty: number } | null>();
  for (const [partId, { total, sample }] of requiredByComponent) {
    const needed = Math.ceil(total);
    const { data: stockRow } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", partId)
      .eq("cabang_id", wo.gudang_cabang_id)
      .maybeSingle();
    stockByComponent.set(partId, stockRow ?? null);
    const avail = stockRow?.qty ?? 0;
    if (needed > avail) {
      violations.push(
        `${sample.component_part_number}: stok Gudang WO ${avail}, dibutuhkan ${needed}.`,
      );
    }
  }
  if (violations.length > 0) {
    return { error: "Stok komponen tidak mencukupi:\n" + violations.join("\n") };
  }

  // Apply: kurangi tiap komponen (sekali per komponen, jumlah teragregasi).
  for (const [partId, { total, sample }] of requiredByComponent) {
    const needed = Math.ceil(total);
    const stockRow = stockByComponent.get(partId)!;
    await supabase
      .from("stock")
      .update({ qty: stockRow.qty - needed })
      .eq("id", stockRow.id);
    await supabase.from("stock_movements").insert({
      part_id: partId,
      cabang_id: wo.gudang_cabang_id,
      qty_change: -needed,
      type: "WO_KOMPONEN",
      reference_id: wo.wo_kode,
      created_by: user?.id,
      notes: `WO ${wo.wo_kode}: ${sample.component_part_number} keluar untuk produksi`,
    });
  }

  // Apply: tambah tiap PN target.
  for (const item of items) {
    const { data: destStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", wo.gudang_cabang_id)
      .maybeSingle();
    if (destStock) {
      await supabase
        .from("stock")
        .update({ qty: destStock.qty + item.qty })
        .eq("id", destStock.id);
    } else {
      await supabase
        .from("stock")
        .insert({ part_id: item.part_id, cabang_id: wo.gudang_cabang_id, qty: item.qty });
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: wo.gudang_cabang_id,
      qty_change: item.qty,
      type: "WO_PRODUKSI",
      reference_id: wo.wo_kode,
      created_by: user?.id,
      notes: `WO ${wo.wo_kode}: ${item.part_number} diproduksi (masuk stok)`,
    });

    await supabase
      .from("working_order_items")
      .update({ applied_qty: item.qty })
      .eq("id", item.id);

    for (const c of item.working_order_item_components || []) {
      await supabase
        .from("working_order_item_components")
        .update({ applied_qty_required: c.qty_required })
        .eq("id", c.id);
    }
  }

  revalidatePath("/working-order");
  revalidatePath("/stock");
  revalidatePath("/mr");
  return { success: true };
}

export async function approveWorkingOrder(woId: number, signatureUrl: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };
  if (!signatureUrl?.trim()) return { error: "Tanda tangan approval wajib dipilih." };

  const { data: wo } = await supabase
    .from("working_orders")
    .select("id, approvals, wo_status, wo_kode, wo_pic_id")
    .eq("id", woId)
    .single();
  if (!wo) return { error: "WO tidak ditemukan." };
  if (wo.wo_status !== "Pending Approval")
    return { error: `WO berstatus ${wo.wo_status}, tidak bisa di-approve.` };

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang)")
    .eq("id", user.id)
    .single();

  const updatedApprovals = _processStep(wo.approvals ?? [], user.id, userProfile, "approved");
  const pendingIndex = updatedApprovals.findIndex(
    (a: any) => a.userid === user.id && a.status === "approved" && !a.signature_url,
  );
  if (pendingIndex === -1) return { error: "Anda tidak memiliki step approval aktif." };
  updatedApprovals[pendingIndex].signature_url = signatureUrl;

  const isAllDone = updatedApprovals.every((a: any) => a.status !== "pending");

  if (isAllDone) {
    const result = await applyWoOnProcess(woId);
    if ((result as any)?.error) return result;
  }

  const { error: updateError } = await supabase
    .from("working_orders")
    .update({
      approvals: updatedApprovals as any,
      wo_status: isAllDone ? "On Process" : "Pending Approval",
      rejection_reason: null,
      on_process_at: isAllDone ? new Date().toISOString() : null,
    })
    .eq("id", woId);
  if (updateError) return { error: updateError.message };

  const justProcessed = updatedApprovals.find(
    (a: any) => a.userid === user.id && a.status === "approved",
  );
  if (wo.wo_pic_id) {
    notifyDocumentOwner(
      wo.wo_pic_id,
      isAllDone ? "document_completed" : "approved",
      "WO",
      woId,
      wo.wo_kode,
      `/working-order/${woId}`,
      justProcessed?.nama,
    ).catch(console.error);
  }
  if (!isAllDone) {
    const remaining = updatedApprovals.filter((a: any) => a.status === "pending");
    notifyApprovers(remaining, "WO", woId, wo.wo_kode, `/working-order/${woId}`).catch(
      console.error,
    );
  }

  revalidatePath("/working-order");
  revalidatePath(`/working-order/${woId}`);
  return { success: true, isAllDone };
}

export async function rejectWorkingOrder(woId: number, reason: string, signatureUrl: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };
  if (!reason?.trim()) return { error: "Alasan penolakan wajib diisi." };
  if (!signatureUrl?.trim()) return { error: "Tanda tangan penolakan wajib dipilih." };

  const { data: wo } = await supabase
    .from("working_orders")
    .select("id, approvals, wo_status, wo_kode, wo_pic_id")
    .eq("id", woId)
    .single();
  if (!wo) return { error: "WO tidak ditemukan." };
  if (wo.wo_status !== "Pending Approval")
    return { error: `WO berstatus ${wo.wo_status}, tidak bisa ditolak.` };

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang)")
    .eq("id", user.id)
    .single();

  const updatedApprovals = _processStep(
    wo.approvals ?? [],
    user.id,
    userProfile,
    "rejected",
    reason.trim(),
  );
  const rejectedIndex = updatedApprovals.findIndex(
    (a: any) =>
      a.userid === user.id && a.status === "rejected" && a.notes === reason.trim() && !a.signature_url,
  );
  if (rejectedIndex === -1) return { error: "Anda tidak memiliki step approval aktif." };
  updatedApprovals[rejectedIndex].signature_url = signatureUrl;

  const { error: updateError } = await supabase
    .from("working_orders")
    .update({
      approvals: updatedApprovals as any,
      wo_status: "Rejected",
      rejection_reason: reason.trim(),
    })
    .eq("id", woId);
  if (updateError) return { error: updateError.message };

  const rejecter = updatedApprovals.find((a: any) => a.userid === user.id && a.status === "rejected");
  if (wo.wo_pic_id) {
    notifyDocumentOwner(
      wo.wo_pic_id,
      "rejected",
      "WO",
      woId,
      wo.wo_kode,
      `/working-order/${woId}`,
      rejecter?.nama,
      reason,
    ).catch(console.error);
  }

  revalidatePath("/working-order");
  revalidatePath(`/working-order/${woId}`);
  return { success: true };
}

/**
 * "Selesaikan WO" -- bookkeeping only (lihat keputusan produk: distribusi
 * ke MR TIDAK memindahkan stok fisik lagi, itu sudah selesai di On
 * Process). Hanya bisa dilakukan anggota approvals[] atau moderator.
 */
export async function closeWorkingOrder(woId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: wo } = await supabase
    .from("working_orders")
    .select("id, wo_status, wo_kode, approvals")
    .eq("id", woId)
    .single();
  if (!wo) return { error: "WO tidak ditemukan." };
  if (wo.wo_status !== "On Process")
    return { error: `WO berstatus ${wo.wo_status}, tidak bisa diselesaikan.` };

  const roleNames = await getRoleNames(supabase, user.id);
  const approverIds = (wo.approvals || []).map((a: any) => a.userid).filter(Boolean);
  const isAllowed = roleNames.includes("moderator") || approverIds.includes(user.id);
  if (!isAllowed)
    return { error: "Hanya anggota approval WO ini atau moderator yang dapat menyelesaikan WO." };

  const { data: items } = await supabase
    .from("working_order_items")
    .select("id, mr_item_id, applied_qty")
    .eq("wo_id", woId);

  for (const item of items || []) {
    const { data: mrItem } = await supabase
      .from("mr_items")
      .select("qty_wo")
      .eq("id", item.mr_item_id)
      .single();
    if (mrItem) {
      await supabase
        .from("mr_items")
        .update({ qty_wo: Number(mrItem.qty_wo || 0) + Number(item.applied_qty || 0) })
        .eq("id", item.mr_item_id);
    }
  }

  const { error } = await supabase
    .from("working_orders")
    .update({ wo_status: "Closed", closed_at: new Date().toISOString(), closed_by: user.id })
    .eq("id", woId);
  if (error) return { error: error.message };

  revalidatePath("/working-order");
  revalidatePath(`/working-order/${woId}`);
  revalidatePath("/mr");
  return { success: true };
}

export async function getWorkingOrderList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("working_orders")
    .select(
      "*, mrs(mr_kode), cabang:gudang_cabang_id(nama_cabang), working_order_items(id)",
    )
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

export async function getWorkingOrderDetail(woId: number) {
  const supabase = await createClient();
  const { data: wo, error } = await supabase
    .from("working_orders")
    .select(
      "*, mrs(id, mr_kode, cabang_id, cabang(nama_cabang)), cabang:gudang_cabang_id(id, nama_cabang, cabang_type), wo_pic:wo_pic_id(nama, email), closed_by_profile:closed_by(nama)",
    )
    .eq("id", woId)
    .single();
  if (error || !wo) return { data: null, error: error?.message || "WO tidak ditemukan." };

  const { data: items } = await supabase
    .from("working_order_items")
    .select("*, working_order_item_components(*)")
    .eq("wo_id", woId)
    .order("id");

  return { data: { ...wo, items: items || [] }, error: null as string | null };
}

export type WoItemEditInput = {
  working_order_item_id: number;
  qty: number;
  lead_time_days?: number | null;
  deadline_date?: string | null;
};

/**
 * Edit WO. Status Pending Approval: patch field biasa (qty/lead time/
 * deadline), tanpa stok tersentuh. Status On Process: qty berubah berarti
 * delta stok (stok komponen & PN target sudah terlanjur diterapkan saat
 * On Process, jadi cuma SELISIH-nya yang disesuaikan, bukan re-apply
 * penuh) -- divalidasi dulu, baru diterapkan, semua tercatat di
 * working_order_edit_logs. WO Closed/Rejected tidak bisa diedit.
 */
export async function editWorkingOrder(woId: number, itemUpdates: WoItemEditInput[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };
  if (!itemUpdates || itemUpdates.length === 0) return { error: "Tidak ada perubahan." };

  const { data: wo } = await supabase
    .from("working_orders")
    .select("id, wo_kode, wo_status, gudang_cabang_id, approvals, wo_pic_id")
    .eq("id", woId)
    .single();
  if (!wo) return { error: "WO tidak ditemukan." };
  if (wo.wo_status === "Closed") return { error: "WO sudah Closed, tidak bisa diedit." };
  if (wo.wo_status === "Rejected") return { error: "WO sudah Rejected, tidak bisa diedit." };

  const roleNames = await getRoleNames(supabase, user.id);
  const isModerator = roleNames.includes("moderator");
  if (wo.wo_status === "On Process") {
    const approverIds = (wo.approvals || []).map((a: any) => a.userid).filter(Boolean);
    if (!isModerator && !approverIds.includes(user.id))
      return { error: "Hanya anggota approval WO ini atau moderator yang dapat mengedit WO." };
  } else if (wo.wo_status === "Pending Approval") {
    if (!isModerator && wo.wo_pic_id !== user.id)
      return { error: "Hanya pembuat WO atau moderator yang dapat mengedit WO saat Pending Approval." };
  }

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .maybeSingle();

  type ChangeRow = {
    woItem: any;
    newQty: number;
    oldQty: number;
    lead_time_days?: number | null;
    deadline_date?: string | null;
  };
  const changes: ChangeRow[] = [];

  for (const upd of itemUpdates) {
    if (!upd.qty || upd.qty <= 0) return { error: "Qty harus lebih dari 0." };
    const { data: woItem } = await supabase
      .from("working_order_items")
      .select("*, working_order_item_components(*)")
      .eq("id", upd.working_order_item_id)
      .single();
    if (!woItem || woItem.wo_id !== woId) return { error: "Item WO tidak valid." };

    const { data: mrItem } = await supabase
      .from("mr_items")
      .select("qty_request")
      .eq("id", woItem.mr_item_id)
      .single();
    if (mrItem) {
      const committed = await getWoCommittedQty(supabase, woItem.mr_item_id, woId);
      if (committed + upd.qty > mrItem.qty_request) {
        return {
          error: `${woItem.part_number}: total WO (${committed + upd.qty}) melebihi qty_request MR (${mrItem.qty_request}).`,
        };
      }
    }

    changes.push({
      woItem,
      newQty: upd.qty,
      oldQty: woItem.qty,
      lead_time_days: upd.lead_time_days,
      deadline_date: upd.deadline_date,
    });
  }

  // Status On Process: hitung & validasi delta stok dulu (semua-atau-tidak).
  if (wo.wo_status === "On Process") {
    const componentDelta = new Map<number, { delta: number; sample: any }>();
    for (const c of changes) {
      for (const comp of c.woItem.working_order_item_components || []) {
        const newRequired = Number(comp.qty_per_unit) * c.newQty;
        const rowDelta = newRequired - Number(comp.applied_qty_required || 0);
        const prev = componentDelta.get(comp.component_part_id);
        componentDelta.set(comp.component_part_id, {
          delta: (prev?.delta || 0) + rowDelta,
          sample: comp,
        });
      }
    }

    const violations: string[] = [];
    const stockCache = new Map<number, { id: number; qty: number } | null>();
    for (const [partId, { delta, sample }] of componentDelta) {
      if (Math.abs(delta) < 1e-9) continue;
      const { data: stockRow } = await supabase
        .from("stock")
        .select("id, qty")
        .eq("part_id", partId)
        .eq("cabang_id", wo.gudang_cabang_id)
        .maybeSingle();
      stockCache.set(partId, stockRow ?? null);
      if (delta > 0) {
        const needed = Math.ceil(delta);
        const avail = stockRow?.qty ?? 0;
        if (needed > avail) {
          violations.push(`${sample.component_part_number}: stok Gudang WO ${avail}, butuh tambahan ${needed}.`);
        }
      }
    }

    for (const c of changes) {
      const itemDelta = c.newQty - c.oldQty;
      if (itemDelta < 0) {
        const { data: destStock } = await supabase
          .from("stock")
          .select("qty")
          .eq("part_id", c.woItem.part_id)
          .eq("cabang_id", wo.gudang_cabang_id)
          .maybeSingle();
        const avail = destStock?.qty ?? 0;
        if (avail + itemDelta < 0) {
          violations.push(
            `${c.woItem.part_number}: stok PN tujuan tinggal ${avail}, tidak cukup untuk dikurangi ${-itemDelta} (kemungkinan sudah terpakai/terkirim).`,
          );
        }
      }
    }

    if (violations.length > 0) {
      return { error: "Penyesuaian stok tidak bisa diterapkan:\n" + violations.join("\n") };
    }

    // Apply component deltas (sekali per komponen, teragregasi).
    for (const [partId, { delta, sample }] of componentDelta) {
      if (Math.abs(delta) < 1e-9) continue;
      const stockRow = stockCache.get(partId);
      const qtyChange = delta > 0 ? -Math.ceil(delta) : Math.floor(-delta);
      if (stockRow) {
        await supabase.from("stock").update({ qty: stockRow.qty + qtyChange }).eq("id", stockRow.id);
      } else if (qtyChange > 0) {
        await supabase.from("stock").insert({ part_id: partId, cabang_id: wo.gudang_cabang_id, qty: qtyChange });
      }
      await supabase.from("stock_movements").insert({
        part_id: partId,
        cabang_id: wo.gudang_cabang_id,
        qty_change: qtyChange,
        type: "WO_KOMPONEN_EDIT",
        reference_id: wo.wo_kode,
        created_by: user.id,
        notes: `Edit WO ${wo.wo_kode}: penyesuaian komponen ${sample.component_part_number}`,
      });
    }

    // Apply target PN deltas.
    for (const c of changes) {
      const itemDelta = c.newQty - c.oldQty;
      if (itemDelta !== 0) {
        const { data: destStock } = await supabase
          .from("stock")
          .select("id, qty")
          .eq("part_id", c.woItem.part_id)
          .eq("cabang_id", wo.gudang_cabang_id)
          .maybeSingle();
        if (destStock) {
          await supabase.from("stock").update({ qty: destStock.qty + itemDelta }).eq("id", destStock.id);
        } else if (itemDelta > 0) {
          await supabase
            .from("stock")
            .insert({ part_id: c.woItem.part_id, cabang_id: wo.gudang_cabang_id, qty: itemDelta });
        }
        await supabase.from("stock_movements").insert({
          part_id: c.woItem.part_id,
          cabang_id: wo.gudang_cabang_id,
          qty_change: itemDelta,
          type: "WO_PRODUKSI_EDIT",
          reference_id: wo.wo_kode,
          created_by: user.id,
          notes: `Edit WO ${wo.wo_kode}: penyesuaian produksi ${c.woItem.part_number}`,
        });
      }
    }

    // Sinkronkan applied_qty / applied_qty_required ke nilai baru.
    for (const c of changes) {
      await supabase
        .from("working_order_items")
        .update({ qty: c.newQty, applied_qty: c.newQty, lead_time_days: c.lead_time_days, deadline_date: c.deadline_date })
        .eq("id", c.woItem.id);
      for (const comp of c.woItem.working_order_item_components || []) {
        const newRequired = Number(comp.qty_per_unit) * c.newQty;
        await supabase
          .from("working_order_item_components")
          .update({ qty_required: newRequired, applied_qty_required: newRequired })
          .eq("id", comp.id);
      }
    }
  } else {
    // Pending Approval: patch field biasa, tanpa stok.
    for (const c of changes) {
      await supabase
        .from("working_order_items")
        .update({ qty: c.newQty, lead_time_days: c.lead_time_days, deadline_date: c.deadline_date })
        .eq("id", c.woItem.id);
      for (const comp of c.woItem.working_order_item_components || []) {
        const newRequired = Number(comp.qty_per_unit) * c.newQty;
        await supabase.from("working_order_item_components").update({ qty_required: newRequired }).eq("id", comp.id);
      }
    }
  }

  await supabase.from("working_order_edit_logs").insert({
    wo_id: woId,
    user_id: user.id,
    user_nama: userProfile?.nama || user.email || user.id,
    summary: `Edit qty ${changes.length} item WO (status: ${wo.wo_status})`,
    changes: changes.map((c) => ({
      part_number: c.woItem.part_number,
      qty_before: c.oldQty,
      qty_after: c.newQty,
      lead_time_days: c.lead_time_days,
      deadline_date: c.deadline_date,
    })) as any,
  });

  revalidatePath("/working-order");
  revalidatePath(`/working-order/${woId}`);
  revalidatePath("/stock");
  return { success: true };
}

export async function getWoEditLogs(woId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("working_order_edit_logs")
    .select("*")
    .eq("wo_id", woId)
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}
