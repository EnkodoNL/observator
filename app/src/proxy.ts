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
  // A read-only demo lets visitors in without signing in; pages hand them the demo session.
  if (/^(on|true|1)$/i.test(process.env.DEMO_MODE ?? "")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // /api/ingest must stay out: the proxy buffers request bodies and truncates them at 10 MB.
  // /api/mcp authenticates with its own bearer tokens; MCP clients send no session cookie.
  matcher: [
    "/((?!api/ingest|api/mcp|api/health|badge/|_next/static|_next/image|favicon.ico|icon.svg|icon$).*)",
  ],
};
