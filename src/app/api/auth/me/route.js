import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/authSession";
import { getRequestUser } from "@/lib/server/authUser";

export async function GET(request) {
  const user = await getRequestUser(request);
  if (!user) {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    response.cookies.set(AUTH_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  }
  return NextResponse.json({ authenticated: true, user: { email: user.email, username: user.username } });
}
