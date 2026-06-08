"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/** Verifikasi caller adalah moderator. Mengembalikan null jika OK, atau pesan error. */
async function requireModerator(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Session expired";

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  const isModerator = (roleRows || []).some(
    (r: any) => r.roles?.name === "moderator",
  );
  if (!isModerator)
    return "Akses ditolak. Hanya Moderator yang dapat mengelola template min/max.";
  return null;
}

const toInt = (v: unknown) => {
  if (v === null || v === undefined || v === "") return 0;
  const n =
    typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, "."));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

export interface MinMaxStageRow {
  part_number: string;
  nama_cabang: string;
  min_qty: number;
  max_qty: number;
  source_row: number;
}

/**
 * Metadata untuk membangun template di client: daftar cabang aktif + total baris stock.
 * Client memakai `total` untuk progress bar saat menarik data per halaman.
 */
export async function getStockMinMaxMeta(): Promise<
  | { success: true; cabang: { id: number; nama_cabang: string }[]; total: number }
  | { success: false; error: string }
> {
  const denied = await requireModerator();
  if (denied) return { success: false, error: denied };

  const admin = createAdminClient();
  const { data: cabang, error: cErr } = await admin
    .from("cabang")
    .select("id, nama_cabang")
    .eq("is_active", true)
    .order("nama_cabang");
  if (cErr) return { success: false, error: cErr.message };

  const { count, error: sErr } = await admin
    .from("stock")
    .select("id", { count: "exact", head: true });
  if (sErr) return { success: false, error: sErr.message };

  return { success: true, cabang: (cabang || []) as any, total: count || 0 };
}

/**
 * Ambil satu halaman baris stock (untuk dibangun jadi Excel di client).
 */
export async function fetchStockMinMaxPage(
  offset: number,
  limit: number,
): Promise<
  | {
      success: true;
      rows: {
        part_number: string;
        part_name: string;
        cabang_id: number;
        qty: number;
        min_qty: number;
        max_qty: number;
      }[];
    }
  | { success: false; error: string }
> {
  const denied = await requireModerator();
  if (denied) return { success: false, error: denied };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("stock")
    .select("qty, min_qty, max_qty, cabang_id, barang(part_number, part_name)")
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return { success: false, error: error.message };

  const rows = (data || [])
    .map((r: any) => ({
      part_number: r.barang?.part_number ?? "",
      part_name: r.barang?.part_name ?? "",
      cabang_id: r.cabang_id as number,
      qty: r.qty as number,
      min_qty: r.min_qty as number,
      max_qty: r.max_qty as number,
    }))
    .filter((r) => r.part_number);
  return { success: true, rows };
}

/**
 * Masukkan satu chunk baris ke staging. Dipanggil berulang oleh client supaya
 * bisa menampilkan progress (chunk per chunk).
 */
export async function stageMinMaxChunk(
  batchCode: string,
  rows: MinMaxStageRow[],
): Promise<{ success: boolean; error?: string }> {
  const denied = await requireModerator();
  if (denied) return { success: false, error: denied };
  if (!batchCode || !batchCode.startsWith("MINMAX_"))
    return { success: false, error: "Batch code tidak valid." };
  if (!rows || rows.length === 0) return { success: true };

  const admin = createAdminClient();
  const payload = rows.map((r) => ({
    batch_code: batchCode,
    part_number: String(r.part_number).trim(),
    nama_cabang: String(r.nama_cabang).trim(),
    min_qty: toInt(r.min_qty),
    max_qty: toInt(r.max_qty),
    source_row: Math.trunc(Number(r.source_row) || 0),
  }));
  const { error } = await admin
    .from("stock_minmax_import_staging")
    .insert(payload);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export interface MinMaxProblemReport {
  total: number;
  unmatched_parts_count: number;
  unmatched_parts: string[];
  unmatched_cabang_count: number;
  unmatched_cabang: string[];
  negative_count: number;
  negatives: {
    source_row: number;
    part_number: string;
    nama_cabang: string;
    min_qty: number;
    max_qty: number;
  }[];
  duplicate_count: number;
  duplicates: { part_number: string; nama_cabang: string; n: number }[];
  min_gt_max_count: number;
  min_gt_max: {
    source_row: number;
    part_number: string;
    nama_cabang: string;
    min_qty: number;
    max_qty: number;
  }[];
}

/**
 * Validasi batch staging dan kembalikan daftar masalah yang detail (per baris).
 * Tidak menerapkan apa pun.
 */
export async function validateMinMaxBatch(
  batchCode: string,
): Promise<
  | { success: true; report: MinMaxProblemReport }
  | { success: false; error: string }
> {
  const denied = await requireModerator();
  if (denied) return { success: false, error: denied };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("report_minmax_import_problems", {
    p_batch_code: batchCode,
  });
  if (error) return { success: false, error: error.message };
  return { success: true, report: data as MinMaxProblemReport };
}

/**
 * Terapkan batch (update min/max) lalu bersihkan staging. Pakai SETELAH
 * validateMinMaxBatch memastikan tidak ada error pemblokir.
 */
export async function applyMinMaxBatch(
  batchCode: string,
): Promise<
  | { success: true; updatedRows: number; minGtMax: number }
  | { success: false; error: string }
> {
  const denied = await requireModerator();
  if (denied) return { success: false, error: denied };

  const admin = createAdminClient();
  try {
    const { data, error } = await admin.rpc(
      "apply_stock_minmax_import_staging",
      { p_batch_code: batchCode },
    );
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    revalidatePath("/stock");
    revalidatePath("/barang");
    return {
      success: true,
      updatedRows: Number(row?.updated_rows ?? 0),
      minGtMax: Number(row?.min_gt_max_rows ?? 0),
    };
  } catch (e: any) {
    return { success: false, error: e?.message || "Gagal menerapkan min/max." };
  } finally {
    await admin
      .from("stock_minmax_import_staging")
      .delete()
      .eq("batch_code", batchCode);
  }
}

/** Hapus baris staging untuk batch (dipakai saat batal / validasi gagal). */
export async function clearMinMaxBatch(batchCode: string): Promise<void> {
  const denied = await requireModerator();
  if (denied) return;
  if (!batchCode || !batchCode.startsWith("MINMAX_")) return;
  const admin = createAdminClient();
  await admin
    .from("stock_minmax_import_staging")
    .delete()
    .eq("batch_code", batchCode);
}

export async function updateStock(
  id: number,
  data: {
    qty: number;
    min_qty: number;
    max_qty: number;
  }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Session expired" };

  // 1. Get current stock for change calculation & cabang scope check
  const { data: currentStock } = await supabase
    .from("stock")
    .select("qty, part_id, cabang_id")
    .eq("id", id)
    .single();

  if (!currentStock) return { success: false, error: "Stock record not found" };

  // RBAC: hanya PPIC, PJO, atau Moderator yang boleh mengubah min/max stock.
  // PPIC & PJO hanya untuk gudang di lokasinya sendiri; Moderator global.
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  const roles = (roleRows || [])
    .map((r: any) => r.roles?.name)
    .filter(Boolean);
  const isModerator = roles.includes("moderator");
  const isPpicOrPjo = roles.includes("ppic") || roles.includes("pjo");

  if (!isModerator && !isPpicOrPjo) {
    return {
      success: false,
      error:
        "Akses ditolak. Hanya PPIC, PJO, atau Moderator yang dapat mengubah stok.",
    };
  }

  if (!isModerator) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("cabang_id")
      .eq("id", user.id)
      .single();
    if (!profile?.cabang_id || profile.cabang_id !== currentStock.cabang_id) {
      return {
        success: false,
        error:
          "Akses ditolak. PPIC/PJO hanya dapat mengubah stok di gudang lokasinya sendiri.",
      };
    }
  }

  const qtyChange = data.qty - currentStock.qty;

  // 2. Perform Update
  const { error } = await supabase
    .from("stock")
    .update(data)
    .eq("id", id);

  if (error) {
    console.error("Error updating stock:", error);
    return { success: false, error: error.message };
  }

  // 3. Log Movement if qty changed
  if (qtyChange !== 0) {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("stock_movements").insert({
      part_id: currentStock.part_id,
      cabang_id: currentStock.cabang_id,
      qty_change: qtyChange,
      type: 'ADJUSTMENT',
      reference_id: 'MANUAL',
      created_by: user?.id,
      notes: 'Manual stock adjustment'
    });
  }

  revalidatePath("/stock");
  revalidatePath("/barang");
  return { success: true };
}

/**
 * Upsert stock record. Used when receiving items.
 */
export async function upsertStock(data: {
  part_id: number;
  cabang_id: number;
  qty: number;
  min_qty?: number;
  max_qty?: number;
}) {
  const supabase = await createClient();

  // We use the UNIQUE constraint on (part_id, cabang_id)
  const { error } = await supabase.from("stock").upsert(data, {
    onConflict: "part_id,cabang_id",
  });

  if (error) {
    console.error("Error upserting stock:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/stock");
  return { success: true };
}
