"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * JOB COSTING SERVICES
 */
export async function getJobCostingList(params?: {
  search?: string;
  status?: string;
  cabang_id?: number;
  page?: number;
  limit?: number;
}) {
  const supabase = await createClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 25;
  const from = (page - 1) * limit;

  let query = supabase
    .from("job_costing")
    .select("*, cabang(nama_cabang), job_costing_items(id, unit_price, qty)", {
      count: "exact",
    })
    .order("created_at", { ascending: false });

  if (params?.search) {
    query = query.or(
      `job_kode.ilike.%${params.search}%,description.ilike.%${params.search}%,finish_part.ilike.%${params.search}%`,
    );
  }
  if (params?.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }
  if (params?.cabang_id) {
    query = query.eq("cabang_id", params.cabang_id);
  }

  query = query.range(from, from + limit - 1);

  const { data, error, count } = await query;
  if (error) return { data: [], count: 0, error: error.message };
  return { data: data ?? [], count: count ?? 0 };
}

export async function getJobCostingById(id: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_costing")
    .select("*, cabang(nama_cabang), job_costing_items(*, po:po_id(po_kode))")
    .eq("id", id)
    .single();

  if (error) return { error: error.message };

  let creator_nama: string | null = null;
  if (data?.created_by) {
    const { data: profileData } = await supabase
      .from("profiles")
      .select("nama")
      .eq("id", data.created_by)
      .maybeSingle();
    creator_nama = profileData?.nama || null;
  }

  return { data: { ...data, creator_nama } };
}

async function getCurrentUserRoles() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      roles: [] as string[],
      error: "Tidak terautentikasi.",
    };
  }

  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  if (error) {
    return { user, roles: [] as string[], error: error.message };
  }

  const roles = (roleRows || [])
    .map((r: any) => r.roles?.name)
    .filter(Boolean) as string[];

  return { user, roles, error: null as string | null };
}

async function canManageJobCostingStatus() {
  const { user, roles, error } = await getCurrentUserRoles();
  if (error || !user) return { allowed: false, error: error || "Unauthorized" };

  const allowed = roles.some((r) => ["admin", "moderator"].includes(r));
  return {
    allowed,
    error: allowed
      ? null
      : "Akses ditolak. Hanya admin/moderator yang diizinkan mengubah status.",
  };
}

async function canManageJobCostingItems(jobId: number) {
  const supabase = await createClient();
  const { user, roles, error } = await getCurrentUserRoles();
  if (error || !user) return { allowed: false, error: error || "Unauthorized" };

  const { data: job, error: jobError } = await supabase
    .from("job_costing")
    .select("created_by, status")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return {
      allowed: false,
      error: jobError?.message || "Job Costing tidak ditemukan.",
    };
  }

  if (job.status !== "open") {
    return {
      allowed: false,
      error: "Item hanya bisa diubah saat status masih open.",
    };
  }

  const isAdminLike = roles.some((r) => ["admin", "moderator"].includes(r));
  const isOwner = job.created_by === user.id;

  return {
    allowed: isAdminLike || isOwner,
    error:
      isAdminLike || isOwner
        ? null
        : "Akses ditolak. Hanya pembuat job/admin/moderator yang boleh mengubah item.",
  };
}

export async function createJobCosting(data: {
  job_kode: string;
  cabang_id: number;
  description: string;
  finish_part?: string;
  job_tanggal?: string;
  status?: "open" | "approved" | "closed" | "rejected";
  notes?: string;
  items: {
    part_id?: number | null;
    part_number?: string;
    part_name?: string;
    description: string;
    qty: number;
    unit: string;
    unit_price: number;
    po_id?: number | null;
    notes?: string;
  }[];
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  // Check duplicate kode
  const { data: existing } = await supabase
    .from("job_costing")
    .select("id")
    .eq("job_kode", data.job_kode)
    .maybeSingle();
  if (existing) return { error: "Kode Job sudah digunakan." };

  const total_cost = data.items.reduce(
    (sum, item) => sum + item.qty * item.unit_price,
    0,
  );

  const { data: job, error } = await supabase
    .from("job_costing")
    .insert({
      job_kode: data.job_kode,
      cabang_id: data.cabang_id,
      description: data.description,
      finish_part: data.finish_part || null,
      job_tanggal: data.job_tanggal || null,
      notes: data.notes || null,
      total_cost,
      status: data.status || "open",
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  if (data.items.length > 0) {
    const itemRows = data.items.map((item) => ({
      job_id: job.id,
      part_id: item.part_id || null,
      part_number: item.part_number || null,
      part_name: item.part_name || null,
      description: item.description,
      qty: item.qty,
      unit: item.unit,
      unit_price: item.unit_price,
      po_id: item.po_id || null,
      notes: item.notes || null,
    }));
    const { error: itemError } = await supabase
      .from("job_costing_items")
      .insert(itemRows);
    if (itemError) return { error: itemError.message };
  }

  revalidatePath("/job-costing");
  return { success: true, data: job };
}

export async function updateJobCostingStatus(id: number, status: string) {
  const access = await canManageJobCostingStatus();
  if (!access.allowed) return { error: access.error };

  if (!["open", "approved", "closed", "rejected"].includes(status)) {
    return { error: "Status tidak valid." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_costing")
    .update({ status })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/job-costing");
  return { success: true };
}

export async function addJobCostingItem(
  jobId: number,
  item: {
    part_id?: number | null;
    part_number?: string;
    part_name?: string;
    description: string;
    qty: number;
    unit: string;
    unit_price: number;
    po_id?: number | null;
    notes?: string;
  },
) {
  const access = await canManageJobCostingItems(jobId);
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const { error } = await supabase.from("job_costing_items").insert({
    job_id: jobId,
    ...item,
    po_id: item.po_id || null,
    notes: item.notes || null,
  });
  if (error) return { error: error.message };

  // Recalculate total_cost
  const { data: items } = await supabase
    .from("job_costing_items")
    .select("qty, unit_price")
    .eq("job_id", jobId);
  const total = (items ?? []).reduce((s, i) => s + i.qty * i.unit_price, 0);
  await supabase
    .from("job_costing")
    .update({ total_cost: total })
    .eq("id", jobId);

  revalidatePath("/job-costing");
  return { success: true };
}

export async function deleteJobCostingItem(itemId: number, jobId: number) {
  const access = await canManageJobCostingItems(jobId);
  if (!access.allowed) return { error: access.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_costing_items")
    .delete()
    .eq("id", itemId);
  if (error) return { error: error.message };

  // Recalculate total_cost
  const { data: items } = await supabase
    .from("job_costing_items")
    .select("qty, unit_price")
    .eq("job_id", jobId);
  const total = (items ?? []).reduce((s, i) => s + i.qty * i.unit_price, 0);
  await supabase
    .from("job_costing")
    .update({ total_cost: total })
    .eq("id", jobId);

  revalidatePath("/job-costing");
  return { success: true };
}

export async function generateJobKode(cabangKode: string) {
  const supabase = await createClient();
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const prefix = `JC/${cabangKode}/${year}/${month}/`;

  const { data } = await supabase
    .from("job_costing")
    .select("job_kode")
    .ilike("job_kode", `${prefix}%`)
    .order("job_kode", { ascending: false })
    .limit(1)
    .maybeSingle();

  let seq = 1;
  if (data?.job_kode) {
    const parts = data.job_kode.split("/");
    seq = parseInt(parts[parts.length - 1] || "0") + 1;
  }
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

/**
 * SPB (Surat Perintah Bayar) SERVICES
 */
export async function getSPBList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spb")
    .select("*, po:pos(po_kode, vendor:vendors(vendor_name))")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching SPB:", error);
    return [];
  }
  return data;
}

export async function createSPB(data: {
  spb_kode: string;
  po_id: number;
  total_amount: number;
}) {
  const supabase = await createClient();
  const { data: spb, error } = await supabase
    .from("spb")
    .insert([
      {
        spb_kode: data.spb_kode,
        po_id: data.po_id,
        total_amount: data.total_amount,
        status: "open",
      },
    ])
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/(With Sidebar)/finance");
  return { success: true, data: spb };
}
