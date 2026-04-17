import { NextResponse } from "next/server";
import { runObjectSelect } from "@/lib/server/objectSelect";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const x = Number(body.x);
    const y = Number(body.y);

    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return NextResponse.json({ error: "Valid x and y are required" }, { status: 400 });
    }

    const result = await runObjectSelect({
      image: body.image,
      x,
      y,
      baseUrl: new URL(request.url).origin,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Object selection failed" },
      { status: 500 }
    );
  }
}
