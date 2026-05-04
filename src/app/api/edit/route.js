import { NextResponse } from "next/server";
import { MAX_GEN_COUNT } from "@/lib/genLimits";
import { resolveNanoServiceTier } from "@/lib/nanoConfig";
import { editWithGptImage2, isGptImage2Model } from "@/lib/server/gptImage2";
import {
  editWithOpenAICompatibleChatImage,
  editWithOpenAICompatibleImage,
} from "@/lib/server/openaiImageCompat";

const API_BASE = process.env.NANO_API_BASE || "https://api.nanobananaapi.dev";
const API_KEY = process.env.NANO_API_KEY;
const API_STYLE = (process.env.NANO_API_STYLE || (API_BASE.includes("yunwu.ai") ? "openai" : "nano")).trim().toLowerCase();
const API_KEY_HEADER = process.env.NANO_API_KEY_HEADER || "authorization";
const OPENAI_COMPAT_IMAGE_MODEL = process.env.NANO_OPENAI_IMAGE_MODEL || "";
const OPENAI_COMPAT_IMAGE_ENDPOINT = (process.env.NANO_OPENAI_IMAGE_ENDPOINT || "images").trim().toLowerCase();

function createRequestMeta(route) {
  return {
    id: `${route}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
  };
}

function logEditEvent(meta, event, details = {}) {
  console.log(`[Edit:${meta.id}] ${event}`, JSON.stringify({
    elapsedMs: Date.now() - meta.startedAt,
    ...details,
  }));
}

function resolveOpenAICompatNanoModel(model) {
  if (OPENAI_COMPAT_IMAGE_MODEL) return OPENAI_COMPAT_IMAGE_MODEL;
  const requestedModel = String(model || "").trim();
  if (requestedModel === "gemini-3.1-flash-image-preview-512") return "gemini-3.1-flash-image-preview";
  if (
    requestedModel === "gemini-3.1-flash-image-preview-2k" ||
    requestedModel === "gemini-3.1-flash-image-preview-4k" ||
    requestedModel === "gemini-3-pro-image-preview-2k" ||
    requestedModel === "gemini-3-pro-image-preview-4k"
  ) {
    return requestedModel;
  }
  if (requestedModel.startsWith("gemini-3.1-flash-image-preview")) return "gemini-3.1-flash-image-preview";
  if (requestedModel.startsWith("gemini-3-pro-image-preview")) return "gemini-3-pro-image-preview";
  if (requestedModel === "gemini-2.5-flash-image-hd") return "gemini-2.5-flash-image";
  return requestedModel || "gemini-3.1-flash-image-preview";
}

export const runtime = "nodejs";
export const maxDuration = 300;

function formatRouteError(err) {
  const code = err?.cause?.code || err?.code || "";
  const host = err?.cause?.hostname || "图片服务";
  if (err?.name === "AbortError") return "图片服务响应超时，请稍后重试。";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `无法连接图片服务 ${host}，域名解析失败或网络暂时不可用，请稍后重试。`;
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return `连接图片服务 ${host} 超时，请稍后重试。`;
  if (code === "ECONNRESET" || code === "ECONNREFUSED") return `图片服务 ${host} 连接中断，请稍后重试。`;
  if (err?.message === "fetch failed") return "图片服务连接失败，请稍后重试。";
  return err?.message || "Internal server error";
}

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
  const meta = createRequestMeta("edit");
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

    const imageCount = Array.isArray(image) ? image.length : image ? 1 : 0;
    logEditEvent(meta, "start", {
      model: model || "gemini-3.1-flash-image-preview",
      imageSize: image_size || "1:1",
      num: Math.min(Math.max(num || 1, 1), MAX_GEN_COUNT),
      mode: mode || null,
      imageCount,
      serviceTier: service_tier || null,
      apiStyle: API_STYLE,
      endpoint: API_STYLE === "openai" ? OPENAI_COMPAT_IMAGE_ENDPOINT : "nano",
    });

    if (!prompt?.trim()) {
      logEditEvent(meta, "validation_error", { reason: "missing_prompt" });
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (!image) {
      logEditEvent(meta, "validation_error", { reason: "missing_image" });
      return NextResponse.json({ error: "Image is required for editing" }, { status: 400 });
    }

    if (mode === "cutout") {
      const url = await runTrueCutout(image);
      logEditEvent(meta, "success", { provider: "local-cutout", urlCount: 1 });
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
      logEditEvent(meta, "success", {
        provider: "gpt-image-2",
        urlCount: urls.filter(Boolean).length,
      });
      return NextResponse.json({
        success: true,
        data: { urls, tasks },
      });
    }

    if (!API_KEY || API_KEY === "sk-your-api-key-here") {
      logEditEvent(meta, "config_error", { reason: "missing_api_key" });
      return NextResponse.json(
        { error: "API key not configured. Set NANO_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    if (API_STYLE === "openai") {
      const urls = OPENAI_COMPAT_IMAGE_ENDPOINT === "chat"
        ? await editWithOpenAICompatibleChatImage({
            apiBase: API_BASE,
            apiKey: API_KEY,
            apiKeyHeader: API_KEY_HEADER,
            model: resolveOpenAICompatNanoModel(model),
            prompt,
            image,
          })
        : await editWithOpenAICompatibleImage({
            apiBase: API_BASE,
            apiKey: API_KEY,
            apiKeyHeader: API_KEY_HEADER,
            model: resolveOpenAICompatNanoModel(model),
            prompt,
            image,
            imageSize: image_size || "1:1",
            num: Math.min(Math.max(num || 1, 1), MAX_GEN_COUNT),
          });
      const tasks = urls
        .filter(Boolean)
        .map((url, index) => ({ id: `nano-openai-edit-${index}`, index, url, status: "completed" }));
      logEditEvent(meta, "success", {
        provider: "openai-compatible",
        urlCount: urls.filter(Boolean).length,
      });
      return NextResponse.json({
        success: true,
        data: { urls, tasks },
      });
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
    logEditEvent(meta, "upstream_response", { provider: "nano", status: res.status });

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      logEditEvent(meta, "non_json_response", { status: res.status });
      return NextResponse.json(
        { error: `API returned non-JSON (${res.status}): ${rawText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    if (data.code !== 0) {
      logEditEvent(meta, "upstream_error", {
        provider: "nano",
        code: data.code,
        status: res.status,
        message: data.message || null,
      });
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
    logEditEvent(meta, "error", {
      message: formatRouteError(err),
      code: err?.cause?.code || err?.code || null,
    });
    return NextResponse.json(
      { error: formatRouteError(err) },
      { status: 500 }
    );
  }
}
