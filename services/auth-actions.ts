"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

/**
 * Sign In with optional NRP support
 */
export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const identifier = formData.get("identifier") as string;
  const password = formData.get("password") as string;

  let email = identifier;

  // Check if identifier is NRP (doesn't contain @)
  if (!identifier.includes("@")) {
    console.log("Attempting NRP lookup for:", identifier);

    // Create a pure, cookie-less client for the NRP lookup to avoid conflicts with expired browser cookies
    const { createClient: createBasicClient } =
      await import("@supabase/supabase-js");
    const anonSupabase = createBasicClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY!,
    );

    const { data: profile, error: profileError } = await anonSupabase
      .from("profiles")
      .select("email")
      .eq("nrp", identifier)
      .single();

    if (profileError || !profile) {
      console.error("NRP lookup error:", profileError);
      return {
        error:
          profileError?.message || "NRP tidak terdaftar atau kredensial salah.",
      };
    }
    email = profile.email;
    console.log("NRP lookup success. Email:", email);
  }

  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // Check if account has been activated by admin
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", signInData.user.id)
    .single();

  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return {
      error:
        "Akun Anda belum diaktifkan oleh admin. Silakan hubungi administrator.",
    };
  }

  revalidatePath("/", "layout");

  // Set daily session cookie — proxy uses this to enforce once-per-day login
  const cookieStore = await cookies();
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD UTC
  cookieStore.set("wms_login_date", today, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 48, // 2 days so proxy can still read it the next day to force re-login
  });

  return { success: true };
}

/**
 * Sign Up with Nama and Cabang selection
 */
export async function signUp(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const nama = formData.get("nama") as string;
  const nrp = formData.get("nrp") as string;
  const cabang_id = formData.get("cabang_id") as string;

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        nama,
        nrp,
        cabang_id: parseInt(cabang_id),
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  // Immediately sign out — new accounts are inactive until approved by admin.
  // Without this, Supabase auto-signs-in the user after signUp.
  await supabase.auth.signOut();

  return { success: true };
}

/**
 * Sign Out
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}

/**
 * Get current user profile
 */
export async function getUserProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang)")
    .eq("id", user.id)
    .single();

  return profile;
}
