import { NextResponse } from "next/server";
import { readCachedTextEditImage, runPythonTextApply } from "@/lib/server/pythonTextEdit";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const imageId = searchParams.get("id");
    if (!imageId) {
      return NextResponse.json({ error: "Missing image id" }, { status: 400 });
    }
    const { buffer, contentType } = await readCachedTextEditImage(imageId);
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
    const blocks = Array.isArray(body.blocks) ? body.blocks : [];
    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }
    if (blocks.length === 0) {
      return NextResponse.json({ error: "Blocks are required" }, { status: 400 });
    }

    const result = await runPythonTextApply({
      image: body.image,
      blocks,
      lang: body.lang || "en",
      baseUrl: new URL(request.url).origin,
    });

    return NextResponse.json({
      success: true,
      data: {
        imageId: result.imageId,
        urls: [result.url],
        tasks: [{ id: `text-edit-${result.imageId}`, index: 0, url: result.url, status: "completed" }],
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Text edit failed" },
      { status: 500 }
    );
  }
}
