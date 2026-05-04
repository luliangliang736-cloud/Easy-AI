import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request) {
  return NextResponse.redirect(new URL("/ip-assets/EZlogo/EZlogo.jpg", request.url));
}
