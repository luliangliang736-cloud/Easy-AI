import { randomUUID } from "crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getOssClient, isOssConfigured, isOssObjectNotFoundError, putOssObjectResilient } from "@/lib/server/ossClient";

const STORE_DIR = join(tmpdir(), "easyai-generated-images");
const MAX_FILE_AGE_MS = 6 * 60 * 60 * 1000;
// 本地 temp 文件有 6 小时寿命且随重启丢失。写入时同步做一份 OSS 永久备份，
// 读取时本地 miss 则回源 OSS，保证 /api/generated-images/ URL 永久有效。
const OSS_BACKUP_PREFIX = "users/system-generated/generated-images/";

export function getGeneratedImageBackupKey(filename = "") {
  return `${OSS_BACKUP_PREFIX}${String(filename || "")}`;
}
// 上限要能覆盖 4K 高清放大的 PNG(可到 40MB+)。低于实际图片大小时,
// 生成结果会保留服务商的临时外链,外链过期后图片就永久丢失(裂图)。
const MAX_REMOTE_IMAGE_BYTES = Number(process.env.GENERATED_IMAGE_CACHE_MAX_BYTES || 60 * 1024 * 1024);
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

// 已确认存在 OSS 备份的文件名（进程内缓存；重启后未知状态靠清理时 HEAD 兜底确认）
const confirmedOssBackups = new Set();
// 清理节流：清理在每次保存时触发，加了 OSS HEAD 确认后改为最多每 10 分钟全量跑一次
let lastCleanupAt = 0;
const CLEANUP_MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 删除前确认这张图在 OSS 有备份。8/1 事故根因之一：OSS 链路故障窗口内备份成批失败，
 * 6 小时清理不看备份状态一律删，导致"从未备份成功"的图被删后永久丢失。
 * 现在：待补传/未备份的文件一律不删（宁可多占临时磁盘），状态未知的先 HEAD 确认，
 * 确认缺失则触发补传并保留本地文件，等备份成功后的下一轮清理再删。
 */
async function canSafelyDelete(filename) {
  if (!isOssConfigured()) return true;
  if (pendingOssBackups.has(filename)) return false;
  if (confirmedOssBackups.has(filename)) return true;
  try {
    await getOssClient().head(`${OSS_BACKUP_PREFIX}${filename}`);
    confirmedOssBackups.add(filename);
    return true;
  } catch (error) {
    if (isOssObjectNotFoundError(error)) {
      try {
        const buffer = await readFile(join(STORE_DIR, filename));
        backupGeneratedImageToOss(filename, buffer, getMimeForFilename(filename));
      } catch {
        // 本地也读不到（并发已删等），保守跳过
      }
      return false;
    }
    // 网络异常时状态不明，保守不删
    return false;
  }
}

async function cleanupOldFiles() {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) return;
  lastCleanupAt = now;
  try {
    const entries = await readdir(STORE_DIR);
    const expired = [];
    for (const entry of entries) {
      if (!/^[a-f0-9-]+\.(png|jpe?g|webp|gif)$/i.test(entry)) continue;
      try {
        const fileStat = await stat(join(STORE_DIR, entry));
        if (now - fileStat.mtimeMs > MAX_FILE_AGE_MS) expired.push(entry);
      } catch {
        // stat 失败跳过
      }
    }
    // 小批串行处理，HEAD 确认不挤占 OSS 通道
    for (let i = 0; i < expired.length; i += 5) {
      await Promise.all(expired.slice(i, i + 5).map(async (entry) => {
        if (!(await canSafelyDelete(entry))) return;
        try {
          await unlink(join(STORE_DIR, entry));
          confirmedOssBackups.delete(entry);
        } catch {
          // 删除失败留给下一轮
        }
      }));
    }
  } catch {
    // Best-effort cache cleanup only.
  }
}

// 备份彻底失败的文件名。之后任何一次成功读到本地文件时都会再补传一次，
// 尽量在容器重部署（本地文件清空）之前把备份补上。
const pendingOssBackups = new Set();

function backupGeneratedImageToOss(filename, buffer, mimeType) {
  if (!isOssConfigured()) return Promise.resolve(false);
  // 返回的 Promise 永不 reject（成功/失败都已在内部消化），调用方可选择等待或忽略。
  // 备份失败的文件会进入 pendingOssBackups，由周期补传兜底。
  return putOssObjectResilient(`${OSS_BACKUP_PREFIX}${filename}`, buffer, {
    "Content-Type": mimeType || getMimeForFilename(filename),
    "Cache-Control": "private, max-age=31536000, immutable",
  })
    .then(() => {
      pendingOssBackups.delete(filename);
      confirmedOssBackups.add(filename);
      return true;
    })
    .catch((error) => {
      pendingOssBackups.add(filename);
      console.error("[GeneratedImageStore] OSS backup failed after retries:", filename, error?.message || error);
      return false;
    });
}

// ============================================================
// 周期性补传：8/1 事故根因之一——补传原先只在文件"恰好被再次读到"时触发，
// OSS 链路故障持续数小时时，故障窗口内生成的图片备份成批失败且无人补传，
// 6 小时后被清理即永久丢失。现在每 2 分钟主动重试待补传名单，
// 链路恢复后自动补齐（8/2 晨容器内存里的名单一次性补上了 177 张，证明该机制有效）。
// ============================================================
const BACKUP_RETRY_INTERVAL_MS = Number(process.env.GENERATED_IMAGE_BACKUP_RETRY_MS || 2 * 60 * 1000);
let backupRetryRunning = false;

async function retryPendingOssBackups() {
  if (backupRetryRunning || pendingOssBackups.size === 0 || !isOssConfigured()) return;
  backupRetryRunning = true;
  try {
    // 每轮最多补 5 张，避免故障恢复瞬间挤占上传通道
    const batch = [...pendingOssBackups].slice(0, 5);
    for (const filename of batch) {
      try {
        const buffer = await readFile(join(STORE_DIR, filename));
        pendingOssBackups.delete(filename);
        backupGeneratedImageToOss(filename, buffer, getMimeForFilename(filename));
      } catch {
        // 本地文件已丢失（容器重启等），无从补传，移出名单
        pendingOssBackups.delete(filename);
      }
    }
  } finally {
    backupRetryRunning = false;
  }
}

const retryTimerKey = "__easyaiGeneratedImageBackupRetryTimer";
if (!globalThis[retryTimerKey]) {
  globalThis[retryTimerKey] = setInterval(() => {
    void retryPendingOssBackups();
  }, BACKUP_RETRY_INTERVAL_MS);
  // 不阻止进程正常退出
  globalThis[retryTimerKey].unref?.();
}

async function readGeneratedImageFromOss(filename) {
  if (!isOssConfigured()) return null;
  try {
    const result = await getOssClient().get(`${OSS_BACKUP_PREFIX}${filename}`);
    const buffer = Buffer.isBuffer(result?.content) ? result.content : null;
    if (!buffer) return null;
    confirmedOssBackups.add(filename);
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

// 生成响应返回前同步等 OSS 备份完成的封顶时长。开传输加速后备份只要 2-6 秒，
// 等它完成再返回，"图片上画布 = 已永久保存"，部署/清理/重启都不再可能弄丢它。
// 链路再度劣化时最多多等这么久就先出图，备份转后台（pendingOssBackups + 周期补传）继续。
const SYNC_BACKUP_WAIT_MS = Number(process.env.GENERATED_IMAGE_SYNC_BACKUP_WAIT_MS || 20_000);

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function saveGeneratedImageBuffer(buffer, mimeType = "image/png") {
  if (!Buffer.isBuffer(buffer)) return "";
  await mkdir(STORE_DIR, { recursive: true });
  void cleanupOldFiles();

  const filename = `${randomUUID()}.${getExtForMime(mimeType)}`;
  await writeFile(join(STORE_DIR, filename), buffer);
  const backupPromise = backupGeneratedImageToOss(filename, buffer, mimeType);
  await Promise.race([backupPromise, waitMs(SYNC_BACKUP_WAIT_MS)]);
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
    if (pendingOssBackups.has(safeName)) {
      pendingOssBackups.delete(safeName);
      backupGeneratedImageToOss(safeName, buffer, getMimeForFilename(safeName));
    }
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
