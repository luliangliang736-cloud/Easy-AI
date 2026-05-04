import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const filePath = path.resolve(process.cwd(), "..", "一键skills", "EZlogo", "EZlogo.jpg");
    const image = await readFile(filePath);

    return new NextResponse(image, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "EZlogo asset not found" }, { status: 404 });
  }
}
