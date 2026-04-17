import { NextResponse } from "next/server";
import { readCachedObjectEditImage, runObjectEdit } from "@/lib/server/objectEdit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const imageId = searchParams.get("id");
    if (!imageId) {
      return NextResponse.json({ error: "Missing image id" }, { status: 400 });
    }
    const { buffer, contentType } = await readCachedObjectEditImage(imageId);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Image not found" },
      { status: 404 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }
    if (!body.mask) {
      return NextResponse.json({ error: "Mask is required" }, { status: 400 });
    }
    if (!String(body.prompt || "").trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const result = await runObjectEdit({
      image: body.image,
      mask: body.mask,
      prompt: String(body.prompt).trim(),
      selection: body.selection || null,
      baseUrl: new URL(request.url).origin,
    });

    return NextResponse.json({
      success: true,
      data: {
        imageId: result.imageId,
        urls: [result.url],
        tasks: [{ id: `object-edit-${result.imageId}`, index: 0, url: result.url, status: "completed" }],
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Object edit failed" },
      { status: 500 }
    );
  }
}
