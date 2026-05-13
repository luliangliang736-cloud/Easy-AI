import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, verifySessionValue } from "@/lib/authSession";

export async function GET(request) {
  const session = request.cookies.get(AUTH_COOKIE_NAME)?.value || "";
  const user = await verifySessionValue(session);
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, user: { username: user.username } });
}
