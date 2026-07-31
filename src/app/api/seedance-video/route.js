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

// 标准版支持 480p/720p/1080p/2K；快速版最高 720p
const VALID_RESOLUTIONS_STANDARD = new Set(["480p", "720p", "1080p", "2K"]);
const VALID_RESOLUTIONS_FAST     = new Set(["480p", "720p"]);
const VALID_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
// Seedance 2.0 支持 4–15 秒
const MIN_DURATION = 4;
const MAX_DURATION = 15;

const POLL_INTERVAL_MS = Number(process.env.SEEDANCE_POLL_INTERVAL_MS || 8_000);
const POLL_TIMEOUT_MS  = Number(process.env.SEEDANCE_POLL_TIMEOUT_MS  || 8 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.SEEDANCE_REQUEST_TIMEOUT_MS || 60_000);
const REQUEST_RETRY_ATTEMPTS = Number(process.env.SEEDANCE_REQUEST_RETRY_ATTEMPTS || 4);
const REQUEST_RETRY_BASE_MS = Number(process.env.SEEDANCE_REQUEST_RETRY_BASE_MS || 1200);
// 结果落盘限时：OSS 通道拥堵（如 4K 图迁移占满带宽）时不能拖死整个请求，
// 超时直接返回上游临时 URL，由前端后台同步接力搬到云端
const PERSIST_TIMEOUT_MS = Number(process.env.VIDEO_PERSIST_TIMEOUT_MS || 60_000);

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

function normalizeResolution(value, model = "") {
  const v = String(value || "").trim();
  const isFast = String(model || "").includes("fast");
  const validSet = isFast ? VALID_RESOLUTIONS_FAST : VALID_RESOLUTIONS_STANDARD;
  if (validSet.has(v)) return v;
  // 快速版最高 720p，标准版默认 1080p
  return isFast ? "720p" : "1080p";
}

function normalizeRatio(value) {
  const v = String(value || "").trim();
  if (VALID_RATIOS.has(v)) return v;
  if (v === "auto") return "16:9";
  return "16:9";
}

function normalizeDuration(value) {
  const n = Math.round(Number(value || 5));
  if (!Number.isFinite(n)) return 5;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, n));
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

// 瞬时性错误（网络抖动/网关 5xx）可安全重试；上游任务本身的失败不在此列
function isTransientSeedanceError(error) {
  const code = error?.cause?.code || error?.code || "";
  const message = String(error?.message || "");
  return (
    error?.name === "AbortError"
    || message === "fetch failed"
    || message.includes("Seedance API returned non-JSON (502)")
    || message.includes("Seedance API returned non-JSON (503)")
    || message.includes("Seedance API returned non-JSON (504)")
    || message.includes("terminated")
    || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "EAI_AGAIN", "ENOTFOUND"].includes(code)
  );
}

async function fetchJsonWithRetry(url, options = {}, { meta, action = "request" } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= REQUEST_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      if (!isTransientSeedanceError(error) || attempt >= REQUEST_RETRY_ATTEMPTS) {
        throw error;
      }
      const delayMs = REQUEST_RETRY_BASE_MS * attempt + Math.floor(Math.random() * 400);
      if (meta) {
        log(meta, "retry", {
          action,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          message: error?.message || "request failed",
        });
      }
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function createTask(body, meta) {
  return fetchJsonWithRetry(
    `${API_BASE}/contents/generations/tasks`,
    { method: "POST", body: JSON.stringify(body) },
    { meta, action: "create_task" }
  );
}

async function pollTask(taskId, meta) {
  const url = `${API_BASE}/contents/generations/tasks/${encodeURIComponent(taskId)}`;
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const data = await fetchJsonWithRetry(url, {}, { meta, action: "poll_task" });
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

async function persistWithBudget(urls, userEmail, meta) {
  const persistPromise = copyImageUrlsToCloudAssets({
    userEmail,
    urls,
    scope: "generated-seedance-video",
  });
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), PERSIST_TIMEOUT_MS));
  const result = await Promise.race([persistPromise, timeoutPromise]);
  if (Array.isArray(result) && result.length > 0) return result;
  log(meta, "persist_timeout", { budgetMs: PERSIST_TIMEOUT_MS });
  return urls;
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
    let resolution   = normalizeResolution(body?.resolution || body?.mode, model);
    const ratio      = normalizeRatio(body?.ratio || body?.aspect_ratio || body?.image_size);
    const duration   = normalizeDuration(body?.duration);
    const generateAudio = String(body?.generate_audio || "false").toLowerCase() !== "false"
      && body?.generate_audio !== false;

    const refImages = Array.isArray(body?.ref_images)
      ? body.ref_images.filter(Boolean).slice(0, 2)
      : [];

    // 上游限制：Seedance 2.0 带参考图（i2v/首尾帧）最高 1080p，2K 仅文生视频可用
    if (refImages.length > 0 && resolution === "2K") resolution = "1080p";

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

    const createData = await createTask(taskBody, meta);
    const taskId = createData?.id || createData?.task_id || createData?.data?.id;

    if (!taskId) {
      // 极少数情况立即返回视频 URL
      const immediateUrl = extractVideoUrl(createData);
      if (immediateUrl) {
        const [persistedUrl] = await persistWithBudget([immediateUrl], storageUserEmail, meta);
        log(meta, "success_immediate", { generationType, url: persistedUrl });
        return NextResponse.json({ success: true, data: { urls: [persistedUrl], mediaType: "video", generationType, tasks: [{ id: "seedance-0", index: 0, url: persistedUrl, status: "completed", type: "video" }] } });
      }
      throw new Error("Seedance API 未返回 task_id");
    }

    log(meta, "task_created", { taskId, generationType });

    const videoUrl = await pollTask(taskId, meta);

    const [persistedUrl] = await persistWithBudget([videoUrl], storageUserEmail, meta);

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
