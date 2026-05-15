import { normalizeGeneratedImageUrls, readGeneratedImage } from "@/lib/server/generatedImageStore";
import { readCloudAssetImage } from "@/lib/server/cloudAssetStore";

const GPT_IMAGE_2_API_BASE_RAW = (
  process.env.GPT_IMAGE_2_API_BASE
  || process.env.FLOATING_ASSISTANT_API_BASE
  || process.env.OPENAI_API_BASE
  || "https://api.openai.com/v1"
).replace(/\/$/, "");
const GPT_IMAGE_2_API_KEY = (
  process.env.GPT_IMAGE_2_API_KEY
  || process.env.FLOATING_ASSISTANT_API_KEY
  || process.env.OPENAI_API_KEY
  || ""
);
const GPT_IMAGE_2_API_VERSION = (
  process.env.GPT_IMAGE_2_API_VERSION
  || process.env.FLOATING_ASSISTANT_API_VERSION
  || process.env.OPENAI_API_VERSION
  || ""
);
const GPT_IMAGE_2_API_KEY_HEADER = (
  process.env.GPT_IMAGE_2_API_KEY_HEADER
  || process.env.FLOATING_ASSISTANT_API_KEY_HEADER
  || process.env.OPENAI_API_KEY_HEADER
  || "authorization"
).trim().toLowerCase();
const GPT_IMAGE_2_MODEL = process.env.GPT_IMAGE_2_MODEL || "gpt-image-2";
const GPT_IMAGE_2_TIMEOUT_MS = Number(process.env.GPT_IMAGE_2_TIMEOUT_MS || 300 * 1000);
const GPT_IMAGE_2_RETRY_COUNT = Math.max(0, Number(process.env.GPT_IMAGE_2_RETRY_COUNT || 1) || 0);
const GPT_IMAGE_2_RETRY_DELAY_MS = Math.max(0, Number(process.env.GPT_IMAGE_2_RETRY_DELAY_MS || 800) || 0);
const GPT_IMAGE_2_QUALITY = normalizeQuality(process.env.GPT_IMAGE_2_QUALITY || "medium");
const GPT_IMAGE_2_OUTPUT_FORMAT = normalizeOutputFormat(process.env.GPT_IMAGE_2_OUTPUT_FORMAT || "png");
const GPT_IMAGE_2_OUTPUT_COMPRESSION = normalizeOutputCompression(
  process.env.GPT_IMAGE_2_OUTPUT_COMPRESSION
);
const GPT_IMAGE_2_MODERATION = normalizeModeration(process.env.GPT_IMAGE_2_MODERATION || "auto");
const GPT_IMAGE_2_MAX_EDGE = 3840;
const GPT_IMAGE_2_MIN_PIXELS = 655360;
const GPT_IMAGE_2_MAX_PIXELS = 8294400;
const GPT_IMAGE_2_MAX_ASPECT_RATIO = 3;
const EXACT_SIZE_PATTERN = /^(\d{2,4})\s*[xX]\s*(\d{2,4})$/;
const GPT_IMAGE_2_STANDARD_API_BASE = /\/v\d+$/i.test(GPT_IMAGE_2_API_BASE_RAW)
  ? GPT_IMAGE_2_API_BASE_RAW
  : `${GPT_IMAGE_2_API_BASE_RAW}/v1`;

function withApiVersion(url) {
  if (!GPT_IMAGE_2_API_VERSION) {
    return url;
  }
  const nextUrl = new URL(url);
  if (!nextUrl.searchParams.has("api-version")) {
    nextUrl.searchParams.set("api-version", GPT_IMAGE_2_API_VERSION);
  }
  return nextUrl.toString();
}

// 有 API_VERSION → Azure deployment 风格；否则 → 标准 OpenAI /v1 风格
const IS_AZURE = Boolean(GPT_IMAGE_2_API_VERSION);

function buildAuthHeaders() {
  if (!GPT_IMAGE_2_API_KEY) {
    return {};
  }
  if (IS_AZURE) {
    return {
      Authorization: `Bearer ${GPT_IMAGE_2_API_KEY}`,
      "api-key": GPT_IMAGE_2_API_KEY,
    };
  }
  // 标准 OpenAI / 云雾等 sk- 格式
  if (GPT_IMAGE_2_API_KEY_HEADER === "api-key" || GPT_IMAGE_2_API_KEY_HEADER === "x-api-key") {
    return { [GPT_IMAGE_2_API_KEY_HEADER]: GPT_IMAGE_2_API_KEY };
  }
  return { Authorization: `Bearer ${GPT_IMAGE_2_API_KEY}` };
}

function buildDeploymentUrl(pathSuffix) {
  if (IS_AZURE) {
    return `${GPT_IMAGE_2_API_BASE_RAW}/openai/deployments/${encodeURIComponent(GPT_IMAGE_2_MODEL)}${pathSuffix}`;
  }
  // 标准 OpenAI 格式：/v1/images/generations 或 /v1/images/edits
  return `${GPT_IMAGE_2_STANDARD_API_BASE}${pathSuffix}`;
}

function normalizeImageInput(image) {
  if (!image) return [];
  const list = Array.isArray(image) ? image : [image];
  return list.filter((item) => typeof item === "string" && item);
}

function mapImageSize(imageSize = "1:1", hasImageInput = false) {
  const ratio = String(imageSize || "1:1").trim().toLowerCase();
  const exactSize = parseExactSize(ratio);
  if (exactSize) {
    validateExactSizeOrThrow(exactSize.width, exactSize.height);
    return `${exactSize.width}x${exactSize.height}`;
  }
  if (ratio === "auto") {
    return hasImageInput ? "auto" : "1024x1024";
  }
  if (["1:1"].includes(ratio)) return "1024x1024";
  if (["16:9", "4:3", "3:2", "5:4", "21:9", "4:1", "8:1"].includes(ratio)) return "1536x1024";
  if (["9:16", "3:4", "2:3", "4:5", "1:4", "1:8"].includes(ratio)) return "1024x1536";
  return "1024x1024";
}

function normalizeQuality(quality) {
  const nextValue = String(quality || "").trim().toLowerCase();
  if (["low", "medium", "high", "auto"].includes(nextValue)) {
    return nextValue;
  }
  return "medium";
}

function normalizeOutputFormat(format) {
  const nextValue = String(format || "").trim().toLowerCase();
  if (["png", "jpeg", "webp"].includes(nextValue)) {
    return nextValue;
  }
  return "png";
}

function normalizeOutputCompression(value) {
  if (value === null || value === undefined || value === "") return null;
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return null;
  return Math.min(100, Math.max(0, Math.round(nextValue)));
}

function toMimeType(outputFormat) {
  const format = normalizeOutputFormat(outputFormat);
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function normalizeModeration(value) {
  const nextValue = String(value || "").trim().toLowerCase();
  if (["auto", "low"].includes(nextValue)) {
    return nextValue;
  }
  return "auto";
}

function parseExactSize(imageSize) {
  const match = String(imageSize || "").trim().match(EXACT_SIZE_PATTERN);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function validateExactSizeOrThrow(width, height) {
  if (width > GPT_IMAGE_2_MAX_EDGE || height > GPT_IMAGE_2_MAX_EDGE) {
    throw new Error(`GPT Image 2 自定义尺寸最长边不能超过 ${GPT_IMAGE_2_MAX_EDGE}px。`);
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new Error("GPT Image 2 自定义尺寸的宽高都必须是 16 的倍数。");
  }
  const longEdge = Math.max(width, height);
  const shortEdge = Math.max(1, Math.min(width, height));
  if (longEdge / shortEdge > GPT_IMAGE_2_MAX_ASPECT_RATIO) {
    throw new Error(`GPT Image 2 自定义尺寸长宽比不能超过 ${GPT_IMAGE_2_MAX_ASPECT_RATIO}:1。`);
  }
  const totalPixels = width * height;
  if (totalPixels < GPT_IMAGE_2_MIN_PIXELS || totalPixels > GPT_IMAGE_2_MAX_PIXELS) {
    throw new Error(
      `GPT Image 2 自定义尺寸总像素必须介于 ${GPT_IMAGE_2_MIN_PIXELS} 和 ${GPT_IMAGE_2_MAX_PIXELS} 之间。`
    );
  }
}

function parseResponseError(data, status) {
  return (
    data?.error?.message
    || data?.message
    || data?.error
    || `GPT Image 2 request failed (${status})`
  );
}

async function parseJsonSafely(response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw || "GPT Image 2 API returned non-JSON response");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error) {
  return error?.cause?.code || error?.code || "";
}

function getUpstreamHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "上游图片服务";
  }
}

function isTransientFetchError(error) {
  const code = getErrorCode(error);
  return (
    error?.name === "AbortError"
    || error?.message === "fetch failed"
    || ["UND_ERR_CONNECT_TIMEOUT", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"].includes(code)
  );
}

function isRetryableStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

function formatFetchError(error, url) {
  if (error?.name === "AbortError") {
    return "图片服务响应超时，请稍后重试。";
  }
  const code = getErrorCode(error);
  const host = error?.cause?.hostname || getUpstreamHost(url);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `无法连接图片服务 ${host}，域名解析失败或网络暂时不可用，请稍后重试。`;
  }
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") {
    return `连接图片服务 ${host} 超时，请稍后重试。`;
  }
  if (code === "ECONNRESET" || code === "ECONNREFUSED") {
    return `图片服务 ${host} 连接中断，请稍后重试。`;
  }
  return error?.message || "图片服务请求失败，请稍后重试。";
}

async function fetchWithRetry(url, createOptions) {
  const requestUrl = withApiVersion(url);
  let lastError = null;
  for (let attempt = 0; attempt <= GPT_IMAGE_2_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GPT_IMAGE_2_TIMEOUT_MS);
    try {
      const options = await createOptions(controller.signal, attempt);
      const response = await fetch(requestUrl, options);
      if (isRetryableStatus(response.status) && attempt < GPT_IMAGE_2_RETRY_COUNT) {
        lastError = new Error(`Retryable GPT Image 2 status ${response.status}`);
        await sleep(GPT_IMAGE_2_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || attempt >= GPT_IMAGE_2_RETRY_COUNT) break;
      await sleep(GPT_IMAGE_2_RETRY_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(formatFetchError(lastError, requestUrl));
}

async function postJson(url, payload) {
  const res = await fetchWithRetry(url, (signal) => ({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(),
      },
      signal,
      body: JSON.stringify(payload),
    }));
  const data = await parseJsonSafely(res);
  if (!res.ok) {
    throw new Error(`${parseResponseError(data, res.status)} [status:${res.status}]`);
  }
  return data;
}

function base64ToBlob(dataUrl) {
  if (dataUrl.startsWith("data:")) {
    const commaIdx = dataUrl.indexOf(",");
    const header = dataUrl.slice(0, commaIdx);
    const b64 = dataUrl.slice(commaIdx + 1);
    const mimeType = header.split(":")[1]?.split(";")[0] || "image/png";
    const buffer = Buffer.from(b64, "base64");
    return { blob: new Blob([buffer], { type: mimeType }), mimeType };
  }
  const buffer = Buffer.from(dataUrl, "base64");
  return { blob: new Blob([buffer], { type: "image/png" }), mimeType: "image/png" };
}

function getLocalGeneratedImageFilename(source = "") {
  const match = String(source || "").match(/^\/api\/generated-images\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

async function imgSrcToBlob(imgSrc) {
  const localFilename = getLocalGeneratedImageFilename(imgSrc);
  if (localFilename) {
    const image = await readGeneratedImage(localFilename);
    if (!image) {
      throw new Error("本地生成图已过期或不存在，请重新生成后再作为参考图使用。");
    }
    return { blob: new Blob([image.buffer], { type: image.mimeType }), mimeType: image.mimeType };
  }

  const cloudImage = await readCloudAssetImage(imgSrc);
  if (cloudImage) {
    return { blob: new Blob([cloudImage.buffer], { type: cloudImage.mimeType }), mimeType: cloudImage.mimeType };
  }

  if (typeof imgSrc === "string" && /^https?:\/\//i.test(imgSrc)) {
    const res = await fetch(imgSrc);
    if (!res.ok) throw new Error(`Failed to fetch reference image (${res.status}): ${imgSrc}`);
    const arrayBuf = await res.arrayBuffer();
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { blob: new Blob([Buffer.from(arrayBuf)], { type: mimeType }), mimeType };
  }
  return base64ToBlob(imgSrc);
}

async function postFormData(url, {
  model,
  prompt,
  images,
  size,
  n,
  quality,
  outputFormat,
  outputCompression,
  moderation,
}) {
  const res = await fetchWithRetry(url, async (signal) => {
    const formData = new FormData();
    // 标准 OpenAI 格式需要在 body 里传 model，Azure 格式 model 在 URL 里
    if (!IS_AZURE) formData.append("model", model);
    formData.append("prompt", prompt);
    formData.append("n", String(n));
    formData.append("size", size);
    if (quality) formData.append("quality", quality);
    if (outputFormat) formData.append("output_format", outputFormat);
    if (outputCompression !== null && outputCompression !== undefined) {
      formData.append("output_compression", String(outputCompression));
    }
    if (moderation) formData.append("moderation", moderation);

    for (const imgSrc of images) {
      const { blob, mimeType } = await imgSrcToBlob(imgSrc);
      const ext = mimeType.split("/")[1] || "png";
      formData.append("image[]", blob, `image.${ext}`);
    }

    return {
      method: "POST",
      headers: buildAuthHeaders(),
      signal,
      body: formData,
    };
  });
  const data = await parseJsonSafely(res);
  if (!res.ok) {
    throw new Error(`${parseResponseError(data, res.status)} [status:${res.status}]`);
  }
  return data;
}

async function extractUrls(data = {}, fallbackMimeType = "image/png") {
  const items = Array.isArray(data?.data) ? data.data : [];
  const urls = items
    .map((item) => {
      if (typeof item?.url === "string" && item.url) {
        return item.url;
      }
      if (typeof item?.b64_json === "string" && item.b64_json) {
        return `data:${fallbackMimeType};base64,${item.b64_json}`;
      }
      if (typeof item?.base64 === "string" && item.base64) {
        return `data:${fallbackMimeType};base64,${item.base64}`;
      }
      return "";
    })
    .filter(Boolean);
  return normalizeGeneratedImageUrls(urls);
}

export function isGptImage2Model(model = "") {
  return String(model || "").trim().toLowerCase() === GPT_IMAGE_2_MODEL.toLowerCase();
}

export function isGptImage2Configured() {
  return Boolean(GPT_IMAGE_2_API_BASE_RAW && GPT_IMAGE_2_API_KEY && GPT_IMAGE_2_MODEL);
}

export async function generateWithGptImage2({
  prompt,
  imageSize = "1:1",
  num = 1,
  quality = GPT_IMAGE_2_QUALITY,
  outputFormat = GPT_IMAGE_2_OUTPUT_FORMAT,
  outputCompression = GPT_IMAGE_2_OUTPUT_COMPRESSION,
  moderation = GPT_IMAGE_2_MODERATION,
}) {
  if (!isGptImage2Configured()) {
    throw new Error("GPT Image 2 尚未配置完整的 API 信息。");
  }

  const normalizedOutputFormat = normalizeOutputFormat(outputFormat);
  const normalizedOutputCompression =
    normalizedOutputFormat === "png" ? null : normalizeOutputCompression(outputCompression);

  const result = await postJson(
    buildDeploymentUrl("/images/generations"),
    {
      model: GPT_IMAGE_2_MODEL,
      prompt: String(prompt || "").trim(),
      size: mapImageSize(imageSize, false),
      n: Math.max(1, Number(num) || 1),
      quality: normalizeQuality(quality),
      output_format: normalizedOutputFormat,
      ...(normalizedOutputCompression !== null ? { output_compression: normalizedOutputCompression } : {}),
      moderation: normalizeModeration(moderation),
    }
  );

  return await extractUrls(result, toMimeType(normalizedOutputFormat));
}

export async function editWithGptImage2({
  prompt,
  image,
  imageSize = "1:1",
  num = 1,
  quality = GPT_IMAGE_2_QUALITY,
  outputFormat = GPT_IMAGE_2_OUTPUT_FORMAT,
  outputCompression = GPT_IMAGE_2_OUTPUT_COMPRESSION,
  moderation = GPT_IMAGE_2_MODERATION,
}) {
  if (!isGptImage2Configured()) {
    throw new Error("GPT Image 2 尚未配置完整的 API 信息。");
  }

  const images = normalizeImageInput(image);
  if (images.length === 0) {
    throw new Error("GPT Image 2 编辑需要至少 1 张参考图。");
  }

  const normalizedOutputFormat = normalizeOutputFormat(outputFormat);
  const normalizedOutputCompression =
    normalizedOutputFormat === "png" ? null : normalizeOutputCompression(outputCompression);

  const result = await postFormData(
    buildDeploymentUrl("/images/edits"),
    {
      model: GPT_IMAGE_2_MODEL,
      prompt: String(prompt || "").trim(),
      images,
      size: mapImageSize(imageSize, true),
      n: Math.max(1, Number(num) || 1),
      quality: normalizeQuality(quality),
      outputFormat: normalizedOutputFormat,
      outputCompression: normalizedOutputCompression,
      moderation: normalizeModeration(moderation),
    }
  );

  return await extractUrls(result, toMimeType(normalizedOutputFormat));
}
