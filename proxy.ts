import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "@/lib/utils";

// Returns YYYY-MM-DD in UTC (consistent between proxy and server actions)
function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
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
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY!,
    {
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

  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname === "/";

  // 4. Unauthenticated user → redirect to login
  if (!user && !isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth/login";
    return NextResponse.redirect(redirectUrl);
  }

  if (user && !isAuthRoute) {
    // 5. Daily session reset: if login_date cookie is not today, force re-login.
    //    This ensures users log in at least once per day.
    const loginDate = request.cookies.get("wms_login_date")?.value;
    if (!loginDate || loginDate !== todayUTC()) {
      await supabase.auth.signOut();
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
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", user.sub)
      .single();

    if (!profile?.is_active) {
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[^.]+$).*)"],
};
