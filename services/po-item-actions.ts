"use server";

// Pembatalan item PO & status progres per barang.
// Aturan lengkap: lib/po-item-status.ts.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  applyPrCompletionStatus,
  applyPrConversionStatus,
  fetchPoItemPendingReceiveQty,
  fetchPoSourcePrIds,
  syncPoReceiveAndCompletion,
} from "@/lib/procurement-status";
import { fetchPoSoIds, refreshSoStatuses } from "@/lib/so-reguler";
import {
  PO_ITEM_SELECT,
  buildPoRevisionSnapshot,
  diffPoRevision,
  flattenPoItems,
} from "@/lib/po-revision";
import {
  PO_CANCELLABLE_STATUSES,
  canManagePoItems,
} from "@/lib/po-item-status";
import { createNotification } from "@/services/notification-actions";

const num = (v: any) => Number(v) || 0;

async function loadActor(supabase: any) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, nama, email, user_roles(roles(name))")
    .eq("id", user.id)
    .single();
  const roleNames: string[] = ((profile as any)?.user_roles || [])
    .map((ur: any) => (Array.isArray(ur.roles) ? ur.roles[0]?.name : ur.roles?.name))
    .filter(Boolean);
  return {
    id: user.id as string,
    nama: (profile?.nama || user.email || "User") as string,
    roleNames,
  };
}

function actorRole(roleNames: string[]) {
  if (roleNames.includes("purchasing")) return "purchasing";
  if (roleNames.includes("moderator")) return "moderator";
  return "approver";
}

/**
 * Batalkan item PO (PO sudah full approved). Sisa qty yang belum diterima
 * dibatalkan: po_items.qty turun ke qty_received, selisihnya dicatat di
 * qty_cancelled, dan qty itu otomatis kembali ke PR/SO sumber (semua rumus
 * sisa membaca po_items.qty). PO langsung berstatus 'closed'; item lain yang
 * masih aktif tetap bisa diterima lewat RI.
 */
export async function cancelPoItem(poItemId: number, reason: string) {
  const supabase = await createClient();
  const actor = await loadActor(supabase);
  if (!actor) return { error: "Session expired." };

  const note = reason?.trim();
  if (!note) return { error: "Alasan pembatalan wajib diisi." };

  const { data: item } = await supabase
    .from("po_items")
    .select("id, po_id, part_number, part_name, satuan, qty, qty_received, qty_cancelled")
    .eq("id", poItemId)
    .maybeSingle();
  if (!item) return { error: "Item PO tidak ditemukan." };

  const { data: po } = await supabase.from("pos").select("*").eq("id", item.po_id).single();
  if (!po) return { error: "PO tidak ditemukan." };

  if (!canManagePoItems(actor.roleNames, po.approvals, actor.id)) {
    return { error: "Hanya approver PO ini, purchasing, atau moderator yang dapat membatalkan item." };
  }
  if (!(PO_CANCELLABLE_STATUSES as readonly string[]).includes(po.po_status)) {
    return {
      error:
        po.po_status === "open"
          ? "PO belum full approved. Ubah item lewat Edit PO, atau tolak PO-nya."
          : `PO berstatus ${po.po_status}, item tidak bisa dibatalkan.`,
    };
  }
  if (po.po_jenis === "konsinyasi") {
    return { error: "Item PO Rekonsil Konsinyasi tidak bisa dibatalkan." };
  }

  const pending = await fetchPoItemPendingReceiveQty(supabase, [poItemId]);
  if ((pending.get(poItemId) || 0) > 0) {
    return {
      error: `Item ${item.part_number} masih ada di RI yang menunggu approval (${pending.get(poItemId)}). Selesaikan / tolak RI tersebut dulu.`,
    };
  }

  const oldQty = num(item.qty);
  const received = num(item.qty_received);
  const cancelQty = oldQty - received;
  if (cancelQty <= 0) {
    return {
      error: `Item ${item.part_number} sudah diterima penuh / sudah dibatalkan, tidak ada sisa yang bisa dibatalkan.`,
    };
  }

  const { data: beforeRows } = await supabase
    .from("po_items")
    .select(PO_ITEM_SELECT)
    .eq("po_id", po.id);
  const beforeItems = flattenPoItems(beforeRows || []);
  const snapshotBefore = buildPoRevisionSnapshot(po, beforeItems);
  // PR sumber dicatat SEBELUM link PR (PO Non-PR) diubah/dihapus.
  const sourcePrIds = await fetchPoSourcePrIds(supabase, po.id);

  const now = new Date().toISOString();
  // Guard optimistik: qty & qty_received belum berubah sejak dibaca.
  const { data: claimed, error: updErr } = await supabase
    .from("po_items")
    .update({
      qty: received,
      qty_cancelled: num(item.qty_cancelled) + cancelQty,
      cancel_reason: note,
      cancelled_by: actor.id,
      cancelled_by_nama: actor.nama,
      cancelled_at: now,
    })
    .eq("id", poItemId)
    .eq("qty", oldQty)
    .eq("qty_received", received)
    .select("id");
  if (updErr) return { error: updErr.message };
  if (!claimed || claimed.length === 0) {
    return { error: "Item ini baru saja berubah (ada penerimaan / edit lain). Muat ulang halaman." };
  }

  // Link manual PO Non-PR -> PR (qty dalam satuan PR): ikut diperkecil
  // proporsional supaya qty PR yang batal dibebaskan. Batal penuh -> link
  // dihapus (qty_pr wajib > 0).
  const { data: links } = await supabase
    .from("po_item_pr_links")
    .select("id, qty_pr")
    .eq("po_item_id", poItemId);
  for (const l of links || []) {
    const scaled = Math.floor(((num(l.qty_pr) * received) / oldQty) * 10000) / 10000;
    if (scaled > 0) {
      await supabase.from("po_item_pr_links").update({ qty_pr: scaled }).eq("id", l.id);
    } else {
      await supabase.from("po_item_pr_links").delete().eq("id", l.id);
    }
  }

  const nextRevision = num(po.po_revision) + 1;
  const { error: headerErr } = await supabase
    .from("pos")
    .update({ po_status: "closed", po_revision: nextRevision })
    .eq("id", po.id);
  if (headerErr) return { error: headerErr.message };

  // Penerimaan (item batal = qty diterima -> selesai), konversi & completion
  // PR sumber, status SO.
  await syncPoReceiveAndCompletion(supabase, po.id);
  for (const prId of sourcePrIds) {
    await applyPrConversionStatus(supabase, prId);
    await applyPrCompletionStatus(supabase, prId);
  }
  if (po.po_jenis === "so" || po.so_id)
    await refreshSoStatuses(supabase, await fetchPoSoIds(supabase, po.id));

  // Riwayat PO + log status barang.
  const { data: afterRows } = await supabase
    .from("po_items")
    .select(PO_ITEM_SELECT)
    .eq("po_id", po.id);
  const afterItems = flattenPoItems(afterRows || []);
  const snapshotAfter = buildPoRevisionSnapshot(
    { ...po, po_status: "closed", po_revision: nextRevision },
    afterItems,
  );
  const changes = diffPoRevision(snapshotBefore, snapshotAfter);
  const summary = `item ${item.part_number} dibatalkan ${cancelQty} ${item.satuan}; PO menjadi CLOSED`;
  const [{ error: revErr }, { error: logErr }] = await Promise.all([
    supabase.from("po_revisions").insert({
      po_id: po.id,
      revision_no: nextRevision,
      edited_by: actor.id,
      edited_by_nama: actor.nama,
      edited_by_role: actorRole(actor.roleNames),
      reason: note,
      summary,
      changes,
      snapshot_before: snapshotBefore,
      snapshot_after: snapshotAfter,
      revision_kind: "batal_item",
      approval_reset: false,
    }),
    supabase.from("po_item_status_logs").insert({
      po_id: po.id,
      po_item_id: poItemId,
      action: "cancel",
      detail: { qty_before: oldQty, qty_received: received, qty_cancelled: cancelQty },
      note,
      changed_by: actor.id,
      changed_by_nama: actor.nama,
    }),
  ]);
  if (revErr) console.error("Gagal mencatat po_revisions:", revErr.message);
  if (logErr) console.error("Gagal mencatat po_item_status_logs:", logErr.message);

  // Kabari PIC + approver lain.
  const recipients = new Set<string>();
  if (po.po_pic_id) recipients.add(po.po_pic_id);
  for (const a of po.approvals || []) {
    const uid = a?.userid || a?.user_id;
    if (uid) recipients.add(uid);
  }
  recipients.delete(actor.id);
  for (const uid of recipients) {
    createNotification({
      userId: uid,
      type: "general",
      title: "Item PO dibatalkan — PO Closed",
      message: `${actor.nama} membatalkan ${cancelQty} ${item.satuan} ${item.part_number} di PO ${po.po_kode}: ${note}. PO menjadi CLOSED; item lain yang aktif tetap bisa diterima.`,
      documentType: "PO",
      documentId: po.id,
      documentUrl: `/po/${po.id}`,
      metadata: { document_number: po.po_kode, revision_no: nextRevision },
    }).catch(console.error);
  }

  revalidatePath("/po");
  revalidatePath(`/po/${po.id}`);
  revalidatePath("/pr");
  revalidatePath("/receive");
  if (po.po_jenis === "so" || po.so_id) revalidatePath("/so-reguler/so");
  return { success: true, cancelledQty: cancelQty };
}

/** Ubah status progres / estimasi / catatan satu barang PO. */
export async function updatePoItemStatus(
  poItemId: number,
  payload: {
    item_detail_status?: string | null;
    item_estimasi?: string | null;
    item_status_note?: string | null;
  },
) {
  const supabase = await createClient();
  const actor = await loadActor(supabase);
  if (!actor) return { error: "Session expired." };

  const { data: item } = await supabase
    .from("po_items")
    .select("id, po_id, part_number, item_detail_status, item_estimasi, item_status_note")
    .eq("id", poItemId)
    .maybeSingle();
  if (!item) return { error: "Item PO tidak ditemukan." };

  const { data: po } = await supabase
    .from("pos")
    .select("id, po_status, approvals")
    .eq("id", item.po_id)
    .single();
  if (!po) return { error: "PO tidak ditemukan." };
  if (!canManagePoItems(actor.roleNames, po.approvals, actor.id)) {
    return { error: "Hanya approver PO ini, purchasing, atau moderator yang dapat mengubah status barang." };
  }
  if (po.po_status === "rejected") {
    return { error: "PO ditolak, status barang tidak bisa diubah." };
  }

  const clean = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    return t ? t : null;
  };
  const after = {
    item_detail_status: clean(payload.item_detail_status),
    item_estimasi: clean(payload.item_estimasi),
    item_status_note: clean(payload.item_status_note),
  };
  const before = {
    item_detail_status: item.item_detail_status ?? null,
    item_estimasi: item.item_estimasi ?? null,
    item_status_note: item.item_status_note ?? null,
  };
  if (
    before.item_detail_status === after.item_detail_status &&
    before.item_estimasi === after.item_estimasi &&
    before.item_status_note === after.item_status_note
  ) {
    return { success: true, unchanged: true };
  }

  const { error } = await supabase
    .from("po_items")
    .update({
      ...after,
      item_status_updated_by_nama: actor.nama,
      item_status_updated_at: new Date().toISOString(),
    })
    .eq("id", poItemId);
  if (error) return { error: error.message };

  const { error: logErr } = await supabase.from("po_item_status_logs").insert({
    po_id: po.id,
    po_item_id: poItemId,
    action: "status",
    detail: { before, after },
    changed_by: actor.id,
    changed_by_nama: actor.nama,
  });
  if (logErr) console.error("Gagal mencatat po_item_status_logs:", logErr.message);

  revalidatePath("/po");
  revalidatePath(`/po/${po.id}`);
  return { success: true };
}

export async function getPoItemStatusLogs(poId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("po_item_status_logs")
    .select("id, po_item_id, action, detail, note, changed_by_nama, created_at")
    .eq("po_id", poId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}
