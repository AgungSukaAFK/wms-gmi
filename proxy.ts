import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // UPDATE: Menggunakan getUser() alih-alih getSession() untuk keamanan
  // getUser() memvalidasi token ke server auth Supabase
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // Jika token kedaluwarsa atau tidak valid (seperti setelah database reset),
  // Supabase akan mengembalikan error. Kita amankan dengan menghapus cookies.
  if (authError || !user) {
    if (authError && authError.message.includes("Refresh Token")) {
      await supabase.auth.signOut(); // Force clear local cookies
    }
  }

  const { pathname } = request.nextUrl;

  const authPaths = [
    "/auth/login",
    "/auth/sign-up",
    "/auth/forgot-password",
    "/auth/error",
    "/auth/sign-up-success",
    "/auth/confirm",
    "/auth/update-password",
  ];

  const pendingPath = "/pending-approval";

  const otherPublicPaths = ["/"];

  const dynamicPublicPatterns = [/^\/approval-po\/[0-9]+$/];

  const isAuthPath = authPaths.includes(pathname);
  const isPendingPath = pathname === pendingPath;
  const isOtherPublicPath = otherPublicPaths.includes(pathname);
  const isDynamicPublicPath = dynamicPublicPatterns.some((pattern) =>
    pattern.test(pathname)
  );

  // Cek keberadaan user, bukan session
  if (!user) {
    if (isAuthPath || isOtherPublicPath || isDynamicPublicPath) {
      return response;
    }

    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  // Jika user terautentikasi
  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", user.id) // Gunakan user.id
      .maybeSingle();

    if (profileError && profileError.code !== "PGRST116") {
      console.error("Middleware profile fetch error:", profileError);
    }

    if (!profile?.is_active) {
      if (!isPendingPath) {
        return NextResponse.redirect(new URL("/pending-approval", request.url));
      }
    } else {
      if (isAuthPath || isPendingPath) {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - .*(files with extensions, e.g. .png, .jpg, .svg)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.[^.]+$).*)",
  ],
};
