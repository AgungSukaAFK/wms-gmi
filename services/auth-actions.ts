"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
    const { createClient: createBasicClient } = await import('@supabase/supabase-js');
    const anonSupabase = createBasicClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY!
    );
    
    const { data: profile, error: profileError } = await anonSupabase
      .from("profiles")
      .select("email")
      .eq("nrp", identifier)
      .single();

    if (profileError || !profile) {
      console.error("NRP lookup error:", profileError);
      return { error: profileError?.message || "NRP tidak terdaftar atau kredensial salah." };
    }
    email = profile.email;
    console.log("NRP lookup success. Email:", email);
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/");
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

  // Success. Middleware will handle redirection after user logs in.
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
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang)")
    .eq("id", user.id)
    .single();

  return profile;
}
