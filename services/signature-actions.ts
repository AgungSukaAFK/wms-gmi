"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";

/**
 * Pembuatan Tanda Tangan Baru
 */
export async function createSignature(formData: {
  imageFile: File;
  label: string;
  accountPassword: string;
  signaturePassword: string;
}) {
  const supabase = await createClient();

  // 1. Dapatkan user saat ini
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { error: "Sesi tidak valid. Silakan login kembali." };

  // 2. Verifikasi Password Akun (Re-authentication trick)
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: formData.accountPassword,
  });
  if (authError) return { error: "Password akun salah. Verifikasi gagal." };

  // 3. Ambil Nama Profile otomatis
  const { data: profile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .single();
  
  const printedName = profile?.nama || "Unknown User";

  // 4. Hash Password Signature
  const signaturePasswordHash = await bcrypt.hash(formData.signaturePassword, 10);

  // 5. Upload Gambar ke Storage
  const fileExt = formData.imageFile.name.split('.').pop();
  const fileName = `${Date.now()}.${fileExt}`;
  const filePath = `${user.id}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("signatures")
    .upload(filePath, formData.imageFile);

  if (uploadError) {
    console.error("Upload error:", uploadError);
    return { error: "Gagal mengunggah gambar tanda tangan." };
  }

  // Dapatkan Public URL (Penting: Jika bucket private, gunakan signed URL di client)
  const { data: { publicUrl } } = supabase.storage
    .from("signatures")
    .getPublicUrl(filePath);

  // 6. Simpan Metadata ke Database
  const { error: dbError } = await supabase
    .from("user_signatures")
    .insert({
      user_id: user.id,
      image_url: publicUrl,
      printed_name: printedName,
      label: formData.label,
      password_hash: signaturePasswordHash,
    });

  if (dbError) {
    console.error("DB error:", dbError);
    // Cleanup storage if DB fails
    await supabase.storage.from("signatures").remove([filePath]);
    return { error: dbError.message };
  }

  revalidatePath("/signatures");
  return { success: true };
}

/**
 * Ambil daftar tanda tangan milik user
 */
export async function getMySignatures() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: "Unauthorized" };

  const { data, error } = await supabase
    .from("user_signatures")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return { data: data || [], error: error?.message };
}

/**
 * Update Label Tanda Tangan
 */
export async function updateSignatureLabel(id: string, newLabel: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_signatures")
    .update({ label: newLabel })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/signatures");
  return { success: true };
}

/**
 * Toggle Visibility (Hide/Show)
 */
export async function toggleSignatureVisibility(id: string, isHidden: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_signatures")
    .update({ is_hidden: isHidden })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/signatures");
  return { success: true };
}
