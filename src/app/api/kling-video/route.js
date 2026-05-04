import { createHmac } from "crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 600;

const API_BASE = (process.env.KLING_API_BASE || "https://api-beijing.klingai.com").replace(/\/$/, "");
const ACCESS_KEY_ID = process.env.KLING_ACCESS_KEY_ID || process.env.KLING_ACCESS_KEY || "";
const ACCESS_KEY_SECRET = process.env.KLING_ACCESS_KEY_SECRET || process.env.KLING_SECRET_KEY || "";
const REQUEST_TIMEOUT_MS = Number(process.env.KLING_REQUEST_TIMEOUT_MS || 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.KLING_POLL_INTERVAL_MS || 5 * 1000);
const POLL_TIMEOUT_MS = Number(process.env.KLING_POLL_TIMEOUT_MS || 8 * 60 * 1000);
const REQUEST_RETRY_ATTEMPTS = Number(process.env.KLING_REQUEST_RETRY_ATTEMPTS || 4);
const REQUEST_RETRY_BASE_MS = Number(process.env.KLING_REQUEST_RETRY_BASE_MS || 1200);

const VALID_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1"]);
const VALID_MODES = new Set(["std", "pro", "4k", "standard", "professional", "720p", "1080p"]);

function createRequestMeta(route) {
  return {
    id: `${route}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
  };
}

function logKlingEvent(meta, event, details = {}) {
  console.log(`[KlingVideo:${meta.id}] ${event}`, JSON.stringify({
    elapsedMs: Date.now() - meta.startedAt,
    ...details,
  }));
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: ACCESS_KEY_ID,
    exp: now + 1800,
    nbf: now - 5,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", ACCESS_KEY_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function normalizeImageSource(image) {
  if (!image || typeof image !== "string") return "";
  const value = image.trim();
  const dataUrlMatch = value.match(/^data:image\/[^;]+;base64,(.+)$/i);
  return dataUrlMatch ? dataUrlMatch[1] : value;
}

function normalizeAspectRatio(value) {
  const raw = String(value || "").trim();
  if (VALID_ASPECT_RATIOS.has(raw)) return raw;
  if (raw === "auto") return "16:9";
  return "16:9";
}

function normalizeDuration(value) {
  const duration = Math.round(Number(value || 5));
  if (!Number.isFinite(duration)) return "5";
  return String(Math.min(15, Math.max(3, duration)));
}

function normalizeMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!VALID_MODES.has(raw)) return "pro";
  if (raw === "professional") return "pro";
  if (raw === "standard") return "std";
  if (raw === "720p") return "std";
  if (raw === "1080p") return "pro";
  return raw;
}

function normalizeSound(value) {
  return String(value || "").trim().toLowerCase() === "on" ? "on" : "off";
}

function normalizeMultiImageDuration(value) {
  const raw = String(value || "").trim();
  return raw === "10" ? "10" : "5";
}

function normalizeV26Duration(value) {
  return String(value || "").trim() === "10" ? "10" : "5";
}

function isOmniVideoModel(modelName) {
  return ["kling-video-o1", "kling-v3-omni"].includes(String(modelName || "").trim().toLowerCase());
}

function buildOmniImageList(images) {
  if (images.length >= 2) {
    return [
      { image_url: images[0], type: "first_frame" },
      { image_url: images[1], type: "end_frame" },
      ...images.slice(2, 7).map((image) => ({ image_url: image })),
    ];
  }
  if (images.length === 1) {
    return [{ image_url: images[0], type: "first_frame" }];
  }
  return [];
}

function normalizeKlingStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["succeed", "succeeded", "success", "completed", "complete"].includes(status)) return "completed";
  if (["failed", "fail", "error"].includes(status)) return "failed";
  if (["submitted", "pending", "queued", "queue", "processing", "running"].includes(status)) return "running";
  return status || "running";
}

function extractTaskId(data) {
  return (
    data?.data?.task_id
    || data?.data?.taskId
    || data?.task_id
    || data?.taskId
    || data?.id
    || ""
  );
}

function extractVideoUrls(data) {
  const candidates = [
    data?.data?.task_result?.videos,
    data?.data?.task_result?.video,
    data?.data?.videos,
    data?.data?.video,
    data?.task_result?.videos,
    data?.task_result?.video,
    data?.videos,
    data?.video,
  ].filter(Boolean);

  const urls = [];
  for (const candidate of candidates) {
    const list = Array.isArray(candidate) ? candidate : [candidate];
    for (const item of list) {
      if (typeof item === "string") {
        urls.push(item);
      } else if (item && typeof item === "object") {
        urls.push(item.url || item.video_url || item.videoUrl || item.resource_url || item.watermark_url);
      }
    }
  }

  const directUrl = (
    data?.data?.video_url
    || data?.data?.videoUrl
    || data?.data?.url
    || data?.video_url
    || data?.videoUrl
    || data?.url
  );
  if (directUrl) urls.push(directUrl);

  return [...new Set(urls.filter(Boolean))];
}

function getApiErrorMessage(data, status) {
  return (
    data?.data?.task_status_msg
    || data?.task_status_msg
    || data?.message
    || data?.msg
    || data?.error?.message
    || data?.error
    || `Kling API request failed (${status})`
  );
}

function getErrorCode(error) {
  return error?.cause?.code || error?.code || "";
}

function isTransientKlingError(error) {
  const code = getErrorCode(error);
  const message = String(error?.message || "");
  return (
    error?.name === "AbortError"
    || message === "fetch failed"
    || message.includes("Kling API returned non-JSON (502)")
    || message.includes("Kling API returned non-JSON (503)")
    || message.includes("Kling API returned non-JSON (504)")
    || message.includes("terminated")
    || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "EAI_AGAIN", "ENOTFOUND"].includes(code)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const rawText = await res.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error(`Kling API returned non-JSON (${res.status}): ${rawText.slice(0, 200)}`);
    }
    if (!res.ok || (data?.code !== undefined && data.code !== 0)) {
      throw new Error(getApiErrorMessage(data, res.status));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function requestKling(path, { method = "GET", body, meta, action = "request" } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= REQUEST_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fetchJsonWithTimeout(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${signJwt()}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientKlingError(error) || attempt >= REQUEST_RETRY_ATTEMPTS) {
        throw error;
      }

      const delayMs = REQUEST_RETRY_BASE_MS * attempt + Math.floor(Math.random() * 400);
      if (meta) {
        logKlingEvent(meta, "retry", {
          action,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          message: error?.message || "request failed",
          code: getErrorCode(error) || null,
        });
      }
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function pollTask(path, taskId, meta) {
  const start = Date.now();
  let lastData = null;

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const data = await requestKling(`${path}/${encodeURIComponent(taskId)}`, {
      meta,
      action: "poll_task",
    });
    lastData = data;

    const status = normalizeKlingStatus(
      data?.data?.task_status
      || data?.data?.status
      || data?.task_status
      || data?.status
    );

    if (status === "completed") {
      const urls = extractVideoUrls(data);
      if (urls.length > 0) return urls;
      throw new Error("Kling 视频任务已完成，但未返回视频 URL");
    }

    if (status === "failed") {
      throw new Error(getApiErrorMessage(data, 400));
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const statusText = lastData
    ? JSON.stringify({
        task_status: lastData?.data?.task_status || lastData?.task_status || lastData?.status,
        message: lastData?.message || lastData?.msg,
      })
    : "no status";
  throw new Error(`Kling 视频生成仍在处理中，请稍后重试。最后状态：${statusText}`);
}

function buildTaskPayload(body) {
  const prompt = String(body?.prompt || "").trim();
  const refImages = Array.isArray(body?.ref_images)
    ? body.ref_images.filter(Boolean)
    : [];
  const generationTypeRequest = String(body?.generation_type || "").trim().toLowerCase();
  const normalizedRefImages = refImages.map((image) => normalizeImageSource(image)).filter(Boolean);
  const firstImage = normalizeImageSource(body?.image || refImages[0]);
  const tailImage = normalizeImageSource(body?.image_tail || refImages[1]);
  const modelName = String(body?.model || body?.model_name || "kling-v3").trim();
  const mode = normalizeMode(body?.mode || "pro");
  const duration = normalizeDuration(body?.duration || "5");

  const payload = {
    model_name: modelName,
    prompt,
    negative_prompt: String(body?.negative_prompt || "").trim() || undefined,
    duration,
    mode,
    external_task_id: body?.external_task_id || undefined,
  };

  payload.sound = normalizeSound(body?.sound);

  if (modelName === "kling-v2-6") {
    payload.duration = normalizeV26Duration(body?.duration);
    if (payload.mode === "4k") payload.mode = "pro";
    if (firstImage && tailImage) {
      payload.mode = "pro";
      payload.sound = "off";
    } else if (payload.sound === "on") {
      payload.mode = "pro";
    }
  }

  if (modelName === "kling-v3" || modelName === "kling-v3-omni") {
    payload.sound = "off";
  }

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === "") delete payload[key];
  });

  if (isOmniVideoModel(modelName)) {
    const imageList = buildOmniImageList(normalizedRefImages);
    const isFrameBased = imageList.some((item) => item.type === "first_frame" || item.type === "end_frame");
    return {
      path: "/v1/videos/omni-video",
      payload: {
        model_name: modelName,
        prompt,
        duration,
        mode,
        sound: payload.sound,
        ...(imageList.length > 0 ? { image_list: imageList } : {}),
        ...(!isFrameBased ? { aspect_ratio: normalizeAspectRatio(body?.aspect_ratio || body?.image_size) } : {}),
        external_task_id: payload.external_task_id,
      },
      generationType: imageList.length >= 2 ? "Omni 首尾帧生视频" : imageList.length === 1 ? "Omni 图生视频" : "Omni 文生视频",
    };
  }

  if (generationTypeRequest === "multi-image") {
    const imageList = normalizedRefImages.slice(0, 4).map((image) => ({ image }));
    if (imageList.length < 2) {
      throw new Error("多图参考生视频至少需要 2 张参考图");
    }
    return {
      path: "/v1/videos/multi-image2video",
      payload: {
        model_name: "kling-v1-6",
        prompt,
        negative_prompt: payload.negative_prompt,
        mode: payload.mode === "4k" ? "pro" : payload.mode,
        duration: normalizeMultiImageDuration(body?.duration),
        aspect_ratio: normalizeAspectRatio(body?.aspect_ratio || body?.image_size),
        image_list: imageList,
        external_task_id: payload.external_task_id,
      },
      generationType: "多图参考生视频",
    };
  }

  if (firstImage && tailImage) {
    return {
      path: "/v1/videos/image2video",
      payload: {
        ...payload,
        image: firstImage,
        image_tail: tailImage,
      },
      generationType: "首尾帧生视频",
    };
  }

  if (firstImage) {
    return {
      path: "/v1/videos/image2video",
      payload: {
        ...payload,
        image: firstImage,
      },
      generationType: "图生视频",
    };
  }

  return {
    path: "/v1/videos/text2video",
    payload: { ...payload, aspect_ratio: normalizeAspectRatio(body?.aspect_ratio || body?.image_size) },
    generationType: "文生视频",
  };
}

export async function POST(request) {
  const meta = createRequestMeta("kling-video");
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET) {
    logKlingEvent(meta, "config_error", { reason: "missing_api_key" });
    return NextResponse.json(
      { error: "Kling API key not configured. Set KLING_ACCESS_KEY_ID and KLING_ACCESS_KEY_SECRET in .env.local" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    if (!String(body?.prompt || "").trim()) {
      logKlingEvent(meta, "validation_error", { reason: "missing_prompt" });
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const { path, payload, generationType } = buildTaskPayload(body);
    payload.external_task_id = payload.external_task_id || meta.id;
    logKlingEvent(meta, "start", {
      generationType,
      path,
      model: payload.model_name,
      mode: payload.mode || null,
      duration: payload.duration || null,
      sound: payload.sound || null,
      aspectRatio: payload.aspect_ratio || null,
      refCount: Array.isArray(body?.ref_images) ? body.ref_images.filter(Boolean).length : 0,
    });
    const createData = await requestKling(path, {
      method: "POST",
      body: payload,
      meta,
      action: "create_task",
    });
    const taskId = extractTaskId(createData);
    if (!taskId) {
      const immediateUrls = extractVideoUrls(createData);
      if (immediateUrls.length > 0) {
        logKlingEvent(meta, "success", {
          generationType,
          taskMode: "immediate",
          urlCount: immediateUrls.length,
        });
        return NextResponse.json({
          success: true,
          data: {
            urls: immediateUrls,
            mediaType: "video",
            generationType,
            tasks: immediateUrls.map((url, index) => ({
              id: `kling-video-${index}`,
              index,
              url,
              status: "completed",
              type: "video",
            })),
          },
        });
      }
      logKlingEvent(meta, "missing_task_id", { generationType });
      throw new Error("Kling API 未返回 task_id");
    }

    logKlingEvent(meta, "task_created", { generationType, taskId });
    const urls = await pollTask(path, taskId, meta);
    logKlingEvent(meta, "success", {
      generationType,
      taskId,
      urlCount: urls.length,
    });
    return NextResponse.json({
      success: true,
      data: {
        urls,
        mediaType: "video",
        generationType,
        taskId,
        tasks: urls.map((url, index) => ({
          id: taskId,
          index,
          url,
          status: "completed",
          type: "video",
        })),
      },
    });
  } catch (error) {
    console.error("[KlingVideo] Error:", error);
    const message = error?.name === "AbortError"
      ? "Kling 视频服务响应超时，请稍后重试。"
      : error?.message || "Kling video request failed";
    logKlingEvent(meta, "error", {
      message,
      code: getErrorCode(error) || null,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
