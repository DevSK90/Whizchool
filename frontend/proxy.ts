import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect only: the session cookie's presence is checked here, while the API
// enforces authentication and permissions on every request.
const SESSION_COOKIE = "wz_sid";

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
