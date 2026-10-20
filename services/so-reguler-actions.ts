"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  SO_KATEGORI_OPTIONS,
  canCreateSO,
  canEditSO,
  refreshSoStatus,
} from "@/lib/so-reguler";

async function getRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (roleRows || [])
    .map((row: any) =>
      Array.isArray(row?.roles) ? row.roles[0]?.name : row?.roles?.name,
    )
    .filter((name: string | undefined): name is string => Boolean(name));
}

/**
 * BUAT SO REGULER
 *
 * Tanpa approval. Wajib customer & kategori. Tanpa lokasi site (revisi
 * 2026-10-16): gudang dipilih saat PO dari SO (gudang penerima) / DO by SO
 * (gudang pengirim). Tidak ada pergerakan stok -- stok baru keluar saat DO
 * Reguler dibuat dari SO ini.
 */
export async function createSoReguler(data: {
  so_kode: string;
  so_tanggal: string;
  so_due_date?: string | null;
  kategori: string;
  // Nomor PO dari customer, keterangan saja (tidak terhubung ke tabel pos).
  customer_po_no?: string;
  customer_po_date?: string | null;
  customer_po_received_date?: string | null;
  marketing_name?: string;
  customer_id: number;
  remarks?: string;
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty: number;
    remarks?: string;
  }[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const roles = await getRoleNames(supabase, user.id);
  if (!canCreateSO(roles)) {
    return {
      error: "Akses ditolak. Hanya marketing/admin/moderator yang bisa membuat SO.",
    };
  }

  const soKode = data.so_kode?.trim();
  if (!soKode) return { error: "Nomor SO wajib diisi." };
  if (!data.so_tanggal) return { error: "Tanggal SO wajib diisi." };
  if (!SO_KATEGORI_OPTIONS.includes(data.kategori))
    return { error: "Kategori SO wajib dipilih." };
  if (!data.customer_id) return { error: "Customer wajib dipilih." };
  if (
    data.customer_po_date &&
    data.customer_po_received_date &&
    data.customer_po_received_date < data.customer_po_date
  )
    return {
      error: "Tanggal PO diterima tidak boleh sebelum tanggal PO dibuat.",
    };
  if (!data.items || data.items.length === 0)
    return { error: "Daftar barang tidak boleh kosong." };
  const badQty = data.items.filter(
    (i) => !Number.isInteger(i.qty) || i.qty <= 0,
  );
  if (badQty.length > 0)
    return {
      error: `Qty harus bilangan bulat > 0: ${badQty.map((i) => i.part_number).join(", ")}`,
    };

  const { data: existing } = await supabase
    .from("so_reguler")
    .select("id")
    .eq("so_kode", soKode)
    .maybeSingle();
  if (existing) return { error: "Nomor SO sudah digunakan. Gunakan nomor lain." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .maybeSingle();

  const { data: so, error: soError } = await supabase
    .from("so_reguler")
    .insert([
      {
        so_kode: soKode,
        so_tanggal: data.so_tanggal,
        so_due_date: data.so_due_date || null,
        kategori: data.kategori,
        customer_po_no: data.customer_po_no?.trim() || null,
        customer_po_date: data.customer_po_date || null,
        customer_po_received_date: data.customer_po_received_date || null,
        marketing_name: data.marketing_name?.trim().toUpperCase() || null,
        customer_id: data.customer_id,
        so_pic: profile?.nama ?? null,
        so_pic_id: user.id,
        remarks: data.remarks?.trim() || null,
        so_status: "open",
        created_by: user.id,
      },
    ])
    .select()
    .single();
  if (soError) return { error: soError.message };

  const { error: itemsError } = await supabase.from("so_reguler_items").insert(
    data.items.map((i) => ({
      so_id: so.id,
      part_id: i.part_id,
      part_number: i.part_number,
      part_name: i.part_name,
      satuan: i.satuan,
      qty: i.qty,
      remarks: i.remarks?.trim() || null,
    })),
  );
  if (itemsError) {
    // Jangan tinggalkan header SO tanpa item.
    await supabase.from("so_reguler").delete().eq("id", so.id);
    return { error: itemsError.message };
  }

  revalidatePath("/so-reguler/so");
  return { success: true, data: so };
}

/**
 * BATALKAN SO REGULER (hanya moderator).
 *
 * PO/DO yang sudah terlanjur dibuat dari SO ini TIDAK ikut dibatalkan -- SO
 * cuma tidak bisa dipakai lagi untuk PO/DO baru.
 */
export async function cancelSoReguler(soId: number, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const roles = await getRoleNames(supabase, user.id);
  if (!roles.includes("moderator"))
    return { error: "Hanya moderator yang dapat membatalkan SO Reguler." };

  if (!reason?.trim()) return { error: "Alasan pembatalan wajib diisi." };

  const { data: so } = await supabase
    .from("so_reguler")
    .select("id, so_status")
    .eq("id", soId)
    .maybeSingle();
  if (!so) return { error: "SO Reguler tidak ditemukan." };
  if (so.so_status === "cancelled")
    return { error: "SO Reguler ini sudah dibatalkan." };

  const { error } = await supabase
    .from("so_reguler")
    .update({
      so_status: "cancelled",
      cancel_reason: reason.trim(),
      cancelled_by: user.id,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", soId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/so");
  return { success: true };
}

/**
 * EDIT SO REGULER (marketing/moderator).
 *
 * Semua validasi distribusi qty (item terpakai PO/DO tidak bisa dihapus/
 * diganti, qty >= qty terpakai, customer terkunci kalau sudah ada DO) dan
 * penyimpanan + riwayat revisi dijalankan atomik di fungsi DB
 * update_so_reguler. Setelah itu status SO dihitung ulang (mis. qty dinaikkan
 * pada SO yang sudah selesai -> balik partial).
 */
export async function updateSoReguler(
  soId: number,
  data: {
    expected_updated_at: string;
    reason: string;
    so_kode: string;
    so_tanggal: string;
    so_due_date?: string | null;
    kategori: string | null;
    customer_po_no?: string;
    customer_po_date?: string | null;
    customer_po_received_date?: string | null;
    marketing_name?: string;
    customer_id: number;
    remarks?: string;
    items: {
      id?: number;
      part_id: number;
      part_number: string;
      part_name: string;
      satuan: string;
      qty: number;
      remarks?: string;
    }[];
  },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const roles = await getRoleNames(supabase, user.id);
  if (!canEditSO(roles))
    return {
      error: "Akses ditolak. Hanya marketing/moderator yang bisa mengedit SO.",
    };
  if (!data.reason?.trim()) return { error: "Alasan perubahan wajib diisi." };

  const { data: result, error } = await supabase.rpc("update_so_reguler", {
    p_so_id: soId,
    p_expected_updated_at: data.expected_updated_at,
    p_reason: data.reason.trim(),
    p_header: {
      so_kode: data.so_kode,
      so_tanggal: data.so_tanggal,
      so_due_date: data.so_due_date || null,
      kategori: data.kategori,
      customer_id: data.customer_id,
      customer_po_no: data.customer_po_no ?? null,
      customer_po_date: data.customer_po_date || null,
      customer_po_received_date: data.customer_po_received_date || null,
      marketing_name: data.marketing_name ?? null,
      remarks: data.remarks ?? null,
    },
    p_items: data.items.map((i) => ({
      id: i.id ?? null,
      part_id: i.part_id,
      part_number: i.part_number,
      part_name: i.part_name,
      satuan: i.satuan,
      qty: i.qty,
      remarks: i.remarks ?? null,
    })),
  });
  if (error) return { error: error.message };

  await refreshSoStatus(supabase, soId);
  revalidatePath("/so-reguler/so");
  revalidatePath(`/so-reguler/so/${soId}`);
  return { success: true, revision_no: (result as any)?.revision_no as number };
}

/** Segarkan status SO (dipanggil saat detail SO dibuka). */
export async function syncSoRegulerStatus(soId: number) {
  const supabase = await createClient();
  await refreshSoStatus(supabase, soId);
  return { success: true };
}
