import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, verifySessionValue } from "@/lib/authSession";
import { revokeAuthSession } from "@/lib/server/authSessionStore";

export async function POST(request) {
  const sessionValue = request.cookies.get(AUTH_COOKIE_NAME)?.value || "";
  const user = await verifySessionValue(sessionValue);
  if (user?.email && user?.sid) {
    await revokeAuthSession(user.email, user.sid).catch((error) => {
      console.error("[Auth] Revoke session failed:", error);
    });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
