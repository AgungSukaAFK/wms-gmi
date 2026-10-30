"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// Hapus barang = soft delete (barang.deleted_at, migration 20261030120000).
// Dokumen lama tetap menunjuk ke baris yang sama sehingga tidak ikut hilang /
// berubah; barang terhapus cuma disembunyikan dari master & picker.

// Batas id per request .in(...) supaya URL PostgREST tidak kepanjangan.
const ID_CHUNK = 200;
const MAX_BULK_ROWS = 1000;

function chunk<T>(list: T[], size = ID_CHUNK) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function requireModerator() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesi berakhir, silakan login ulang." } as const;

  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  if (error) return { error: error.message } as const;

  type RoleRow = { roles: { name: string } | { name: string }[] | null };
  const roles = ((roleRows || []) as RoleRow[])
    .map((r) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name))
    .filter(Boolean);
  if (!roles.includes("moderator"))
    return { error: "Akses ditolak. Aksi massal barang hanya untuk moderator." } as const;

  return { supabase, user } as const;
}

async function findExistingPartNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  partNumber: string,
  excludeId?: number,
) {
  let query = supabase
    .from("barang")
    .select("id, part_number, deleted_at")
    .eq("part_number", partNumber)
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.maybeSingle();
  return data;
}

function duplicatePartNumberError(existing: { part_number: string; deleted_at: string | null }) {
  return existing.deleted_at
    ? `Part number ${existing.part_number} sudah ada di barang terhapus. Pulihkan dari filter "Terhapus" (moderator).`
    : `Part number ${existing.part_number} sudah dipakai barang lain.`;
}

export async function createBarang(data: {
  part_number: string;
  part_name: string;
  part_satuan: string;
}) {
  const supabase = await createClient();

  const existing = await findExistingPartNumber(supabase, data.part_number);
  if (existing) return { success: false, error: duplicatePartNumberError(existing) };

  const { error } = await supabase.from("barang").insert([data]);

  if (error) {
    console.error("Error creating barang:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/barang");
  return { success: true };
}

export async function updateBarang(
  id: number,
  data: {
    part_number: string;
    part_name: string;
    part_satuan: string;
  }
) {
  const supabase = await createClient();

  const existing = await findExistingPartNumber(supabase, data.part_number, id);
  if (existing) return { success: false, error: duplicatePartNumberError(existing) };

  const { error } = await supabase.from("barang").update(data).eq("id", id);

  if (error) {
    console.error("Error updating barang:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/barang");
  return { success: true };
}

export type BarangDeleteSkip = { id: number; part_number: string; reason: string };

/**
 * Tandai barang terhapus. Barang yang masih punya stok (qty <> 0) di gudang
 * GMI, titipan vendor, atau di customer dilewati: kalau ikut disembunyikan,
 * stoknya jadi tidak kelihatan di mana pun.
 */
async function softDeleteBarang(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  ids: number[],
) {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id))));
  const rows: { id: number; part_number: string }[] = [];
  for (const part of chunk(uniqueIds)) {
    const { data, error } = await supabase
      .from("barang")
      .select("id, part_number")
      .in("id", part)
      .is("deleted_at", null);
    if (error) return { error: error.message } as const;
    rows.push(...(data || []));
  }

  const stockChecks = [
    { table: "stock", label: "Masih ada stok di gudang" },
    { table: "vendor_consignment_stock", label: "Masih ada stok titipan vendor" },
    { table: "customer_stock", label: "Masih ada stok di customer (konsinyasi)" },
  ];
  const blocked = new Map<number, string>();
  for (const check of stockChecks) {
    for (const part of chunk(rows.map((r) => r.id))) {
      const { data, error } = await supabase
        .from(check.table)
        .select("part_id")
        .in("part_id", part)
        .neq("qty", 0);
      if (error) return { error: error.message } as const;
      for (const s of data || []) {
        if (!blocked.has(s.part_id)) blocked.set(s.part_id, check.label);
      }
    }
  }

  const skipped: BarangDeleteSkip[] = rows
    .filter((r) => blocked.has(r.id))
    .map((r) => ({ id: r.id, part_number: r.part_number, reason: blocked.get(r.id)! }));
  const deletableIds = rows.filter((r) => !blocked.has(r.id)).map((r) => r.id);

  const deletedAt = new Date().toISOString();
  for (const part of chunk(deletableIds)) {
    const { error } = await supabase
      .from("barang")
      .update({ deleted_at: deletedAt, deleted_by: userId })
      .in("id", part)
      .is("deleted_at", null);
    if (error) return { error: error.message } as const;
  }

  return { deleted: deletableIds.length, skipped } as const;
}

export async function deleteBarang(id: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sesi berakhir, silakan login ulang." };

  const result = await softDeleteBarang(supabase, user.id, [id]);
  if ("error" in result) {
    console.error("Error deleting barang:", result.error);
    return { success: false, error: result.error };
  }
  if (result.skipped.length > 0) {
    return {
      success: false,
      error: `Tidak dapat menghapus barang: ${result.skipped[0].reason.toLowerCase()}.`,
    };
  }

  revalidatePath("/barang");
  return { success: true };
}

export async function bulkDeleteBarang(ids: number[]) {
  const auth = await requireModerator();
  if ("error" in auth) return { success: false, error: auth.error };
  if (ids.length === 0) return { success: false, error: "Tidak ada barang dipilih." };
  if (ids.length > MAX_BULK_ROWS)
    return { success: false, error: `Maksimal ${MAX_BULK_ROWS} barang sekali hapus.` };

  const result = await softDeleteBarang(auth.supabase, auth.user.id, ids);
  if ("error" in result) return { success: false, error: result.error };

  revalidatePath("/barang");
  return { success: true, deleted: result.deleted, skipped: result.skipped };
}

export async function restoreBarang(ids: number[]) {
  const auth = await requireModerator();
  if ("error" in auth) return { success: false, error: auth.error };
  if (ids.length === 0) return { success: false, error: "Tidak ada barang dipilih." };
  if (ids.length > MAX_BULK_ROWS)
    return { success: false, error: `Maksimal ${MAX_BULK_ROWS} barang sekali pulihkan.` };

  let restored = 0;
  for (const part of chunk(Array.from(new Set(ids)))) {
    const { data, error } = await auth.supabase
      .from("barang")
      .update({ deleted_at: null, deleted_by: null })
      .in("id", part)
      .not("deleted_at", "is", null)
      .select("id");
    if (error) return { success: false, error: error.message };
    restored += data?.length || 0;
  }

  revalidatePath("/barang");
  return { success: true, restored };
}

export type BarangBulkEditRow = {
  id: number;
  part_number: string;
  part_name: string;
  part_satuan: string;
};

/**
 * Simpan edit massal (hanya baris yang berubah). Satu statement upsert
 * berdasarkan id supaya semuanya tersimpan atau tidak sama sekali.
 */
export async function bulkUpdateBarang(rows: BarangBulkEditRow[]) {
  const auth = await requireModerator();
  if ("error" in auth) return { success: false, error: auth.error };
  const { supabase } = auth;

  if (rows.length === 0) return { success: false, error: "Tidak ada perubahan untuk disimpan." };
  if (rows.length > MAX_BULK_ROWS)
    return { success: false, error: `Maksimal ${MAX_BULK_ROWS} barang sekali simpan.` };

  const payload = rows.map((r) => ({
    id: Number(r.id),
    part_number: (r.part_number || "").trim(),
    part_name: (r.part_name || "").trim(),
    part_satuan: (r.part_satuan || "").trim(),
  }));

  const empty = payload.find((r) => !r.part_number || !r.part_name || !r.part_satuan);
  if (empty)
    return {
      success: false,
      error: `Part number, nama, dan satuan wajib diisi (${empty.part_number || `ID ${empty.id}`}).`,
    };

  const seen = new Map<string, number>();
  for (const r of payload) {
    if (seen.has(r.part_number))
      return { success: false, error: `Part number ${r.part_number} dobel di daftar edit.` };
    seen.set(r.part_number, r.id);
  }

  const ids = payload.map((r) => r.id);
  const idSet = new Set(ids);
  let found = 0;
  for (const part of chunk(ids)) {
    const { count, error } = await supabase
      .from("barang")
      .select("id", { count: "exact", head: true })
      .in("id", part);
    if (error) return { success: false, error: error.message };
    found += count || 0;
  }
  if (found !== ids.length)
    return { success: false, error: "Sebagian barang tidak ditemukan. Muat ulang halaman lalu coba lagi." };

  for (const part of chunk(payload.map((r) => r.part_number))) {
    const { data, error } = await supabase
      .from("barang")
      .select("id, part_number, deleted_at")
      .in("part_number", part);
    if (error) return { success: false, error: error.message };
    const clash = (data || []).find((b) => !idSet.has(b.id));
    if (clash) return { success: false, error: duplicatePartNumberError(clash) };
  }

  const { error } = await supabase.from("barang").upsert(payload, { onConflict: "id" });
  if (error) {
    console.error("Error bulk updating barang:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/barang");
  return { success: true, updated: payload.length };
}

export async function getBarangStockDetails(partId: number) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_stock_with_status")
    .select("*")
    .eq("part_id", partId)
    .order("nama_cabang", { ascending: true });

  if (error) {
    console.error("Error fetching stock details:", error);
    return [];
  }

  return data;
}
