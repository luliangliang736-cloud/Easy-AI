import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = process.cwd();
const PYTHON_BIN = process.env.TEXT_EDIT_PYTHON_BIN || process.env.PYTHON_BIN || "python";
const CACHE_DIR = path.join(os.tmpdir(), "easy-ai-text-edit-cache");
const WORK_ROOT = path.join(os.tmpdir(), "easy-ai-text-edit-work");
const PYTHON_TIMEOUT_MS = Number(process.env.TEXT_EDIT_PYTHON_TIMEOUT_MS || 10 * 60 * 1000);
const MASK_ENGINE = process.env.TEXT_EDIT_MASK_ENGINE || "auto";
const SAM_CHECKPOINT = process.env.TEXT_EDIT_SAM_CHECKPOINT || "";
const INPAINT_METHOD = process.env.TEXT_EDIT_INPAINT_METHOD || "auto";
const SD_MODEL = process.env.TEXT_EDIT_SD_MODEL || "runwayml/stable-diffusion-inpainting";

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

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function createWorkDir(prefix) {
  await ensureDir(WORK_ROOT);
  return fs.mkdtemp(path.join(WORK_ROOT, `${prefix}-`));
}

async function writeSourceImage(image, workDir, baseName = "input", baseUrl = "") {
  const { mime, buffer } = await loadImageBuffer(image, baseUrl);
  const ext = extensionFromMime(mime);
  const filePath = path.join(workDir, `${baseName}${ext}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

function appendOptionalArg(args, flag, value) {
  if (value !== undefined && value !== null && value !== "") {
    args.push(flag, String(value));
  }
}

async function runPython(args) {
  try {
    return await execFileAsync(PYTHON_BIN, args, {
      cwd: PROJECT_ROOT,
      timeout: PYTHON_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = String(err?.stderr || "").trim();
    const stdout = String(err?.stdout || "").trim();
    const detail = stderr || stdout || err?.message || "Python command failed";
    throw new Error(detail);
  }
}

export async function runPythonTextDetect({ image, lang = "en", baseUrl = "" }) {
  const workDir = await createWorkDir("detect");
  try {
    const inputPath = await writeSourceImage(image, workDir, "detect-input", baseUrl);
    const jsonPath = path.join(workDir, "blocks.json");
    const args = [
      "-m",
      "python_tools.text_replace.cli",
      "detect",
      "--input",
      inputPath,
      "--json",
      jsonPath,
      "--lang",
      lang,
      "--mask-engine",
      MASK_ENGINE,
    ];
    appendOptionalArg(args, "--sam-checkpoint", SAM_CHECKPOINT);
    await runPython(args);
    const raw = await fs.readFile(jsonPath, "utf8");
    const blocks = JSON.parse(raw);
    return {
      text: blocks.map((block) => String(block.text || "").trim()).filter(Boolean).join("\n"),
      blocks,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

export async function runPythonTextApply({ image, blocks, lang = "en", baseUrl = "" }) {
  const workDir = await createWorkDir("apply");
  try {
    const inputPath = await writeSourceImage(image, workDir, "apply-input", baseUrl);
    const jsonPath = path.join(workDir, "blocks.json");
    const outputPath = path.join(workDir, "output.png");
    await fs.writeFile(jsonPath, JSON.stringify(blocks, null, 2), "utf8");

    const args = [
      "-m",
      "python_tools.text_replace.cli",
      "apply",
      "--input",
      inputPath,
      "--json",
      jsonPath,
      "--output",
      outputPath,
      "--lang",
      lang,
      "--method",
      INPAINT_METHOD,
      "--mask-engine",
      MASK_ENGINE,
      "--sd-model",
      SD_MODEL,
    ];
    appendOptionalArg(args, "--sam-checkpoint", SAM_CHECKPOINT);
    await runPython(args);

    await ensureDir(CACHE_DIR);
    const imageId = crypto.randomUUID();
    const cachedPath = path.join(CACHE_DIR, `${imageId}.png`);
    await fs.copyFile(outputPath, cachedPath);
    return {
      imageId,
      url: `/api/text-edit?id=${encodeURIComponent(imageId)}`,
      outputPath: cachedPath,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

export async function readCachedTextEditImage(imageId) {
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
