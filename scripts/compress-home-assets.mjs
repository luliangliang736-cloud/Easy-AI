/**
 * 首页媒体资源压缩脚本
 * - 图片：用 sharp 转 WebP（质量 82，保留原文件不删除）
 * - 视频：用 ffmpeg 重新编码 H.264 并覆盖原文件（先备份到 .bak.mp4）
 *
 * 用法：node scripts/compress-home-assets.mjs
 */

import sharp from "sharp";
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.resolve(__dirname, "../public/images");

// ── 图片：转 WebP ─────────────────────────────────────────────────────────────
// 只处理首页实际用到的图片
const IMAGES_TO_WEBP = [
  "home-scroll-person-3.jpg",
  "footer-bottom.jpg",
  "floating-avatar-v2.png",
  "business-showcase/cover-1.jpg",
  "business-showcase/cover-2.jpg",
  "effect-showcase-card-1.jpg",
  "effect-showcase-card-2.jpg",
  "effect-showcase-card-3.jpg",
  "effect-showcase-card-4.jpg",
  "effect-showcase-card-5.jpg",
  "home-hero-carousel/2.jpg",
  "home-hero-carousel/5.jpg",
  "home-hero-carousel/7.jpg",
];

async function convertToWebP(relPath) {
  const inputPath = path.join(IMG_DIR, relPath);
  const outputPath = inputPath.replace(/\.(jpg|jpeg|png)$/i, ".webp");

  if (!fs.existsSync(inputPath)) {
    console.warn(`  ⚠ 跳过（不存在）: ${relPath}`);
    return null;
  }

  const beforeSize = fs.statSync(inputPath).size;
  process.stdout.write(`  转换 ${relPath} (${(beforeSize / 1024 / 1024).toFixed(2)}MB) → WebP ...`);

  try {
    await sharp(inputPath)
      .webp({ quality: 82, effort: 6 })
      .toFile(outputPath);

    const afterSize = fs.statSync(outputPath).size;
    const ratio = Math.round((1 - afterSize / beforeSize) * 100);
    const newName = path.basename(outputPath);
    console.log(` ✓ → ${newName} (${(afterSize / 1024 / 1024).toFixed(2)}MB, 减少 ${ratio}%)`);
    return { relPath, newRelPath: relPath.replace(/\.(jpg|jpeg|png)$/i, ".webp"), beforeSize, afterSize };
  } catch (err) {
    console.log(` ✗ 失败: ${err.message}`);
    return null;
  }
}

// ── 视频：ffmpeg 重新编码 ──────────────────────────────────────────────────────
const VIDEOS_TO_COMPRESS = [
  "home-hero-carousel/1.mp4",
  "home-hero-carousel/3.mp4",
  "home-hero-carousel/4.mp4",
  "home-hero-carousel/6.mp4",
  "home-bottom-summary.mp4",
];

function compressVideo(relPath) {
  const inputPath = path.join(IMG_DIR, relPath);
  const bakPath = inputPath.replace(".mp4", ".bak.mp4");
  const tmpPath = inputPath.replace(".mp4", ".tmp.mp4");

  if (!fs.existsSync(inputPath)) {
    console.warn(`  ⚠ 跳过（不存在）: ${relPath}`);
    return;
  }
  if (fs.existsSync(bakPath)) {
    console.log(`  ℹ 已有备份，跳过重新备份: ${path.basename(bakPath)}`);
  } else {
    fs.copyFileSync(inputPath, bakPath);
    console.log(`  📦 已备份 → ${path.basename(bakPath)}`);
  }

  const beforeSize = fs.statSync(inputPath).size;
  process.stdout.write(`  压缩 ${relPath} (${(beforeSize / 1024 / 1024).toFixed(2)}MB) ...`);

  // CRF 28 = 高质量，scale=1280 = 宽度 1280px，faststart 让视频边下边播
  const result = spawnSync(
    "ffmpeg",
    [
      "-y", "-i", inputPath,
      "-vcodec", "libx264",
      "-crf", "28",
      "-vf", "scale=1280:-2",
      "-preset", "slow",
      "-movflags", "+faststart",
      "-an",          // 首页轮播视频无声，去掉音频轨可再省一点
      tmpPath,
    ],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 300_000 }
  );

  if (result.status !== 0) {
    const errMsg = result.stderr?.toString()?.split("\n").slice(-5).join(" ") || "未知错误";
    console.log(` ✗ 失败: ${errMsg}`);
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    return;
  }

  fs.renameSync(tmpPath, inputPath);
  const afterSize = fs.statSync(inputPath).size;
  const ratio = Math.round((1 - afterSize / beforeSize) * 100);
  console.log(` ✓ (${(afterSize / 1024 / 1024).toFixed(2)}MB, 减少 ${ratio}%)`);
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n=== 图片 → WebP ===\n");
  const results = [];
  for (const rel of IMAGES_TO_WEBP) {
    const r = await convertToWebP(rel);
    if (r) results.push(r);
  }

  console.log("\n=== 视频压缩（H.264 CRF28, 1280px） ===\n");
  for (const rel of VIDEOS_TO_COMPRESS) {
    compressVideo(rel);
  }

  const totalBefore = results.reduce((s, r) => s + r.beforeSize, 0);
  const totalAfter = results.reduce((s, r) => s + r.afterSize, 0);
  console.log(`\n=== 图片完成：${results.length} 个文件，总计 ${(totalBefore/1024/1024).toFixed(1)}MB → ${(totalAfter/1024/1024).toFixed(1)}MB ===`);
  console.log("\n原始文件均未删除（.jpg/.png 仍保留）。代码引用更新见下一步提示。\n");
}

main().catch(console.error);
