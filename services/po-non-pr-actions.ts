"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  computePrConvertStatus,
  fetchPrItemConvertedQty,
} from "@/lib/pr-po-coverage";

// "Hubungkan ke PR" untuk item PO Non-PR (escape plan, lihat
// supabase/migrations/20261006100000_po_non_pr_and_jc_link.sql). Relasi
// banyak-ke-banyak, qty_pr diisi manual dalam satuan PR. Buat link: purchasing
// /moderator. Hapus link: moderator saja.

async function fetchRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (data || [])
    .map((r: any) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name))
    .filter(Boolean)
    .map((n: string) => n.toLowerCase());
}

async function refreshPrStatus(supabase: any, prId: number) {
  const status = await computePrConvertStatus(supabase, prId);
  if (status) {
    await supabase.from("prs").update({ pr_convert_status: status }).eq("id", prId);
  }
}

export async function linkPoItemToPrItem(data: {
  po_item_id: number;
  pr_item_id: number;
  qty_pr: number;
  notes?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const roles = await fetchRoleNames(supabase, user.id);
  if (!roles.includes("purchasing") && !roles.includes("moderator")) {
    return { error: "Hanya purchasing/moderator yang bisa menghubungkan PO ke PR." };
  }

  const qtyPr = Number(data.qty_pr);
  if (!Number.isFinite(qtyPr) || qtyPr <= 0) {
    return { error: "Qty PR wajib lebih dari 0." };
  }

  const { data: poItem } = await supabase
    .from("po_items")
    .select("id, po_id, part_number, pos!inner(po_kode, po_jenis, po_status)")
    .eq("id", data.po_item_id)
    .maybeSingle();
  if (!poItem) return { error: "Item PO tidak ditemukan." };
  const po: any = Array.isArray(poItem.pos) ? poItem.pos[0] : poItem.pos;
  if (po?.po_jenis !== "non_pr") {
    return { error: "Hubungkan ke PR hanya untuk PO Non-PR." };
  }
  if (po?.po_status === "rejected") {
    return { error: "PO sudah ditolak, tidak bisa dihubungkan ke PR." };
  }

  const { data: prItem } = await supabase
    .from("pr_items")
    .select("id, pr_id, qty, part_number, satuan, prs!inner(pr_kode, pr_status)")
    .eq("id", data.pr_item_id)
    .maybeSingle();
  if (!prItem) return { error: "Item PR tidak ditemukan." };
  const pr: any = Array.isArray(prItem.prs) ? prItem.prs[0] : prItem.prs;
  if (pr?.pr_status !== "approved") {
    return { error: `PR ${pr?.pr_kode || ""} belum/tidak berstatus approved.` };
  }

  const { data: existing } = await supabase
    .from("po_item_pr_links")
    .select("id")
    .eq("po_item_id", data.po_item_id)
    .eq("pr_item_id", data.pr_item_id)
    .maybeSingle();
  if (existing) {
    return {
      error: "Item PO ini sudah terhubung ke item PR tersebut. Minta moderator hapus link lama kalau qty perlu diubah.",
    };
  }

  const converted = await fetchPrItemConvertedQty(supabase, [prItem.id]);
  const remaining = Math.max(0, prItem.qty - (converted.get(prItem.id) || 0));
  if (qtyPr > remaining) {
    return {
      error: `Qty melebihi sisa PR ${pr?.pr_kode} item ${prItem.part_number} yang belum ter-PO (sisa ${remaining} ${prItem.satuan}).`,
    };
  }

  const { error } = await supabase.from("po_item_pr_links").insert({
    po_item_id: data.po_item_id,
    pr_item_id: data.pr_item_id,
    qty_pr: qtyPr,
    notes: data.notes?.trim() || null,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  await refreshPrStatus(supabase, prItem.pr_id);

  revalidatePath("/po");
  revalidatePath("/pr");
  return { success: true };
}

export async function deletePoItemPrLink(linkId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const roles = await fetchRoleNames(supabase, user.id);
  if (!roles.includes("moderator")) {
    return { error: "Hanya moderator yang bisa menghapus link PO ke PR." };
  }

  const { data: link } = await supabase
    .from("po_item_pr_links")
    .select("id, pr_items!inner(pr_id)")
    .eq("id", linkId)
    .maybeSingle();
  if (!link) return { error: "Link tidak ditemukan." };
  const prItem: any = Array.isArray(link.pr_items) ? link.pr_items[0] : link.pr_items;

  const { error } = await supabase.from("po_item_pr_links").delete().eq("id", linkId);
  if (error) return { error: error.message };

  if (prItem?.pr_id) await refreshPrStatus(supabase, prItem.pr_id);

  revalidatePath("/po");
  revalidatePath("/pr");
  return { success: true };
}
