"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * CABANG SERVICES
 */
export async function getCabangList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cabang")
    .select("*")
    .order("nama_cabang");

  if (error) {
    console.error("Error fetching cabang:", error);
    return [];
  }
  return data;
}

export async function upsertCabang(formData: FormData) {
  const supabase = await createClient();
  const id = formData.get("id") ? parseInt(formData.get("id") as string) : undefined;
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
  const id = formData.get("id") ? parseInt(formData.get("id") as string) : undefined;
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
export async function getVendorList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .order("vendor_name");

  if (error) {
    console.error("Error fetching vendors:", error);
    return [];
  }
  return data;
}

export async function upsertVendor(formData: FormData) {
  const supabase = await createClient();
  const id = formData.get("id") ? parseInt(formData.get("id") as string) : undefined;
  const vendor_no = formData.get("vendor_no") as string;
  const vendor_name = formData.get("vendor_name") as string;
  const telephone = formData.get("telephone") as string;
  const contact_name = formData.get("contact_name") as string;
  const is_active = formData.get("is_active") === "true";

  const payload = { vendor_no, vendor_name, telephone, contact_name, is_active };

  let query = id 
    ? supabase.from("vendors").update(payload).eq("id", id)
    : supabase.from("vendors").insert([payload]);

  const { error } = await query;

  if (error) return { error: error.message };
  
  revalidatePath("/(With Sidebar)/vendor");
  return { success: true };
}

/**
 * CUSTOMERS SERVICES
 */
export async function getCustomerList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("customer_name");

  if (error) {
    console.error("Error fetching customers:", error);
    return [];
  }
  return data;
}

export async function upsertCustomer(formData: FormData) {
  const supabase = await createClient();
  const id = formData.get("id") ? parseInt(formData.get("id") as string) : undefined;
  const customer_no = formData.get("customer_no") as string;
  const customer_name = formData.get("customer_name") as string;
  const telephone = formData.get("telephone") as string;
  const contact_name = formData.get("contact_name") as string;
  const is_active = formData.get("is_active") === "true";

  const payload = { customer_no, customer_name, telephone, contact_name, is_active };

  let query = id 
    ? supabase.from("customers").update(payload).eq("id", id)
    : supabase.from("customers").insert([payload]);

  const { error } = await query;

  if (error) return { error: error.message };
  
  revalidatePath("/(With Sidebar)/customer");
  return { success: true };
}
