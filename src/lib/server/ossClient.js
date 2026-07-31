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

// ============================================================
// OSS 上传并发闸门（大小图分通道）
// 跨国到北京 OSS 的出口带宽有限。多个 40MB+ 大图（4K 高清放大）无节制并发
// 上传时，容器网络被打满：曾出现 900+ 超时 socket、50 个并发挂起连接，
// 连带同容器的数据库连接超时（登录/扣积分报 timeout exceeded when trying to
// connect），线上生图整体不可用。
// 大小图必须分通道：共用一个队列时，一批大图重试会占满队列，
// 普通小图（参考图、常规生成图）也被"队列已满"拒绝，前端连环弹"云端保存失败"。
// 小图通道并发高、队列深（上传快，几乎不堆积）；大图通道 1 个并发慢慢传，
// 队列有限、超出快速失败（调用方均有 catch 兜底，稍后自动重试）。
// ============================================================
function createUploadGate(limit, maxQueue, label) {
  let active = 0;
  const waiters = [];
  return {
    acquire() {
      if (active < limit) {
        active += 1;
        return Promise.resolve();
      }
      if (waiters.length >= maxQueue) {
        return Promise.reject(new Error(`OSS ${label} upload queue is full, try again later`));
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
      }).then(() => {
        active += 1;
      });
    },
    release() {
      active -= 1;
      const next = waiters.shift();
      if (next) next();
    },
  };
}

const smallUploadGate = createUploadGate(
  Number(process.env.OSS_SMALL_UPLOAD_CONCURRENCY || 4),
  Number(process.env.OSS_SMALL_UPLOAD_QUEUE || 200),
  "small",
);
const largeUploadGate = createUploadGate(
  Number(process.env.OSS_LARGE_UPLOAD_CONCURRENCY || 1),
  Number(process.env.OSS_LARGE_UPLOAD_QUEUE || 8),
  "large",
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function putOssObjectResilient(objectKey, buffer, headers = {}) {
  const client = getOssClient();
  const isLarge = Buffer.isBuffer(buffer) && buffer.byteLength > MULTIPART_THRESHOLD_BYTES;
  const gate = isLarge ? largeUploadGate : smallUploadGate;
  await gate.acquire();
  try {
    let checkpoint;
    let lastError;
    for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      try {
        if (Buffer.isBuffer(buffer) && buffer.byteLength > MULTIPART_THRESHOLD_BYTES) {
          return await client.multipartUpload(objectKey, buffer, {
            partSize: 2 * 1024 * 1024,
            parallel: 2,
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
  } finally {
    gate.release();
  }
}

export function isOssObjectNotFoundError(error) {
  return Number(error?.status) === 404 || /NoSuchKey/i.test(String(error?.code || error?.name || ""));
}

/**
 * OSS 桶内服务端复制：数据不经过本容器，40MB 大图也是亚秒级完成。
 * 生成图迁移到用户云资产时优先走这里——原先"下载到容器再重新上传"的方式，
 * 一张 4K 大图要跨国传输两次（数分钟），画布加载时批量迁移会把上传通道
 * 和容器带宽全部打满，连带其它请求超时。
 */
export async function copyOssObjectResilient(targetKey, sourceKey) {
  const client = getOssClient();
  let lastError;
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await client.copy(targetKey, sourceKey);
    } catch (error) {
      if (isOssObjectNotFoundError(error)) throw error;
      lastError = error;
      if (attempt < UPLOAD_MAX_ATTEMPTS) await sleep(attempt * 1000);
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
