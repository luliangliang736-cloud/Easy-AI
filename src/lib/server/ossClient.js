import OSS from "ali-oss";

const globalKey = "__easyaiOssClient";

function getOssRegion() {
  return String(process.env.OSS_REGION || "oss-cn-beijing");
}

export function isOssConfigured() {
  return Boolean(
    process.env.OSS_BUCKET &&
      process.env.OSS_ACCESS_KEY_ID &&
      process.env.OSS_ACCESS_KEY_SECRET,
  );
}

export function getOssClient() {
  if (!isOssConfigured()) {
    throw new Error("OSS is not configured");
  }

  if (!globalThis[globalKey]) {
    globalThis[globalKey] = new OSS({
      region: getOssRegion(),
      endpoint: process.env.OSS_ENDPOINT || undefined,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
      bucket: process.env.OSS_BUCKET,
      secure: true,
      timeout: Number(process.env.OSS_TIMEOUT_MS || 180_000),
    });
  }
  return globalThis[globalKey];
}

export function encodeCloudAssetUrl(objectKey = "") {
  return `/api/cloud-assets/${String(objectKey)
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}
