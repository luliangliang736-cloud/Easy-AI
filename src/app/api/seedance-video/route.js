import { NextResponse } from "next/server";
import { copyImageUrlsToCloudAssets, readCloudAssetImage } from "@/lib/server/cloudAssetStore";
import { getRequestUser } from "@/lib/server/authUser";
import { readGeneratedImage } from "@/lib/server/generatedImageStore";

export const runtime = "nodejs";
export const maxDuration = 600;

const API_BASE = (process.env.SEEDANCE_API_BASE || "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/$/, "");
const API_KEY = process.env.SEEDANCE_API_KEY || "";

// 默认使用 Seedance 2.0 标准版；快速版模型 ID 也在此列出
const DEFAULT_MODEL = "dreamina-seedance-2-0-260128";
const FAST_MODEL = "dreamina-seedance-2-0-fast-260128";
const VALID_MODELS = new Set([DEFAULT_MODEL, FAST_MODEL]);

const VALID_RESOLUTIONS = new Set(["480p", "720p"]);
const VALID_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
// Seedance 2.0 支持 5 / 10 秒（按 duration token 计费）
const VALID_DURATIONS = new Set([5, 10]);

const POLL_INTERVAL_MS = Number(process.env.SEEDANCE_POLL_INTERVAL_MS || 8_000);
const POLL_TIMEOUT_MS  = Number(process.env.SEEDANCE_POLL_TIMEOUT_MS  || 8 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.SEEDANCE_REQUEST_TIMEOUT_MS || 60_000);

// ─── helpers ─────────────────────────────────────────────────────────────────

function createMeta() {
  return { id: `seedance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, startedAt: Date.now() };
}

function log(meta, event, details = {}) {
  console.log(`[SeedanceVideo:${meta.id}] ${event}`, JSON.stringify({ elapsedMs: Date.now() - meta.startedAt, ...details }));
}

function normalizeModel(value) {
  const v = String(value || "").trim();
  return VALID_MODELS.has(v) ? v : DEFAULT_MODEL;
}

function normalizeResolution(value) {
  const v = String(value || "").trim().toLowerCase();
  return VALID_RESOLUTIONS.has(v) ? v : "720p";
}

function normalizeRatio(value) {
  const v = String(value || "").trim();
  if (VALID_RATIOS.has(v)) return v;
  if (v === "auto") return "16:9";
  return "16:9";
}

function normalizeDuration(value) {
  const n = Math.round(Number(value || 5));
  return VALID_DURATIONS.has(n) ? n : 5;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 将本地/云端图片路径解析为 Base64 data URL 或公网 URL
async function resolveImageSource(source = "") {
  const value = String(source || "").trim();
  if (!value) return "";

  // 云端 /api/cloud-assets/ 转为 base64
  if (/^\/api\/cloud-assets\//i.test(value)) {
    const cloudImage = await readCloudAssetImage(value);
    if (cloudImage) {
      return `data:${cloudImage.mimeType};base64,${cloudImage.buffer.toString("base64")}`;
    }
  }

  // 本地 /api/generated-images/ 转为 base64
  const localMatch = value.match(/^\/api\/generated-images\/([^/?#]+)/i);
  if (localMatch) {
    const localImage = await readGeneratedImage(decodeURIComponent(localMatch[1]));
    if (!localImage) throw new Error("本地生成图已过期，请重新生成后再用于视频。");
    return `data:${localImage.mimeType};base64,${localImage.buffer.toString("base64")}`;
  }

  return value;
}

// Seedance content 数组：text + 可选图片（首帧/尾帧/参考图）
async function buildContentArray(prompt, refImages = []) {
  const content = [{ type: "text", text: prompt }];
  const imageRoles = ["first_frame", "last_frame"];

  for (let i = 0; i < Math.min(refImages.length, 2); i++) {
    const resolved = await resolveImageSource(refImages[i]);
    if (!resolved) continue;
    const isDataUrl = /^data:image\//i.test(resolved);
    content.push({
      type: "image_url",
      image_url: { url: resolved },
      role: imageRoles[i],
      ...(isDataUrl ? {} : {}),
    });
  }

  return content;
}

function normalizeSeedanceStatus(value) {
  const s = String(value || "").trim().toLowerCase();
  if (["succeeded", "success", "completed", "complete"].includes(s)) return "succeeded";
  if (["failed", "fail", "error", "cancelled", "canceled"].includes(s)) return "failed";
  return "running";
}

function extractVideoUrl(data) {
  return (
    data?.content?.video_url
    || data?.data?.content?.video_url
    || data?.video_url
    || data?.data?.video_url
    || ""
  );
}

function getApiError(data, status) {
  return (
    data?.error?.message
    || data?.message
    || data?.msg
    || `Seedance API request failed (${status})`
  );
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const rawText = await res.text();
    let data = {};
    try { data = rawText ? JSON.parse(rawText) : {}; } catch {
      throw new Error(`Seedance API returned non-JSON (${res.status}): ${rawText.slice(0, 200)}`);
    }
    if (!res.ok) throw new Error(getApiError(data, res.status));
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function createTask(body) {
  return fetchJson(`${API_BASE}/contents/generations/tasks`, { method: "POST", body: JSON.stringify(body) });
}

async function pollTask(taskId, meta) {
  const url = `${API_BASE}/contents/generations/tasks/${encodeURIComponent(taskId)}`;
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const data = await fetchJson(url);
    const status = normalizeSeedanceStatus(data?.status);

    if (status === "succeeded") {
      const videoUrl = extractVideoUrl(data);
      if (videoUrl) return videoUrl;
      throw new Error("Seedance 任务完成但未返回视频 URL");
    }

    if (status === "failed") {
      throw new Error(getApiError(data, 400) || "Seedance 视频生成失败");
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("Seedance 视频生成超时，请稍后重试。");
}

// ─── handler ─────────────────────────────────────────────────────────────────

export async function POST(request) {
  const meta = createMeta();
  if (!API_KEY) {
    log(meta, "config_error", { reason: "missing_api_key" });
    return NextResponse.json(
      { error: "Seedance API key not configured. Set SEEDANCE_API_KEY in .env.local" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const requestUser = await getRequestUser(request).catch(() => null);
    const storageUserEmail = requestUser?.email || "system-generated";

    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const model      = normalizeModel(body?.model);
    const resolution = normalizeResolution(body?.resolution || body?.mode);
    const ratio      = normalizeRatio(body?.ratio || body?.aspect_ratio || body?.image_size);
    const duration   = normalizeDuration(body?.duration);
    const generateAudio = String(body?.generate_audio || "false").toLowerCase() !== "false"
      && body?.generate_audio !== false;

    const refImages = Array.isArray(body?.ref_images)
      ? body.ref_images.filter(Boolean).slice(0, 2)
      : [];

    const content = await buildContentArray(prompt, refImages);
    const generationType = refImages.length >= 2 ? "首尾帧生视频"
      : refImages.length === 1 ? "图生视频"
      : "文生视频";

    const taskBody = {
      model,
      content,
      ratio,
      resolution,
      duration,
      generate_audio: generateAudio,
    };

    log(meta, "start", { generationType, model, resolution, ratio, duration, generateAudio, refCount: refImages.length });

    const createData = await createTask(taskBody);
    const taskId = createData?.id || createData?.task_id || createData?.data?.id;

    if (!taskId) {
      // 极少数情况立即返回视频 URL
      const immediateUrl = extractVideoUrl(createData);
      if (immediateUrl) {
        const [persistedUrl] = await copyImageUrlsToCloudAssets({ userEmail: storageUserEmail, urls: [immediateUrl], scope: "generated-seedance-video" });
        log(meta, "success_immediate", { generationType, url: persistedUrl });
        return NextResponse.json({ success: true, data: { urls: [persistedUrl], mediaType: "video", generationType, tasks: [{ id: "seedance-0", index: 0, url: persistedUrl, status: "completed", type: "video" }] } });
      }
      throw new Error("Seedance API 未返回 task_id");
    }

    log(meta, "task_created", { taskId, generationType });

    const videoUrl = await pollTask(taskId, meta);

    const [persistedUrl] = await copyImageUrlsToCloudAssets({
      userEmail: storageUserEmail,
      urls: [videoUrl],
      scope: "generated-seedance-video",
    });

    log(meta, "success", { taskId, generationType, url: persistedUrl });

    return NextResponse.json({
      success: true,
      data: {
        urls: [persistedUrl],
        mediaType: "video",
        generationType,
        taskId,
        tasks: [{ id: taskId, index: 0, url: persistedUrl, status: "completed", type: "video" }],
      },
    });
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "Seedance 视频服务响应超时，请稍后重试。"
      : error?.message || "Seedance video request failed";
    log(meta, "error", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
