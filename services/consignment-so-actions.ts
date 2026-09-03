"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type ConsignmentSoItemInput = {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  part_number_customer?: string;
  code_item_customer?: string;
  qty: number;
};

async function getRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (roleRows || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

async function requireModeratorOrAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" } as const;

  const roleNames = await getRoleNames(supabase, user.id);
  const allowed = roleNames.some(
    (role) => role === "moderator" || role === "admin",
  );
  if (!allowed)
    return {
      error:
        "Akses ditolak. Hanya moderator/admin yang dapat mengubah atau menghapus SO Consignment.",
    } as const;

  return { supabase, user } as const;
}

/**
 * BUAT SO CONSIGNMENT
 *
 * Murni pencatatan data. Tidak ada pergerakan stok & tidak ada approval.
 */
export async function createConsignmentSo(data: {
  so_no: string;
  so_tanggal_input: string;
  tgl_po_email_marketing?: string;
  tgl_po_customer?: string;
  due_date?: string;
  no_po?: string;
  customer_id: number;
  site?: string;
  items: ConsignmentSoItemInput[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const soNo = data.so_no?.trim();
  if (!soNo) return { error: "No. SO wajib diisi." };
  if (!data.customer_id) return { error: "Customer wajib dipilih." };
  if (!data.items || data.items.length === 0)
    return { error: "Daftar item tidak boleh kosong." };
  for (const item of data.items) {
    if (!item.qty || item.qty <= 0)
      return { error: `${item.part_number}: qty harus lebih dari 0.` };
  }

  // No. SO unik
  const { data: existing } = await supabase
    .from("consignment_so")
    .select("id")
    .eq("so_no", soNo)
    .maybeSingle();
  if (existing) return { error: "No. SO sudah digunakan. Gunakan nomor lain." };

  // Insert header
  const { data: soRow, error: soError } = await supabase
    .from("consignment_so")
    .insert([
      {
        so_no: soNo,
        so_tanggal_input: data.so_tanggal_input,
        tgl_po_email_marketing: data.tgl_po_email_marketing || null,
        tgl_po_customer: data.tgl_po_customer || null,
        due_date: data.due_date || null,
        no_po: data.no_po?.trim() || null,
        customer_id: data.customer_id,
        site: data.site?.trim() || null,
        created_by: user.id,
      },
    ])
    .select()
    .single();
  if (soError) return { error: soError.message };

  // Insert items
  const itemsToInsert = data.items.map((item) => ({
    so_id: soRow.id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    part_number_customer: item.part_number_customer?.trim() || null,
    code_item_customer: item.code_item_customer?.trim() || null,
    qty: item.qty,
  }));
  const { error: itemsError } = await supabase
    .from("consignment_so_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  revalidatePath("/so-reguler/consignment/so");
  return { success: true, data: soRow };
}

/**
 * UPDATE HEADER SO CONSIGNMENT (moderator/admin).
 *
 * Item tidak diubah lewat fungsi ini (mengikuti pola DO Reguler).
 */
export async function updateConsignmentSo(
  soId: number,
  payload: Partial<{
    so_tanggal_input: string;
    tgl_po_email_marketing: string;
    tgl_po_customer: string;
    due_date: string;
    no_po: string;
    site: string;
  }>,
) {
  const auth = await requireModeratorOrAdmin();
  if ("error" in auth) return { error: auth.error };

  const { supabase } = auth;
  const safePayload = {
    ...payload,
    tgl_po_email_marketing: payload.tgl_po_email_marketing || null,
    tgl_po_customer: payload.tgl_po_customer || null,
    due_date: payload.due_date || null,
    no_po: payload.no_po?.trim() || null,
    site: payload.site?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("consignment_so")
    .update(safePayload)
    .eq("id", soId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/consignment/so");
  return { success: true };
}

/**
 * HAPUS SO CONSIGNMENT (moderator/admin). Item ikut terhapus lewat cascade.
 */
export async function deleteConsignmentSo(soId: number) {
  const auth = await requireModeratorOrAdmin();
  if ("error" in auth) return { error: auth.error };

  const { supabase } = auth;
  const { error } = await supabase
    .from("consignment_so")
    .delete()
    .eq("id", soId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/consignment/so");
  return { success: true };
}

const DASHBOARD_SORT_COLUMNS: Record<string, string> = {
  so_tanggal_input: "so_tanggal_input",
  so_no: "so_no",
  due_date: "due_date",
  customer_name: "customer_name",
  part_number: "part_number",
};

/**
 * REPORT DASHBOARD CONSIGNMENT
 *
 * Satu baris per item SO Consignment (v_consignment_dashboard). Mengikuti
 * pola getSpbReport — kolom fase berikutnya (supply, IT, PR/PO GMI,
 * rekonsiliasi) belum ada di view, ditampilkan kosong oleh frontend.
 */
export async function getConsignmentDashboardReport(params?: {
  search?: string;
  page?: number;
  limit?: number;
  sort?: string;
}) {
  const supabase = await createClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 50;
  const from = (page - 1) * limit;

  let query = supabase
    .from("v_consignment_dashboard")
    .select("*", { count: "exact" });

  const [sortKeyRaw, sortDirRaw] = (params?.sort || "").split(/_(asc|desc)$/);
  const sortColumn = DASHBOARD_SORT_COLUMNS[sortKeyRaw];
  if (sortColumn) {
    query = query.order(sortColumn, { ascending: sortDirRaw === "asc" });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  if (params?.search) {
    query = query.or(
      `so_no.ilike.%${params.search}%,no_po.ilike.%${params.search}%,site.ilike.%${params.search}%,part_number.ilike.%${params.search}%,part_name.ilike.%${params.search}%,code_item_customer.ilike.%${params.search}%,part_number_customer.ilike.%${params.search}%`,
    );
  }

  const { data, error, count } = await query.range(from, from + limit - 1);
  if (error) return { data: [], count: 0, error: error.message };

  return { data: data || [], count: count || 0, error: null as string | null };
}
