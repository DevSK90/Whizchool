import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@whizchool/shared/api";

// Optimistic redirect only: the session cookie's presence is checked here, while the API
// enforces authentication and permissions on every request.

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (!hasSession && (pathname.startsWith("/app") || pathname.startsWith("/portal"))) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/portal/:path*"],
};
