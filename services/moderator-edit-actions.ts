"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { notifyApprovers, notifyDocumentOwner } from "@/services/notification-actions";

export type ModeratorApprovalStep = {
  userid: string;
  nama: string;
  email?: string | null;
  approval_role: "menyetujui" | "mengetahui";
  status: "pending" | "approved" | "rejected";
  processed_at?: string | null;
  signature_url?: string | null;
  notes?: string | null;
  snapshot?: any;
};

type ModeratorAllocation = {
  mr_item_id: number;
  part_number?: string;
  qty_pr: number;
  qty_sharestock_total: number;
  deadline?: string | null;
  sharestocks: { source_cabang_id: number; qty: number; deadline?: string | null }[];
};

export type ModeratorMrEditPayload = {
  cabang_id?: number;
  mr_tanggal?: string;
  mr_due_date?: string | null;
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
  approvals: ModeratorApprovalStep[];
  rejection_reason?: string;
  allocations?: ModeratorAllocation[];
};

async function fetchRoleNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (data || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

function deriveStatus(approvals: ModeratorApprovalStep[]): "open" | "approved" | "rejected" {
  if (approvals.some((a) => a.status === "rejected")) return "rejected";
  if (approvals.length > 0 && approvals.every((a) => a.status === "approved"))
    return "approved";
  return "open";
}

/**
 * Edit MR secara penuh oleh moderator: header, items, dan jalur/status approval
 * sekaligus, di luar giliran approval normal. Karena ini bisa membuat status
 * approval "lompat" (mis. langsung approved, atau turun lagi dari approved),
 * setiap perubahan status approved yang sudah punya distribusi stock (share
 * stock/PR/delivery) diblokir supaya tidak ada distribusi yang menggantung.
 */
export async function moderatorEditMR(mrId: number, payload: ModeratorMrEditPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const roleNames = await fetchRoleNames(supabase, user.id);
  if (!roleNames.includes("moderator")) {
    return { error: "Hanya moderator yang dapat menggunakan Moderator Edit." };
  }

  const { data: mr, error: mrError } = await supabase
    .from("mrs")
    .select("*")
    .eq("id", mrId)
    .single();
  if (mrError || !mr) return { error: "MR tidak ditemukan." };

  if (!payload.approvals || payload.approvals.length === 0) {
    return { error: "Jalur approval tidak boleh kosong." };
  }
  for (const step of payload.approvals) {
    if (!step.userid || !step.nama) {
      return { error: "Setiap tahap approval harus punya approver yang dipilih." };
    }
    if (!["menyetujui", "mengetahui"].includes(step.approval_role)) {
      return { error: "Role approval tidak valid." };
    }
    if (!["pending", "approved", "rejected"].includes(step.status)) {
      return { error: "Status approval tidak valid." };
    }
  }

  const { data: currentItems } = await supabase
    .from("mr_items")
    .select("id, part_number, qty_pr, qty_sharestock_total")
    .eq("mr_id", mrId);
  const itemById = new Map((currentItems || []).map((i: any) => [i.id, i]));

  // 1. Guard: item yang akan dihapus tidak boleh sudah punya distribusi stock
  // (PR/Share Stock/Delivery) supaya tidak ada jejak distribusi yang gantung.
  if (payload.deletedItemIds && payload.deletedItemIds.length > 0) {
    const { count: prCount } = await supabase
      .from("pr_items")
      .select("id", { count: "exact", head: true })
      .in("mr_item_id", payload.deletedItemIds);
    if (prCount && prCount > 0)
      return { error: "Ada item yang mau dihapus sudah punya PR terkait. Hapus/urus PR-nya dulu." };

    const { count: dlvCount } = await supabase
      .from("delivery_items")
      .select("id", { count: "exact", head: true })
      .in("mr_item_id", payload.deletedItemIds);
    if (dlvCount && dlvCount > 0)
      return { error: "Ada item yang mau dihapus sudah punya Delivery/Share Stock terkait." };

    const { count: ssCount } = await supabase
      .from("mr_sharestock_allocations")
      .select("id", { count: "exact", head: true })
      .in("mr_item_id", payload.deletedItemIds);
    if (ssCount && ssCount > 0)
      return { error: "Ada item yang mau dihapus sudah punya alokasi Share Stock terkait." };
  }

  // 2. Guard: qty tidak boleh diturunkan di bawah qty yang sudah dialokasikan.
  if (payload.updatedItems) {
    for (const upd of payload.updatedItems) {
      const existing = itemById.get(upd.id);
      if (!existing) continue;
      const allocated = (existing.qty_pr || 0) + (existing.qty_sharestock_total || 0);
      if (allocated > 0 && upd.qty_request < allocated) {
        return {
          error: `Qty item ${existing.part_number} tidak boleh diturunkan di bawah qty yang sudah dialokasikan (${allocated}).`,
        };
      }
    }
  }

  const previousApprovedLike = ["approved", "done", "closed"].includes(mr.mr_status);
  const newStatus = deriveStatus(payload.approvals);
  const newApprovedLike = newStatus === "approved";

  if (newStatus === "rejected" && !payload.rejection_reason?.trim()) {
    return { error: "Alasan penolakan wajib diisi jika status approval jadi rejected." };
  }

  // 3. Guard: turun dari approved (atau setara) hanya boleh kalau belum ada
  // distribusi stock apapun untuk MR ini.
  let hasExistingDistribution = false;
  if (previousApprovedLike && !newApprovedLike) {
    const itemIds = (currentItems || []).map((i: any) => i.id);
    const [{ count: ssCount }, { count: prCount }, { count: dlvCount }] = await Promise.all([
      itemIds.length > 0
        ? supabase
            .from("mr_sharestock_allocations")
            .select("id", { count: "exact", head: true })
            .in("mr_item_id", itemIds)
        : Promise.resolve({ count: 0 } as any),
      supabase.from("pr_items").select("id", { count: "exact", head: true }).eq("mr_id", mrId),
      supabase.from("deliveries").select("id", { count: "exact", head: true }).eq("mr_id", mrId),
    ]);
    hasExistingDistribution = !!((ssCount || 0) > 0 || (prCount || 0) > 0 || (dlvCount || 0) > 0);
    if (hasExistingDistribution) {
      return {
        error:
          "MR ini sudah punya distribusi stock (Share Stock/PR/Delivery). Tidak bisa mengubah status approval keluar dari 'approved' tanpa membereskan distribusi tersebut terlebih dahulu.",
      };
    }
  }

  // 4. Apply item mutations.
  if (payload.deletedItemIds && payload.deletedItemIds.length > 0) {
    const { error: delErr } = await supabase
      .from("mr_items")
      .delete()
      .in("id", payload.deletedItemIds)
      .eq("mr_id", mrId);
    if (delErr) return { error: `Gagal hapus item: ${delErr.message}` };
  }

  if (payload.updatedItems && payload.updatedItems.length > 0) {
    for (const item of payload.updatedItems) {
      const itemPatch: Record<string, any> = { qty_request: item.qty_request };
      if (item.remarks !== undefined) itemPatch.remarks = item.remarks || null;
      const { error: itemErr } = await supabase
        .from("mr_items")
        .update(itemPatch)
        .eq("id", item.id)
        .eq("mr_id", mrId);
      if (itemErr) return { error: `Gagal update item: ${itemErr.message}` };
    }
  }

  let insertedItemIds: number[] = [];
  if (payload.newItems && payload.newItems.length > 0) {
    const toInsert = payload.newItems.map((i) => ({ ...i, mr_id: mrId }));
    const { data: inserted, error: insertErr } = await supabase
      .from("mr_items")
      .insert(toInsert)
      .select("id");
    if (insertErr) return { error: `Gagal tambah item: ${insertErr.message}` };
    insertedItemIds = (inserted || []).map((i: any) => i.id);
  }

  // 5. Header patch.
  const headerPatch: Record<string, any> = {
    approvals: payload.approvals,
    mr_status: newStatus,
    rejection_reason: newStatus === "rejected" ? payload.rejection_reason : null,
  };
  if (payload.cabang_id !== undefined) headerPatch.cabang_id = payload.cabang_id;
  if (payload.mr_tanggal !== undefined) headerPatch.mr_tanggal = payload.mr_tanggal;
  if (payload.mr_due_date !== undefined) headerPatch.mr_due_date = payload.mr_due_date || null;
  if (payload.mr_priority !== undefined) headerPatch.mr_priority = payload.mr_priority;

  const { error: updateErr } = await supabase.from("mrs").update(headerPatch).eq("id", mrId);
  if (updateErr) return { error: updateErr.message };

  // 6. Kalau baru pertama kali jadi fully-approved, proses Final Decision
  // (alokasi share stock vs PR) supaya qty_pr/qty_sharestock_total konsisten
  // seperti alur approve normal — tidak ada item yang "gantung" tanpa alokasi.
  if (!previousApprovedLike && newApprovedLike) {
    const finalCabangId = payload.cabang_id ?? mr.cabang_id;
    const mrDueDate = (payload.mr_due_date ?? mr.mr_due_date)
      ? String(payload.mr_due_date ?? mr.mr_due_date).slice(0, 10)
      : null;
    const allItemIds = [
      ...(currentItems || [])
        .map((i: any) => i.id)
        .filter((id: number) => !(payload.deletedItemIds || []).includes(id)),
      ...insertedItemIds,
    ];
    const allocByItem = new Map((payload.allocations || []).map((a) => [a.mr_item_id, a]));

    for (const itemId of allItemIds) {
      const alloc = allocByItem.get(itemId);
      if (!alloc) continue; // tanpa entri alokasi → default: sudah full qty_request di qty_pr lewat item update, tidak perlu apa2 di sini
      const allocationDeadline = alloc.deadline ? String(alloc.deadline).slice(0, 10) : null;

      if (
        mrDueDate &&
        Number(alloc.qty_sharestock_total || 0) > 0 &&
        !allocationDeadline
      ) {
        return {
          error: `Deadline supply wajib diisi untuk item ${alloc.part_number || itemId} (ada alokasi share stock).`,
        };
      }
      if (
        mrDueDate &&
        Number(alloc.qty_sharestock_total || 0) > 0 &&
        allocationDeadline &&
        allocationDeadline > mrDueDate
      ) {
        return {
          error: `Deadline supply item ${alloc.part_number || itemId} tidak boleh melewati due date MR (${mrDueDate}).`,
        };
      }
      if (alloc.sharestocks && alloc.sharestocks.length > 0) {
        const sameWarehouse = alloc.sharestocks.find(
          (ss) => ss.source_cabang_id === finalCabangId,
        );
        if (sameWarehouse) {
          return {
            error: `Gudang sumber untuk item ${alloc.part_number || itemId} tidak boleh sama dengan gudang tujuan MR.`,
          };
        }

        const sharestockEntries = alloc.sharestocks.map((ss) => ({
          mr_item_id: itemId,
          source_cabang_id: ss.source_cabang_id,
          qty: ss.qty,
          deadline: ss.deadline ?? alloc.deadline ?? null,
        }));
        await supabase.from("mr_sharestock_allocations").insert(sharestockEntries);
      }

      await supabase
        .from("mr_items")
        .update({
          qty_pr: alloc.qty_pr,
          qty_sharestock_total: alloc.qty_sharestock_total,
        })
        .eq("id", itemId);
    }
  }

  // 7. Audit log.
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .single();

  const summaryParts: string[] = [];
  if (payload.cabang_id !== undefined && payload.cabang_id !== mr.cabang_id)
    summaryParts.push("cabang");
  if (payload.mr_tanggal !== undefined && payload.mr_tanggal !== mr.mr_tanggal)
    summaryParts.push("tanggal");
  if (payload.mr_due_date !== undefined) summaryParts.push("due date");
  if (payload.mr_priority !== undefined && payload.mr_priority !== mr.mr_priority)
    summaryParts.push("prioritas");
  if (payload.updatedItems?.length) summaryParts.push(`${payload.updatedItems.length} item diubah`);
  if (payload.newItems?.length) summaryParts.push(`${payload.newItems.length} item ditambah`);
  if (payload.deletedItemIds?.length) summaryParts.push(`${payload.deletedItemIds.length} item dihapus`);
  if (mr.mr_status !== newStatus) summaryParts.push(`status ${mr.mr_status} → ${newStatus}`);
  summaryParts.push(`jalur approval (${payload.approvals.length} tahap)`);

  await supabase.from("moderator_edit_logs").insert({
    doc_type: "mr",
    doc_id: mrId,
    user_id: user.id,
    user_nama: myProfile?.nama || user.email,
    summary: `Moderator edit: ${summaryParts.join(", ")}.`,
    changes: {
      before: {
        cabang_id: mr.cabang_id,
        mr_tanggal: mr.mr_tanggal,
        mr_due_date: mr.mr_due_date,
        mr_priority: mr.mr_priority,
        mr_status: mr.mr_status,
        approvals: mr.approvals,
      },
      after: {
        cabang_id: headerPatch.cabang_id ?? mr.cabang_id,
        mr_tanggal: headerPatch.mr_tanggal ?? mr.mr_tanggal,
        mr_due_date: headerPatch.mr_due_date ?? mr.mr_due_date,
        mr_priority: headerPatch.mr_priority ?? mr.mr_priority,
        mr_status: newStatus,
        approvals: payload.approvals,
      },
      items: {
        updated: payload.updatedItems || [],
        added: payload.newItems || [],
        deletedIds: payload.deletedItemIds || [],
      },
    },
  });

  // 8. Notifications.
  if (mr.mr_status !== newStatus) {
    if (newStatus === "approved") {
      notifyDocumentOwner(
        mr.mr_pic_id,
        "document_completed",
        "MR",
        mrId,
        mr.mr_kode,
        `/mr/${mrId}`,
        myProfile?.nama || "Moderator",
      ).catch(console.error);
    } else if (newStatus === "rejected") {
      notifyDocumentOwner(
        mr.mr_pic_id,
        "rejected",
        "MR",
        mrId,
        mr.mr_kode,
        `/mr/${mrId}`,
        myProfile?.nama || "Moderator",
        payload.rejection_reason,
      ).catch(console.error);
    }
  }
  notifyApprovers(payload.approvals, "MR", mrId, mr.mr_kode, `/mr/${mrId}`).catch(console.error);

  revalidatePath("/mr");
  revalidatePath(`/mr/${mrId}`);
  return { success: true };
}

export async function getModeratorEditLogs(docType: "mr" | "pr" | "po" | "spb", docId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("moderator_edit_logs")
    .select("*")
    .eq("doc_type", docType)
    .eq("doc_id", docId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}
