import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  createSessionId,
  createSessionValue,
  isSharedPasswordValid,
  normalizeAuthEmail,
} from "@/lib/authSession";
import { registerAuthSession } from "@/lib/server/authSessionStore";

export async function POST(request) {
  try {
    const body = await request.json();
    const email = normalizeAuthEmail(body?.email || "");
    const password = String(body?.password || "");

    if (!isSharedPasswordValid(email, password)) {
      return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
    }

    const sessionId = createSessionId();
    const sessionValue = await createSessionValue(email, sessionId);
    await registerAuthSession(email, sessionId, request.headers.get("user-agent") || "");
    const response = NextResponse.json({ ok: true, user: { email, username: email } });
    response.cookies.set(AUTH_COOKIE_NAME, sessionValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("[Auth] Login failed:", error);
    return NextResponse.json({ error: "登录失败，请稍后重试" }, { status: 500 });
  }
}
