import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/server/authUser";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const user = await getRequestUser(request);
    return NextResponse.json({ active: Boolean(user?.email) });
  } catch (error) {
    console.error("[Auth] Session check failed:", error);
    return NextResponse.json({ active: false }, { status: 401 });
  }
}
