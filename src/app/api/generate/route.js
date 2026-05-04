import { NextResponse } from "next/server";
import { MAX_GEN_COUNT } from "@/lib/genLimits";
import { resolveNanoServiceTier } from "@/lib/nanoConfig";
import { generateWithGptImage2, isGptImage2Model } from "@/lib/server/gptImage2";
import {
  generateWithOpenAICompatibleChatImage,
  generateWithOpenAICompatibleImage,
} from "@/lib/server/openaiImageCompat";

export const maxDuration = 300;

const API_BASE = process.env.NANO_API_BASE || "https://api.nanobananaapi.dev";
const API_KEY = process.env.NANO_API_KEY;
const API_STYLE = (process.env.NANO_API_STYLE || (API_BASE.includes("yunwu.ai") ? "openai" : "nano")).trim().toLowerCase();
const API_KEY_HEADER = process.env.NANO_API_KEY_HEADER || "authorization";
const OPENAI_COMPAT_IMAGE_MODEL = process.env.NANO_OPENAI_IMAGE_MODEL || "";
const OPENAI_COMPAT_IMAGE_ENDPOINT = (process.env.NANO_OPENAI_IMAGE_ENDPOINT || "images").trim().toLowerCase();

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

export async function POST(request) {
  if (!API_KEY || API_KEY === "sk-your-api-key-here") {
    return NextResponse.json(
      { error: "API key not configured. Set NANO_API_KEY in .env.local" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const {
      prompt,
      model,
      image_size,
      num,
      ref_images,
      service_tier,
      quality,
      output_format,
      output_compression,
      moderation,
    } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (isGptImage2Model(model)) {
      const urls = await generateWithGptImage2({
        prompt,
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

    if (API_STYLE === "openai") {
      const urls = OPENAI_COMPAT_IMAGE_ENDPOINT === "chat"
        ? await generateWithOpenAICompatibleChatImage({
            apiBase: API_BASE,
            apiKey: API_KEY,
            apiKeyHeader: API_KEY_HEADER,
            model: resolveOpenAICompatNanoModel(model),
            prompt,
          })
        : await generateWithOpenAICompatibleImage({
            apiBase: API_BASE,
            apiKey: API_KEY,
            apiKeyHeader: API_KEY_HEADER,
            model: resolveOpenAICompatNanoModel(model),
            prompt,
            imageSize: image_size || "1:1",
            num: Math.min(Math.max(num || 1, 1), MAX_GEN_COUNT),
          });
      const tasks = urls
        .filter(Boolean)
        .map((url, index) => ({ id: `nano-openai-${index}`, index, url, status: "completed" }));
      return NextResponse.json({
        success: true,
        data: { urls, tasks },
      });
    }

    const payload = {
      prompt: prompt.trim(),
      model: model || "gemini-3.1-flash-image-preview",
      image_size: image_size || "1:1",
      num: Math.min(Math.max(num || 1, 1), MAX_GEN_COUNT),
      service_tier: resolveNanoServiceTier(service_tier),
    };

    if (ref_images?.length) {
      payload.ref_images = ref_images;
    }

    console.log("[Generate]", JSON.stringify({ ...payload, ref_images: payload.ref_images?.length || 0 }));

    const res = await fetch(`${API_BASE}/v1/images/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await res.text();
    console.log("[Generate] Status:", res.status, "Body:", rawText.slice(0, 500));

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
    console.error("[Generate] Error:", err);
    return NextResponse.json(
      { error: formatRouteError(err) },
      { status: 500 }
    );
  }
}
