const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function normalizeBaseUrl(apiBase = "") {
  const raw = String(apiBase || "https://api.openai.com").replace(/\/$/, "");
  return /\/v\d+$/i.test(raw) ? raw : `${raw}/v1`;
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
  if (/^\d{2,4}\s*[xX]\s*\d{2,4}$/.test(ratio)) {
    return ratio.replace(/\s+/g, "").replace("x", "x");
  }
  if (["1:1"].includes(ratio)) return "1024x1024";
  if (["16:9", "4:3", "3:2", "5:4", "21:9"].includes(ratio)) return "1536x1024";
  if (["9:16", "3:4", "2:3", "4:5"].includes(ratio)) return "1024x1536";
  return "1024x1024";
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

async function imageSourceToBlob(source) {
  if (typeof source === "string" && /^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch reference image (${res.status})`);
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { blob: new Blob([Buffer.from(await res.arrayBuffer())], { type: mimeType }), mimeType };
  }
  return base64ToBlob(source);
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

  return extractUrls(data);
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

  return extractUrls(data);
}

export async function generateWithOpenAICompatibleChatImage({
  apiBase,
  apiKey,
  apiKeyHeader,
  model,
  prompt,
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
          content: String(prompt || "").trim(),
        },
      ],
    },
  });

  return extractChatImageUrls(data);
}

export async function editWithOpenAICompatibleChatImage({
  apiBase,
  apiKey,
  apiKeyHeader,
  model,
  prompt,
  image,
}) {
  const images = normalizeImageInput(image);
  if (images.length === 0) {
    throw new Error("编辑需要至少 1 张参考图。");
  }

  const content = [
    { type: "text", text: String(prompt || "").trim() },
    ...images.map((url) => ({
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

  return extractChatImageUrls(data);
}
