// SPDX-License-Identifier: FSL-1.1-ALv2
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "obs_session";
const PUBLIC = ["/login", "/setup", "/invite", "/api/auth/passkey/login"];

/**
 * Cheap gate: without a session cookie, send page requests to /login. Real validation
 * happens in the (app) layout and in every action and route handler.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // /api/ingest must stay out: the proxy buffers request bodies and truncates them at 10 MB.
  matcher: ["/((?!api/ingest|api/health|badge/|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
