/**
 * 上传首页媒体资源到阿里云 OSS
 * 用法：node scripts/upload-home-assets-to-oss.mjs
 *
 * 上传后在 Railway 设置以下两个环境变量即可生效（不需要改代码）：
 *   NEXT_PUBLIC_HOME_ASSET_BASE_URL=https://easyai-assets-lqb.oss-cn-beijing.aliyuncs.com/home-assets
 *   NEXT_PUBLIC_HOME_HERO_ASSET_BASE_URL=https://easyai-assets-lqb.oss-cn-beijing.aliyuncs.com/home-assets/home-hero-carousel
 */

import OSS from "ali-oss";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");

const client = new OSS({
  region: process.env.OSS_REGION || "oss-cn-beijing",
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_HERO_BUCKET || "easyai-hero",
});

// 要上传的文件列表：[本地相对路径, OSS 目标路径]（全部是压缩后的版本）
const FILES = [
  // Hero 轮播视频（已用 ffmpeg 压缩）+ 图片（已转 WebP）
  ["images/home-hero-carousel/1.mp4",   "home-assets/home-hero-carousel/1.mp4"],
  ["images/home-hero-carousel/2.webp",  "home-assets/home-hero-carousel/2.webp"],
  ["images/home-hero-carousel/3.mp4",   "home-assets/home-hero-carousel/3.mp4"],
  ["images/home-hero-carousel/4.mp4",   "home-assets/home-hero-carousel/4.mp4"],
  ["images/home-hero-carousel/5.webp",  "home-assets/home-hero-carousel/5.webp"],
  ["images/home-hero-carousel/6.mp4",   "home-assets/home-hero-carousel/6.mp4"],
  ["images/home-hero-carousel/7.webp",  "home-assets/home-hero-carousel/7.webp"],
  // 首页大图 / 视频（均已压缩）
  ["images/home-scroll-person-3.webp",  "home-assets/home-scroll-person-3.webp"],
  ["images/home-bottom-summary.mp4",    "home-assets/home-bottom-summary.mp4"],
  ["images/footer-bottom.webp",         "home-assets/footer-bottom.webp"],
  // 业务展示卡片（WebP）
  ["images/business-showcase/cover-1.webp", "home-assets/business-showcase/cover-1.webp"],
  ["images/business-showcase/cover-2.webp", "home-assets/business-showcase/cover-2.webp"],
  // 效果展示卡片（WebP）
  ["images/effect-showcase-card-1.webp", "home-assets/effect-showcase-card-1.webp"],
  ["images/effect-showcase-card-2.webp", "home-assets/effect-showcase-card-2.webp"],
  ["images/effect-showcase-card-3.webp", "home-assets/effect-showcase-card-3.webp"],
  ["images/effect-showcase-card-4.webp", "home-assets/effect-showcase-card-4.webp"],
  ["images/effect-showcase-card-5.webp", "home-assets/effect-showcase-card-5.webp"],
  // 头像 / 浮动助手
  ["images/internal-user-avatar.png",   "home-assets/internal-user-avatar.png"],
  ["images/floating-avatar-v2.webp",    "home-assets/floating-avatar-v2.webp"],
];

const CONTENT_TYPES = {
  ".mp4":  "video/mp4",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".webp": "image/webp",
  ".gif":  "image/gif",
};

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

async function uploadFile(localRel, ossKey) {
  const localPath = path.join(PUBLIC_DIR, localRel);
  if (!fs.existsSync(localPath)) {
    console.warn(`  ⚠ 跳过（本地不存在）: ${localRel}`);
    return false;
  }
  const size = fs.statSync(localPath).size;
  const ext = path.extname(localPath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
  const start = Date.now();
  process.stdout.write(`  上传 ${localRel} (${formatMB(size)}) → ${ossKey} ...`);
  try {
    await client.put(ossKey, localPath, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "x-oss-object-acl": "public-read",
      },
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(` ✓ ${elapsed}s`);
    return true;
  } catch (err) {
    console.log(` ✗ 失败: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log("=== 开始上传首页资源到阿里云 OSS ===\n");
  let ok = 0, skip = 0, fail = 0;
  for (const [local, oss] of FILES) {
    const result = await uploadFile(local, oss);
    if (result === true) ok++;
    else if (result === false) { const exists = fs.existsSync(path.join(PUBLIC_DIR, local)); exists ? fail++ : skip++; }
  }
  console.log(`\n=== 完成：${ok} 成功，${skip} 跳过，${fail} 失败 ===`);
  if (ok > 0) {
    console.log(`
\n✅ 上传完成！在 Railway 添加以下两个环境变量（无需重新部署，触发 Redeploy 即可）：

  NEXT_PUBLIC_HOME_ASSET_BASE_URL
  = https://easyai-hero.oss-cn-beijing.aliyuncs.com/home-assets

  NEXT_PUBLIC_HOME_HERO_ASSET_BASE_URL
  = https://easyai-hero.oss-cn-beijing.aliyuncs.com/home-assets/home-hero-carousel

设置完成后，首页所有图片/视频直接走阿里云 OSS，不再经过 Railway 服务器。
`);
  }
}

main().catch(console.error);
