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
  const MAX_SIGNATURES = 2;
  const supabase = await createClient();

  // 1. Dapatkan user saat ini
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user)
    return { error: "Sesi tidak valid. Silakan login kembali." };

  // 2. Verifikasi Password Akun (Re-authentication trick)
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: formData.accountPassword,
  });
  if (authError) return { error: "Password akun salah. Verifikasi gagal." };

  // 2b. Batasi kuota tanda tangan per user
  const { count, error: countError } = await supabase
    .from("user_signatures")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) {
    return { error: "Gagal memeriksa kuota tanda tangan." };
  }

  if ((count ?? 0) >= MAX_SIGNATURES) {
    return {
      error: `Batas maksimal ${MAX_SIGNATURES} tanda tangan telah tercapai.`,
    };
  }

  // 3. Ambil Nama Profile otomatis
  let { data: profile, error: profFetchError } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .single();

  // Auto-fix: Jika profile tidak ditemukan, coba buatkan
  if (profFetchError?.code === "PGRST116" || !profile) {
    console.log("Repairing missing profile in createSignature for:", user.id);
    const { data: newProfile, error: repairError } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        nama: user.user_metadata?.nama || user.email?.split("@")[0] || "User",
        email: user.email!,
        is_active: true,
      })
      .select("nama")
      .single();

    if (repairError)
      return {
        error: `Gagal memperbaiki profil: ${(repairError as any).message}`,
      };
    profile = newProfile;
  }

  const printedName = profile?.nama || "Unknown User";

  // 4. Hash Password Signature
  const signaturePasswordHash = await bcrypt.hash(
    formData.signaturePassword,
    10,
  );

  // 5. Upload Gambar ke Storage
  const fileExt = formData.imageFile.name.split(".").pop();
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
  const {
    data: { publicUrl },
  } = supabase.storage.from("signatures").getPublicUrl(filePath);

  // 6. Simpan Metadata ke Database
  const { error: dbError } = await supabase.from("user_signatures").insert({
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

/**
 * Verifikasi Password Signature dengan Lockout Mechanism
 */
export async function verifySignaturePassword(
  signatureId: string,
  plainPassword: string,
) {
  const supabase = await createClient();

  // 1. Dapatkan user saat ini
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Unauthorized" };

  // 2. Ambil Signature dan Profile User (termasuk status aktif & failed attempts)
  const { data: signatureData, error: sigError } = await supabase
    .from("user_signatures")
    .select("password_hash")
    .eq("id", signatureId)
    .eq("user_id", user.id)
    .single();

  if (sigError || !signatureData)
    return { success: false, error: "Tanda tangan tidak ditemukan" };

  const { data: profile, error: profError } = await supabase
    .from("profiles")
    .select("is_active, signature_failed_attempts")
    .eq("id", user.id)
    .single();

  if (profError || !profile) {
    console.error("Profile security check error:", profError);

    // Auto-fix: Jika profile tidak ditemukan (PGRST116), coba buatkan profile dasar
    if (profError?.code === "PGRST116" || !profile) {
      console.log(
        "Attempting to auto-create missing profile for user:",
        user.id,
      );
      const { data: newProfile, error: createError } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          nama: user.user_metadata?.nama || user.email?.split("@")[0] || "User",
          email: user.email!,
          is_active: true,
          signature_failed_attempts: 0,
        })
        .select()
        .single();

      if (createError) {
        return {
          success: false,
          error: `Gagal membuat profil otomatis: ${createError.message}`,
        };
      }

      return verifySignaturePassword(signatureId, plainPassword); // Pecobaan ulang setelah repair
    }

    return {
      success: false,
      error: `Gagal memuat profil keamanan: ${(profError as any)?.message || "Unknown Error"}`,
    };
  }

  // 3. Cek apakah akun sudah nonaktif
  if (!profile.is_active) {
    return {
      success: false,
      error:
        "AKUN NONAKTIF: Akun Anda telah terkunci karena terlalu banyak percobaan salah. Silakan hubungi Administrator.",
    };
  }

  // 4. Verifikasi Password
  const isMatch = await bcrypt.compare(
    plainPassword,
    signatureData.password_hash,
  );

  if (!isMatch) {
    const newAttempts = (profile.signature_failed_attempts || 0) + 1;
    const isLockout = newAttempts >= 5;

    // Update failed attempts & potentially deactivate
    await supabase
      .from("profiles")
      .update({
        signature_failed_attempts: newAttempts,
        is_active: !isLockout,
      })
      .eq("id", user.id);

    if (isLockout) {
      return {
        success: false,
        error:
          "ACCOUNT LOCKED: Anda telah salah memasukkan password sebanyak 5 kali. Akun Anda telah dinonaktifkan.",
      };
    }

    return {
      success: false,
      error: `Password salah. Sisa percobaan: ${5 - newAttempts} kali lagi.`,
    };
  }

  // 5. Success: Reset failed attempts
  if (profile.signature_failed_attempts > 0) {
    await supabase
      .from("profiles")
      .update({ signature_failed_attempts: 0 })
      .eq("id", user.id);
  }

  return { success: true };
}
