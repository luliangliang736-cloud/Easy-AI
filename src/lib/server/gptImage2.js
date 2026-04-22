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
  if (ratio === "auto" && hasImageInput) {
    return "1024x1024";
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

async function postFormData(url, { model, prompt, images, size, n, quality }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GPT_IMAGE_2_TIMEOUT_MS);
  try {
    const formData = new FormData();
    formData.append("model", model);
    formData.append("prompt", prompt);
    formData.append("n", String(n));
    formData.append("size", size);
    if (quality) formData.append("quality", quality);

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

function extractUrls(data = {}) {
  const items = Array.isArray(data?.data) ? data.data : [];
  return items
    .map((item) => {
      if (typeof item?.url === "string" && item.url) {
        return item.url;
      }
      if (typeof item?.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
      }
      if (typeof item?.base64 === "string" && item.base64) {
        return `data:image/png;base64,${item.base64}`;
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

export async function generateWithGptImage2({ prompt, imageSize = "1:1", num = 1 }) {
  if (!isGptImage2Configured()) {
    throw new Error("GPT Image 2 尚未配置完整的 API 信息。");
  }

  const result = await postJson(
    buildDeploymentUrl("/images/generations"),
    {
      model: GPT_IMAGE_2_MODEL,
      prompt: String(prompt || "").trim(),
      size: mapImageSize(imageSize, false),
      n: Math.max(1, Number(num) || 1),
      quality: GPT_IMAGE_2_QUALITY,
    }
  );

  return extractUrls(result);
}

export async function editWithGptImage2({ prompt, image, imageSize = "1:1", num = 1 }) {
  if (!isGptImage2Configured()) {
    throw new Error("GPT Image 2 尚未配置完整的 API 信息。");
  }

  const images = normalizeImageInput(image);
  if (images.length === 0) {
    throw new Error("GPT Image 2 编辑需要至少 1 张参考图。");
  }

  const result = await postFormData(
    buildDeploymentUrl("/images/edits"),
    {
      model: GPT_IMAGE_2_MODEL,
      prompt: String(prompt || "").trim(),
      images,
      size: mapImageSize(imageSize, true),
      n: Math.max(1, Number(num) || 1),
      quality: GPT_IMAGE_2_QUALITY,
    }
  );

  return extractUrls(result);
}
