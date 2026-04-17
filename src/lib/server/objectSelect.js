import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = process.cwd();
const PYTHON_BIN = process.env.OBJECT_SELECT_PYTHON_BIN || process.env.PYTHON_BIN || "python";
const WORK_ROOT = path.join(os.tmpdir(), "easy-ai-object-select-work");
const SAM_MODE = (process.env.SAM_MODE || "auto").trim().toLowerCase();
const DEFAULT_LOCAL_SAM_CHECKPOINT = path.resolve(PROJECT_ROOT, "..", "models", "SAM", "sam_vit_h_4b8939.pth");
const SAM_CHECKPOINT = process.env.SAM_CHECKPOINT || DEFAULT_LOCAL_SAM_CHECKPOINT;
const SAM_MODEL_TYPE = process.env.SAM_MODEL_TYPE || "vit_h";
const SAM_API_URL = process.env.SAM_API_URL || process.env.OBJECT_SELECT_API_URL || "";
const SAM_API_KEY = process.env.SAM_API_KEY || process.env.OBJECT_SELECT_API_KEY || "";
const SAM_API_TIMEOUT_MS = Number(process.env.SAM_API_TIMEOUT_MS || process.env.OBJECT_SELECT_API_TIMEOUT_MS || 60 * 1000);
const OPENAI_API_BASE_RAW = (process.env.OPENAI_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_KEY_HEADER = (process.env.OPENAI_API_KEY_HEADER || "authorization").trim().toLowerCase();
const OBJECT_SELECT_LABEL_MODEL = process.env.OBJECT_SELECT_LABEL_MODEL || process.env.OBJECT_PLAN_MODEL || "gpt-4o-mini";
const OBJECT_SELECT_LABEL_TIMEOUT_MS = Number(process.env.OBJECT_SELECT_LABEL_TIMEOUT_MS || 30 * 1000);

const OBJECT_LABEL_ALIASES = [
  [/diamond|gem|jewel|crystal/i, "钻石"],
  [/gift|present|box|package/i, "礼盒"],
  [/hat|cap|helmet/i, "帽子"],
  [/hair|bangs|hairstyle/i, "头发"],
  [/bag|backpack|handbag|purse/i, "包"],
  [/shirt|coat|jacket|hoodie|top/i, "上衣"],
  [/sleeve/i, "袖子"],
  [/pants|trousers|shorts|skirt/i, "下装"],
  [/shoe|shoes|sneaker|boot/i, "鞋子"],
  [/glasses|goggles/i, "眼镜"],
  [/ring/i, "戒指"],
  [/necklace/i, "项链"],
  [/earring/i, "耳环"],
  [/phone|mobile/i, "手机"],
  [/card/i, "卡片"],
  [/watch/i, "手表"],
];

function normalizeOpenAIBase(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!base) {
    return "https://api.openai.com/v1";
  }
  return /\/v\d+$/i.test(base) ? base : `${base}/v1`;
}

const OPENAI_API_BASE = normalizeOpenAIBase(OPENAI_API_BASE_RAW);

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

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function createWorkDir(prefix) {
  await ensureDir(WORK_ROOT);
  return fs.mkdtemp(path.join(WORK_ROOT, `${prefix}-`));
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

async function writeSourceImage(image, workDir, baseName = "input", baseUrl = "") {
  const { mime, buffer } = await loadImageBuffer(image, baseUrl);
  const ext = extensionFromMime(mime);
  const filePath = path.join(workDir, `${baseName}${ext}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function runPython(args) {
  try {
    return await execFileAsync(PYTHON_BIN, args, {
      cwd: PROJECT_ROOT,
      timeout: SAM_API_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = String(err?.stderr || "").trim();
    const stdout = String(err?.stdout || "").trim();
    const detail = stderr || stdout || err?.message || "Python command failed";
    throw new Error(detail);
  }
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
    throw new Error(raw || "Object select API returned non-JSON response");
  }
}

function buildAuthHeaders(apiKey) {
  if (!apiKey) return {};
  if (OPENAI_API_KEY_HEADER === "api-key" || OPENAI_API_KEY_HEADER === "x-api-key") {
    return { [OPENAI_API_KEY_HEADER]: apiKey };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

async function postJsonWithTimeout(url, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(OPENAI_API_KEY),
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafely(res);
    if (!res.ok) {
      throw new Error(data?.error?.message || data?.error || data?.message || `Request failed (${res.status})`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function mapSelectionResponse(payload, x, y) {
  const data = payload?.data || payload || {};
  const mask = data.mask_data_url || data.maskDataUrl || data.mask || data.mask_url || data.maskUrl;
  if (!mask) {
    throw new Error("SAM selection API did not return a mask");
  }
  return {
    mask_data_url: mask,
    bbox: data.bbox || data.box || null,
    method: data.method || "sam_api",
    score: data.score ?? null,
    point: data.point || { x, y },
    image_size: data.image_size || data.imageSize || null,
    label: data.label || data.object_label || data.objectLabel || "",
  };
}

function normalizeDetectedLabel(text) {
  const raw = String(text || "").trim().replace(/^["'\s]+|["'\s]+$/g, "");
  if (!raw) return "";
  for (const [pattern, label] of OBJECT_LABEL_ALIASES) {
    if (pattern.test(raw)) {
      return label;
    }
  }
  if (/^[\x00-\x7F]+$/.test(raw)) {
    return raw.slice(0, 16);
  }
  return raw.slice(0, 12);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function buildPointFocusedCropDataUrl({ image, bbox, point, baseUrl = "" }) {
  const { mime, buffer } = await loadImageBuffer(image, baseUrl);
  const source = sharp(buffer, { failOn: "none" });
  const meta = await source.metadata();
  const imageWidth = Number(meta.width || 0);
  const imageHeight = Number(meta.height || 0);
  if (!imageWidth || !imageHeight || !point) {
    return normalizeImageInput(image, baseUrl);
  }

  const bboxW = Math.max(1, Number(bbox?.w || 0));
  const bboxH = Math.max(1, Number(bbox?.h || 0));
  const cropWidth = clamp(
    Math.round(Math.max(120, bboxW * 0.7, imageWidth * 0.1)),
    64,
    imageWidth
  );
  const cropHeight = clamp(
    Math.round(Math.max(120, bboxH * 0.7, imageHeight * 0.1)),
    64,
    imageHeight
  );

  const centerX = clamp(Math.round(Number(point.x || 0)), 0, imageWidth - 1);
  const centerY = clamp(Math.round(Number(point.y || 0)), 0, imageHeight - 1);
  const left = clamp(Math.round(centerX - cropWidth / 2), 0, Math.max(0, imageWidth - cropWidth));
  const top = clamp(Math.round(centerY - cropHeight / 2), 0, Math.max(0, imageHeight - cropHeight));

  const cropped = await source
    .extract({
      left,
      top,
      width: cropWidth,
      height: cropHeight,
    })
    .png()
    .toBuffer();

  return `data:image/png;base64,${cropped.toString("base64")}`;
}

async function detectSelectionLabel({ image, bbox, point, imageSize, baseUrl = "" }) {
  if (!OPENAI_API_KEY) return "";
  const chatUrl = `${OPENAI_API_BASE}/chat/completions`;
  const focusedImage = await buildPointFocusedCropDataUrl({
    image,
    bbox,
    point,
    baseUrl,
  });
  const userText = [
    "Identify the main object in this cropped image.",
    "The crop is centered around the user's click point, so prioritize the object nearest the center.",
    "Return only one short English noun phrase.",
    "Examples: diamond, hat, hair, backpack, jacket, sleeve, shoes, gift box.",
    `Point: ${JSON.stringify(point || null)}`,
    `BBox: ${JSON.stringify(bbox || null)}`,
    `Image size: ${JSON.stringify(imageSize || null)}`,
  ].join("\n");
  try {
    const data = await postJsonWithTimeout(
      chatUrl,
      {
        model: OBJECT_SELECT_LABEL_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: focusedImage, detail: "low" } },
            ],
          },
        ],
        max_tokens: 20,
      },
      OBJECT_SELECT_LABEL_TIMEOUT_MS
    );
    const text = String(data?.choices?.[0]?.message?.content || "").trim();
    return normalizeDetectedLabel(text);
  } catch {
    return "";
  }
}

async function canUseLocalSam() {
  if (SAM_MODE === "remote") {
    return false;
  }
  try {
    await fs.access(SAM_CHECKPOINT);
    return true;
  } catch {
    return false;
  }
}

async function runLocalObjectSelect({ image, x, y, baseUrl = "" }) {
  const workDir = await createWorkDir("object-select");
  try {
    const inputPath = await writeSourceImage(image, workDir, "select-input", baseUrl);
    const jsonPath = path.join(workDir, "selection.json");
    const args = [
      "-m",
      "python_tools.object_select.cli",
      "--input",
      inputPath,
      "--output",
      jsonPath,
      "--x",
      String(Math.round(Number(x))),
      "--y",
      String(Math.round(Number(y))),
      "--sam-model-type",
      SAM_MODEL_TYPE,
      "--sam-checkpoint",
      SAM_CHECKPOINT,
    ];
    await runPython(args);
    const raw = await fs.readFile(jsonPath, "utf8");
    return mapSelectionResponse(JSON.parse(raw), x, y);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function runRemoteObjectSelect({ image, x, y, baseUrl = "" }) {
  if (!SAM_API_URL) {
    throw new Error("未配置 SAM_API_URL（Meta SAM 官方服务接口）");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAM_API_TIMEOUT_MS);
  try {
    const res = await fetch(SAM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SAM_API_KEY ? { Authorization: `Bearer ${SAM_API_KEY}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        image: normalizeImageInput(image, baseUrl),
        points: [[Math.round(Number(x)), Math.round(Number(y))]],
        point_labels: [1],
      }),
    });
    const payload = await parseJsonSafely(res);
    if (!res.ok) {
      throw new Error(payload?.error || payload?.message || `SAM selection API failed (${res.status})`);
    }
    return mapSelectionResponse(payload, x, y);
  } finally {
    clearTimeout(timer);
  }
}

export async function runObjectSelect({ image, x, y, baseUrl = "" }) {
  let result;
  if (await canUseLocalSam()) {
    try {
      result = await runLocalObjectSelect({ image, x, y, baseUrl });
    } catch (error) {
      if (SAM_MODE !== "local" && SAM_API_URL) {
        result = await runRemoteObjectSelect({ image, x, y, baseUrl });
      } else {
        const detail = error instanceof Error ? error.message : String(error || "");
        throw new Error(
          `本地 SAM 运行失败，请先安装 Python 依赖（opencv-python、torch、torchvision、segment-anything）或配置 SAM_API_URL。详情：${detail}`
        );
      }
    }
  } else if (SAM_MODE === "local") {
    throw new Error(`本地 SAM checkpoint 不存在：${SAM_CHECKPOINT}`);
  } else {
    result = await runRemoteObjectSelect({ image, x, y, baseUrl });
  }

  if (result && !result.label) {
    result.label = await detectSelectionLabel({
      image,
      bbox: result.bbox,
      point: result.point || { x, y },
      imageSize: result.image_size,
      baseUrl,
    });
  }
  return result;
}
