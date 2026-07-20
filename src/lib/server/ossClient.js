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

// 超过该体积的对象改用分片上传：单次 put 一个 40MB+ 的大图（4K 高清放大）
// 跨国传到 OSS 经常撞 180s 超时，备份失败后一旦容器重部署图就永久丢了。
// 分片上传的超时按"每个分片请求"计算，小分片几乎不会超时，且失败可断点续传。
const MULTIPART_THRESHOLD_BYTES = Number(process.env.OSS_MULTIPART_THRESHOLD_BYTES || 8 * 1024 * 1024);
const UPLOAD_MAX_ATTEMPTS = Number(process.env.OSS_UPLOAD_MAX_ATTEMPTS || 3);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function putOssObjectResilient(objectKey, buffer, headers = {}) {
  const client = getOssClient();
  let checkpoint;
  let lastError;
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      if (Buffer.isBuffer(buffer) && buffer.byteLength > MULTIPART_THRESHOLD_BYTES) {
        return await client.multipartUpload(objectKey, buffer, {
          partSize: 2 * 1024 * 1024,
          parallel: 3,
          checkpoint,
          progress: (_percent, cpt) => { checkpoint = cpt; },
          headers,
        });
      }
      return await client.put(objectKey, buffer, { headers });
    } catch (error) {
      lastError = error;
      // 最后一次重试前丢弃断点，避免损坏的 checkpoint 让重试必然失败
      if (attempt === UPLOAD_MAX_ATTEMPTS - 1) checkpoint = undefined;
      if (attempt < UPLOAD_MAX_ATTEMPTS) await sleep(attempt * 2000);
    }
  }
  throw lastError;
}

export function encodeCloudAssetUrl(objectKey = "") {
  return `/api/cloud-assets/${String(objectKey)
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}
