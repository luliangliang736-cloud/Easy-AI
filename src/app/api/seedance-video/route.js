import { NextResponse } from "next/server";
import { copyImageUrlsToCloudAssets, getCloudAssetKeyFromUrl, getCloudAssetSignedUrl, readCloudAssetImage } from "@/lib/server/cloudAssetStore";
import { getRequestUser } from "@/lib/server/authUser";
import { readGeneratedImage } from "@/lib/server/generatedImageStore";
import { saveGenerationResult } from "@/lib/server/generationResultStore";

export const runtime = "nodejs";
export const maxDuration = 1800;

const API_BASE = (process.env.SEEDANCE_API_BASE || "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/$/, "");
const API_KEY = process.env.SEEDANCE_API_KEY || "";

// 默认使用 Seedance 2.0 标准版；快速版与 2.5 全能版模型 ID 也在此列出
const DEFAULT_MODEL = "dreamina-seedance-2-0-260128";
const FAST_MODEL = "dreamina-seedance-2-0-fast-260128";
const SD25_MODEL = "dreamina-seedance-2-5-260628";
const VALID_MODELS = new Set([DEFAULT_MODEL, FAST_MODEL, SD25_MODEL]);

function isSd25Model(model) {
  return String(model || "") === SD25_MODEL;
}

// BytePlus 国际站 Ark 通道实际支持 480p/720p/1080p/4K，没有 2K 档（实测 2K 会被上游拒绝）。
// 4K 单价过高暂不开放，标准版最高 1080p；快速版最高 720p；2.5 只有 480p/720p
const VALID_RESOLUTIONS_STANDARD = new Set(["480p", "720p", "1080p"]);
const VALID_RESOLUTIONS_FAST     = new Set(["480p", "720p"]);
const VALID_RESOLUTIONS_SD25     = new Set(["480p", "720p"]);
const VALID_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
// Seedance 2.0 支持 4–15 秒；2.5 支持 4–30 秒（-1 表示模型自选，编辑任务强制 -1）
const MIN_DURATION = 4;
const MAX_DURATION = 15;
const MAX_DURATION_SD25 = 30;

// 2.5 素材上限（官方：图 30 张、视频 10 条且总长 ≤30s、音频 10 条且总长 ≤30s）
const SD25_MAX_IMAGES = 30;
const SD25_MAX_VIDEOS = 10;
const SD25_MAX_AUDIOS = 10;

// 2.5 编辑/延长任务靠提示词关键词触发（官方机制）。命中后需要锁定 ratio=adaptive；
// 编辑任务还要求 duration=-1（跟随原视频）。先判延长再判编辑（"延长并加入"以延长为准）。
const SD25_EXTEND_TRIGGER = /(延长|续写|接着播放|继续生成|向后延|向前延|延续|extend\s+(forward|backward)|continue\s+from)/i;
const SD25_EDIT_TRIGGER = /(编辑|替换|换成|换掉|删除|删掉|去掉|移除|修改|改成|改为|加上|添加|插入|翻译|配音|口型|重绘|edit\s+video|replace|remove|delete|modify|insert|change\s+to)/i;

const POLL_INTERVAL_MS = Number(process.env.SEEDANCE_POLL_INTERVAL_MS || 8_000);
// 2.5 重参考任务（多图+视频、30 秒长片）上游经常跑 10 分钟以上，轮询上限放宽到 25 分钟；
// 提前放弃是双输：Ark 照跑照计费，出的片也被丢弃
const POLL_TIMEOUT_MS  = Number(process.env.SEEDANCE_POLL_TIMEOUT_MS  || 25 * 60 * 1000);
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
  if (isSd25Model(model)) {
    return VALID_RESOLUTIONS_SD25.has(v) ? v : "720p";
  }
  const isFast = String(model || "").includes("fast");
  const validSet = isFast ? VALID_RESOLUTIONS_FAST : VALID_RESOLUTIONS_STANDARD;
  if (validSet.has(v)) return v;
  // 快速版最高 720p，标准版默认 1080p
  return isFast ? "720p" : "1080p";
}

function normalizeRatio(value, model = "") {
  const v = String(value || "").trim();
  // 2.5 支持 adaptive（跟随输入素材），编辑/延长/首尾帧任务必须用它
  if (isSd25Model(model) && v === "adaptive") return "adaptive";
  if (VALID_RATIOS.has(v)) return v;
  if (v === "auto") return "16:9";
  return "16:9";
}

function normalizeDuration(value, model = "") {
  const n = Math.round(Number(value || 5));
  if (!Number.isFinite(n)) return 5;
  if (isSd25Model(model)) {
    if (n === -1) return -1; // 模型自选时长
    return Math.min(MAX_DURATION_SD25, Math.max(MIN_DURATION, n));
  }
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, n));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 视频/音频源不能当图片参考传给 Ark（下载校验会失败），按扩展名与 data URL 前缀识别 */
function isNonImageMediaSource(source = "") {
  const value = String(source || "").trim();
  return (
    /^data:(video|audio)\//i.test(value)
    || /\.(mp4|webm|mov|m4v|avi|mp3|wav|m4a)([?#]|$)/i.test(value)
  );
}

function isAudioSource(source = "") {
  const value = String(source || "").trim();
  return /^data:audio\//i.test(value) || /\.(mp3|wav|m4a)([?#]|$)/i.test(value);
}

/** 2.5 用：参考素材按图/视频/音频分类（上传顺序保留，提示词里按"图1/视频1"编号引用） */
function classifyRefSources(sources = []) {
  const images = [];
  const videos = [];
  const audios = [];
  for (const src of sources) {
    if (isAudioSource(src)) audios.push(src);
    else if (isNonImageMediaSource(src)) videos.push(src);
    else images.push(src);
  }
  return {
    images: images.slice(0, SD25_MAX_IMAGES),
    videos: videos.slice(0, SD25_MAX_VIDEOS),
    audios: audios.slice(0, SD25_MAX_AUDIOS),
  };
}

/** 视频/音频源解析：云端资产给 Ark 签名直链（避免几十 MB 的 base64 请求体），其余原样透传 */
function resolveMediaSource(source = "") {
  const value = String(source || "").trim();
  if (!value) return "";
  const key = getCloudAssetKeyFromUrl(value);
  if (key) return getCloudAssetSignedUrl(key);
  if (value.startsWith("/")) {
    throw new Error("参考视频/音频需要先同步到云端，请稍后重试或重新上传。");
  }
  return value;
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
    // 读不到时不能把相对路径透传给 Ark（必然 resource download failed），直接报明确错误
    throw new Error("参考图云端资源读取失败，请重新上传或换一张图。");
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

/**
 * 2.5 任务模式判定（官方"锁定/非锁定"机制）：
 * - frames：≤2 张图、无视频/音频、无编辑/延长意图 → 经典首尾帧（锁 ratio=adaptive）
 * - edit：带视频 + 编辑关键词 → 锁 ratio=adaptive、duration=-1
 * - extend：带视频 + 延长关键词 → 锁 ratio=adaptive
 * - reference：其余情况，全部素材作语义参考（比例/时长自由）
 */
function resolveSd25TaskMode(prompt, { images, videos, audios }) {
  const hasVideos = videos.length > 0;
  if (hasVideos && SD25_EXTEND_TRIGGER.test(prompt)) return "extend";
  if (hasVideos && SD25_EDIT_TRIGGER.test(prompt)) return "edit";
  if (!hasVideos && audios.length === 0 && images.length >= 1 && images.length <= 2) return "frames";
  return "reference";
}

// 2.5 content 数组：frames 模式沿用首尾帧角色；其余模式按 reference_* 角色平铺，
// 顺序与上传顺序一致（提示词里的"图1/视频1"编号按此顺序解析）
async function buildSd25ContentArray(prompt, { images, videos, audios }, mode) {
  const content = [{ type: "text", text: prompt }];

  if (mode === "frames") {
    const imageRoles = ["first_frame", "last_frame"];
    for (let i = 0; i < Math.min(images.length, 2); i++) {
      const resolved = await resolveImageSource(images[i]);
      if (!resolved) continue;
      content.push({ type: "image_url", image_url: { url: resolved }, role: imageRoles[i] });
    }
    return content;
  }

  for (const image of images) {
    const resolved = await resolveImageSource(image);
    if (!resolved) continue;
    content.push({ type: "image_url", image_url: { url: resolved }, role: "reference_image" });
  }
  for (const video of videos) {
    const resolved = resolveMediaSource(video);
    if (!resolved) continue;
    content.push({ type: "video_url", video_url: { url: resolved }, role: "reference_video" });
  }
  for (const audio of audios) {
    const resolved = resolveMediaSource(audio);
    if (!resolved) continue;
    content.push({ type: "audio_url", audio_url: { url: resolved }, role: "reference_audio" });
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

/** 上游常见参数校验错误翻译成用户能看懂的中文提示 */
function humanizeSeedanceError(message = "") {
  const raw = String(message || "");
  if (/video pixel count .* greater than or equal/i.test(raw)) {
    return "参考视频分辨率太低：至少需要约 480p（854×480）及以上，请换一条更清晰的视频。";
  }
  if (/image pixel count .* greater than or equal/i.test(raw)) {
    return "参考图分辨率太低，请换一张更清晰的图片。";
  }
  if (/video duration|total duration/i.test(raw) && /exceed|greater|less/i.test(raw)) {
    return "参考视频时长不符合要求：单条 2–30 秒、全部视频总长不超过 30 秒。";
  }
  if (/resource download failed/i.test(raw)) {
    return "参考素材下载失败：素材可能还没同步到云端，稍等几秒重试，或重新上传。";
  }
  if (/sensitive information|content policy|moderation/i.test(raw)) {
    return "生成结果被内容审核拦截（常见原因：真人人脸、知名 IP/商标或敏感词）。可换素材再试；如属误伤，直接重试有机会通过。";
  }
  return raw;
}

function getApiError(data, status) {
  return humanizeSeedanceError(
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
    // 客户端断连/超时后可凭此 ID 找回结果（与生图路由同一套恢复机制）
    const clientRequestId = String(body?.clientRequestId || "").trim();

    const model = normalizeModel(body?.model);
    const isSd25 = isSd25Model(model);

    let resolution   = normalizeResolution(body?.resolution || body?.mode, model);
    let ratio        = normalizeRatio(body?.ratio || body?.aspect_ratio || body?.image_size, model);
    let duration     = normalizeDuration(body?.duration, model);
    const generateAudio = String(body?.generate_audio || "false").toLowerCase() !== "false"
      && body?.generate_audio !== false;

    const rawRefSources = Array.isArray(body?.ref_images) ? body.ref_images.filter(Boolean) : [];

    let content;
    let generationType;

    if (isSd25) {
      // 2.5：图/视频/音频都可作参考素材，按任务模式锁定参数（官方"锁定/非锁定"机制）
      const classified = classifyRefSources(rawRefSources);
      const taskMode = resolveSd25TaskMode(prompt, classified);
      if (taskMode === "frames" || taskMode === "edit" || taskMode === "extend") {
        ratio = "adaptive";
      }
      if (taskMode === "edit") {
        duration = -1; // 编辑任务时长跟随原视频
      }
      content = await buildSd25ContentArray(prompt, classified, taskMode);
      generationType = taskMode === "edit" ? "视频编辑"
        : taskMode === "extend" ? "视频延长"
        : taskMode === "frames"
          ? (classified.images.length >= 2 ? "首尾帧生视频" : "图生视频")
          : (rawRefSources.length > 0 ? "参考生视频" : "文生视频");
      log(meta, "sd25_task_mode", {
        taskMode,
        images: classified.images.length,
        videos: classified.videos.length,
        audios: classified.audios.length,
      });
    } else {
      // 2.0：R2V 同样支持视频参考（实测 Ark 通道接受 reference_video 角色）；
      // 音频参考 2.0 不支持纯音频且场景少，过滤掉。无视频时保持经典首尾帧行为
      const classified = classifyRefSources(rawRefSources);
      if (classified.audios.length > 0) {
        log(meta, "ref_skipped_audio_sd20", { skippedCount: classified.audios.length });
      }
      if (classified.videos.length > 0) {
        content = await buildSd25ContentArray(prompt, { ...classified, audios: [] }, "reference");
        generationType = "参考生视频";
        log(meta, "sd20_reference_mode", { images: classified.images.length, videos: classified.videos.length });
      } else {
        const refImages = classified.images.slice(0, 2);
        content = await buildContentArray(prompt, refImages);
        generationType = refImages.length >= 2 ? "首尾帧生视频"
          : refImages.length === 1 ? "图生视频"
          : "文生视频";
      }
    }

    const taskBody = {
      model,
      content,
      ratio,
      resolution,
      duration,
      generate_audio: generateAudio,
    };

    log(meta, "start", { generationType, model, resolution, ratio, duration, generateAudio, refCount: rawRefSources.length });

    const createData = await createTask(taskBody, meta);
    const taskId = createData?.id || createData?.task_id || createData?.data?.id;

    if (!taskId) {
      // 极少数情况立即返回视频 URL
      const immediateUrl = extractVideoUrl(createData);
      if (immediateUrl) {
        const [persistedUrl] = await persistWithBudget([immediateUrl], storageUserEmail, meta);
        log(meta, "success_immediate", { generationType, url: persistedUrl });
        const immediateBody = { success: true, data: { urls: [persistedUrl], mediaType: "video", generationType, tasks: [{ id: "seedance-0", index: 0, url: persistedUrl, status: "completed", type: "video" }] } };
        await saveGenerationResult(clientRequestId, immediateBody);
        return NextResponse.json(immediateBody);
      }
      throw new Error("Seedance API 未返回 task_id");
    }

    log(meta, "task_created", { taskId, generationType });

    const videoUrl = await pollTask(taskId, meta);

    const [persistedUrl] = await persistWithBudget([videoUrl], storageUserEmail, meta);

    log(meta, "success", { taskId, generationType, url: persistedUrl });

    const responseBody = {
      success: true,
      data: {
        urls: [persistedUrl],
        mediaType: "video",
        generationType,
        taskId,
        tasks: [{ id: taskId, index: 0, url: persistedUrl, status: "completed", type: "video" }],
      },
    };
    await saveGenerationResult(clientRequestId, responseBody);
    return NextResponse.json(responseBody);
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "Seedance 视频服务响应超时，请稍后重试。"
      : error?.message || "Seedance video request failed";
    log(meta, "error", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
