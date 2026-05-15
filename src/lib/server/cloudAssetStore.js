import { encodeCloudAssetUrl, getOssClient, isOssConfigured } from "@/lib/server/ossClient";

const MAX_UPLOAD_BYTES = Number(process.env.CLOUD_ASSET_MAX_UPLOAD_BYTES || 12 * 1024 * 1024);

const contentTypeExt = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function safeFilename(value = "") {
  return String(value || "image")
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
}

function decodeDataUrl(dataUrl = "") {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URL");
  const contentType = match[1].toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("Only image uploads are supported");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error("Image is too large");
  return { buffer, contentType };
}

export async function uploadCloudAsset({ userEmail = "", dataUrl = "", filename = "", scope = "canvas" } = {}) {
  if (!isOssConfigured()) throw new Error("OSS is not configured");
  const { buffer, contentType } = decodeDataUrl(dataUrl);
  const ext = contentTypeExt.get(contentType) || "png";
  const userPart = encodeURIComponent(String(userEmail || "unknown").toLowerCase());
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  const randomPart = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const objectKey = `users/${userPart}/${safeFilename(scope)}/${datePart}/${randomPart}-${safeFilename(filename)}.${ext}`;

  await getOssClient().put(objectKey, buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });

  return {
    key: objectKey,
    url: encodeCloudAssetUrl(objectKey),
    contentType,
    size: buffer.byteLength,
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
