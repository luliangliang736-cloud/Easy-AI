import { NextResponse } from "next/server";
import { MAX_GEN_COUNT } from "@/lib/genLimits";
import { resolveNanoServiceTier } from "@/lib/nanoConfig";
import { editWithGptImage2, isGptImage2Model } from "@/lib/server/gptImage2";

const API_BASE = process.env.NANO_API_BASE || "https://api.nanobananaapi.dev";
const API_KEY = process.env.NANO_API_KEY;

export const runtime = "nodejs";
export const maxDuration = 300;

async function normalizeCutoutSource(image) {
  const source = Array.isArray(image) ? image[0] : image;
  if (!source || typeof source !== "string") {
    throw new Error("Image is required for cutout");
  }

  if (/^data:image\//i.test(source)) {
    const mime = source.match(/^data:(image\/[^;]+);base64,/i)?.[1] || "image/png";
    const base64 = source.split(",")[1] || "";
    const buffer = Buffer.from(base64, "base64");
    return new Blob([buffer], { type: mime });
  }

  const res = await fetch(source);
  if (!res.ok) {
    throw new Error(`Failed to fetch source image (${res.status})`);
  }
  const contentType = res.headers.get("content-type") || "image/png";
  return new Blob([await res.arrayBuffer()], { type: contentType });
}

async function runTrueCutout(image) {
  const input = await normalizeCutoutSource(image);
  const { removeBackground } = await import("@imgly/background-removal-node");
  const blob = await removeBackground(input, {
    model: "small",
    output: {
      format: "image/png",
      type: "foreground",
    },
    debug: false,
  });
  const buffer = Buffer.from(await blob.arrayBuffer());
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      prompt,
      image,
      model,
      image_size,
      num,
      mode,
      service_tier,
      quality,
      output_format,
      output_compression,
      moderation,
    } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (!image) {
      return NextResponse.json({ error: "Image is required for editing" }, { status: 400 });
    }

    if (mode === "cutout") {
      const url = await runTrueCutout(image);
      return NextResponse.json({
        success: true,
        data: {
          urls: [url],
          tasks: [{ id: "cutout-0", index: 0, url, status: "completed" }],
        },
      });
    }

    if (isGptImage2Model(model)) {
      const urls = await editWithGptImage2({
        prompt,
        image,
        imageSize: image_size,
        num: Math.min(Math.max(num || 1, 1), MAX_GEN_COUNT),
        quality,
        outputFormat: output_format,
        outputCompression: output_compression,
        moderation,
      });
      const tasks = urls
        .filter(Boolean)
        .map((url, index) => ({ id: `gpt-image-2-${index}`, index, url, status: "completed" }));
      return NextResponse.json({
        success: true,
        data: { urls, tasks },
      });
    }

    if (!API_KEY || API_KEY === "sk-your-api-key-here") {
      return NextResponse.json(
        { error: "API key not configured. Set NANO_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const payload = {
      prompt: prompt.trim(),
      image,
      model: model || "gemini-3.1-flash-image-preview",
      image_size: image_size || "1:1",
      num: Math.min(Math.max(num || 1, 1), MAX_GEN_COUNT),
      service_tier: resolveNanoServiceTier(service_tier),
    };

    console.log("[Edit]", JSON.stringify({ ...payload, image: Array.isArray(payload.image) ? `[${payload.image.length} images]` : "1 image" }));

    const res = await fetch(`${API_BASE}/v1/images/edit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await res.text();
    console.log("[Edit] Status:", res.status, "Body:", rawText.slice(0, 500));

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        { error: `API returned non-JSON (${res.status}): ${rawText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    if (data.code !== 0) {
      return NextResponse.json(
        { error: data.message || `API error (code: ${data.code})` },
        { status: res.status >= 400 ? res.status : 400 }
      );
    }

    const urls = Array.isArray(data.data?.url) ? data.data.url : [data.data?.url];
    const tasks = urls
      .filter(Boolean)
      .map((url, index) => ({ id: `nano-${index}`, index, url, status: "completed" }));

    return NextResponse.json({
      success: true,
      data: { urls, tasks },
    });
  } catch (err) {
    console.error("[Edit] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
