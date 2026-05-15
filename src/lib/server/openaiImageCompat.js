import { normalizeGeneratedImageUrls, readGeneratedImage } from "@/lib/server/generatedImageStore";
import { readCloudAssetImage } from "@/lib/server/cloudAssetStore";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function normalizeBaseUrl(apiBase = "") {
  const raw = String(apiBase || "https://api.openai.com").replace(/\/$/, "");
  return /\/v\d+(?:beta)?$/i.test(raw) ? raw : `${raw}/v1`;
}

function normalizeGeminiBaseUrl(apiBase = "") {
  const raw = String(apiBase || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  if (/\/v1beta$/i.test(raw)) return raw;
  if (/\/v1$/i.test(raw)) return raw.replace(/\/v1$/i, "/v1beta");
  return `${raw}/v1beta`;
}

function buildAuthHeaders(apiKey = "", apiKeyHeader = "authorization") {
  if (!apiKey) return {};
  const header = String(apiKeyHeader || "authorization").trim().toLowerCase();
  if (header === "api-key" || header === "x-api-key") {
    return { [header]: apiKey };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

function mapImageSize(imageSize = "1:1") {
  const ratio = String(imageSize || "1:1").trim().toLowerCase();
  if (ratio === "auto") return "auto";
  if (["1k", "2k", "4k"].includes(ratio)) return ratio.toUpperCase();
  if (/^\d{2,4}\s*[xX]\s*\d{2,4}$/.test(ratio)) {
    return ratio.replace(/\s+/g, "").replace("x", "x");
  }
  if (["1:1"].includes(ratio)) return "1024x1024";
  if (["16:9", "4:3", "3:2", "5:4", "21:9"].includes(ratio)) return "1536x1024";
  if (["9:16", "3:4", "2:3", "4:5"].includes(ratio)) return "1024x1536";
  return "1024x1024";
}

function buildChatImagePrompt(prompt, imageSize = "1:1") {
  const basePrompt = String(prompt || "").trim();
  const requestedSize = String(imageSize || "").trim();
  if (!requestedSize) return basePrompt;

  if (requestedSize.toLowerCase() === "auto") {
    return `${basePrompt}

Output size requirements:
- Preserve the aspect ratio of the first reference image.
- Do not default to a square canvas unless the first reference image is square.`;
  }

  return `${basePrompt}

Output size requirements:
- Use aspect ratio/size: ${requestedSize}.
- Do not default to a square canvas unless ${requestedSize} is square.`;
}

function parseResponseError(data, status) {
  return (
    data?.error?.message
    || data?.message
    || data?.error
    || `OpenAI-compatible image request failed (${status})`
  );
}

async function parseJsonSafely(response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw || "OpenAI-compatible image API returned non-JSON response");
  }
}

function normalizeImageInput(image) {
  if (!image) return [];
  const list = Array.isArray(image) ? image : [image];
  return list.filter((item) => typeof item === "string" && item);
}

function normalizeGeminiImageSize(imageSize = "1K") {
  const value = String(imageSize || "1K").trim().toUpperCase();
  return ["0.5K", "512", "1K", "2K", "4K"].includes(value) ? value : "1K";
}

function normalizeGeminiAspectRatio(aspectRatio = "1:1") {
  const candidates = [
    ["1:1", 1],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
    ["4:5", 4 / 5],
    ["5:4", 5 / 4],
    ["21:9", 21 / 9],
  ];
  const value = String(aspectRatio || "").trim();
  const direct = candidates.find(([ratio]) => ratio === value);
  if (direct) return direct[0];

  const exactSize = value.match(/^(\d{2,5})\s*[xX]\s*(\d{2,5})$/);
  const ratioMatch = value.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  const width = Number(exactSize?.[1] || ratioMatch?.[1] || 1);
  const height = Number(exactSize?.[2] || ratioMatch?.[2] || 1);
  const ratioValue = width > 0 && height > 0 ? width / height : 1;
  return candidates.reduce((best, candidate) => (
    Math.abs(candidate[1] - ratioValue) < Math.abs(best[1] - ratioValue) ? candidate : best
  ), candidates[0])[0];
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

async function localGeneratedImageToBuffer(source = "") {
  const filename = getLocalGeneratedImageFilename(source);
  if (!filename) return null;
  const image = await readGeneratedImage(filename);
  if (!image) {
    throw new Error("本地生成图已过期或不存在，请重新生成后再作为参考图使用。");
  }
  return image;
}

async function normalizeChatImageSource(source = "") {
  const localImage = await localGeneratedImageToBuffer(source);
  const cloudImage = localImage || await readCloudAssetImage(source);
  if (!cloudImage) return source;
  return `data:${cloudImage.mimeType};base64,${cloudImage.buffer.toString("base64")}`;
}

async function imageSourceToBlob(source) {
  const localImage = await localGeneratedImageToBuffer(source);
  const cloudImage = localImage || await readCloudAssetImage(source);
  if (cloudImage) {
    return { blob: new Blob([cloudImage.buffer], { type: cloudImage.mimeType }), mimeType: cloudImage.mimeType };
  }

  if (typeof source === "string" && /^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch reference image (${res.status})`);
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { blob: new Blob([Buffer.from(await res.arrayBuffer())], { type: mimeType }), mimeType };
  }
  return base64ToBlob(source);
}

async function imageSourceToGeminiInlineData(source) {
  const { blob, mimeType } = await imageSourceToBlob(source);
  const buffer = Buffer.from(await blob.arrayBuffer());
  return {
    inline_data: {
      mime_type: mimeType,
      data: buffer.toString("base64"),
    },
  };
}

function extractUrls(data = {}, fallbackMimeType = "image/png") {
  const items = Array.isArray(data?.data) ? data.data : [];
  return items
    .map((item) => {
      if (typeof item?.url === "string" && item.url) return item.url;
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

function extractChatImageUrls(data = {}) {
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((item) => item?.text || item?.image_url?.url || "").join("\n")
    : String(content || "");
  const urls = [];
  const markdownImagePattern = /!\[[^\]]*]\((data:image\/[^)]+|https?:\/\/[^)\s]+)\)/gi;
  let match;
  while ((match = markdownImagePattern.exec(text)) !== null) {
    urls.push(match[1]);
  }
  if (/^data:image\//i.test(text.trim()) || /^https?:\/\/\S+/i.test(text.trim())) {
    urls.push(text.trim());
  }
  return [...new Set(urls.filter(Boolean))];
}

function extractGeminiImageUrls(data = {}) {
  const parts = (Array.isArray(data?.candidates) ? data.candidates : [])
    .flatMap((candidate) => candidate?.content?.parts || []);
  return parts
    .map((part) => {
      const inlineData = part?.inlineData || part?.inline_data;
      const base64 = inlineData?.data;
      if (typeof base64 === "string" && base64) {
        const mimeType = inlineData?.mimeType || inlineData?.mime_type || "image/png";
        return `data:${mimeType};base64,${base64}`;
      }
      return part?.fileData?.fileUri || part?.file_data?.file_uri || "";
    })
    .filter(Boolean);
}

async function postJson({ apiBase, apiKey, apiKeyHeader, path, payload, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${normalizeBaseUrl(apiBase)}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(apiKey, apiKeyHeader),
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

async function postFormData({ apiBase, apiKey, apiKeyHeader, path, payload, images, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        formData.append(key, String(value));
      }
    });

    for (const image of images) {
      const { blob, mimeType } = await imageSourceToBlob(image);
      const ext = mimeType.split("/")[1] || "png";
      formData.append("image[]", blob, `image.${ext}`);
    }

    const res = await fetch(`${normalizeBaseUrl(apiBase)}${path}`, {
      method: "POST",
      headers: buildAuthHeaders(apiKey, apiKeyHeader),
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

export async function generateWithOpenAICompatibleImage({
  apiBase,
  apiKey,
  apiKeyHeader,
  model,
  prompt,
  imageSize = "1:1",
  num = 1,
}) {
  const data = await postJson({
    apiBase,
    apiKey,
    apiKeyHeader,
    path: "/images/generations",
    payload: {
      model,
      prompt: String(prompt || "").trim(),
      size: mapImageSize(imageSize),
      n: Math.max(1, Number(num) || 1),
    },
  });

  return await normalizeGeneratedImageUrls(extractUrls(data));
}

export async function editWithOpenAICompatibleImage({
  apiBase,
  apiKey,
  apiKeyHeader,
  model,
  prompt,
  image,
  imageSize = "1:1",
  num = 1,
}) {
  const images = normalizeImageInput(image);
  if (images.length === 0) {
    throw new Error("编辑需要至少 1 张参考图。");
  }

  const data = await postFormData({
    apiBase,
    apiKey,
    apiKeyHeader,
    path: "/images/edits",
    payload: {
      model,
      prompt: String(prompt || "").trim(),
      size: mapImageSize(imageSize),
      n: Math.max(1, Number(num) || 1),
    },
    images,
  });

  return await normalizeGeneratedImageUrls(extractUrls(data));
}

export async function generateWithOpenAICompatibleChatImage({
  apiBase,
  apiKey,
  apiKeyHeader,
  model,
  prompt,
  imageSize = "1:1",
}) {
  const data = await postJson({
    apiBase,
    apiKey,
    apiKeyHeader,
    path: "/chat/completions",
    payload: {
      model,
      messages: [
        {
          role: "user",
          content: buildChatImagePrompt(prompt, imageSize),
        },
      ],
    },
  });

  return await normalizeGeneratedImageUrls(extractChatImageUrls(data));
}

export async function editWithOpenAICompatibleChatImage({
  apiBase,
  apiKey,
  apiKeyHeader,
  model,
  prompt,
  image,
  imageSize = "1:1",
}) {
  const images = normalizeImageInput(image);
  if (images.length === 0) {
    throw new Error("编辑需要至少 1 张参考图。");
  }

  const normalizedImages = await Promise.all(images.map((url) => normalizeChatImageSource(url)));
  const content = [
    { type: "text", text: buildChatImagePrompt(prompt, imageSize) },
    ...normalizedImages.map((url) => ({
      type: "image_url",
      image_url: { url },
    })),
  ];

  const data = await postJson({
    apiBase,
    apiKey,
    apiKeyHeader,
    path: "/chat/completions",
    payload: {
      model,
      messages: [
        {
          role: "user",
          content,
        },
      ],
    },
  });

  return await normalizeGeneratedImageUrls(extractChatImageUrls(data));
}

export async function editWithGeminiNativeImage({
  apiBase,
  apiKey,
  model,
  prompt,
  image,
  imageSize = "1K",
  aspectRatio = "1:1",
}) {
  const images = normalizeImageInput(image);
  if (images.length === 0) {
    throw new Error("编辑需要至少 1 张参考图。");
  }

  const inlineImages = await Promise.all(images.map((url) => imageSourceToGeminiInlineData(url)));
  const path = `/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const data = await postJson({
    apiBase: normalizeGeminiBaseUrl(apiBase),
    apiKey: "",
    apiKeyHeader: "",
    path,
    payload: {
      contents: [
        {
          role: "user",
          parts: [
            { text: String(prompt || "").trim() },
            ...inlineImages,
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: normalizeGeminiAspectRatio(aspectRatio),
          imageSize: normalizeGeminiImageSize(imageSize),
        },
      },
    },
  });

  return await normalizeGeneratedImageUrls(extractGeminiImageUrls(data));
}
