import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Defensive normalization for malformed paths like "/dashboard,%20/dashboard".
  // Keep only the first valid path segment before a comma.
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

  return NextResponse.next({
    request: { headers: request.headers },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[^.]+$).*)"],
};
