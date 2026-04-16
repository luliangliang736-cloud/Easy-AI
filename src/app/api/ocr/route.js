import { NextResponse } from "next/server";
import { runPythonTextDetect } from "@/lib/server/pythonTextEdit";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }
    const result = await runPythonTextDetect({
      image: body.image,
      lang: body.lang || "en",
      baseUrl: new URL(request.url).origin,
    });
    console.log("[OCR] Python blocks:", result.blocks.length);

    return NextResponse.json({
      success: true,
      data: {
        text: result.text || "",
        blocks: result.blocks || [],
        engine: "python",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "OCR failed" },
      { status: 500 }
    );
  }
}
