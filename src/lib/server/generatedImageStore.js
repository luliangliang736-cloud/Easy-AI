import { randomUUID } from "crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getOssClient, isOssConfigured } from "@/lib/server/ossClient";

const STORE_DIR = join(tmpdir(), "easyai-generated-images");
const MAX_FILE_AGE_MS = 6 * 60 * 60 * 1000;
// 本地 temp 文件有 6 小时寿命且随重启丢失。写入时同步做一份 OSS 永久备份，
// 读取时本地 miss 则回源 OSS，保证 /api/generated-images/ URL 永久有效。
const OSS_BACKUP_PREFIX = "users/system-generated/generated-images/";
const MAX_REMOTE_IMAGE_BYTES = Number(process.env.GENERATED_IMAGE_CACHE_MAX_BYTES || 25 * 1024 * 1024);
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

function backupGeneratedImageToOss(filename, buffer, mimeType) {
  if (!isOssConfigured()) return;
  // Fire-and-forget：备份不在生成请求的响应路径上，失败只影响过期后的回源兜底。
  void getOssClient()
    .put(`${OSS_BACKUP_PREFIX}${filename}`, buffer, {
      headers: {
        "Content-Type": mimeType || getMimeForFilename(filename),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })
    .catch((error) => {
      console.warn("[GeneratedImageStore] OSS backup failed:", filename, error?.message || error);
    });
}

async function readGeneratedImageFromOss(filename) {
  if (!isOssConfigured()) return null;
  try {
    const result = await getOssClient().get(`${OSS_BACKUP_PREFIX}${filename}`);
    const buffer = Buffer.isBuffer(result?.content) ? result.content : null;
    if (!buffer) return null;
    // 回写本地 temp 作为缓存，后续读取无需再走 OSS。
    try {
      await mkdir(STORE_DIR, { recursive: true });
      await writeFile(join(STORE_DIR, filename), buffer);
    } catch {
      // 缓存回写失败不影响本次读取。
    }
    return buffer;
  } catch {
    return null;
  }
}

export async function saveGeneratedImageBuffer(buffer, mimeType = "image/png") {
  if (!Buffer.isBuffer(buffer)) return "";
  await mkdir(STORE_DIR, { recursive: true });
  void cleanupOldFiles();

  const filename = `${randomUUID()}.${getExtForMime(mimeType)}`;
  await writeFile(join(STORE_DIR, filename), buffer);
  backupGeneratedImageToOss(filename, buffer, mimeType);
  return `/api/generated-images/${filename}`;
}

export async function saveGeneratedDataImage(dataUrl) {
  const parsed = parseDataImage(dataUrl);
  if (!parsed) return dataUrl;

  return saveGeneratedImageBuffer(parsed.buffer, parsed.mimeType);
}

async function saveGeneratedRemoteImage(url = "") {
  const source = String(url || "");
  if (!/^https?:\/\//i.test(source)) return source;
  const res = await fetch(source);
  if (!res.ok) throw new Error(`Failed to cache generated image (${res.status})`);
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "image/png";
  if (!contentType.startsWith("image/")) return source;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) return source;
  return saveGeneratedImageBuffer(buffer, contentType);
}

export async function normalizeGeneratedImageUrls(urls = []) {
  if (!Array.isArray(urls)) return [];
  return Promise.all(urls.map(async (url) => {
    if (typeof url !== "string" || !url) return "";
    try {
      if (/^data:image\//i.test(url)) {
        return await saveGeneratedDataImage(url);
      }
      if (/^https?:\/\//i.test(url)) {
        return await saveGeneratedRemoteImage(url);
      }
      return url;
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
    // 本地 temp 已过期/丢失（6 小时清理、服务重启、换机器），回源 OSS 备份。
    const buffer = await readGeneratedImageFromOss(safeName);
    if (!buffer) return null;
    return {
      buffer,
      mimeType: getMimeForFilename(safeName),
    };
  }
}
