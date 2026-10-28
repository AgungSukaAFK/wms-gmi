import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "@/lib/utils";

// Returns YYYY-MM-DD in UTC (consistent between proxy and server actions)
function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

// Koneksi Vercel → VPS Supabase sesekali timeout (default undici 10 detik), dan
// selama itu navigasi tertahan. GET (getUser, cek profil) dibatasi lebih pendek.
// POST (refresh token) sengaja tidak: membatalkan refresh yang sudah diproses
// server bisa membuat refresh token hangus.
const PROXY_GET_TIMEOUT_MS = 5000;

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") return fetch(input, init);
  const timeout = AbortSignal.timeout(PROXY_GET_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  return fetch(input, { ...init, signal });
}

export async function proxy(request: NextRequest) {
  // 1. Defensive normalization for malformed paths like "/dashboard,%20/dashboard".
  const url = request.nextUrl.clone();
  if (url.pathname.includes(",")) {
    const normalized = url.pathname
      .split(",")
      .map((part) => part.trim())
      .find((part) => part.startsWith("/"));

    if (normalized && normalized !== url.pathname) {
      url.pathname = normalized;
      return NextResponse.redirect(url);
    }
  }

  // 2. Skip auth checks when env vars are missing (local setup without .env)
  if (!hasEnvVars) {
    return NextResponse.next({ request });
  }

  // 3. Supabase session refresh — must be done on every request so tokens stay fresh.
  //    Do NOT put any code between createServerClient and getClaims().
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY!,
    {
      global: { fetch: fetchWithTimeout },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data, error: claimsError } = await supabase.auth.getClaims();
  const user = data?.claims;

  // Supabase tidak terjangkau (timeout/5xx) ≠ sesi invalid. Jangan redirect ke
  // login — itu yang bikin user "kepental" tiap jaringan ke VPS tersendat.
  // Loloskan saja; data tetap dilindungi RLS/JWT di sisi Supabase.
  if (!user && isAuthRetryableFetchError(claimsError)) {
    return supabaseResponse;
  }

  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname === "/";

  // 3b. Sudah login tapi membuka halaman auth entry (login/sign-up/forgot/landing)
  //     → langsung arahkan ke dashboard. Halaman fungsional seperti /auth/confirm,
  //     /auth/update-password, /auth/error dikecualikan agar tetap bisa diakses.
  const pathname = request.nextUrl.pathname;
  const isAuthEntryRoute =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth/login") ||
    pathname.startsWith("/auth/sign-up") ||
    pathname.startsWith("/auth/forgot-password");

  if (user && isAuthEntryRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  // 4. Unauthenticated user → redirect to login, bawa path asal di ?next=
  //    supaya setelah login kembali ke halaman yang tadi dibuka.
  if (!user && !isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && !isAuthRoute) {
    // 5. Daily session reset: if login_date cookie is not today, force re-login.
    //    This ensures users log in at least once per day.
    const loginDate = request.cookies.get("wms_login_date")?.value;
    if (!loginDate || loginDate !== todayUTC()) {
      // scope local: cukup sesi browser ini. Default "global" ikut mencabut
      // sesi akun yang sama di device/domain lain yang sudah login hari ini.
      await supabase.auth.signOut({ scope: "local" });
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/auth/login";
      const redirectResponse = NextResponse.redirect(redirectUrl);
      // Copy updated cookies (including sign-out deletions) to the redirect response
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie);
      });
      // Ensure the login_date cookie is cleared
      redirectResponse.cookies.delete("wms_login_date");
      return redirectResponse;
    }

    // 6. Verify account is still active
    const {
      data: profile,
      error: profileError,
      status: profileStatus,
    } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", user.sub)
      .single();

    // status 0 = gagal jaringan/timeout, 5xx = gateway bermasalah. Itu bukan
    // bukti akun nonaktif — jangan sign out & hapus wms_login_date.
    const profileCheckUnavailable =
      !!profileError && (profileStatus === 0 || profileStatus >= 500);

    if (!profileCheckUnavailable && !profile?.is_active) {
      await supabase.auth.signOut();
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/auth/login";
      redirectUrl.searchParams.set("error", "account_inactive");
      const redirectResponse = NextResponse.redirect(redirectUrl);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie);
      });
      redirectResponse.cookies.delete("wms_login_date");
      return redirectResponse;
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|opengraph-image|.*\\.[^.]+$).*)"],
};
