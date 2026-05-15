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
  const response = NextResponse.redirect(loginUrl);
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function unauthorizedJson() {
  const response = NextResponse.json({ error: "请先登录 EasyAI" }, { status: 401 });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

async function isSessionStillActive(request) {
  const checkUrl = new URL("/api/auth/session-check", request.url);
  const res = await fetch(checkUrl, {
    headers: {
      cookie: request.headers.get("cookie") || "",
    },
    cache: "no-store",
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => null);
  return data?.active === true;
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

  if (user) {
    const active = await isSessionStillActive(request).catch((error) => {
      console.error("[Auth] Active session check failed:", error);
      return false;
    });
    if (active) return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return unauthorizedJson();
  }

  return redirectToLogin(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
