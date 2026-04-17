import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import sharp from "sharp";

const CACHE_DIR = path.join(os.tmpdir(), "easy-ai-object-edit-cache");
const OPENAI_API_BASE_RAW = (process.env.OPENAI_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_VERSION = process.env.OPENAI_API_VERSION || "";
const OPENAI_API_KEY_HEADER = (process.env.OPENAI_API_KEY_HEADER || "authorization").trim().toLowerCase();
const OPENAI_API_STYLE = (process.env.OPENAI_API_STYLE || "auto").trim().toLowerCase();
const OPENAI_PLAN_API_STYLE = (process.env.OPENAI_PLAN_API_STYLE || "auto").trim().toLowerCase();
const OBJECT_PLAN_MODEL = process.env.OBJECT_PLAN_MODEL || "gpt-4.1-mini";
const OBJECT_PLAN_API_TIMEOUT_MS = Number(process.env.OBJECT_PLAN_API_TIMEOUT_MS || 60 * 1000);
const OBJECT_EDIT_PROVIDER = (process.env.OBJECT_EDIT_PROVIDER || "openai").trim().toLowerCase();
const OBJECT_EDIT_MODEL = process.env.OBJECT_EDIT_MODEL || "gpt-image-1";
const OBJECT_EDIT_API_TIMEOUT_MS = Number(process.env.OBJECT_EDIT_API_TIMEOUT_MS || 10 * 60 * 1000);
const NANO_API_BASE = (process.env.NANO_API_BASE || "https://api.nanobananaapi.dev").replace(/\/$/, "");
const NANO_API_KEY = process.env.NANO_API_KEY || "";
const NANO_OBJECT_EDIT_MODEL = process.env.NANO_OBJECT_EDIT_MODEL || "gemini-3.1-flash-image-preview";

function normalizeOpenAIBase(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!base) {
    return "https://api.openai.com/v1";
  }
  return /\/v\d+$/i.test(base) ? base : `${base}/v1`;
}

const OPENAI_API_BASE = normalizeOpenAIBase(OPENAI_API_BASE_RAW);
const OBJECT_PLAN_API_URL = process.env.OBJECT_PLAN_API_URL || `${OPENAI_API_BASE}/responses`;
const OPENAI_CHAT_COMPLETIONS_URL = `${OPENAI_API_BASE}/chat/completions`;
const OBJECT_EDIT_API_URL = process.env.OBJECT_EDIT_API_URL || `${OPENAI_API_BASE}/images/edits`;
const OPENAI_AZURE_IMAGES_EDIT_URL = `${OPENAI_API_BASE_RAW.replace(/\/$/, "")}/openai/images/edits`;

function withApiVersion(url) {
  if (!OPENAI_API_VERSION) {
    return url;
  }
  const nextUrl = new URL(url);
  if (!nextUrl.searchParams.has("api-version")) {
    nextUrl.searchParams.set("api-version", OPENAI_API_VERSION);
  }
  return nextUrl.toString();
}

function buildAzureDeploymentUrl(model, pathSuffix) {
  const base = OPENAI_API_BASE_RAW.replace(/\/$/, "");
  return `${base}/openai/deployments/${encodeURIComponent(model)}${pathSuffix}`;
}

function buildAuthHeaders(apiKey) {
  if (!apiKey) {
    return {};
  }
  if (OPENAI_API_KEY_HEADER === "api-key" || OPENAI_API_KEY_HEADER === "x-api-key") {
    return { [OPENAI_API_KEY_HEADER]: apiKey };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

const STANDARD_RATIOS = [
  { label: "1:1", value: 1 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "3:2", value: 3 / 2 },
  { label: "2:3", value: 2 / 3 },
  { label: "4:5", value: 4 / 5 },
  { label: "5:4", value: 5 / 4 },
];

function getApiErrorMessage(data, status) {
  return (
    data?.error?.message
    || data?.message
    || data?.error
    || `Request failed (${status})`
  );
}

function isSafeCacheId(value) {
  return /^[a-z0-9-]+$/i.test(String(value || ""));
}

function getMimeAndBufferFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("Invalid data URL");
  }
  return {
    mime: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64"),
  };
}

function extensionFromMime(mime) {
  if (/png/i.test(mime)) return ".png";
  if (/webp/i.test(mime)) return ".webp";
  if (/gif/i.test(mime)) return ".gif";
  return ".jpg";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function loadImageBuffer(image, baseUrl = "") {
  if (!image || typeof image !== "string") {
    throw new Error("Image is required");
  }
  if (/^data:image\//i.test(image)) {
    return getMimeAndBufferFromDataUrl(image);
  }
  const resolvedUrl = /^https?:\/\//i.test(image)
    ? image
    : image.startsWith("/") && baseUrl
      ? new URL(image, baseUrl).toString()
      : image;
  const res = await fetch(resolvedUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status})`);
  }
  const mime = (res.headers.get("content-type") || "image/png").toLowerCase();
  return {
    mime,
    buffer: Buffer.from(await res.arrayBuffer()),
  };
}

async function appendImageFile(formData, fieldName, image, baseUrl = "", baseName = "image") {
  const { mime, buffer } = await loadImageBuffer(image, baseUrl);
  const ext = extensionFromMime(mime);
  formData.append(fieldName, new Blob([buffer], { type: mime }), `${baseName}${ext}`);
}

async function appendBufferAsFile(formData, fieldName, buffer, mime, baseName) {
  const ext = extensionFromMime(mime);
  formData.append(fieldName, new Blob([buffer], { type: mime }), `${baseName}${ext}`);
}

function invertSelectionMaskForOpenAI(maskBuffer) {
  const png = PNG.sync.read(maskBuffer);
  for (let i = 0; i < png.data.length; i += 4) {
    const alpha = png.data[i + 3];
    const isSelected = alpha > 16;
    png.data[i] = 255;
    png.data[i + 1] = 255;
    png.data[i + 2] = 255;
    // OpenAI Images edits transparent pixels and preserves opaque ones.
    png.data[i + 3] = isSelected ? 0 : 255;
  }
  return Buffer.from(PNG.sync.write(png));
}

async function appendOpenAIMaskFile(formData, maskBuffer, baseName = "mask") {
  const normalizedMask = invertSelectionMaskForOpenAI(maskBuffer);
  formData.append("mask", new Blob([normalizedMask], { type: "image/png" }), `${baseName}.png`);
}

function normalizeImageInput(image, baseUrl = "") {
  if (!image || typeof image !== "string") {
    throw new Error("Image is required");
  }
  if (/^data:image\//i.test(image) || /^https?:\/\//i.test(image)) {
    return image;
  }
  if (image.startsWith("/") && baseUrl) {
    return new URL(image, baseUrl).toString();
  }
  return image;
}

async function parseJsonSafely(response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw || "Object edit API returned non-JSON response");
  }
}

async function postJsonWithTimeout(url, payload, { apiKey = "", timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(withApiVersion(url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(apiKey),
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafely(res);
    if (!res.ok) {
      const message = getApiErrorMessage(data, res.status);
      throw new Error(`${message} [status:${res.status}]`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function postMultipartWithTimeout(url, formData, { apiKey = "", timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(withApiVersion(url), {
      method: "POST",
      headers: {
        ...buildAuthHeaders(apiKey),
      },
      signal: controller.signal,
      body: formData,
    });
    const data = await parseJsonSafely(res);
    if (!res.ok) {
      const message = getApiErrorMessage(data, res.status);
      throw new Error(`${message} [status:${res.status}]`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function extractOpenAIResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const output = Array.isArray(data?.output) ? data.output : [];
  const chunks = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("").trim();
}

function extractChatCompletionsText(data) {
  const message = data?.choices?.[0]?.message;
  if (typeof message?.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => (part?.type === "text" || part?.type === "output_text" ? part?.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function findMaskBounds(maskBuffer) {
  const png = PNG.sync.read(maskBuffer);
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const idx = (y * png.width + x) * 4;
      if (png.data[idx + 3] > 16) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return null;
  }
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

function resolveCropRect(imageWidth, imageHeight, bbox) {
  const safeBox = bbox && bbox.w > 0 && bbox.h > 0
    ? bbox
    : { x: 0, y: 0, w: imageWidth, h: imageHeight };
  const padX = Math.max(32, Math.round(safeBox.w * 0.45));
  const padY = Math.max(32, Math.round(safeBox.h * 0.45));
  const left = clamp(Math.round(safeBox.x - padX), 0, Math.max(0, imageWidth - 1));
  const top = clamp(Math.round(safeBox.y - padY), 0, Math.max(0, imageHeight - 1));
  const right = clamp(Math.round(safeBox.x + safeBox.w + padX), left + 1, imageWidth);
  const bottom = clamp(Math.round(safeBox.y + safeBox.h + padY), top + 1, imageHeight);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function resolveOpenAIEditSize(width, height) {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.2) return "1536x1024";
  if (ratio < 0.8) return "1024x1536";
  return "1024x1024";
}

async function prepareLocalizedEditAssets({ image, mask, selection, baseUrl = "" }) {
  const { mime: imageMime, buffer: imageBuffer } = await loadImageBuffer(image, baseUrl);
  const { buffer: maskBuffer } = await loadImageBuffer(mask, baseUrl);
  const imageMeta = await sharp(imageBuffer).metadata();
  const imageWidth = Number(imageMeta.width || 0);
  const imageHeight = Number(imageMeta.height || 0);
  if (!imageWidth || !imageHeight) {
    throw new Error("无法读取原图尺寸");
  }

  const bbox = selection?.bbox || findMaskBounds(maskBuffer);
  const cropRect = resolveCropRect(imageWidth, imageHeight, bbox);
  const imageCropBuffer = await sharp(imageBuffer)
    .extract(cropRect)
    .png()
    .toBuffer();
  const maskCropBuffer = await sharp(maskBuffer)
    .resize(imageWidth, imageHeight, { fit: "fill" })
    .extract(cropRect)
    .png()
    .toBuffer();

  return {
    imageBuffer,
    imageMime,
    cropRect,
    imageCropBuffer,
    maskCropBuffer,
    editSize: resolveOpenAIEditSize(cropRect.width, cropRect.height),
  };
}

async function saveEditedResultToCache(result, baseUrl = "") {
  const candidates = [
    result?.data?.[0]?.b64_json,
    result?.data?.b64_json,
    result?.b64_json,
    result?.data?.[0]?.url,
    result?.data?.url,
    result?.url,
    Array.isArray(result?.urls) ? result.urls[0] : null,
    Array.isArray(result?.data?.urls) ? result.data.urls[0] : null,
  ].filter(Boolean);

  if (candidates.length === 0) {
    throw new Error("OpenAI Images edit API did not return an image");
  }

  let buffer;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(String(candidates[0])) && !String(candidates[0]).startsWith("http")) {
    buffer = Buffer.from(String(candidates[0]).replace(/\s/g, ""), "base64");
  } else {
    const { buffer: fetched } = await loadImageBuffer(normalizeImageInput(String(candidates[0]), baseUrl), baseUrl);
    buffer = fetched;
  }

  await ensureDir(CACHE_DIR);
  const imageId = crypto.randomUUID();
  const cachedPath = path.join(CACHE_DIR, `${imageId}.png`);
  await fs.writeFile(cachedPath, buffer);
  return {
    imageId,
    url: `/api/object-edit?id=${encodeURIComponent(imageId)}`,
    outputPath: cachedPath,
  };
}

async function extractEditedImageBuffer(result, baseUrl = "") {
  const candidates = [
    result?.data?.[0]?.b64_json,
    result?.data?.b64_json,
    result?.b64_json,
    result?.data?.[0]?.url,
    result?.data?.url,
    result?.url,
    Array.isArray(result?.urls) ? result.urls[0] : null,
    Array.isArray(result?.data?.urls) ? result.data.urls[0] : null,
  ].filter(Boolean);

  if (candidates.length === 0) {
    throw new Error("OpenAI Images edit API did not return an image");
  }

  if (/^[A-Za-z0-9+/=\r\n]+$/.test(String(candidates[0])) && !String(candidates[0]).startsWith("http")) {
    return Buffer.from(String(candidates[0]).replace(/\s/g, ""), "base64");
  }
  const { buffer } = await loadImageBuffer(normalizeImageInput(String(candidates[0]), baseUrl), baseUrl);
  return buffer;
}

async function saveBufferToCache(buffer) {
  await ensureDir(CACHE_DIR);
  const imageId = crypto.randomUUID();
  const cachedPath = path.join(CACHE_DIR, `${imageId}.png`);
  await fs.writeFile(cachedPath, buffer);
  return {
    imageId,
    url: `/api/object-edit?id=${encodeURIComponent(imageId)}`,
    outputPath: cachedPath,
  };
}

function resolveNanoImageSize(selection) {
  const width = Number(selection?.image_size?.width || selection?.imageSize?.width || 0);
  const height = Number(selection?.image_size?.height || selection?.imageSize?.height || 0);
  if (!width || !height) {
    return "1:1";
  }
  const ratio = width / height;
  let best = STANDARD_RATIOS[0];
  let delta = Math.abs(best.value - ratio);
  for (const candidate of STANDARD_RATIOS.slice(1)) {
    const nextDelta = Math.abs(candidate.value - ratio);
    if (nextDelta < delta) {
      best = candidate;
      delta = nextDelta;
    }
  }
  return best.label;
}

function buildNanoEditPrompt(instruction, selection) {
  const bbox = selection?.bbox;
  const hints = [];
  if (bbox && Number.isFinite(bbox.x) && Number.isFinite(bbox.y)) {
    hints.push(`selected region bbox: x=${bbox.x}, y=${bbox.y}, w=${bbox.w}, h=${bbox.h}`);
  }
  if (selection?.point && Number.isFinite(selection.point.x) && Number.isFinite(selection.point.y)) {
    hints.push(`selection point: (${selection.point.x}, ${selection.point.y})`);
  }
  return [
    instruction,
    "Only modify the selected object/region implied by the selection.",
    "Keep the rest of the image unchanged, including composition, pose, lighting, camera angle, and background.",
    hints.length ? `Selection hints: ${hints.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

async function runNanoObjectEdit({ image, prompt, selection, baseUrl = "" }) {
  if (!NANO_API_KEY) {
    throw new Error("未配置 NANO_API_KEY（Nano 编辑接口）");
  }
  const payload = {
    prompt: buildNanoEditPrompt(prompt, selection),
    image: normalizeImageInput(image, baseUrl),
    model: NANO_OBJECT_EDIT_MODEL,
    image_size: resolveNanoImageSize(selection),
    num: 1,
  };

  const res = await fetch(`${NANO_API_BASE}/v1/images/edit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NANO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafely(res);
  if (!res.ok || data?.code !== 0) {
    throw new Error(getApiErrorMessage(data, res.status));
  }

  const url = Array.isArray(data?.data?.url) ? data.data.url[0] : data?.data?.url;
  if (!url) {
    throw new Error("Nano 编辑接口未返回结果图片");
  }
  return {
    imageId: null,
    url,
    outputPath: null,
  };
}

export async function buildObjectEditInstruction({ prompt, selection }) {
  if (!OPENAI_API_KEY) {
    throw new Error("未配置 OPENAI_API_KEY（OpenAI 官方 GPT / Images 接口）");
  }

  const systemText = [
    "You are an image edit planner.",
    "Rewrite the user's request into a single concise instruction for masked object editing.",
    "Only edit the selected object inside the mask.",
    "Keep composition, lighting, camera angle, framing, and everything outside the mask unchanged.",
    "Keep the edited object anchored in the exact original position, footprint, perspective, and contact area unless the user explicitly asks to move it.",
    "Preserve the original canvas size and framing. Do not crop, zoom, reframe, or shift the scene.",
    "Do not mention the mask explicitly in the final instruction.",
  ].join(" ");
  const userText = [
    `User request: ${String(prompt || "").trim()}`,
    `Selection metadata: ${JSON.stringify(selection || {})}`,
  ].join("\n");

  let rawText = "";
  const shouldTryResponsesFirst = OPENAI_PLAN_API_STYLE !== "chat_completions";

  if (shouldTryResponsesFirst && OPENAI_API_STYLE !== "azure") {
    try {
      const data = await postJsonWithTimeout(
        OBJECT_PLAN_API_URL,
        {
          model: OBJECT_PLAN_MODEL,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: systemText }],
            },
            {
              role: "user",
              content: [
                { type: "input_text", text: userText },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "object_edit_instruction",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  instruction: {
                    type: "string",
                    description: "A concise full instruction for editing only the selected object while preserving the rest of the image.",
                  },
                },
                required: ["instruction"],
              },
            },
          },
        },
        { apiKey: OPENAI_API_KEY, timeoutMs: OBJECT_PLAN_API_TIMEOUT_MS }
      );
      rawText = extractOpenAIResponseText(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      const canFallback = OPENAI_PLAN_API_STYLE === "auto" && /\[status:(404|405)\]/.test(message);
      if (!canFallback) {
        throw error;
      }
    }
  }

  if (!rawText) {
    const chatUrl = OPENAI_API_STYLE === "azure"
      ? buildAzureDeploymentUrl(OBJECT_PLAN_MODEL, "/chat/completions")
      : OPENAI_CHAT_COMPLETIONS_URL;
    const data = await postJsonWithTimeout(
      chatUrl,
      {
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
        ...(OPENAI_API_STYLE === "azure" ? {} : { model: OBJECT_PLAN_MODEL }),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "object_edit_instruction",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                instruction: {
                  type: "string",
                  description: "A concise full instruction for editing only the selected object while preserving the rest of the image.",
                },
              },
              required: ["instruction"],
            },
          },
        },
      },
      { apiKey: OPENAI_API_KEY, timeoutMs: OBJECT_PLAN_API_TIMEOUT_MS }
    );
    rawText = extractChatCompletionsText(data);
  }

  let parsed;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }
  const instruction = parsed?.instruction;
  if (!instruction || !String(instruction).trim()) {
    throw new Error("GPT 规划接口未返回 instruction");
  }
  return String(instruction).trim();
}

export async function runObjectEdit({ image, mask, prompt, selection, baseUrl = "" }) {
  if (!OPENAI_API_KEY) {
    throw new Error("未配置 OPENAI_API_KEY（GPT 指令规划接口）");
  }

  const instruction = await buildObjectEditInstruction({ prompt, selection });
  if (OBJECT_EDIT_PROVIDER === "nano") {
    return runNanoObjectEdit({
      image,
      prompt: instruction,
      selection,
      baseUrl,
    });
  }

  const localizedAssets = await prepareLocalizedEditAssets({
    image,
    mask,
    selection,
    baseUrl,
  });

  let result;
  if (OPENAI_API_STYLE === "azure") {
    result = await postJsonWithTimeout(
      OPENAI_AZURE_IMAGES_EDIT_URL,
      {
        model: OBJECT_EDIT_MODEL,
        images: [
          {
            image_url: `data:image/png;base64,${localizedAssets.imageCropBuffer.toString("base64")}`,
          },
        ],
        mask: {
          image_url: `data:image/png;base64,${invertSelectionMaskForOpenAI(localizedAssets.maskCropBuffer).toString("base64")}`,
        },
        prompt: instruction,
        input_fidelity: "high",
        quality: "high",
        output_format: "png",
        background: "opaque",
        size: localizedAssets.editSize,
        n: 1,
      },
      { apiKey: OPENAI_API_KEY, timeoutMs: OBJECT_EDIT_API_TIMEOUT_MS }
    );
  } else {
    const formData = new FormData();
    formData.set("model", OBJECT_EDIT_MODEL);
    formData.set("prompt", instruction);
    formData.set("background", "opaque");
    formData.set("input_fidelity", "high");
    formData.set("quality", "high");
    formData.set("output_format", "png");
    formData.set("size", localizedAssets.editSize);
    formData.set("n", "1");
    await appendBufferAsFile(formData, "image", localizedAssets.imageCropBuffer, "image/png", "source");
    await appendOpenAIMaskFile(formData, localizedAssets.maskCropBuffer, "mask");

    result = await postMultipartWithTimeout(OBJECT_EDIT_API_URL, formData, {
      apiKey: OPENAI_API_KEY,
      timeoutMs: OBJECT_EDIT_API_TIMEOUT_MS,
    });
  }

  const editedCropBuffer = await extractEditedImageBuffer(result, baseUrl);
  const mergedBuffer = await sharp(localizedAssets.imageBuffer)
    .composite([
      {
        input: await sharp(editedCropBuffer)
          .resize(localizedAssets.cropRect.width, localizedAssets.cropRect.height, { fit: "fill" })
          .png()
          .toBuffer(),
        left: localizedAssets.cropRect.left,
        top: localizedAssets.cropRect.top,
      },
    ])
    .png()
    .toBuffer();

  return saveBufferToCache(mergedBuffer);
}

export async function readCachedObjectEditImage(imageId) {
  if (!isSafeCacheId(imageId)) {
    throw new Error("Invalid image id");
  }
  const filePath = path.join(CACHE_DIR, `${imageId}.png`);
  const buffer = await fs.readFile(filePath);
  return {
    buffer,
    contentType: "image/png",
  };
}
