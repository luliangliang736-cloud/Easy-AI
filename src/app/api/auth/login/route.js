import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  createSessionValue,
  isCredentialValid,
} from "@/lib/authSession";

export async function POST(request) {
  try {
    const body = await request.json();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    if (!isCredentialValid(username, password)) {
      return NextResponse.json({ error: "账号或密码不正确" }, { status: 401 });
    }

    const sessionValue = await createSessionValue(username);
    const response = NextResponse.json({ ok: true, user: { username } });
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
