import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/automations", "/logs", "/settings"];

// Upstream OpenReply's own public marketing/SEO pages (landing page, blog-style
// comparison pages, etc.) — irrelevant on a private instance and they leak
// which self-hosted tool this is, GitHub link included. Send visitors to the
// actual product instead of exposing any of that.
const MARKETING_REDIRECT_PATHS = new Set([
  "/",
  "/comment-link-automation",
  "/instagram-comment-to-dm-templates",
  "/instagram-dm-automation-agencies",
  "/manychat-alternative",
  "/templates",
]);
const MARKETING_REDIRECT_TARGET = "https://tryalpy.com";

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (MARKETING_REDIRECT_PATHS.has(pathname)) {
    return NextResponse.redirect(MARKETING_REDIRECT_TARGET, { status: 302 });
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isLogin = pathname === "/login";
  const isAuthenticated = hasSessionCookie(request);

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLogin && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/automations/:path*",
    "/logs/:path*",
    "/settings/:path*",
    "/login",
    "/comment-link-automation",
    "/instagram-comment-to-dm-templates",
    "/instagram-dm-automation-agencies",
    "/manychat-alternative",
    "/templates",
  ],
};
