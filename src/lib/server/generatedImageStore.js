import { randomUUID } from "crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const STORE_DIR = join(tmpdir(), "easyai-generated-images");
const MAX_FILE_AGE_MS = 6 * 60 * 60 * 1000;
const DATA_IMAGE_PATTERN = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([\s\S]+)$/i;

function getExtForMime(mimeType = "image/png") {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

function getMimeForFilename(filename = "") {
  const value = String(filename || "").toLowerCase();
  if (value.endsWith(".jpg") || value.endsWith(".jpeg")) return "image/jpeg";
  if (value.endsWith(".webp")) return "image/webp";
  if (value.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function parseDataImage(dataUrl = "") {
  const match = String(dataUrl || "").match(DATA_IMAGE_PATTERN);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2].replace(/\s/g, ""), "base64"),
  };
}

async function cleanupOldFiles() {
  try {
    const now = Date.now();
    const entries = await readdir(STORE_DIR);
    await Promise.all(entries.map(async (entry) => {
      if (!/^[a-f0-9-]+\.(png|jpe?g|webp|gif)$/i.test(entry)) return;
      const filePath = join(STORE_DIR, entry);
      const fileStat = await stat(filePath);
      if (now - fileStat.mtimeMs > MAX_FILE_AGE_MS) {
        await unlink(filePath);
      }
    }));
  } catch {
    // Best-effort cache cleanup only.
  }
}

export async function saveGeneratedDataImage(dataUrl) {
  const parsed = parseDataImage(dataUrl);
  if (!parsed) return dataUrl;

  await mkdir(STORE_DIR, { recursive: true });
  void cleanupOldFiles();

  const filename = `${randomUUID()}.${getExtForMime(parsed.mimeType)}`;
  await writeFile(join(STORE_DIR, filename), parsed.buffer);
  return `/api/generated-images/${filename}`;
}

export async function normalizeGeneratedImageUrls(urls = []) {
  if (!Array.isArray(urls)) return [];
  return Promise.all(urls.map(async (url) => {
    if (typeof url !== "string" || !url) return "";
    if (!DATA_IMAGE_PATTERN.test(url)) return url;
    try {
      return await saveGeneratedDataImage(url);
    } catch {
      return url;
    }
  })).then((items) => items.filter(Boolean));
}

export async function readGeneratedImage(filename = "") {
  const safeName = String(filename || "");
  if (!/^[a-f0-9-]+\.(png|jpe?g|webp|gif)$/i.test(safeName)) {
    return null;
  }
  try {
    const buffer = await readFile(join(STORE_DIR, safeName));
    return {
      buffer,
      mimeType: getMimeForFilename(safeName),
    };
  } catch {
    return null;
  }
}
