"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  applyMrConversionStatus,
  applyPrCompletionStatus,
  applyPrConversionStatus,
  fetchPoSourcePrIds,
  syncPoReceiveAndCompletion,
} from "@/lib/procurement-status";
import { recomputeMrItemsFulfillment } from "@/lib/mr-fulfillment";
import { refreshSoStatus } from "@/lib/so-reguler";

export type CascadeDeleteDocType = "mr" | "pr" | "po" | "receive" | "delivery";

export type CascadeDeleteDocumentRef = {
  doc_type: string;
  id: number;
  kode: string;
};

export type CascadeDeleteConflict = {
  part_id: number;
  part_number: string;
  part_name: string;
  cabang_id: number;
  cabang_nama: string;
  current_qty: number;
  delta: number;
  resulting_qty: number;
  shortfall: number;
};

export type CascadeDeletePlan = {
  can_delete: boolean;
  documents: CascadeDeleteDocumentRef[];
  conflicts: CascadeDeleteConflict[];
  blocked_reasons: string[];
};

type ActionResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data?: CascadeDeletePlan; error: string };

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

async function requireModerator(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expired." };

  const roleNames = await fetchRoleNames(supabase, user.id);
  if (!roleNames.includes("moderator")) {
    return { ok: false, error: "Hanya moderator yang dapat menghapus dokumen." };
  }
  return { ok: true, supabase };
}

/**
 * Preview dokumen apa saja yang akan ikut terhapus (+ konflik stok kalau
 * ada) sebelum moderator konfirmasi. Read-only, tidak menulis apapun.
 */
export async function previewModeratorDocumentDelete(
  docType: CascadeDeleteDocType,
  docId: number,
): Promise<ActionResult<CascadeDeletePlan>> {
  const guard = await requireModerator();
  if (!guard.ok) return { success: false, error: guard.error };

  const { data, error } = await guard.supabase.rpc("plan_cascade_document_delete", {
    p_doc_type: docType,
    p_doc_id: docId,
  });
  if (error) return { success: false, error: error.message };

  return { success: true, data: data as CascadeDeletePlan };
}

/**
 * Eksekusi hapus cascade. Server-side melakukan seluruh cascade + reverse
 * stok + recompute status dokumen ancestor yang bertahan + audit log dalam
 * satu transaksi Postgres (lihat migration
 * 20260924110000_moderator_cascade_delete.sql) — kalau ada konflik stok
 * atau delivery yang sudah completed dalam scope, RPC ini mengembalikan
 * can_delete: false TANPA menulis apapun (bukan exception), supaya UI bisa
 * menampilkan detail konfliknya.
 */
export async function moderatorDeleteDocument(
  docType: CascadeDeleteDocType,
  docId: number,
  reason: string,
): Promise<ActionResult<CascadeDeletePlan>> {
  const guard = await requireModerator();
  if (!guard.ok) return { success: false, error: guard.error };

  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    return { success: false, error: "Alasan penghapusan wajib diisi." };
  }

  // Dokumen yang TIDAK ikut terhapus tapi status/qty-nya bergantung pada
  // dokumen yang dihapus -- dicatat sebelum hapus, dihitung ulang sesudahnya
  // dengan rumus terpusat (lib/procurement-status.ts & lib/mr-fulfillment.ts:
  // item PR rejected, share stock, bypass, WO, RI langsung ke gudang MR).
  const survivors = await collectCascadeSurvivors(guard.supabase, docType, docId);

  const { data, error } = await guard.supabase.rpc("execute_cascade_document_delete", {
    p_doc_type: docType,
    p_doc_id: docId,
    p_reason: trimmedReason,
  });
  if (error) return { success: false, error: error.message };

  const result = data as CascadeDeletePlan & { success: boolean };
  if (!result.success) {
    return {
      success: false,
      data: result,
      error:
        result.blocked_reasons?.[0] ||
        "Tidak dapat dihapus karena ada konflik stok. Lihat detail konflik.",
    };
  }

  await recomputeCascadeSurvivors(guard.supabase, survivors);

  revalidatePath("/mr");
  revalidatePath("/mr/scheduled");
  revalidatePath("/pr");
  revalidatePath("/po");
  revalidatePath("/receive");
  revalidatePath("/deliveries");
  revalidatePath("/share-stock");
  revalidatePath("/stock");
  revalidatePath("/planning-supply");

  return { success: true, data: result };
}

type CascadeSurvivors = {
  poIds: number[];
  prIds: number[];
  mrIds: number[];
  mrItemIds: number[];
  soIds: number[];
};

async function collectCascadeSurvivors(
  supabase: any,
  docType: CascadeDeleteDocType,
  docId: number,
): Promise<CascadeSurvivors> {
  const out: CascadeSurvivors = { poIds: [], prIds: [], mrIds: [], mrItemIds: [], soIds: [] };
  const addMrItemsOfPrItems = async (prItemIds: number[]) => {
    if (prItemIds.length === 0) return;
    const { data } = await supabase
      .from("pr_items")
      .select("mr_id, mr_item_id")
      .in("id", prItemIds);
    for (const r of data || []) {
      if (r.mr_id) out.mrIds.push(r.mr_id);
      if (r.mr_item_id) out.mrItemIds.push(r.mr_item_id);
    }
  };
  try {
    if (docType === "pr") {
      const { data } = await supabase.from("pr_items").select("id").eq("pr_id", docId);
      await addMrItemsOfPrItems((data || []).map((r: any) => r.id));
    } else if (docType === "po") {
      out.prIds.push(...(await fetchPoSourcePrIds(supabase, docId)));
      const { data: po } = await supabase.from("pos").select("so_id").eq("id", docId).maybeSingle();
      if (po?.so_id) out.soIds.push(po.so_id);
      const { data } = await supabase.from("po_items").select("pr_item_id").eq("po_id", docId);
      await addMrItemsOfPrItems((data || []).map((r: any) => r.pr_item_id).filter(Boolean));
    } else if (docType === "receive") {
      const { data: ri } = await supabase.from("receives").select("po_id").eq("id", docId).maybeSingle();
      if (ri?.po_id) {
        out.poIds.push(ri.po_id);
        out.prIds.push(...(await fetchPoSourcePrIds(supabase, ri.po_id)));
        const { data: po } = await supabase.from("pos").select("so_id").eq("id", ri.po_id).maybeSingle();
        if (po?.so_id) out.soIds.push(po.so_id);
      }
      const { data } = await supabase
        .from("receive_items")
        .select("po_items(pr_item_id)")
        .eq("ri_id", docId);
      await addMrItemsOfPrItems(
        (data || [])
          .map((r: any) => (Array.isArray(r.po_items) ? r.po_items[0] : r.po_items)?.pr_item_id)
          .filter(Boolean),
      );
    } else if (docType === "delivery") {
      const { data } = await supabase
        .from("delivery_items")
        .select("mr_item_id, mr_items(mr_id)")
        .eq("dlv_id", docId);
      for (const r of data || []) {
        if (r.mr_item_id) out.mrItemIds.push(r.mr_item_id);
        const mi = Array.isArray(r.mr_items) ? r.mr_items[0] : r.mr_items;
        if (mi?.mr_id) out.mrIds.push(mi.mr_id);
      }
    }
  } catch (e) {
    console.error("Gagal mengumpulkan dokumen terdampak cascade delete:", e);
  }
  return out;
}

async function recomputeCascadeSurvivors(supabase: any, s: CascadeSurvivors) {
  const uniq = (a: number[]) => Array.from(new Set(a.filter(Boolean)));
  try {
    for (const poId of uniq(s.poIds)) {
      const { data: exists } = await supabase.from("pos").select("id").eq("id", poId).maybeSingle();
      if (exists) await syncPoReceiveAndCompletion(supabase, poId);
    }
    for (const prId of uniq(s.prIds)) {
      await applyPrConversionStatus(supabase, prId);
      await applyPrCompletionStatus(supabase, prId);
    }
    for (const mrId of uniq(s.mrIds)) await applyMrConversionStatus(supabase, mrId);
    const { data: liveItems } = uniq(s.mrItemIds).length
      ? await supabase.from("mr_items").select("id").in("id", uniq(s.mrItemIds))
      : { data: [] as any[] };
    const liveIds = (liveItems || []).map((r: any) => r.id);
    if (liveIds.length > 0) await recomputeMrItemsFulfillment(supabase, liveIds);
    for (const soId of uniq(s.soIds)) await refreshSoStatus(supabase, soId);
  } catch (e) {
    console.error("Gagal menghitung ulang dokumen terdampak cascade delete:", e);
  }
}
