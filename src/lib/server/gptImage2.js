const GPT_IMAGE_2_API_BASE_RAW = (
  process.env.GPT_IMAGE_2_API_BASE
  || process.env.FLOATING_ASSISTANT_API_BASE
  || ""
).replace(/\/$/, "");
const GPT_IMAGE_2_API_KEY = process.env.GPT_IMAGE_2_API_KEY || process.env.FLOATING_ASSISTANT_API_KEY || "";
const GPT_IMAGE_2_API_VERSION = process.env.GPT_IMAGE_2_API_VERSION || process.env.FLOATING_ASSISTANT_API_VERSION || "";
const GPT_IMAGE_2_API_KEY_HEADER = (
  process.env.GPT_IMAGE_2_API_KEY_HEADER
  || process.env.FLOATING_ASSISTANT_API_KEY_HEADER
  || "api-key"
).trim().toLowerCase();
const GPT_IMAGE_2_MODEL = process.env.GPT_IMAGE_2_MODEL || "gpt-image-2";
const GPT_IMAGE_2_TIMEOUT_MS = Number(process.env.GPT_IMAGE_2_TIMEOUT_MS || 10 * 60 * 1000);
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

function buildAuthHeaders() {
  if (!GPT_IMAGE_2_API_KEY) {
    return {};
  }
  const headers = {
    Authorization: `Bearer ${GPT_IMAGE_2_API_KEY}`,
    "api-key": GPT_IMAGE_2_API_KEY,
  };
  if (GPT_IMAGE_2_API_KEY_HEADER === "x-api-key") {
    headers["x-api-key"] = GPT_IMAGE_2_API_KEY;
  }
  return headers;
}

function buildDeploymentUrl(pathSuffix) {
  return `${GPT_IMAGE_2_API_BASE_RAW}/openai/deployments/${encodeURIComponent(GPT_IMAGE_2_MODEL)}${pathSuffix}`;
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
    return "auto";
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

async function postJson(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GPT_IMAGE_2_TIMEOUT_MS);
  try {
    const res = await fetch(withApiVersion(url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(),
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafely(res);
    if (!res.ok) {
      throw new Error(`${parseResponseError(data, res.status)} [status:${res.status}]`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GPT_IMAGE_2_TIMEOUT_MS);
  try {
    const formData = new FormData();
    formData.append("model", model);
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
      const { blob, mimeType } = base64ToBlob(imgSrc);
      const ext = mimeType.split("/")[1] || "png";
      formData.append("image[]", blob, `image.${ext}`);
    }

    const res = await fetch(withApiVersion(url), {
      method: "POST",
      headers: buildAuthHeaders(),
      signal: controller.signal,
      body: formData,
    });
    const data = await parseJsonSafely(res);
    if (!res.ok) {
      throw new Error(`${parseResponseError(data, res.status)} [status:${res.status}]`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function extractUrls(data = {}, fallbackMimeType = "image/png") {
  const items = Array.isArray(data?.data) ? data.data : [];
  return items
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

  return extractUrls(result, toMimeType(normalizedOutputFormat));
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

  return extractUrls(result, toMimeType(normalizedOutputFormat));
}
