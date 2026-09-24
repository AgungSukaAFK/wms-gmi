"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
