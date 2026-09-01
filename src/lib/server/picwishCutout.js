import sharp from "sharp";

/**
 * 佐糖（PicWish）万物抠图 API。
 * 文档：https://picwish.cn/background-removal-api-doc
 * 计费：普通抠图每次成功调用消耗 0.5 算粒（描边 >0 时 1 算粒，本项目不用描边）。
 *
 * ⚠️ 跨境链路约束（Railway 海外 ↔ 佐糖国内）：
 * - 首选把源图以「阿里云 OSS 签名直链」形式传给佐糖（image_url），
 *   佐糖服务器在国内，国内→国内下载秒级完成；
 * - 从 Railway 跨境上传图片二进制（image_file）极慢且易挂死，仅作兜底，
 *   且必须带超时——上线首日曾因无超时的跨境 multipart 上传把请求挂死数分钟。
 * - 返回的结果链接仅 1 小时有效，调用方必须立即永久化到 OSS，
 *   绝不能把临时链接返回给前端或写进画布/云端记录。
 */

const PICWISH_API_BASE = (process.env.PICWISH_API_BASE || "https://techsz.aoscdn.com").replace(/\/+$/, "");
const PICWISH_API_KEY = process.env.PICWISH_API_KEY || "";

// 佐糖上传限制：分辨率最大 4096x4096，文件最大 20MB
const MAX_INPUT_DIMENSION = 4096;
const MAX_INPUT_BYTES = 19 * 1024 * 1024;

// 官方建议：每 1 秒轮询一次，最长 60 秒
const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 60;

// 各请求的硬超时：任何一步都不允许无限挂起
const CREATE_URL_TIMEOUT_MS = Number(process.env.PICWISH_CREATE_TIMEOUT_MS || 30_000);
const CREATE_FILE_TIMEOUT_MS = Number(process.env.PICWISH_UPLOAD_TIMEOUT_MS || 120_000);
const POLL_TIMEOUT_MS = 15_000;

// 任务失败状态码 → 用户可读信息（见官方文档「任务状态码」表）
const STATE_MESSAGES = {
  "-1": "抠图处理失败",
  "-2": "抠图完成但结果保存失败，请重试",
  "-3": "抠图服务下载源图失败",
  "-5": "图片超出大小限制（30MB）",
  "-7": "图片文件无效（损坏或格式不支持）",
  "-8": "抠图处理超时",
  "-9": "抠图服务内部处理失败",
  "-10": "图片未通过抠图服务的内容检测",
  "-11": "抠图结果为空",
  "-13": "抠图任务被异常取消",
  "-14": "图片内容不符合抠图服务要求",
  "-15": "抠图服务资源不足，请稍后重试",
  "-16": "图片未通过抠图服务的内容检测",
  "-17": "非法提示词",
};

// 佐糖默认 QPS 只有 2：多任务并发时轮询按任务数自动降频，避免撞 429 限频
let activePollingTasks = 0;

export function isPicwishConfigured() {
  return Boolean(PICWISH_API_KEY);
}

/** 超出佐糖尺寸/体积限制时等比缩到限制内（常规 1K/2K/4K 生成图不会触发） */
async function preparePicwishInput(blob) {
  const buffer = Buffer.from(await blob.arrayBuffer());
  try {
    const meta = await sharp(buffer).metadata();
    const maxSide = Math.max(meta.width || 0, meta.height || 0);
    if (maxSide <= MAX_INPUT_DIMENSION && buffer.byteLength <= MAX_INPUT_BYTES) return blob;
    const resized = await sharp(buffer)
      .resize({
        width: MAX_INPUT_DIMENSION,
        height: MAX_INPUT_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return new Blob([resized], { type: "image/png" });
  } catch {
    return blob;
  }
}

async function picwishFetch(path, { timeoutMs, ...options } = {}) {
  const res = await fetch(`${PICWISH_API_BASE}${path}`, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs || 30_000),
    headers: {
      "X-API-KEY": PICWISH_API_KEY,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.status !== 200) {
    const message = data?.message || `HTTP ${res.status}`;
    throw new Error(`佐糖抠图服务请求失败：${message}`);
  }
  return data;
}

/**
 * 执行抠图：创建异步任务 → 轮询结果。
 * @param {object} options
 * @param {string} [options.imageUrl] 佐糖可直接下载的源图 URL（首选，传 OSS 签名直链）
 * @param {Blob} [options.blob] 源图二进制（兜底，跨境上传慢）
 * @param {(event: string, details?: object) => void} [options.log] 分步日志回调
 * @returns {Promise<string>} 抠图结果的临时下载 URL（1 小时有效，调用方负责永久化）
 */
export async function runPicwishCutout({ imageUrl = "", blob = null, log = () => {} } = {}) {
  if (!isPicwishConfigured()) {
    throw new Error("佐糖抠图未配置：请设置 PICWISH_API_KEY 环境变量");
  }
  if (!imageUrl && !blob) {
    throw new Error("佐糖抠图缺少源图");
  }

  const form = new FormData();
  form.append("sync", "0");
  let createTimeoutMs = CREATE_URL_TIMEOUT_MS;
  if (imageUrl) {
    form.append("image_url", imageUrl);
  } else {
    const input = await preparePicwishInput(blob);
    form.append("image_file", input, "input.png");
    createTimeoutMs = CREATE_FILE_TIMEOUT_MS;
  }

  // 创建任务：429（QPS 限频）时退避重试，其它错误直接抛出
  const createStartedAt = Date.now();
  let created;
  for (let attempt = 1; ; attempt += 1) {
    try {
      created = await picwishFetch("/api/tasks/visual/segmentation", {
        method: "POST",
        body: form,
        timeoutMs: createTimeoutMs,
      });
      break;
    } catch (error) {
      if (attempt < 3 && /HTTP 429/.test(String(error?.message || ""))) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        continue;
      }
      throw error;
    }
  }
  const taskId = created?.data?.task_id;
  if (!taskId) throw new Error("佐糖抠图服务未返回任务 ID");
  log("picwish_task_created", {
    mode: imageUrl ? "image_url" : "image_file",
    createMs: Date.now() - createStartedAt,
  });

  const pollStartedAt = Date.now();
  const pollDeadline = pollStartedAt + POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS;
  activePollingTasks += 1;
  try {
    let transientErrors = 0;
    while (Date.now() < pollDeadline) {
      // 并发轮询自动降频：N 个任务同时轮询时各自把间隔拉长到 N 秒，总 QPS 恒约 1
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * Math.max(1, activePollingTasks)));
      let result;
      try {
        result = await picwishFetch(`/api/tasks/visual/segmentation/${encodeURIComponent(taskId)}`, {
          method: "GET",
          timeoutMs: POLL_TIMEOUT_MS,
        });
      } catch (error) {
        // 限频/网络抖动都是瞬时状态，任务在佐糖侧仍在正常处理，继续轮询即可
        transientErrors += 1;
        if (transientErrors > 10) throw error;
        continue;
      }
      const state = Number(result?.data?.state);
      if (state === 1) {
        const resultImageUrl = result?.data?.image;
        if (!resultImageUrl) throw new Error("佐糖抠图完成但未返回结果图片");
        log("picwish_task_done", { pollMs: Date.now() - pollStartedAt });
        return resultImageUrl;
      }
      if (state < 0) {
        throw new Error(STATE_MESSAGES[String(state)] || `佐糖抠图处理失败（state=${state}）`);
      }
    }
    throw new Error("佐糖抠图轮询超时（60 秒），请稍后重试");
  } finally {
    activePollingTasks -= 1;
  }
}
