"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { notifyApprovers, notifyDocumentOwner } from "@/services/notification-actions";
import {
  applyReturnSpbPosting,
  finalizeSpbInvoiceStatus,
} from "@/services/spb-actions";
import { applyReceiveCompletion } from "@/services/procurement-actions";

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
  // Dipakai khusus dokumen Stock Out (SPB PO/DO/Invoice/Return): label posisi
  // untuk slot tanda tangan cetak. Tidak dipakai MR/PR/PO — dibawa apa adanya
  // supaya tidak hilang saat step di-edit lewat ApprovalFlowEditor.
  position?: string | null;
};

type ModeratorAllocation = {
  mr_item_id: number;
  part_number?: string;
  qty_pr: number;
  qty_sharestock_total: number;
  deadline?: string | null;
  sharestocks: { source_cabang_id: number; qty: number; deadline?: string | null }[];
};

export type ModeratorPrEditPayload = {
  cabang_id?: number;
  pr_tanggal?: string;
  updatedItems?: { id: number; qty: number }[];
  deletedItemIds?: number[];
  approvals: ModeratorApprovalStep[];
};

export type ModeratorPoEditPayload = {
  po_tanggal?: string;
  po_estimasi?: string | null;
  po_payment_term?: string | null;
  po_keterangan?: string | null;
  updatedItems?: { id: number; qty: number }[];
  deletedItemIds?: number[];
  approvals: ModeratorApprovalStep[];
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
    .select("id, part_number, qty_pr, qty_sharestock_total, qty_request")
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

    // Ambil qty_request OTORITATIF langsung dari DB. Step 4 di atas SUDAH
    // menjalankan delete/update/insert item, jadi qty_request di DB di sini
    // sudah final untuk item lama yang di-update maupun item baru.
    const { data: freshItems, error: freshItemsError } = await supabase
      .from("mr_items")
      .select("id, part_number, qty_request")
      .in("id", allItemIds);
    if (freshItemsError) return { error: freshItemsError.message };
    const freshById = new Map((freshItems || []).map((i: any) => [i.id, i]));

    // ---------- VALIDATE ALL FIRST (belum ada mutasi alokasi) ----------
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
      }

      const freshItem = freshById.get(itemId);
      if (!freshItem) {
        return { error: `Item MR (id ${itemId}) tidak ditemukan untuk validasi alokasi.` };
      }
      const requestedShare = Number(alloc.qty_sharestock_total || 0);
      if (requestedShare > freshItem.qty_request) {
        return {
          error: `Total share stock item ${freshItem.part_number} (${requestedShare}) melebihi qty yang diminta MR (${freshItem.qty_request}).`,
        };
      }
      const sumSS = (alloc.sharestocks || []).reduce(
        (s, ss) => s + Number(ss.qty || 0),
        0,
      );
      if (sumSS !== requestedShare) {
        return {
          error: `Data alokasi item ${freshItem.part_number} tidak konsisten (total baris ${sumSS} != ${requestedShare}).`,
        };
      }
    }

    // ---------- SEMUA VALID -> APPLY MUTASI ----------
    for (const itemId of allItemIds) {
      const alloc = allocByItem.get(itemId);
      if (!alloc) continue;

      if (alloc.sharestocks && alloc.sharestocks.length > 0) {
        const sharestockEntries = alloc.sharestocks.map((ss) => ({
          mr_item_id: itemId,
          source_cabang_id: ss.source_cabang_id,
          qty: ss.qty,
          deadline: ss.deadline ?? alloc.deadline ?? null,
        }));
        const { error: insErr } = await supabase
          .from("mr_sharestock_allocations")
          .insert(sharestockEntries);
        if (insErr) return { error: insErr.message };
      }

      const { error: updErr } = await supabase
        .from("mr_items")
        .update({
          qty_pr: alloc.qty_pr,
          qty_sharestock_total: alloc.qty_sharestock_total,
        })
        .eq("id", itemId);
      if (updErr) return { error: updErr.message };
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

// Duplicated (not imported) from procurement-actions.ts's _applyMrConversionStatus /
// _applyPrConversionStatus: those live in a "use server" module where every export
// becomes a Server Action, so importing an internal helper with a non-serializable
// `supabase` client argument across that boundary is unsafe. Kept in sync manually —
// same aggregation logic (qty converted vs qty available → pending/partial/complete).
async function _recomputeMrConvertStatus(mrId: number, supabase: any) {
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
    (s: number, i: any) => s + Math.min(i.qty_pr || 0, convertedMap.get(i.id) || 0),
    0,
  );
  const status =
    totalConverted <= 0 ? "pending" : totalConverted < totalQtyPr ? "partial" : "complete";
  await supabase.from("mrs").update({ mr_convert_status: status }).eq("id", mrId);
}

async function _recomputePrConvertStatus(prId: number, supabase: any) {
  const { data: items } = await supabase.from("pr_items").select("id, qty").eq("pr_id", prId);
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
  const status = totalConverted <= 0 ? "pending" : totalConverted < totalQty ? "partial" : "complete";
  await supabase.from("prs").update({ pr_convert_status: status }).eq("id", prId);
}

/**
 * Edit PR secara penuh oleh moderator: header, qty item (existing saja — item
 * baru tetap lewat alur konversi MR→PR biasa karena selalu terikat ke satu
 * mr_item spesifik), dan jalur/status approval, di luar giliran approval
 * normal. PR tidak punya langkah "final decision" seperti MR (tidak ada split
 * share stock), jadi tidak perlu form alokasi tambahan saat status berubah ke
 * approved — tapi tetap dijaga supaya tidak overconvert dari MR atau
 * meninggalkan PO yang menggantung.
 */
export async function moderatorEditPR(prId: number, payload: ModeratorPrEditPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const roleNames = await fetchRoleNames(supabase, user.id);
  if (!roleNames.includes("moderator")) {
    return { error: "Hanya moderator yang dapat menggunakan Moderator Edit." };
  }

  const { data: pr, error: prError } = await supabase
    .from("prs")
    .select("*")
    .eq("id", prId)
    .single();
  if (prError || !pr) return { error: "PR tidak ditemukan." };

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
    .from("pr_items")
    .select("id, mr_id, mr_item_id, part_number, qty")
    .eq("pr_id", prId);
  const itemById = new Map((currentItems || []).map((i: any) => [i.id, i]));

  // 1. Guard: item yang mau dihapus tidak boleh sudah dikonversi ke PO.
  if (payload.deletedItemIds && payload.deletedItemIds.length > 0) {
    const { count: poCount } = await supabase
      .from("po_items")
      .select("id", { count: "exact", head: true })
      .in("pr_item_id", payload.deletedItemIds);
    if (poCount && poCount > 0) {
      return {
        error: "Ada item yang mau dihapus sudah dikonversi ke PO. Urus PO-nya dulu.",
      };
    }
  }

  if (payload.updatedItems && payload.updatedItems.length > 0) {
    const updatedIds = payload.updatedItems.map((u) => u.id);

    // 2. Guard: qty tidak boleh diturunkan di bawah qty yang sudah dikonversi ke PO.
    const { data: poRows } = await supabase
      .from("po_items")
      .select("pr_item_id, qty, pos!inner(po_status)")
      .in("pr_item_id", updatedIds);
    const convertedToPoMap = new Map<number, number>();
    for (const row of poRows || []) {
      const poStatus = Array.isArray((row as any).pos)
        ? (row as any).pos[0]?.po_status
        : (row as any).pos?.po_status;
      if (poStatus === "rejected") continue;
      convertedToPoMap.set(row.pr_item_id, (convertedToPoMap.get(row.pr_item_id) || 0) + row.qty);
    }
    for (const upd of payload.updatedItems) {
      const converted = convertedToPoMap.get(upd.id) || 0;
      if (converted > 0 && upd.qty < converted) {
        const existing = itemById.get(upd.id);
        return {
          error: `Qty item ${existing?.part_number || upd.id} tidak boleh diturunkan di bawah qty yang sudah dikonversi ke PO (${converted}).`,
        };
      }
    }

    // 3. Guard: qty tidak boleh melebihi sisa qty_pr dari MR item sumbernya
    // (menghitung qty yang sudah dipakai PR lain di luar PR ini).
    const mrItemIds = Array.from(
      new Set(
        payload.updatedItems
          .map((u) => itemById.get(u.id)?.mr_item_id)
          .filter((id): id is number => Boolean(id)),
      ),
    );
    if (mrItemIds.length > 0) {
      const { data: mrItemRows } = await supabase
        .from("mr_items")
        .select("id, qty_pr, part_number")
        .in("id", mrItemIds);
      const { data: siblingPrItems } = await supabase
        .from("pr_items")
        .select("mr_item_id, qty, prs!inner(pr_status)")
        .in("mr_item_id", mrItemIds)
        .neq("pr_id", prId);

      const elsewhereMap = new Map<number, number>();
      for (const row of siblingPrItems || []) {
        const prStatus = Array.isArray((row as any).prs)
          ? (row as any).prs[0]?.pr_status
          : (row as any).prs?.pr_status;
        if (prStatus === "rejected") continue;
        elsewhereMap.set(row.mr_item_id, (elsewhereMap.get(row.mr_item_id) || 0) + row.qty);
      }
      const mrItemById = new Map((mrItemRows || []).map((r: any) => [r.id, r]));

      for (const upd of payload.updatedItems) {
        const item = itemById.get(upd.id);
        if (!item?.mr_item_id) continue;
        const mrItem = mrItemById.get(item.mr_item_id);
        if (!mrItem) continue;
        const elsewhere = elsewhereMap.get(item.mr_item_id) || 0;
        const remaining = Math.max(0, (mrItem.qty_pr || 0) - elsewhere);
        if (upd.qty > remaining) {
          return {
            error: `Qty item ${item.part_number} melebihi sisa yang bisa dikonversi dari MR (sisa ${remaining}).`,
          };
        }
      }
    }
  }

  const previousApprovedLike = ["approved", "done", "closed"].includes(pr.pr_status);
  const newStatus = deriveStatus(payload.approvals);
  const newApprovedLike = newStatus === "approved";

  if (newStatus === "rejected") {
    const rejectedStep = payload.approvals.find((a) => a.status === "rejected");
    if (!rejectedStep?.notes?.trim()) {
      return { error: "Catatan/alasan penolakan wajib diisi pada tahap yang di-reject." };
    }
  }

  // 4. Guard: turun dari approved (atau setara) hanya boleh kalau PR ini belum
  // dikonversi ke PO sama sekali.
  if (previousApprovedLike && !newApprovedLike) {
    const itemIds = (currentItems || []).map((i: any) => i.id);
    const { count: poCount } =
      itemIds.length > 0
        ? await supabase
            .from("po_items")
            .select("id", { count: "exact", head: true })
            .in("pr_item_id", itemIds)
        : ({ count: 0 } as any);
    if (poCount && poCount > 0) {
      return {
        error:
          "PR ini sudah dikonversi ke PO. Tidak bisa mengubah status approval keluar dari 'approved' tanpa membereskan PO tersebut terlebih dahulu.",
      };
    }
  }

  // 5. Apply item mutations.
  if (payload.deletedItemIds && payload.deletedItemIds.length > 0) {
    const { error: delErr } = await supabase
      .from("pr_items")
      .delete()
      .in("id", payload.deletedItemIds)
      .eq("pr_id", prId);
    if (delErr) return { error: `Gagal hapus item: ${delErr.message}` };
  }
  if (payload.updatedItems && payload.updatedItems.length > 0) {
    for (const item of payload.updatedItems) {
      const { error: itemErr } = await supabase
        .from("pr_items")
        .update({ qty: item.qty })
        .eq("id", item.id)
        .eq("pr_id", prId);
      if (itemErr) return { error: `Gagal update item: ${itemErr.message}` };
    }
  }

  // 6. Header patch.
  const headerPatch: Record<string, any> = {
    approvals: payload.approvals,
    pr_status: newStatus,
  };
  if (payload.cabang_id !== undefined) headerPatch.cabang_id = payload.cabang_id;
  if (payload.pr_tanggal !== undefined) headerPatch.pr_tanggal = payload.pr_tanggal;

  const { error: updateErr } = await supabase.from("prs").update(headerPatch).eq("id", prId);
  if (updateErr) return { error: updateErr.message };

  // 7. Recompute conversion progress (denominator/numerator berubah kalau ada
  // item dihapus/qty berubah) supaya persentase di UI lain tidak jadi janggal.
  if (
    (payload.deletedItemIds && payload.deletedItemIds.length > 0) ||
    (payload.updatedItems && payload.updatedItems.length > 0)
  ) {
    await _recomputePrConvertStatus(prId, supabase);
    const involvedMrIds = Array.from(
      new Set((currentItems || []).map((i: any) => i.mr_id).filter(Boolean)),
    );
    await Promise.all(involvedMrIds.map((mrId) => _recomputeMrConvertStatus(mrId, supabase)));
  }

  // 8. Audit log.
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .single();

  const summaryParts: string[] = [];
  if (payload.cabang_id !== undefined && payload.cabang_id !== pr.cabang_id)
    summaryParts.push("cabang");
  if (payload.pr_tanggal !== undefined && payload.pr_tanggal !== pr.pr_tanggal)
    summaryParts.push("tanggal");
  if (payload.updatedItems?.length) summaryParts.push(`${payload.updatedItems.length} item diubah`);
  if (payload.deletedItemIds?.length) summaryParts.push(`${payload.deletedItemIds.length} item dihapus`);
  if (pr.pr_status !== newStatus) summaryParts.push(`status ${pr.pr_status} → ${newStatus}`);
  summaryParts.push(`jalur approval (${payload.approvals.length} tahap)`);

  await supabase.from("moderator_edit_logs").insert({
    doc_type: "pr",
    doc_id: prId,
    user_id: user.id,
    user_nama: myProfile?.nama || user.email,
    summary: `Moderator edit: ${summaryParts.join(", ")}.`,
    changes: {
      before: {
        cabang_id: pr.cabang_id,
        pr_tanggal: pr.pr_tanggal,
        pr_status: pr.pr_status,
        approvals: pr.approvals,
      },
      after: {
        cabang_id: headerPatch.cabang_id ?? pr.cabang_id,
        pr_tanggal: headerPatch.pr_tanggal ?? pr.pr_tanggal,
        pr_status: newStatus,
        approvals: payload.approvals,
      },
      items: {
        updated: payload.updatedItems || [],
        deletedIds: payload.deletedItemIds || [],
      },
    },
  });

  // 9. Notifications.
  if (pr.pr_status !== newStatus) {
    if (newStatus === "approved") {
      notifyDocumentOwner(
        pr.pr_pic_id,
        "document_completed",
        "PR",
        prId,
        pr.pr_kode,
        `/pr/${prId}`,
        myProfile?.nama || "Moderator",
      ).catch(console.error);
    } else if (newStatus === "rejected") {
      const rejectedStep = payload.approvals.find((a) => a.status === "rejected");
      notifyDocumentOwner(
        pr.pr_pic_id,
        "rejected",
        "PR",
        prId,
        pr.pr_kode,
        `/pr/${prId}`,
        myProfile?.nama || "Moderator",
        rejectedStep?.notes || undefined,
      ).catch(console.error);
    }
  }
  notifyApprovers(payload.approvals, "PR", prId, pr.pr_kode, `/pr/${prId}`).catch(console.error);

  revalidatePath("/pr");
  return { success: true };
}

// Mirrors the receive-status aggregation in createReceive() (procurement-actions.ts):
// qty_received per line vs qty ordered → pending/partial/complete. Only the
// receive_status is synced here (po_status stays whatever the moderator set via
// approvals) since qty can shrink under Moderator Edit and change the percentage.
async function _recomputePoReceiveStatus(poId: number, supabase: any) {
  const { data: items } = await supabase
    .from("po_items")
    .select("qty, qty_received")
    .eq("po_id", poId);
  if (!items || items.length === 0) return;

  const allReceived = items.every((i: any) => i.qty_received >= i.qty);
  const someReceived = items.some((i: any) => i.qty_received > 0);
  const status = allReceived ? "complete" : someReceived ? "partial" : "pending";
  await supabase.from("pos").update({ po_receive_status: status }).eq("id", poId);
}

/**
 * Edit PO secara penuh oleh moderator: header (tanggal/estimasi/payment
 * term/keterangan), qty item (existing saja — sama seperti PR, item baru
 * selalu terikat ke satu pr_item spesifik jadi tidak didukung di sini), dan
 * jalur/status approval. Harga & vendor sengaja TIDAK bisa diedit lewat mode
 * ini — itu ranah akses harga (role "purchasing", lihat lib/po-price-access.ts)
 * dan di luar concern approval/stock yang jadi fokus Moderator Edit.
 */
export async function moderatorEditPO(poId: number, payload: ModeratorPoEditPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const roleNames = await fetchRoleNames(supabase, user.id);
  if (!roleNames.includes("moderator")) {
    return { error: "Hanya moderator yang dapat menggunakan Moderator Edit." };
  }

  const { data: po, error: poError } = await supabase
    .from("pos")
    .select("*")
    .eq("id", poId)
    .single();
  if (poError || !po) return { error: "PO tidak ditemukan." };

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
    .from("po_items")
    .select("id, part_number, qty, qty_received, pr_item_id")
    .eq("po_id", poId);
  const itemById = new Map((currentItems || []).map((i: any) => [i.id, i]));

  // 1. Guard: item yang mau dihapus tidak boleh sudah ada barang yang diterima.
  if (payload.deletedItemIds && payload.deletedItemIds.length > 0) {
    for (const id of payload.deletedItemIds) {
      const item = itemById.get(id);
      if (item && item.qty_received > 0) {
        return {
          error: `Item ${item.part_number} sudah ada barang diterima (${item.qty_received}), tidak bisa dihapus.`,
        };
      }
    }
  }

  if (payload.updatedItems && payload.updatedItems.length > 0) {
    // 2. Guard: qty tidak boleh diturunkan di bawah qty yang sudah diterima.
    for (const upd of payload.updatedItems) {
      const item = itemById.get(upd.id);
      if (item && upd.qty < item.qty_received) {
        return {
          error: `Qty item ${item.part_number} tidak boleh diturunkan di bawah qty yang sudah diterima (${item.qty_received}).`,
        };
      }
    }

    // 3. Guard: qty tidak boleh melebihi sisa qty pr_items sumbernya (menghitung
    // qty yang sudah dipakai PO lain di luar PO ini, seperti guard di createPurchaseOrder).
    const prItemIds = Array.from(
      new Set(
        payload.updatedItems
          .map((u) => itemById.get(u.id)?.pr_item_id)
          .filter((id): id is number => Boolean(id)),
      ),
    );
    if (prItemIds.length > 0) {
      const { data: prItemRows } = await supabase
        .from("pr_items")
        .select("id, qty, part_number")
        .in("id", prItemIds);
      const { data: siblingPoItems } = await supabase
        .from("po_items")
        .select("pr_item_id, qty, pos!inner(po_status)")
        .in("pr_item_id", prItemIds)
        .neq("po_id", poId);

      const elsewhereMap = new Map<number, number>();
      for (const row of siblingPoItems || []) {
        const poStatus = Array.isArray((row as any).pos)
          ? (row as any).pos[0]?.po_status
          : (row as any).pos?.po_status;
        if (poStatus === "rejected") continue;
        elsewhereMap.set(row.pr_item_id, (elsewhereMap.get(row.pr_item_id) || 0) + row.qty);
      }
      const prItemById = new Map((prItemRows || []).map((r: any) => [r.id, r]));

      for (const upd of payload.updatedItems) {
        const item = itemById.get(upd.id);
        if (!item?.pr_item_id) continue;
        const prItem = prItemById.get(item.pr_item_id);
        if (!prItem) continue;
        const elsewhere = elsewhereMap.get(item.pr_item_id) || 0;
        const remaining = Math.max(0, (prItem.qty || 0) - elsewhere);
        if (upd.qty > remaining) {
          return {
            error: `Qty item ${item.part_number} melebihi sisa yang bisa dikonversi dari PR (sisa ${remaining}).`,
          };
        }
      }
    }
  }

  const previousApprovedLike = ["approved", "done", "closed"].includes(po.po_status);
  const newStatus = deriveStatus(payload.approvals);
  const newApprovedLike = newStatus === "approved";

  if (newStatus === "rejected") {
    const rejectedStep = payload.approvals.find((a) => a.status === "rejected");
    if (!rejectedStep?.notes?.trim()) {
      return { error: "Catatan/alasan penolakan wajib diisi pada tahap yang di-reject." };
    }
  }

  // 4. Guard: turun dari approved (atau setara) hanya boleh kalau belum ada
  // barang yang diterima sama sekali untuk PO ini.
  if (previousApprovedLike && !newApprovedLike && po.po_receive_status !== "pending") {
    return {
      error:
        "PO ini sudah mulai diterima (partial/complete). Tidak bisa mengubah status approval keluar dari 'approved' tanpa membereskan penerimaan tersebut terlebih dahulu.",
    };
  }

  // 5. Apply item mutations.
  if (payload.deletedItemIds && payload.deletedItemIds.length > 0) {
    const { error: delErr } = await supabase
      .from("po_items")
      .delete()
      .in("id", payload.deletedItemIds)
      .eq("po_id", poId);
    if (delErr) return { error: `Gagal hapus item: ${delErr.message}` };
  }
  if (payload.updatedItems && payload.updatedItems.length > 0) {
    for (const item of payload.updatedItems) {
      const { error: itemErr } = await supabase
        .from("po_items")
        .update({ qty: item.qty })
        .eq("id", item.id)
        .eq("po_id", poId);
      if (itemErr) return { error: `Gagal update item: ${itemErr.message}` };
    }
  }

  // 6. Header patch.
  const headerPatch: Record<string, any> = {
    approvals: payload.approvals,
    po_status: newStatus,
  };
  if (payload.po_tanggal !== undefined) headerPatch.po_tanggal = payload.po_tanggal;
  if (payload.po_estimasi !== undefined) headerPatch.po_estimasi = payload.po_estimasi || null;
  if (payload.po_payment_term !== undefined)
    headerPatch.po_payment_term = payload.po_payment_term || null;
  if (payload.po_keterangan !== undefined)
    headerPatch.po_keterangan = payload.po_keterangan || null;

  const { error: updateErr } = await supabase.from("pos").update(headerPatch).eq("id", poId);
  if (updateErr) return { error: updateErr.message };

  // 7. Recompute penerimaan (denominator berubah kalau qty diubah/item dihapus)
  // dan progres konversi PR sumbernya, supaya tidak ada persentase yang janggal.
  if (
    (payload.deletedItemIds && payload.deletedItemIds.length > 0) ||
    (payload.updatedItems && payload.updatedItems.length > 0)
  ) {
    await _recomputePoReceiveStatus(poId, supabase);
    const prItemIds = (currentItems || [])
      .map((i: any) => i.pr_item_id)
      .filter(Boolean);
    if (prItemIds.length > 0) {
      const { data: prItemRows } = await supabase
        .from("pr_items")
        .select("id, pr_id")
        .in("id", prItemIds);
      const involvedPrIds = Array.from(
        new Set((prItemRows || []).map((r: any) => r.pr_id).filter(Boolean)),
      );
      await Promise.all(involvedPrIds.map((prId) => _recomputePrConvertStatus(prId, supabase)));
    }
  }

  // 8. Audit log.
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .single();

  const summaryParts: string[] = [];
  if (payload.po_tanggal !== undefined && payload.po_tanggal !== po.po_tanggal)
    summaryParts.push("tanggal");
  if (payload.po_estimasi !== undefined) summaryParts.push("estimasi terima");
  if (payload.po_payment_term !== undefined) summaryParts.push("payment term");
  if (payload.po_keterangan !== undefined) summaryParts.push("keterangan");
  if (payload.updatedItems?.length) summaryParts.push(`${payload.updatedItems.length} item diubah`);
  if (payload.deletedItemIds?.length) summaryParts.push(`${payload.deletedItemIds.length} item dihapus`);
  if (po.po_status !== newStatus) summaryParts.push(`status ${po.po_status} → ${newStatus}`);
  summaryParts.push(`jalur approval (${payload.approvals.length} tahap)`);

  await supabase.from("moderator_edit_logs").insert({
    doc_type: "po",
    doc_id: poId,
    user_id: user.id,
    user_nama: myProfile?.nama || user.email,
    summary: `Moderator edit: ${summaryParts.join(", ")}.`,
    changes: {
      before: {
        po_tanggal: po.po_tanggal,
        po_estimasi: po.po_estimasi,
        po_payment_term: po.po_payment_term,
        po_keterangan: po.po_keterangan,
        po_status: po.po_status,
        approvals: po.approvals,
      },
      after: {
        po_tanggal: headerPatch.po_tanggal ?? po.po_tanggal,
        po_estimasi: headerPatch.po_estimasi ?? po.po_estimasi,
        po_payment_term: headerPatch.po_payment_term ?? po.po_payment_term,
        po_keterangan: headerPatch.po_keterangan ?? po.po_keterangan,
        po_status: newStatus,
        approvals: payload.approvals,
      },
      items: {
        updated: payload.updatedItems || [],
        deletedIds: payload.deletedItemIds || [],
      },
    },
  });

  // 9. Notifications.
  if (po.po_status !== newStatus) {
    if (newStatus === "approved" && po.po_pic_id) {
      notifyDocumentOwner(
        po.po_pic_id,
        "document_completed",
        "PO",
        poId,
        po.po_kode,
        `/po/${poId}`,
        myProfile?.nama || "Moderator",
      ).catch(console.error);
    } else if (newStatus === "rejected" && po.po_pic_id) {
      const rejectedStep = payload.approvals.find((a) => a.status === "rejected");
      notifyDocumentOwner(
        po.po_pic_id,
        "rejected",
        "PO",
        poId,
        po.po_kode,
        `/po/${poId}`,
        myProfile?.nama || "Moderator",
        rejectedStep?.notes || undefined,
      ).catch(console.error);
    }
  }
  notifyApprovers(payload.approvals, "PO", poId, po.po_kode, `/po/${poId}`).catch(console.error);

  revalidatePath("/po");
  return { success: true };
}

// ============================================================
// RECEIVE ITEM (GRN)
// ============================================================

export type ModeratorReceiveEditPayload = {
  ri_tanggal?: string;
  ri_pic?: string;
  ri_keterangan?: string | null;
  updatedItems?: { id: number; qty: number }[];
  deletedItemIds?: number[];
  approvals: ModeratorApprovalStep[];
  rejection_reason?: string;
};

/**
 * Edit Receive Item (GRN) secara penuh oleh moderator: header (tanggal/PIC/
 * keterangan), qty item, dan jalur/status approval, di luar giliran approval
 * normal. Begitu ri_status sudah 'completed', stok, po_items.qty_received,
 * dan mr_items.qty_received sudah diposting (lihat applyReceiveCompletion) —
 * jadi item TIDAK BOLEH diubah lagi lewat mode ini, dan status approval tidak
 * boleh diturunkan dari 'completed', supaya tidak ada posting yang jadi tidak
 * konsisten dengan data receive-nya sendiri. Kalau moderator menyetujui semua
 * tahap lewat mode ini sehingga baru pertama kali completed, posting stok
 * yang sama seperti alur approve normal tetap dijalankan (applyReceiveCompletion).
 */
export async function moderatorEditReceive(riId: number, payload: ModeratorReceiveEditPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const roleNames = await fetchRoleNames(supabase, user.id);
  if (!roleNames.includes("moderator")) {
    return { error: "Hanya moderator yang dapat menggunakan Moderator Edit." };
  }

  const { data: ri, error: riError } = await supabase
    .from("receives")
    .select("*")
    .eq("id", riId)
    .single();
  if (riError || !ri) return { error: "Receive tidak ditemukan." };

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

  const previousStatus: string = ri.ri_status || "open";
  const previousCompleted = previousStatus === "completed";

  // 1. Guard: item tidak boleh diubah lagi kalau sudah completed (stok/po_items
  // /mr_items sudah diposting dan tidak otomatis di-rollback/re-posting di sini).
  if (
    previousCompleted &&
    ((payload.updatedItems && payload.updatedItems.length > 0) ||
      (payload.deletedItemIds && payload.deletedItemIds.length > 0))
  ) {
    return {
      error:
        "Receive ini sudah completed — stok dan qty_received sudah diposting. Item tidak bisa diubah lagi lewat Moderator Edit.",
    };
  }

  const { data: currentItems } = await supabase
    .from("receive_items")
    .select("id, part_number, qty, po_item_id")
    .eq("ri_id", riId);
  const itemById = new Map((currentItems || []).map((i: any) => [i.id, i]));

  // 2. Guard: qty item yang diupdate tidak boleh melebihi sisa qty PO item
  // sumbernya (qty PO dikurangi qty yang sudah diterima dari receive lain —
  // receive ini sendiri belum diposting selama belum completed).
  if (payload.updatedItems && payload.updatedItems.length > 0) {
    const poItemIds = Array.from(
      new Set(
        payload.updatedItems
          .map((u) => itemById.get(u.id)?.po_item_id)
          .filter((id): id is number => Boolean(id)),
      ),
    );
    if (poItemIds.length > 0) {
      const { data: poItemRows } = await supabase
        .from("po_items")
        .select("id, qty, qty_received, part_number")
        .in("id", poItemIds);
      const poItemById = new Map((poItemRows || []).map((r: any) => [r.id, r]));

      for (const upd of payload.updatedItems) {
        const item = itemById.get(upd.id);
        if (!item?.po_item_id) continue;
        const poItem = poItemById.get(item.po_item_id);
        if (!poItem) continue;
        const remaining = Math.max(0, (poItem.qty || 0) - (poItem.qty_received || 0));
        if (upd.qty > remaining) {
          return {
            error: `Qty item ${item.part_number} melebihi sisa yang bisa diterima dari PO (sisa ${remaining}).`,
          };
        }
      }
    }
  }

  const newStatus = deriveStockOutStatus(payload.approvals);
  const newCompleted = newStatus === "completed";

  if (newStatus === "rejected" && !payload.rejection_reason?.trim()) {
    return { error: "Alasan penolakan wajib diisi jika status approval jadi rejected." };
  }

  // 3. Guard: status approval tidak boleh diturunkan dari 'completed' — begitu
  // completed, stok/po_items/mr_items sudah diposting berdasarkan data saat itu.
  if (previousCompleted && !newCompleted) {
    return {
      error:
        "Receive ini sudah completed dan stoknya sudah diposting ke inventory. Tidak bisa mengubah status approval keluar dari 'completed'.",
    };
  }

  // 4. Apply item mutations (hanya kalau belum completed, sudah dijamin guard #1).
  if (payload.deletedItemIds && payload.deletedItemIds.length > 0) {
    const { error: delErr } = await supabase
      .from("receive_items")
      .delete()
      .in("id", payload.deletedItemIds)
      .eq("ri_id", riId);
    if (delErr) return { error: `Gagal hapus item: ${delErr.message}` };
  }
  if (payload.updatedItems && payload.updatedItems.length > 0) {
    for (const item of payload.updatedItems) {
      const { error: itemErr } = await supabase
        .from("receive_items")
        .update({ qty: item.qty })
        .eq("id", item.id)
        .eq("ri_id", riId);
      if (itemErr) return { error: `Gagal update item: ${itemErr.message}` };
    }
  }

  // 5. Header patch.
  const headerPatch: Record<string, any> = {
    approvals: payload.approvals,
    ri_status: newStatus,
    rejection_reason: newStatus === "rejected" ? payload.rejection_reason : null,
    completed_at: newCompleted ? (ri.completed_at ?? new Date().toISOString()) : null,
  };
  if (payload.ri_tanggal !== undefined) headerPatch.ri_tanggal = payload.ri_tanggal;
  if (payload.ri_pic !== undefined) headerPatch.ri_pic = payload.ri_pic;
  if (payload.ri_keterangan !== undefined) headerPatch.ri_keterangan = payload.ri_keterangan || null;

  const { error: updateErr } = await supabase.from("receives").update(headerPatch).eq("id", riId);
  if (updateErr) return { error: updateErr.message };

  // 6. Baru pertama kali completed lewat mode ini → jalankan posting stok yang
  // sama seperti alur approve normal. Kalau gagal, rollback status supaya tidak
  // ada dokumen yang "completed" tanpa posting.
  if (!previousCompleted && newCompleted) {
    const completionResult = await applyReceiveCompletion(riId);
    if ((completionResult as any)?.error) {
      await supabase
        .from("receives")
        .update({ ri_status: previousStatus, completed_at: ri.completed_at ?? null })
        .eq("id", riId);
      return completionResult;
    }
  }

  // 7. Audit log.
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .single();

  const summaryParts: string[] = [];
  if (payload.ri_tanggal !== undefined && payload.ri_tanggal !== ri.ri_tanggal)
    summaryParts.push("tanggal");
  if (payload.ri_pic !== undefined && payload.ri_pic !== ri.ri_pic) summaryParts.push("PIC");
  if (payload.ri_keterangan !== undefined) summaryParts.push("keterangan");
  if (payload.updatedItems?.length) summaryParts.push(`${payload.updatedItems.length} item diubah`);
  if (payload.deletedItemIds?.length) summaryParts.push(`${payload.deletedItemIds.length} item dihapus`);
  if (previousStatus !== newStatus) summaryParts.push(`status ${previousStatus} → ${newStatus}`);
  summaryParts.push(`jalur approval (${payload.approvals.length} tahap)`);

  await supabase.from("moderator_edit_logs").insert({
    doc_type: "receive",
    doc_id: riId,
    user_id: user.id,
    user_nama: myProfile?.nama || user.email,
    summary: `Moderator edit: ${summaryParts.join(", ")}.`,
    changes: {
      before: {
        ri_tanggal: ri.ri_tanggal,
        ri_pic: ri.ri_pic,
        ri_keterangan: ri.ri_keterangan,
        ri_status: previousStatus,
        approvals: ri.approvals,
      },
      after: {
        ri_tanggal: headerPatch.ri_tanggal ?? ri.ri_tanggal,
        ri_pic: headerPatch.ri_pic ?? ri.ri_pic,
        ri_keterangan: headerPatch.ri_keterangan ?? ri.ri_keterangan,
        ri_status: newStatus,
        approvals: payload.approvals,
      },
      items: {
        updated: payload.updatedItems || [],
        deletedIds: payload.deletedItemIds || [],
      },
    },
  });

  // 8. Notifications.
  if (previousStatus !== newStatus && ri.ri_pic_id) {
    if (newStatus === "completed") {
      notifyDocumentOwner(
        ri.ri_pic_id,
        "document_completed",
        "RI",
        riId,
        ri.ri_kode,
        `/receive`,
        myProfile?.nama || "Moderator",
      ).catch(console.error);
    } else if (newStatus === "rejected") {
      notifyDocumentOwner(
        ri.ri_pic_id,
        "rejected",
        "RI",
        riId,
        ri.ri_kode,
        `/receive`,
        myProfile?.nama || "Moderator",
        payload.rejection_reason,
      ).catch(console.error);
    }
  }
  notifyApprovers(payload.approvals, "RI", riId, ri.ri_kode, `/receive`).catch(console.error);

  revalidatePath("/receive");
  revalidatePath("/po");
  revalidatePath("/stock");
  revalidatePath("/mr");
  return { success: true };
}

// ============================================================
// STOCK OUT (SPB) — spb_invoice, return_spb
// ============================================================
//
// Base `spb`, SPB PO, dan SPB DO sengaja tidak dapat Moderator Edit lewat
// jalur ini: ketiganya tidak lagi punya approval digital (langsung
// 'completed' saat dibuat — lihat komentar di createSpb/createSpbPo/
// createSpbDo, services/spb-actions.ts) dan punya jalur edit/cancel sendiri
// yang lebih simpel (updateSpb/updateSpbPo/updateSpbDo, tanpa approvals).
// Dua dokumen turunan yang tersisa (Invoice/Return) masing-masing masih
// punya approval_status ('open'|'rejected'|'completed') + approvals JSONB +
// kolom rejection_reason sendiri — pola yang sama dipakai di sini.

type StockOutTable = "spb_invoice" | "return_spb";

function deriveStockOutStatus(
  approvals: ModeratorApprovalStep[],
): "open" | "rejected" | "completed" {
  if (approvals.some((a) => a.status === "rejected")) return "rejected";
  if (approvals.length > 0 && approvals.every((a) => a.status === "approved"))
    return "completed";
  return "open";
}

// Downstream-chain guard: SPB PO -> SPB DO -> SPB Invoice adalah rantai
// dokumen (tiap tahap mereferensikan detail tahap sebelumnya). Return SPB
// langsung memposting stok balik saat completed. Turunkan status approval
// dari 'completed' setelah salah satu dari ini terjadi akan meninggalkan
// dokumen turunan/posting stok yang menggantung -- jadi diblokir.
async function _guardStockOutDowngrade(
  supabase: any,
  table: StockOutTable,
  id: number,
): Promise<string | null> {
  if (table === "return_spb") {
    const { data: row } = await supabase
      .from("return_spb")
      .select("rtn_kode")
      .eq("id", id)
      .single();
    if (!row?.rtn_kode) return null;
    const { count } = await supabase
      .from("stock_movements")
      .select("id", { count: "exact", head: true })
      .eq("type", "SPB_RETURN")
      .eq("reference_id", row.rtn_kode);
    if (count && count > 0) {
      return "Return ini sudah diposting ke stok (barang sudah masuk kembali). Tidak bisa mengubah status approval keluar dari 'completed' tanpa membereskan posting tersebut terlebih dahulu.";
    }
    return null;
  }
  return null;
}

async function _moderatorEditStockOut(params: {
  table: StockOutTable;
  docType: "spb_invoice" | "return_spb";
  docLabel: string;
  id: number;
  headerPatch: Record<string, any>;
  approvals: ModeratorApprovalStep[];
  rejectionReason?: string;
  onFirstComplete?: (id: number) => Promise<{ error?: string } | void>;
  documentUrl: string;
}) {
  const { table, docType, docLabel, id, headerPatch, approvals, rejectionReason, onFirstComplete, documentUrl } =
    params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const roleNames = await fetchRoleNames(supabase, user.id);
  if (!roleNames.includes("moderator")) {
    return { error: "Hanya moderator yang dapat menggunakan Moderator Edit." };
  }

  const { data: row, error: rowErr } = await supabase.from(table).select("*").eq("id", id).single();
  if (rowErr || !row) return { error: `${docLabel} tidak ditemukan.` };

  if (!approvals || approvals.length === 0) {
    return { error: "Jalur approval tidak boleh kosong." };
  }
  for (const step of approvals) {
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

  const previousStatus: string = row.approval_status || "open";
  const previousCompleted = previousStatus === "completed";
  const newStatus = deriveStockOutStatus(approvals);
  const newCompleted = newStatus === "completed";

  if (newStatus === "rejected" && !rejectionReason?.trim()) {
    return { error: "Alasan penolakan wajib diisi." };
  }

  if (previousCompleted && !newCompleted) {
    const guardError = await _guardStockOutDowngrade(supabase, table, id);
    if (guardError) return { error: guardError };
  }

  const patch: Record<string, any> = {
    ...headerPatch,
    approvals,
    approval_status: newStatus,
    rejection_reason: newStatus === "rejected" ? rejectionReason : null,
    completed_at: newCompleted ? (row.completed_at ?? new Date().toISOString()) : null,
  };

  const { error: updateErr } = await supabase.from(table).update(patch).eq("id", id);
  if (updateErr) return { error: updateErr.message };

  if (!previousCompleted && newCompleted && onFirstComplete) {
    const finalizeResult = await onFirstComplete(id);
    if (finalizeResult?.error) {
      await supabase
        .from(table)
        .update({ approval_status: previousStatus, completed_at: row.completed_at ?? null })
        .eq("id", id);
      return { error: finalizeResult.error };
    }
  }

  const { data: myProfile } = await supabase.from("profiles").select("nama").eq("id", user.id).single();

  const summaryParts: string[] = [];
  const changedFieldKeys = Object.keys(headerPatch).filter((k) => headerPatch[k] !== row[k]);
  if (changedFieldKeys.length > 0) summaryParts.push(`${changedFieldKeys.length} field header diubah`);
  if (previousStatus !== newStatus) summaryParts.push(`status ${previousStatus} → ${newStatus}`);
  summaryParts.push(`jalur approval (${approvals.length} tahap)`);

  await supabase.from("moderator_edit_logs").insert({
    doc_type: docType,
    doc_id: id,
    user_id: user.id,
    user_nama: myProfile?.nama || user.email,
    summary: `Moderator edit: ${summaryParts.join(", ")}.`,
    changes: {
      before: { ...Object.fromEntries(Object.keys(headerPatch).map((k) => [k, row[k]])), approval_status: previousStatus, approvals: row.approvals },
      after: { ...headerPatch, approval_status: newStatus, approvals },
    },
  });

  // Dokumen stock-out tidak selalu punya owner/PIC yang seragam untuk
  // notifyDocumentOwner; notifikasi approve/reject cukup lewat notifyApprovers
  // (approver berikutnya) + riwayat Moderator Edit di halaman terkait.
  notifyApprovers(
    approvals,
    docLabel,
    id,
    String(row.po_no || row.do_no || row.invoice_no || row.rtn_kode || id),
    documentUrl,
  ).catch(console.error);

  revalidatePath("/spb");
  revalidatePath("/spb/po");
  revalidatePath("/spb/do");
  revalidatePath("/spb/invoice");
  revalidatePath("/return-spb");
  return { success: true };
}


export type ModeratorSpbInvoiceEditPayload = {
  invoice_date?: string | null;
  invoice_email_date?: string | null;
  approval_template_id?: number;
  approvals: ModeratorApprovalStep[];
  rejection_reason?: string;
};

export async function moderatorEditSpbInvoice(id: number, payload: ModeratorSpbInvoiceEditPayload) {
  return _moderatorEditStockOut({
    table: "spb_invoice",
    docType: "spb_invoice",
    docLabel: "SPB Invoice",
    id,
    headerPatch: {
      invoice_date: payload.invoice_date || null,
      invoice_email_date: payload.invoice_email_date || null,
      ...(payload.approval_template_id !== undefined
        ? { approval_template_id: payload.approval_template_id }
        : {}),
    },
    approvals: payload.approvals,
    rejectionReason: payload.rejection_reason,
    onFirstComplete: (docId) => finalizeSpbInvoiceStatus(docId),
    documentUrl: "/spb/invoice",
  });
}

export type ModeratorReturnSpbEditPayload = {
  rtn_tanggal?: string;
  rtn_note?: string | null;
  approval_template_id?: number;
  approvals: ModeratorApprovalStep[];
  rejection_reason?: string;
};

export async function moderatorEditReturnSpb(id: number, payload: ModeratorReturnSpbEditPayload) {
  return _moderatorEditStockOut({
    table: "return_spb",
    docType: "return_spb",
    docLabel: "Return SPB",
    id,
    headerPatch: {
      ...(payload.rtn_tanggal !== undefined ? { rtn_tanggal: payload.rtn_tanggal } : {}),
      rtn_note: payload.rtn_note || null,
      ...(payload.approval_template_id !== undefined
        ? { approval_template_id: payload.approval_template_id }
        : {}),
    },
    approvals: payload.approvals,
    rejectionReason: payload.rejection_reason,
    onFirstComplete: async (docId) => {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return applyReturnSpbPosting(docId, user?.id || "");
    },
    documentUrl: "/return-spb",
  });
}

export async function getModeratorEditLogs(
  docType: "mr" | "pr" | "po" | "spb" | "spb_po" | "spb_do" | "spb_invoice" | "return_spb" | "receive",
  docId: number,
) {
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
