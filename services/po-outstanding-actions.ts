"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { fetchPrItemConvertedQty, isPrItemRejected } from "@/lib/pr-po-coverage";
import {
  applyPrCompletionStatus,
  applyPrConversionStatus,
} from "@/lib/procurement-status";

// PO Outstanding (import ERP, lihat lib/po-outstanding.ts): item dihubungkan
// ke item PR WMS per baris. Link-nya sama persis dengan PO reguler
// (po_items.pr_item_id + mr_id dari item PR), jadi RI otomatis mengalir ke
// MR dan status konversi/completion PR ikut terhitung lewat jalur yang sudah
// ada.
//
// Pengaman distribusi qty: item yang sudah punya RI (selesai / masih menunggu
// approval) dikunci -- link tidak bisa dibuat/diubah/dilepas, karena kredit
// MR terjadi saat RI diposting.

async function getEditor(supabase: any) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." as const };
  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  const roles: string[] = (data || [])
    .map((r: any) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name))
    .filter(Boolean)
    .map((n: string) => n.toLowerCase());
  if (!roles.includes("purchasing") && !roles.includes("moderator")) {
    return { error: "Hanya purchasing/moderator yang bisa mengubah PO Outstanding." as const };
  }
  return { user };
}

async function getOutstandingPo(supabase: any, poId: number) {
  const { data: po } = await supabase
    .from("pos")
    .select("id, po_kode, po_status, po_is_outstanding, pr_id")
    .eq("id", poId)
    .maybeSingle();
  if (!po) return { error: "PO tidak ditemukan." };
  if (!po.po_is_outstanding) return { error: "Fitur ini khusus PO Outstanding." };
  if (po.po_status === "rejected") return { error: "PO sudah ditolak." };
  return { po };
}

// po_item_id yang sudah dipakai RI (selain RI rejected).
async function fetchLockedPoItemIds(supabase: any, poItemIds: number[]) {
  if (poItemIds.length === 0) return new Set<number>();
  const { data } = await supabase
    .from("receive_items")
    .select("po_item_id, receives!inner(ri_status)")
    .in("po_item_id", poItemIds)
    .neq("receives.ri_status", "rejected");
  return new Set<number>((data || []).map((r: any) => r.po_item_id));
}

async function refreshPrs(supabase: any, prIds: Iterable<number>) {
  for (const prId of new Set(prIds)) {
    await applyPrConversionStatus(supabase, prId);
    await applyPrCompletionStatus(supabase, prId);
  }
}

// pos.pr_id = PR pertama yang terhubung (referensi tampilan lama), null kalau
// belum ada. Trigger pos_fill_cabang_from_pr mengisi cabang PO dari PR itu
// bila cabang PO masih kosong.
async function syncHeaderPrId(supabase: any, poId: number, currentPrId: number | null) {
  const { data: rows } = await supabase
    .from("po_items")
    .select("id, pr_items(pr_id)")
    .eq("po_id", poId)
    .not("pr_item_id", "is", null)
    .order("id");
  const prIds = (rows || [])
    .map((r: any) => (Array.isArray(r.pr_items) ? r.pr_items[0]?.pr_id : r.pr_items?.pr_id))
    .filter(Boolean) as number[];
  const next = currentPrId && prIds.includes(currentPrId) ? currentPrId : (prIds[0] ?? null);
  if (next !== currentPrId) {
    await supabase.from("pos").update({ pr_id: next }).eq("id", poId);
  }
}

export type OutstandingLinkInput = {
  po_item_id: number;
  pr_item_id: number;
  // Qty item PO melebihi sisa PR: pecah item jadi bagian terhubung (= sisa
  // PR) + sisa yang belum terhubung, alih-alih ditolak.
  split?: boolean;
};

export async function linkOutstandingPoItems(poId: number, links: OutstandingLinkInput[]) {
  const supabase = await createClient();
  const editor = await getEditor(supabase);
  if ("error" in editor) return { error: editor.error };
  const res = await getOutstandingPo(supabase, poId);
  if ("error" in res) return { error: res.error };
  const po = res.po;

  if (!links || links.length === 0) return { error: "Pilih minimal satu item." };
  const poItemIds = links.map((l) => Number(l.po_item_id));
  const prItemIds = links.map((l) => Number(l.pr_item_id));
  if (new Set(poItemIds).size !== poItemIds.length) {
    return { error: "Item PO yang sama dipilih lebih dari sekali." };
  }
  if (new Set(prItemIds).size !== prItemIds.length) {
    return { error: "Satu item PR hanya boleh dihubungkan ke satu item PO." };
  }

  const [{ data: poItems }, { data: siblingRows }, { data: prItems }, locked, converted] =
    await Promise.all([
      supabase
        .from("po_items")
        .select(
          "id, po_id, part_id, part_number, part_name, satuan, qty, qty_received, harga, vendor_id, pr_item_id, ost_pr_ref, ost_proyek_ref, ost_keterangan",
        )
        .eq("po_id", poId)
        .in("id", poItemIds),
      supabase
        .from("po_items")
        .select("pr_item_id")
        .eq("po_id", poId)
        .in("pr_item_id", prItemIds),
      supabase
        .from("pr_items")
        .select("id, pr_id, mr_id, qty, status, part_id, part_number, satuan, prs!inner(pr_kode, pr_status)")
        .in("id", prItemIds),
      fetchLockedPoItemIds(supabase, poItemIds),
      fetchPrItemConvertedQty(supabase, prItemIds),
    ]);

  const poItemById = new Map((poItems || []).map((i: any) => [i.id, i]));
  const prItemById = new Map((prItems || []).map((i: any) => [i.id, i]));
  const alreadyInPo = new Set((siblingRows || []).map((r: any) => r.pr_item_id));

  type Plan = { link: OutstandingLinkInput; poItem: any; prItem: any; linkQty: number };
  const plans: Plan[] = [];
  const errors: string[] = [];
  for (const link of links) {
    const poItem: any = poItemById.get(Number(link.po_item_id));
    const prItem: any = prItemById.get(Number(link.pr_item_id));
    if (!poItem) {
      errors.push(`Item PO #${link.po_item_id} bukan bagian dari PO ${po.po_kode}.`);
      continue;
    }
    const pn = poItem.part_number;
    if (poItem.pr_item_id) {
      errors.push(`${pn}: sudah terhubung ke PR. Lepas dulu link lamanya.`);
      continue;
    }
    if (locked.has(poItem.id) || Number(poItem.qty_received) > 0) {
      errors.push(`${pn}: sudah ada Receive Item, link tidak bisa diubah.`);
      continue;
    }
    if (!prItem) {
      errors.push(`${pn}: item PR tidak ditemukan.`);
      continue;
    }
    const pr = Array.isArray(prItem.prs) ? prItem.prs[0] : prItem.prs;
    if (pr?.pr_status !== "approved") {
      errors.push(`${pn}: PR ${pr?.pr_kode || ""} tidak berstatus approved.`);
      continue;
    }
    if (isPrItemRejected(prItem)) {
      errors.push(`${pn}: item di PR ${pr?.pr_kode} ditolak approver.`);
      continue;
    }
    if (Number(prItem.part_id) !== Number(poItem.part_id)) {
      errors.push(`${pn}: part number beda dengan item PR (${prItem.part_number}).`);
      continue;
    }
    if (alreadyInPo.has(prItem.id)) {
      errors.push(`${pn}: item PR ${pr?.pr_kode} sudah terhubung ke item lain di PO ini.`);
      continue;
    }
    const remaining = Math.max(0, Number(prItem.qty) - (converted.get(prItem.id) || 0));
    const qty = Number(poItem.qty) || 0;
    if (remaining <= 0) {
      errors.push(`${pn}: PR ${pr?.pr_kode} sudah ter-PO penuh.`);
      continue;
    }
    if (qty > remaining && !link.split) {
      errors.push(
        `${pn}: qty PO ${qty} melebihi sisa PR ${pr?.pr_kode} (${remaining} ${prItem.satuan}). Centang "pecah item" untuk menghubungkan sebagian.`,
      );
      continue;
    }
    plans.push({ link, poItem, prItem, linkQty: Math.min(qty, remaining) });
  }
  if (errors.length > 0) return { error: errors.join("\n") };

  // ---- Mutasi ----
  let splitCount = 0;
  for (const { poItem, prItem, linkQty } of plans) {
    const qty = Number(poItem.qty) || 0;
    // Guard optimistic: item masih belum terhubung & qty belum berubah.
    const { data: upd, error } = await supabase
      .from("po_items")
      .update({ pr_item_id: prItem.id, mr_id: prItem.mr_id, qty: linkQty })
      .eq("id", poItem.id)
      .eq("po_id", poId)
      .is("pr_item_id", null)
      .eq("qty", qty)
      .select("id");
    if (error) return { error: `Gagal menghubungkan ${poItem.part_number}: ${error.message}` };
    if (!upd || upd.length === 0) {
      return { error: `${poItem.part_number} baru saja diubah user lain. Muat ulang halaman.` };
    }
    if (linkQty < qty) {
      const { error: insErr } = await supabase.from("po_items").insert({
        po_id: poId,
        mr_id: null,
        pr_item_id: null,
        part_id: poItem.part_id,
        part_number: poItem.part_number,
        part_name: poItem.part_name,
        satuan: poItem.satuan,
        qty: qty - linkQty,
        qty_received: 0,
        harga: poItem.harga,
        vendor_id: poItem.vendor_id,
        ost_pr_ref: poItem.ost_pr_ref,
        ost_proyek_ref: poItem.ost_proyek_ref,
        ost_keterangan: poItem.ost_keterangan,
      });
      if (insErr) {
        // Kembalikan qty supaya total PO tidak berkurang.
        await supabase.from("po_items").update({ qty }).eq("id", poItem.id);
        return { error: `Gagal memecah item ${poItem.part_number}: ${insErr.message}` };
      }
      splitCount++;
    }
  }

  await syncHeaderPrId(supabase, poId, po.pr_id);
  await refreshPrs(supabase, plans.map((p) => p.prItem.pr_id));

  revalidatePath("/po");
  revalidatePath(`/po/${poId}`);
  revalidatePath("/pr");
  return { success: true, linked: plans.length, split: splitCount };
}

export async function unlinkOutstandingPoItem(poItemId: number) {
  const supabase = await createClient();
  const editor = await getEditor(supabase);
  if ("error" in editor) return { error: editor.error };

  const { data: poItem } = await supabase
    .from("po_items")
    .select("id, po_id, part_number, qty_received, pr_item_id, pr_items(pr_id)")
    .eq("id", poItemId)
    .maybeSingle();
  if (!poItem) return { error: "Item PO tidak ditemukan." };
  const res = await getOutstandingPo(supabase, poItem.po_id);
  if ("error" in res) return { error: res.error };
  if (!poItem.pr_item_id) return { error: "Item ini belum terhubung ke PR." };

  const locked = await fetchLockedPoItemIds(supabase, [poItem.id]);
  if (locked.has(poItem.id) || Number(poItem.qty_received) > 0) {
    return { error: `${poItem.part_number}: sudah ada Receive Item, link tidak bisa dilepas.` };
  }

  const prItem: any = Array.isArray(poItem.pr_items) ? poItem.pr_items[0] : poItem.pr_items;
  const { error } = await supabase
    .from("po_items")
    .update({ pr_item_id: null, mr_id: null })
    .eq("id", poItem.id);
  if (error) return { error: error.message };

  await syncHeaderPrId(supabase, poItem.po_id, res.po.pr_id);
  if (prItem?.pr_id) await refreshPrs(supabase, [prItem.pr_id]);

  revalidatePath("/po");
  revalidatePath(`/po/${poItem.po_id}`);
  revalidatePath("/pr");
  return { success: true };
}

export async function setOutstandingPoCabang(poId: number, cabangId: number | null) {
  const supabase = await createClient();
  const editor = await getEditor(supabase);
  if ("error" in editor) return { error: editor.error };
  const res = await getOutstandingPo(supabase, poId);
  if ("error" in res) return { error: res.error };

  const { error } = await supabase
    .from("pos")
    .update({ cabang_id: cabangId })
    .eq("id", poId);
  if (error) return { error: error.message };

  revalidatePath("/po");
  revalidatePath(`/po/${poId}`);
  return { success: true };
}
