"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * JOB COSTING SERVICES
 */
export async function getJobCostingList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_costing")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching job costing:", error);
    return [];
  }
  return data;
}

export async function createJobCosting(data: {
  job_kode: string;
  cabang_id: number;
  description: string;
  total_cost: number;
}) {
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("job_costing")
    .insert([{
      job_kode: data.job_kode,
      cabang_id: data.cabang_id,
      description: data.description,
      total_cost: data.total_cost,
      status: "open"
    }])
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/(With Sidebar)/finance");
  return { success: true, data: job };
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
    .insert([{
      spb_kode: data.spb_kode,
      po_id: data.po_id,
      total_amount: data.total_amount,
      status: "open"
    }])
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/(With Sidebar)/finance");
  return { success: true, data: spb };
}
