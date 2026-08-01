import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Route protection.
 *
 * This middleware performs an *optimistic* check only: it verifies that a
 * signed session cookie is present and redirects anonymous visitors to sign-in.
 * It deliberately does not read the database or decide role access.
 *
 * Middleware runs on every matching request, including prefetches, so a DB
 * round-trip here would be a per-navigation cost. More importantly, a cookie
 * proves possession, not authority — the real authorisation decision belongs
 * next to the data, in `requireRole` / `requirePermission`, where it cannot be
 * bypassed by hitting a server action directly. Treating middleware as the
 * security boundary is the classic Next.js authorisation bug.
 */

const PROTECTED_PREFIXES = [
  "/appointments",
  "/records",
  "/book",
  "/consultation",
  "/account",
  "/doctor",
  "/admin",
];

const AUTH_ROUTES = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const sessionCookie = getSessionCookie(request, { cookiePrefix: "medibook" });

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !sessionCookie) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(signInUrl);
  }

  // A signed-in visitor has no use for the sign-in screen.
  if (sessionCookie && AUTH_ROUTES.includes(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, static assets and the auth API itself
     * (which must stay reachable while signed out).
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js)$).*)",
  ],
};
