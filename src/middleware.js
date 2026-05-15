import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, verifySessionValue } from "./lib/authSession";

const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/feishu-im-webhook",
  "/api/home-hero-assets",
];

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];

function isPublicPath(pathname = "") {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/fonts/")) return true;
  if (pathname.startsWith("/images/")) return true;
  if (pathname.startsWith("/ip-assets/")) return true;
  if (pathname.startsWith("/assets/")) return true;
  if (/\.[a-z0-9]+$/i.test(pathname) && !pathname.startsWith("/api/")) return true;
  return false;
}

function isPublicApi(pathname = "") {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectToLogin(request) {
  const loginUrl = new URL("/", request.url);
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set("login", "1");
  if (nextPath !== "/") loginUrl.searchParams.set("next", nextPath);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  if (request.method === "OPTIONS" || isPublicPath(pathname) || isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const sessionValue = request.cookies.get(AUTH_COOKIE_NAME)?.value || "";
  let user = null;
  try {
    user = await verifySessionValue(sessionValue);
  } catch (error) {
    console.error("[Auth] Session verification failed:", error);
  }

  if (user) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "请先登录 EasyAI" }, { status: 401 });
  }

  return redirectToLogin(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
