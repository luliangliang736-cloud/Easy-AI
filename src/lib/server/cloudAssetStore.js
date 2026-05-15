import { encodeCloudAssetUrl, getOssClient, isOssConfigured } from "@/lib/server/ossClient";
import { readGeneratedImage } from "@/lib/server/generatedImageStore";

const MAX_UPLOAD_BYTES = Number(process.env.CLOUD_ASSET_MAX_UPLOAD_BYTES || 12 * 1024 * 1024);
const MAX_MEDIA_UPLOAD_BYTES = Number(process.env.CLOUD_MEDIA_MAX_UPLOAD_BYTES || 500 * 1024 * 1024);

const contentTypeExt = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
  ["video/x-m4v", "m4v"],
  ["video/ogg", "ogv"],
  ["application/octet-stream", "bin"],
]);

function safeFilename(value = "") {
  return String(value || "image")
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
}

function inferMediaContentTypeFromUrl(source = "") {
  const path = String(source || "").split("?")[0].split("#")[0].toLowerCase();
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mov")) return "video/quicktime";
  if (path.endsWith(".m4v")) return "video/x-m4v";
  if (path.endsWith(".ogv") || path.endsWith(".ogg")) return "video/ogg";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".png")) return "image/png";
  return "";
}

function decodeDataUrl(dataUrl = "") {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URL");
  const contentType = match[1].toLowerCase();
  if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
    throw new Error("Only image and video uploads are supported");
  }
  const buffer = Buffer.from(match[2], "base64");
  const maxBytes = contentType.startsWith("video/") ? MAX_MEDIA_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (buffer.byteLength > maxBytes) throw new Error("Media file is too large");
  return { buffer, contentType };
}

export async function uploadCloudAsset({ userEmail = "", dataUrl = "", filename = "", scope = "canvas" } = {}) {
  if (!isOssConfigured()) throw new Error("OSS is not configured");
  const { buffer, contentType } = decodeDataUrl(dataUrl);
  return uploadCloudAssetBuffer({
    userEmail,
    buffer,
    contentType,
    filename,
    scope,
  });
}

export async function uploadCloudAssetBuffer({ userEmail = "", buffer, contentType = "image/png", filename = "", scope = "canvas" } = {}) {
  if (!isOssConfigured()) throw new Error("OSS is not configured");
  if (!Buffer.isBuffer(buffer)) throw new Error("Invalid upload buffer");
  const normalizedContentType = String(contentType || "image/png").split(";")[0].trim().toLowerCase();
  const isVideo = normalizedContentType.startsWith("video/");
  const isImage = normalizedContentType.startsWith("image/");
  const isBinaryFallback = normalizedContentType === "application/octet-stream";
  if (!isImage && !isVideo && !isBinaryFallback) {
    throw new Error("Only image and video uploads are supported");
  }
  const maxBytes = isVideo || isBinaryFallback ? MAX_MEDIA_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (buffer.byteLength > maxBytes) throw new Error("Media file is too large");
  const ext = contentTypeExt.get(normalizedContentType) || "png";
  const userPart = encodeURIComponent(String(userEmail || "unknown").toLowerCase());
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  const randomPart = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const objectKey = `users/${userPart}/${safeFilename(scope)}/${datePart}/${randomPart}-${safeFilename(filename)}.${ext}`;

  await getOssClient().put(objectKey, buffer, {
    headers: {
      "Content-Type": normalizedContentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });

  return {
    key: objectKey,
    url: encodeCloudAssetUrl(objectKey),
    contentType: normalizedContentType,
    size: buffer.byteLength,
  };
}

export async function copyImageUrlToCloudAsset({ userEmail = "", url = "", filename = "", scope = "generated" } = {}) {
  const source = String(url || "");
  if (!source) return "";
  if (/^\/api\/cloud-assets\//i.test(source)) return source;

  let buffer = null;
  let contentType = "image/png";

  const dataMatch = source.match(/^data:([^;,]+);base64,(.+)$/);
  if (dataMatch) {
    contentType = dataMatch[1].toLowerCase();
    buffer = Buffer.from(dataMatch[2].replace(/\s/g, ""), "base64");
  } else if (/^\/api\/generated-images\//i.test(source)) {
    const localFilename = decodeURIComponent(source.match(/^\/api\/generated-images\/([^/?#]+)/i)?.[1] || "");
    const image = await readGeneratedImage(localFilename);
    if (!image) throw new Error("Local generated image not found");
    contentType = image.mimeType;
    buffer = image.buffer;
  } else if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch media for OSS copy (${res.status})`);
    const headerContentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    contentType = headerContentType && headerContentType !== "application/octet-stream"
      ? headerContentType
      : inferMediaContentTypeFromUrl(source) || headerContentType || "image/png";
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    return source;
  }

  const result = await uploadCloudAssetBuffer({
    userEmail,
    buffer,
    contentType,
    filename,
    scope,
  });
  return result.url;
}

export async function copyImageUrlsToCloudAssets({ userEmail = "", urls = [], scope = "generated" } = {}) {
  if (!Array.isArray(urls)) return [];
  const copied = await Promise.all(urls.map(async (url, index) => {
    try {
      return await copyImageUrlToCloudAsset({
        userEmail,
        url,
        filename: `generated-${index + 1}`,
        scope,
      });
    } catch (error) {
      console.error("[CloudAssets] Generated image copy failed:", error);
      return url;
    }
  }));
  return copied.filter(Boolean);
}

export function getCloudAssetKeyFromUrl(source = "") {
  const match = String(source || "").match(/\/api\/cloud-assets\/([^?#]+)/i);
  if (!match?.[1]) return "";
  return decodeURIComponent(match[1]);
}

export async function readCloudAssetImage(source = "") {
  const key = getCloudAssetKeyFromUrl(source);
  if (!key) return null;
  const res = await fetch(getCloudAssetSignedUrl(key));
  if (!res.ok) throw new Error(`读取云端图片失败（${res.status}）`);
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    mimeType: contentType,
  };
}

export async function getCloudAssetStream(objectKey = "") {
  if (!isOssConfigured()) throw new Error("OSS is not configured");
  return getOssClient().getStream(objectKey);
}

export function getCloudAssetSignedUrl(objectKey = "") {
  if (!isOssConfigured()) throw new Error("OSS is not configured");
  return getOssClient().signatureUrl(objectKey, {
    expires: Number(process.env.OSS_SIGNED_URL_EXPIRES_SECONDS || 3600),
  });
}
