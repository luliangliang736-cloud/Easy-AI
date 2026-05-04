import { NextResponse } from "next/server";
import { readGeneratedImage } from "@/lib/server/generatedImageStore";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const { filename } = await params;
  const image = await readGeneratedImage(filename);
  if (!image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  return new NextResponse(image.buffer, {
    headers: {
      "Content-Type": image.mimeType,
      "Cache-Control": "public, max-age=21600",
    },
  });
}
