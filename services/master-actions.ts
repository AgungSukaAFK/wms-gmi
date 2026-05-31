"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * CABANG SERVICES
 */

type CabangPayload = {
  nama_cabang: string;
  kode_cabang: string;
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
    .select("id, nama_cabang, kode_cabang, is_active, created_at")
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
  const limit = Math.max(1, Math.min(200, params.limit || 20));
  const search = params.search?.trim() || "";
  const statusFilter = params.is_aktif || "all";

  let query = supabase.from("vendors").select("*", { count: "exact" });

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

  const { data, error, count } = await query
    .order("vendor_name", { ascending: true })
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

export async function deleteVendor(id: number) {
  const access = await hasVendorWriteAccess();
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const { count, error: poError } = await supabase
    .from("pos")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", id);

  if (poError) return { error: poError.message };

  if ((count || 0) > 0) {
    return {
      error: "Vendor tidak dapat dihapus karena sudah direferensikan pada PO",
    };
  }

  const { error } = await supabase.from("vendors").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/vendors");
  return { success: true };
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
};

type CustomerPayload = {
  customer_name: string;
  address?: string;
  telephone?: string;
  email?: string;
  pic_name?: string;
  is_active?: boolean;
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
    ["logistik", "marketing", "admin"].includes(r),
  );

  return {
    allowed,
    error: allowed
      ? null
      : "Akses ditolak. Hanya logistik/marketing/admin yang diizinkan.",
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

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error, count } = await query
    .order("customer_name", { ascending: true })
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
  };

  if (id) {
    return updateCustomer(id, payload);
  }

  return createCustomer(payload);
}
