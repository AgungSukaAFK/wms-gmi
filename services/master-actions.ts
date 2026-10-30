"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * CABANG SERVICES
 */

type CabangPayload = {
  nama_cabang: string;
  kode_cabang: string;
  alamat?: string;
  is_active?: boolean;
};

async function hasCabangWriteAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { allowed: false, error: "Unauthorized" };
  }

  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  if (error) {
    return { allowed: false, error: error.message };
  }

  const roles = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
  const allowed = roles.includes("moderator");

  return {
    allowed,
    error: allowed
      ? null
      : "Akses ditolak. Hanya moderator yang diizinkan mengelola cabang.",
  };
}

async function countReferences(
  table: string,
  column: string,
  cabangId: number,
) {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, cabangId);

  if (error) {
    // If a table/column doesn't exist in a specific environment, ignore safely.
    return 0;
  }

  return count || 0;
}

// Hanya cabang aktif — dipakai untuk dropdown (mis. pemilihan cabang saat sign-up).
export async function getCabangList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cabang")
    .select("*")
    .eq("is_active", true)
    .order("nama_cabang");

  if (error) {
    console.error("Error fetching cabang:", error);
    return [];
  }
  return data;
}

export async function getCabangManagementList() {
  const access = await hasCabangWriteAccess();
  if (!access.allowed) return { data: [], error: access.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cabang")
    .select("id, nama_cabang, kode_cabang, alamat, is_active, created_at")
    .order("nama_cabang");

  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

export async function createCabang(payload: CabangPayload) {
  const access = await hasCabangWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const nama_cabang = payload.nama_cabang?.trim();
  const kode_cabang = payload.kode_cabang?.trim();

  if (!nama_cabang || !kode_cabang) {
    return { error: "Nama cabang dan kode cabang wajib diisi." };
  }

  const { data: created, error: createError } = await supabase
    .from("cabang")
    .insert([
      {
        nama_cabang,
        kode_cabang,
        alamat: payload.alamat?.trim() || null,
        is_active: payload.is_active ?? true,
      },
    ])
    .select("id")
    .single();

  if (createError || !created) {
    return { error: createError?.message || "Gagal membuat cabang." };
  }

  // Ensure every existing part has an initial stock row at this new cabang.
  const { data: barangRows, error: barangError } = await supabase
    .from("barang")
    .select("id");

  if (barangError) {
    return {
      error: `Cabang berhasil dibuat, tetapi gagal inisialisasi stok: ${barangError.message}`,
    };
  }

  const initialStockRows = (barangRows || []).map((b: any) => ({
    part_id: b.id,
    cabang_id: created.id,
    qty: 0,
    min_qty: 0,
    max_qty: 0,
  }));

  if (initialStockRows.length > 0) {
    const { error: stockError } = await supabase
      .from("stock")
      .upsert(initialStockRows, { onConflict: "part_id,cabang_id" });

    if (stockError) {
      return {
        error: `Cabang berhasil dibuat, tetapi gagal inisialisasi stok: ${stockError.message}`,
      };
    }
  }

  revalidatePath("/cabang");
  return { success: true };
}

export async function updateCabang(id: number, payload: CabangPayload) {
  const access = await hasCabangWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const nama_cabang = payload.nama_cabang?.trim();
  const kode_cabang = payload.kode_cabang?.trim();

  if (!nama_cabang || !kode_cabang) {
    return { error: "Nama cabang dan kode cabang wajib diisi." };
  }

  const { error } = await supabase
    .from("cabang")
    .update({
      nama_cabang,
      kode_cabang,
      alamat: payload.alamat?.trim() || null,
      is_active: payload.is_active ?? true,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/cabang");
  return { success: true };
}

export async function deleteCabangWithConfirmation(
  id: number,
  typedName: string,
) {
  const access = await hasCabangWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const { data: cabang, error: cabangError } = await supabase
    .from("cabang")
    .select("id, nama_cabang")
    .eq("id", id)
    .single();

  if (cabangError || !cabang) return { error: "Cabang tidak ditemukan." };

  if (typedName.trim() !== cabang.nama_cabang) {
    return {
      error:
        "Konfirmasi hapus tidak sesuai. Ketik persis nama cabang untuk melanjutkan.",
    };
  }

  const checks = [
    { table: "profiles", column: "cabang_id", label: "Profiles" },
    { table: "stock", column: "cabang_id", label: "Stock" },
    {
      table: "deliveries",
      column: "dari_cabang_id",
      label: "Deliveries (Dari)",
    },
    { table: "deliveries", column: "ke_cabang_id", label: "Deliveries (Ke)" },
    { table: "mrs", column: "cabang_id", label: "Material Request" },
    { table: "prs", column: "cabang_id", label: "Purchase Request" },
    { table: "pos", column: "cabang_id", label: "Purchase Order" },
    { table: "receives", column: "cabang_id", label: "Receive Item" },
    { table: "job_costing", column: "cabang_id", label: "Job Costing" },
    {
      table: "approval_templates",
      column: "cabang_id",
      label: "Approval Templates",
    },
    {
      table: "mr_sharestock_allocations",
      column: "source_cabang_id",
      label: "MR Share Stock Allocations",
    },
    {
      table: "job_costing_items",
      column: "source_cabang_id",
      label: "Job Costing Items (Source)",
    },
    {
      table: "job_costing",
      column: "finish_part_cabang_id",
      label: "Job Costing Finish Part",
    },
    {
      table: "job_costing_finish_parts",
      column: "cabang_id",
      label: "Job Costing Finish Parts",
    },
  ];

  const refs: string[] = [];
  for (const check of checks) {
    const count = await countReferences(check.table, check.column, id);
    if (count > 0) {
      refs.push(`${check.label}: ${count}`);
    }
  }

  if (refs.length > 0) {
    return {
      error:
        "Cabang tidak dapat dihapus karena masih direferensikan data lain.",
      references: refs,
    };
  }

  const { error } = await supabase.from("cabang").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/cabang");
  return { success: true };
}

export async function upsertCabang(formData: FormData) {
  const supabase = await createClient();
  const id = formData.get("id")
    ? parseInt(formData.get("id") as string)
    : undefined;
  const nama_cabang = formData.get("nama_cabang") as string;
  const kode_cabang = formData.get("kode_cabang") as string;
  const is_active = formData.get("is_active") === "true";

  const payload = { nama_cabang, kode_cabang, is_active };

  let query = id
    ? supabase.from("cabang").update(payload).eq("id", id)
    : supabase.from("cabang").insert([payload]);

  const { error } = await query;

  if (error) return { error: error.message };

  revalidatePath("/(With Sidebar)/cabang");
  return { success: true };
}

/**
 * BARANG SERVICES
 */
export async function getBarangList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("barang")
    .select("*")
    .order("part_name");

  if (error) {
    console.error("Error fetching barang:", error);
    return [];
  }
  return data;
}

export async function upsertBarang(formData: FormData) {
  const supabase = await createClient();
  const id = formData.get("id")
    ? parseInt(formData.get("id") as string)
    : undefined;
  const part_number = formData.get("part_number") as string;
  const part_name = formData.get("part_name") as string;
  const part_satuan = formData.get("part_satuan") as string;

  const payload = { part_number, part_name, part_satuan };

  let query = id
    ? supabase.from("barang").update(payload).eq("id", id)
    : supabase.from("barang").insert([payload]);

  const { error } = await query;

  if (error) return { error: error.message };

  revalidatePath("/(With Sidebar)/barang");
  return { success: true };
}

/**
 * VENDORS SERVICES
 */
type VendorListParams = {
  page?: number;
  limit?: number;
  search?: string;
  is_aktif?: "all" | "active" | "inactive";
  sort?: string;
  /** true = hanya vendor terhapus (soft delete), default hanya yang belum. */
  deleted?: boolean;
};

type VendorPayload = {
  vendor_name: string;
  address?: string;
  telephone?: string;
  email?: string;
  pic_name?: string;
  is_active?: boolean;
};

async function hasVendorWriteAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { allowed: false, error: "Unauthorized" };
  }

  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  if (error) {
    return { allowed: false, error: error.message };
  }

  const roles = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
  const allowed = roles.some((r: string) =>
    ["purchasing", "admin", "moderator"].includes(r),
  );

  return {
    allowed,
    error: allowed
      ? null
      : "Akses ditolak. Hanya purchasing/admin/moderator yang diizinkan.",
  };
}

async function hasVendorModeratorAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { allowed: false, userId: null, error: "Unauthorized" };
  }

  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  if (error) {
    return { allowed: false, userId: user.id, error: error.message };
  }

  const roles = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
  const allowed = roles.includes("moderator");

  return {
    allowed,
    userId: user.id,
    error: allowed
      ? null
      : "Akses ditolak. Aksi massal vendor hanya untuk moderator.",
  };
}

// Batas id per request .in(...) supaya URL PostgREST tidak kepanjangan.
const VENDOR_ID_CHUNK = 200;
const VENDOR_MAX_BULK_ROWS = 1000;

function chunkIds<T>(list: T[], size = VENDOR_ID_CHUNK) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function generateVendorCode() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const nextNumber = ((data?.id as number | undefined) || 0) + 1;
  return `VND-${String(nextNumber).padStart(5, "0")}`;
}

export async function getVendorList(params: VendorListParams = {}) {
  const supabase = await createClient();
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(1, Math.min(1000, params.limit || 25));
  const search = params.search?.trim() || "";
  const statusFilter = params.is_aktif || "all";

  let query = supabase.from("vendors").select("*", { count: "exact" });

  query = params.deleted
    ? query.not("deleted_at", "is", null)
    : query.is("deleted_at", null);

  if (search) {
    query = query.or(
      `vendor_name.ilike.%${search}%,vendor_no.ilike.%${search}%,email.ilike.%${search}%,pic_name.ilike.%${search}%`,
    );
  }

  if (statusFilter === "active") {
    query = query.eq("is_active", true);
  } else if (statusFilter === "inactive") {
    query = query.eq("is_active", false);
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Konvensi sort key: `${kolom}_${asc|desc}`.
  const VENDOR_SORT_COLUMNS: Record<string, string> = {
    vendor_name: "vendor_name",
    vendor_no: "vendor_no",
    is_active: "is_active",
  };
  const [sortKeyRaw, sortDirRaw] = (params.sort || "").split(/_(asc|desc)$/);
  const sortColumn = VENDOR_SORT_COLUMNS[sortKeyRaw];
  const sortField = sortColumn || "vendor_name";
  const sortAscending = sortColumn ? sortDirRaw === "asc" : true;

  const { data, error, count } = await query
    .order(sortField, { ascending: sortAscending })
    .range(from, to);

  if (error) {
    return { data: [], total: 0, page, limit, error: error.message };
  }

  return {
    data: data || [],
    total: count || 0,
    page,
    limit,
    error: null,
  };
}

export async function createVendor(payload: VendorPayload) {
  const access = await hasVendorWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();

  const vendor_name = payload.vendor_name?.trim();
  if (!vendor_name) {
    return { error: "Nama vendor wajib diisi" };
  }

  let vendor_no = "";
  try {
    vendor_no = await generateVendorCode();
  } catch (err: any) {
    return { error: err.message || "Gagal membuat kode vendor" };
  }

  const { data, error } = await supabase
    .from("vendors")
    .insert([
      {
        vendor_no,
        vendor_name,
        address: payload.address?.trim() || null,
        telephone: payload.telephone?.trim() || null,
        email: payload.email?.trim() || null,
        pic_name: payload.pic_name?.trim() || null,
        is_active: payload.is_active ?? true,
      },
    ])
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/vendors");
  return { success: true, data };
}

export async function updateVendor(id: number, payload: VendorPayload) {
  const access = await hasVendorWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();

  const vendor_name = payload.vendor_name?.trim();
  if (!vendor_name) {
    return { error: "Nama vendor wajib diisi" };
  }

  const { error } = await supabase
    .from("vendors")
    .update({
      vendor_name,
      address: payload.address?.trim() || null,
      telephone: payload.telephone?.trim() || null,
      email: payload.email?.trim() || null,
      pic_name: payload.pic_name?.trim() || null,
      is_active: payload.is_active ?? true,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/vendors");
  return { success: true };
}

export async function toggleVendorStatus(id: number) {
  const access = await hasVendorWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase
    .from("vendors")
    .select("id, is_active")
    .eq("id", id)
    .single();

  if (currentError || !current) return { error: "Vendor tidak ditemukan" };

  const { error } = await supabase
    .from("vendors")
    .update({ is_active: !current.is_active })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/vendors");
  return { success: true };
}

export type VendorDeleteSkip = { id: number; vendor_no: string; reason: string };

/**
 * Hapus vendor = soft delete (vendors.deleted_at, migration 20261030120000).
 * PR/PO/SPB/IT mengambil nama vendor lewat join, jadi baris vendor tetap
 * disimpan supaya dokumen lama tidak berubah. Vendor yang barang titipannya
 * masih ada di gudang GMI dilewati.
 */
async function softDeleteVendors(ids: number[], userId: string) {
  const supabase = await createClient();
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id))));

  const rows: { id: number; vendor_no: string }[] = [];
  for (const part of chunkIds(uniqueIds)) {
    const { data, error } = await supabase
      .from("vendors")
      .select("id, vendor_no")
      .in("id", part)
      .is("deleted_at", null);
    if (error) return { error: error.message } as const;
    rows.push(...(data || []));
  }

  const blocked = new Set<number>();
  for (const part of chunkIds(rows.map((r) => r.id))) {
    const { data, error } = await supabase
      .from("vendor_consignment_stock")
      .select("vendor_id")
      .in("vendor_id", part)
      .neq("qty", 0);
    if (error) return { error: error.message } as const;
    for (const s of data || []) blocked.add(s.vendor_id);
  }

  const skipped: VendorDeleteSkip[] = rows
    .filter((r) => blocked.has(r.id))
    .map((r) => ({
      id: r.id,
      vendor_no: r.vendor_no,
      reason: "Masih ada stok titipan vendor di gudang",
    }));
  const deletableIds = rows.filter((r) => !blocked.has(r.id)).map((r) => r.id);

  const deletedAt = new Date().toISOString();
  for (const part of chunkIds(deletableIds)) {
    const { error } = await supabase
      .from("vendors")
      .update({ deleted_at: deletedAt, deleted_by: userId })
      .in("id", part)
      .is("deleted_at", null);
    if (error) return { error: error.message } as const;
  }

  return { deleted: deletableIds.length, skipped } as const;
}

export async function deleteVendor(id: number) {
  const access = await hasVendorWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const result = await softDeleteVendors([id], user.id);
  if ("error" in result) return { error: result.error };
  if (result.skipped.length > 0) {
    return {
      error: `Vendor tidak dapat dihapus: ${result.skipped[0].reason.toLowerCase()}.`,
    };
  }

  revalidatePath("/vendors");
  return { success: true };
}

export async function bulkDeleteVendors(ids: number[]) {
  const access = await hasVendorModeratorAccess();
  if (!access.allowed || !access.userId) return { error: access.error };
  if (ids.length === 0) return { error: "Tidak ada vendor dipilih." };
  if (ids.length > VENDOR_MAX_BULK_ROWS)
    return { error: `Maksimal ${VENDOR_MAX_BULK_ROWS} vendor sekali hapus.` };

  const result = await softDeleteVendors(ids, access.userId);
  if ("error" in result) return { error: result.error };

  revalidatePath("/vendors");
  return { success: true, deleted: result.deleted, skipped: result.skipped };
}

export async function restoreVendors(ids: number[]) {
  const access = await hasVendorModeratorAccess();
  if (!access.allowed) return { error: access.error };
  if (ids.length === 0) return { error: "Tidak ada vendor dipilih." };
  if (ids.length > VENDOR_MAX_BULK_ROWS)
    return { error: `Maksimal ${VENDOR_MAX_BULK_ROWS} vendor sekali pulihkan.` };

  const supabase = await createClient();
  let restored = 0;
  for (const part of chunkIds(Array.from(new Set(ids)))) {
    const { data, error } = await supabase
      .from("vendors")
      .update({ deleted_at: null, deleted_by: null })
      .in("id", part)
      .not("deleted_at", "is", null)
      .select("id");
    if (error) return { error: error.message };
    restored += data?.length || 0;
  }

  revalidatePath("/vendors");
  return { success: true, restored };
}

export type VendorBulkEditRow = VendorPayload & { id: number };

/**
 * Simpan edit massal vendor (hanya baris yang berubah). Satu statement upsert
 * berdasarkan id supaya semuanya tersimpan atau tidak sama sekali; vendor_no
 * diambil dari DB (tidak bisa diubah dari sini).
 */
export async function bulkUpdateVendors(rows: VendorBulkEditRow[]) {
  const access = await hasVendorModeratorAccess();
  if (!access.allowed) return { error: access.error };
  if (rows.length === 0) return { error: "Tidak ada perubahan untuk disimpan." };
  if (rows.length > VENDOR_MAX_BULK_ROWS)
    return { error: `Maksimal ${VENDOR_MAX_BULK_ROWS} vendor sekali simpan.` };

  const supabase = await createClient();
  const ids = Array.from(new Set(rows.map((r) => Number(r.id))));
  const vendorNoById = new Map<number, string>();
  for (const part of chunkIds(ids)) {
    const { data, error } = await supabase
      .from("vendors")
      .select("id, vendor_no")
      .in("id", part);
    if (error) return { error: error.message };
    for (const v of data || []) vendorNoById.set(v.id, v.vendor_no);
  }
  if (vendorNoById.size !== ids.length)
    return { error: "Sebagian vendor tidak ditemukan. Muat ulang halaman lalu coba lagi." };

  const payload = rows.map((r) => ({
    id: Number(r.id),
    vendor_no: vendorNoById.get(Number(r.id))!,
    vendor_name: r.vendor_name?.trim() || "",
    address: r.address?.trim() || null,
    telephone: r.telephone?.trim() || null,
    email: r.email?.trim() || null,
    pic_name: r.pic_name?.trim() || null,
    is_active: r.is_active ?? true,
  }));
  const empty = payload.find((r) => !r.vendor_name);
  if (empty) return { error: `Nama vendor wajib diisi (${empty.vendor_no}).` };

  const { error } = await supabase.from("vendors").upsert(payload, { onConflict: "id" });
  if (error) return { error: error.message };

  revalidatePath("/vendors");
  return { success: true, updated: payload.length };
}

export async function upsertVendor(formData: FormData) {
  const id = formData.get("id")
    ? parseInt(formData.get("id") as string)
    : undefined;

  const payload: VendorPayload = {
    vendor_name: (formData.get("vendor_name") as string) || "",
    address: (formData.get("address") as string) || "",
    telephone: (formData.get("telephone") as string) || "",
    email: (formData.get("email") as string) || "",
    pic_name: (formData.get("pic_name") as string) || "",
    is_active: formData.get("is_active") !== "false",
  };

  if (id) {
    return updateVendor(id, payload);
  }

  return createVendor(payload);
}

/**
 * CUSTOMERS SERVICES
 */
type CustomerListParams = {
  page?: number;
  limit?: number;
  search?: string;
  is_aktif?: "all" | "active" | "inactive";
  customer_type?: "all" | CustomerType;
  sortField?: string;
  ascending?: boolean;
};

type CustomerType = "consignment" | "non_consignment" | "both";

type CustomerPayload = {
  customer_name: string;
  address?: string;
  telephone?: string;
  email?: string;
  pic_name?: string;
  is_active?: boolean;
  customer_type?: CustomerType;
};

async function hasCustomerWriteAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { allowed: false, error: "Unauthorized" };
  }

  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  if (error) {
    return { allowed: false, error: error.message };
  }

  const roles = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
  const allowed = roles.some((r: string) =>
    ["marketing", "moderator"].includes(r),
  );

  return {
    allowed,
    error: allowed
      ? null
      : "Akses ditolak. Hanya marketing/moderator yang diizinkan.",
  };
}

async function generateCustomerCode() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const nextNumber = ((data?.id as number | undefined) || 0) + 1;
  return `CST-${String(nextNumber).padStart(5, "0")}`;
}

export async function getCustomerList(params: CustomerListParams = {}) {
  const supabase = await createClient();
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(1, Math.min(200, params.limit || 20));
  const search = params.search?.trim() || "";
  const statusFilter = params.is_aktif || "all";

  let query = supabase.from("customers").select("*", { count: "exact" });

  if (search) {
    query = query.or(
      `customer_name.ilike.%${search}%,customer_no.ilike.%${search}%,email.ilike.%${search}%,pic_name.ilike.%${search}%`,
    );
  }

  if (statusFilter === "active") {
    query = query.eq("is_active", true);
  } else if (statusFilter === "inactive") {
    query = query.eq("is_active", false);
  }

  const typeFilter = params.customer_type || "all";
  if (typeFilter !== "all") {
    query = query.eq("customer_type", typeFilter);
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error, count } = await query
    .order(params.sortField || "customer_name", {
      ascending: params.ascending ?? true,
    })
    .range(from, to);

  if (error) {
    return { data: [], total: 0, page, limit, error: error.message };
  }

  return {
    data: data || [],
    total: count || 0,
    page,
    limit,
    error: null,
  };
}

export async function createCustomer(payload: CustomerPayload) {
  const access = await hasCustomerWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();

  const customer_name = payload.customer_name?.trim();
  if (!customer_name) {
    return { error: "Nama customer wajib diisi" };
  }

  let customer_no = "";
  try {
    customer_no = await generateCustomerCode();
  } catch (err: any) {
    return { error: err.message || "Gagal membuat kode customer" };
  }

  const { data, error } = await supabase
    .from("customers")
    .insert([
      {
        customer_no,
        customer_name,
        address: payload.address?.trim() || null,
        telephone: payload.telephone?.trim() || null,
        email: payload.email?.trim() || null,
        pic_name: payload.pic_name?.trim() || null,
        is_active: payload.is_active ?? true,
        customer_type: payload.customer_type || "non_consignment",
      },
    ])
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/customers");
  return { success: true, data };
}

export async function updateCustomer(id: number, payload: CustomerPayload) {
  const access = await hasCustomerWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();

  const customer_name = payload.customer_name?.trim();
  if (!customer_name) {
    return { error: "Nama customer wajib diisi" };
  }

  const { error } = await supabase
    .from("customers")
    .update({
      customer_name,
      address: payload.address?.trim() || null,
      telephone: payload.telephone?.trim() || null,
      email: payload.email?.trim() || null,
      pic_name: payload.pic_name?.trim() || null,
      is_active: payload.is_active ?? true,
      customer_type: payload.customer_type || "non_consignment",
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/customers");
  return { success: true };
}

export async function toggleCustomerStatus(id: number) {
  const access = await hasCustomerWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase
    .from("customers")
    .select("id, is_active")
    .eq("id", id)
    .single();

  if (currentError || !current) return { error: "Customer tidak ditemukan" };

  const { error } = await supabase
    .from("customers")
    .update({ is_active: !current.is_active })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/customers");
  return { success: true };
}

export async function upsertCustomer(formData: FormData) {
  const id = formData.get("id")
    ? parseInt(formData.get("id") as string)
    : undefined;

  const payload: CustomerPayload = {
    customer_name: (formData.get("customer_name") as string) || "",
    address: (formData.get("address") as string) || "",
    telephone: (formData.get("telephone") as string) || "",
    email: (formData.get("email") as string) || "",
    pic_name: (formData.get("pic_name") as string) || "",
    is_active: formData.get("is_active") !== "false",
    customer_type:
      (formData.get("customer_type") as CustomerType) || "non_consignment",
  };

  if (id) {
    return updateCustomer(id, payload);
  }

  return createCustomer(payload);
}

/**
 * CUSTOMER SITES
 *
 * Master site per customer (= gudang customer). Dipakai Consignment:
 * dropdown Site di SO dan Site Tujuan di IK hanya menampilkan site milik
 * customer yang dipilih. cabang_id = kolom lama, tidak dipakai IK lagi.
 */
type CustomerSitePayload = {
  site_name: string;
  alamat?: string;
  cabang_id?: number | null;
  is_active?: boolean;
};

export async function getCustomerSites(
  customerId: number,
  opts: { activeOnly?: boolean } = {},
) {
  const supabase = await createClient();
  let query = supabase
    .from("customer_sites")
    .select("*, cabang:cabang!cabang_id(id, nama_cabang)")
    .eq("customer_id", customerId)
    .order("site_name");
  if (opts.activeOnly) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null };
}

function normalizeSitePayload(payload: CustomerSitePayload) {
  return {
    site_name: payload.site_name?.trim().toUpperCase() || "",
    alamat: payload.alamat?.trim() || null,
    cabang_id: payload.cabang_id || null,
    is_active: payload.is_active ?? true,
  };
}

function mapSiteError(message: string) {
  return message.includes("uq_customer_sites_customer_name")
    ? "Nama site sudah ada untuk customer ini."
    : message;
}

export async function createCustomerSite(
  customerId: number,
  payload: CustomerSitePayload,
) {
  const access = await hasCustomerWriteAccess();
  if (!access.allowed) return { error: access.error };

  const row = normalizeSitePayload(payload);
  if (!row.site_name) return { error: "Nama site wajib diisi" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_sites")
    .insert([{ ...row, customer_id: customerId }])
    .select()
    .single();
  if (error) return { error: mapSiteError(error.message) };

  revalidatePath("/customers");
  return { success: true, data };
}

export async function updateCustomerSite(
  id: number,
  payload: CustomerSitePayload,
) {
  const access = await hasCustomerWriteAccess();
  if (!access.allowed) return { error: access.error };

  const row = normalizeSitePayload(payload);
  if (!row.site_name) return { error: "Nama site wajib diisi" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customer_sites")
    .update(row)
    .eq("id", id);
  if (error) return { error: mapSiteError(error.message) };

  revalidatePath("/customers");
  return { success: true };
}

/**
 * UNIT SERVICES
 * Baca: semua user login. Tulis: moderator saja (juga dijaga RLS units).
 */

type UnitPayload = {
  kode_unit: string;
  tipe_unit: string;
  brand?: string | null;
  is_active?: boolean;
};

type UnitListParams = {
  page?: number;
  limit?: number;
  search?: string;
  // "all" | "__none__" (tanpa brand) | nama brand
  brand?: string;
  is_aktif?: "all" | "active" | "inactive";
  sort?: string;
};

async function hasUnitWriteAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { allowed: false, error: "Unauthorized" };
  }

  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  if (error) {
    return { allowed: false, error: error.message };
  }

  const roles = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
  const allowed = roles.includes("moderator");

  return {
    allowed,
    error: allowed
      ? null
      : "Akses ditolak. Hanya moderator yang diizinkan mengelola unit.",
  };
}

function normalizeUnitPayload(payload: UnitPayload) {
  const clean = (v?: string | null) => (v || "").replace(/\s+/g, " ").trim();
  return {
    kode_unit: clean(payload.kode_unit),
    tipe_unit: clean(payload.tipe_unit),
    brand: clean(payload.brand).toUpperCase() || null,
    is_active: payload.is_active ?? true,
  };
}

function mapUnitError(message: string) {
  if (message.includes("uq_units_kode_unit")) {
    return "Kode unit sudah terdaftar";
  }
  return message;
}

export async function getUnitList(params: UnitListParams = {}) {
  const supabase = await createClient();
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(1, Math.min(200, params.limit || 20));
  // Kode/tipe unit banyak mengandung "(", "," -> nilai or() wajib di-quote.
  const search = (params.search || "").replace(/["\\]/g, "").trim();
  const statusFilter = params.is_aktif || "all";
  const brandFilter = params.brand || "all";

  let query = supabase.from("units").select("*", { count: "exact" });

  if (search) {
    query = query.or(
      `kode_unit.ilike."%${search}%",tipe_unit.ilike."%${search}%",brand.ilike."%${search}%"`,
    );
  }

  if (statusFilter === "active") {
    query = query.eq("is_active", true);
  } else if (statusFilter === "inactive") {
    query = query.eq("is_active", false);
  }

  if (brandFilter === "__none__") {
    query = query.is("brand", null);
  } else if (brandFilter !== "all") {
    query = query.eq("brand", brandFilter);
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Konvensi sort key: `${kolom}_${asc|desc}`.
  const UNIT_SORT_COLUMNS: Record<string, string> = {
    kode_unit: "kode_unit",
    tipe_unit: "tipe_unit",
    brand: "brand",
    is_active: "is_active",
  };
  const [sortKeyRaw, sortDirRaw] = (params.sort || "").split(/_(asc|desc)$/);
  const sortColumn = UNIT_SORT_COLUMNS[sortKeyRaw];
  const sortField = sortColumn || "kode_unit";
  const sortAscending = sortColumn ? sortDirRaw === "asc" : true;

  let ordered = query.order(sortField, {
    ascending: sortAscending,
    nullsFirst: false,
  });
  if (sortField !== "kode_unit") {
    ordered = ordered.order("kode_unit", { ascending: true });
  }

  const { data, error, count } = await ordered.range(from, to);

  if (error) {
    return { data: [], total: 0, page, limit, error: error.message };
  }

  return {
    data: data || [],
    total: count || 0,
    page,
    limit,
    error: null,
  };
}

// Daftar brand & tipe unik — untuk filter brand dan saran isian form.
export async function getUnitOptions() {
  const supabase = await createClient();
  const brands = new Set<string>();
  const types = new Set<string>();
  const PAGE = 1000; // batas max_rows PostgREST

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("units")
      .select("brand, tipe_unit")
      .order("id")
      .range(from, from + PAGE - 1);

    if (error) return { brands: [], types: [], error: error.message };
    for (const row of data || []) {
      if (row.brand) brands.add(row.brand);
      if (row.tipe_unit) types.add(row.tipe_unit);
    }
    if (!data || data.length < PAGE) break;
  }

  const sort = (a: string, b: string) => a.localeCompare(b, "id");
  return {
    brands: [...brands].sort(sort),
    types: [...types].sort(sort),
    error: null,
  };
}

export async function createUnit(payload: UnitPayload) {
  const access = await hasUnitWriteAccess();
  if (!access.allowed) return { error: access.error };

  const row = normalizeUnitPayload(payload);
  if (!row.kode_unit) return { error: "Kode unit wajib diisi" };
  if (!row.tipe_unit) return { error: "Tipe unit wajib diisi" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .insert([row])
    .select()
    .single();

  if (error) return { error: mapUnitError(error.message) };

  revalidatePath("/units");
  return { success: true, data };
}

export async function updateUnit(id: number, payload: UnitPayload) {
  const access = await hasUnitWriteAccess();
  if (!access.allowed) return { error: access.error };

  const row = normalizeUnitPayload(payload);
  if (!row.kode_unit) return { error: "Kode unit wajib diisi" };
  if (!row.tipe_unit) return { error: "Tipe unit wajib diisi" };

  const supabase = await createClient();
  const { error } = await supabase.from("units").update(row).eq("id", id);

  if (error) return { error: mapUnitError(error.message) };

  revalidatePath("/units");
  return { success: true };
}

export async function toggleUnitStatus(id: number) {
  const access = await hasUnitWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase
    .from("units")
    .select("id, is_active")
    .eq("id", id)
    .single();

  if (currentError || !current) return { error: "Unit tidak ditemukan" };

  const { error } = await supabase
    .from("units")
    .update({ is_active: !current.is_active })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/units");
  return { success: true };
}

export async function deleteUnit(id: number) {
  const access = await hasUnitWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const { error } = await supabase.from("units").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/units");
  return { success: true };
}
