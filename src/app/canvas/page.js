"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import Canvas from "@/components/Canvas";
import ChatPanel from "@/components/ChatPanel";
import TextEditBlocksPanel from "@/components/TextEditBlocksPanel";
import { ToastProvider, useToast } from "@/components/Toast";
import BrandLogo from "@/components/BrandLogo";
import { compressImage } from "@/lib/imageUtils";
import { useHistory } from "@/lib/useHistory";
import { useTheme } from "@/lib/useTheme";
import { useAuthSessionGuard } from "@/lib/useAuthSessionGuard";
import { useCloudLocalStorageSync } from "@/lib/useCloudLocalStorageSync";
import { MAX_GEN_COUNT } from "@/lib/genLimits";

const FLOATING_ENTRY_DRAFT_KEY = "lovart-floating-entry-draft";
const CANVAS_CLOUD_STATE_KEYS = [
  "lovart-conversations",
  "lovart-active-conversation",
  "lovart-canvas-boards",
  "lovart-active-canvas-board",
  "lovart-canvas-images",
  "lovart-canvas-texts",
  "lovart-canvas-shapes",
];

function errStr(e) {
  if (!e) return "未知错误";
  if (typeof e === "string") return e;
  return e.message || e.error || JSON.stringify(e);
}

function normalizeInspirationUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function parseQuantityToken(tok) {
  if (!tok) return 0;
  const t = String(tok).trim();
  if (/^\d{1,2}$/.test(t)) {
    const n = parseInt(t, 10);
    return n >= 1 && n <= 99 ? n : 0;
  }
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (t.length === 1 && map[t] !== undefined) return map[t];
  if (t === "十") return 10;
  const m10 = t.match(/^十([一二三四五六七八九])?$/);
  if (m10) return 10 + (m10[1] ? map[m10[1]] : 0);
  const m2 = t.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/);
  if (m2) {
    return map[m2[1]] * 10 + (m2[2] ? map[m2[2]] : 0);
  }
  return 0;
}

const ASPECT_RATIO_CANDIDATES = [
  { value: "1:1", ratio: 1 },
  { value: "16:9", ratio: 16 / 9 },
  { value: "9:16", ratio: 9 / 16 },
  { value: "4:3", ratio: 4 / 3 },
  { value: "3:4", ratio: 3 / 4 },
  { value: "3:2", ratio: 3 / 2 },
  { value: "2:3", ratio: 2 / 3 },
  { value: "2:1", ratio: 2 / 1 },
  { value: "1:2", ratio: 1 / 2 },
  { value: "4:5", ratio: 4 / 5 },
  { value: "5:4", ratio: 5 / 4 },
  { value: "21:9", ratio: 21 / 9 },
];

const ASPECT_RATIO_RULES = [
  { value: "1:1", score: 6, keywords: ["1:1", "1：1", "1比1", "正方形", "方图", "方版", "方形", "square"] },
  { value: "1:1", score: 5, keywords: ["logo", "图标", "头像", "icon", "贴纸", "表情包"] },
  { value: "1:1", score: 5, keywords: ["电商主图", "商品主图", "淘宝主图", "京东主图", "拼多多主图", "亚马逊主图", "白底图"] },
  { value: "1:1", score: 4, keywords: ["sku图", "sku主图", "款式图", "商品方图", "产品卡片图", "商品卡片图"] },
  { value: "16:9", score: 6, keywords: ["16:9", "16：9", "16比9", "宽屏", "横屏", "横版", "landscape"] },
  { value: "16:9", score: 5, keywords: ["banner", "横幅", "头图", "网页首屏", "网站首屏", "官网首屏", "ppt首图", "ppt封面", "youtube封面", "电脑壁纸"] },
  { value: "16:9", score: 4, keywords: ["ppt", "演示文稿", "发布会大屏", "横版kv", "横版海报", "横版封面", "公众号头图", "公众号首图", "b站封面", "bilibili封面", "视频封面横版"] },
  { value: "9:16", score: 6, keywords: ["9:16", "9：16", "9比16", "竖屏", "竖版", "手机尺寸", "手机比例", "手机屏幕"] },
  { value: "9:16", score: 5, keywords: ["抖音", "快手", "视频号", "直播间", "直播带货", "story", "stories", "reel", "reels", "short", "shorts"] },
  { value: "9:16", score: 4, keywords: ["手机壁纸", "开屏", "直播预告", "短视频封面", "短视频", "全屏海报", "电商详情长图", "商品详情长图"] },
  { value: "4:3", score: 6, keywords: ["4:3", "4：3", "4比3"] },
  { value: "4:3", score: 4, keywords: ["演示页", "课件封面", "幻灯片配图", "平板壁纸", "ipad壁纸", "教学课件"] },
  { value: "3:4", score: 6, keywords: ["3:4", "3：4", "3比4"] },
  { value: "3:4", score: 5, keywords: ["海报", "宣传海报", "活动海报", "招聘海报", "竖版海报", "宣传单页", "菜单", "价目表", "节目单"] },
  { value: "3:4", score: 4, keywords: ["封面海报", "海报风", "展架海报", "易拉宝", "竖版物料", "a4", "a4海报", "传单", "证件照"] },
  { value: "2:3", score: 6, keywords: ["2:3", "2：3", "2比3"] },
  { value: "2:3", score: 4, keywords: ["电影海报", "摄影竖图", "书籍封面", "小说封面", "专辑封面", "杂志封面"] },
  { value: "3:2", score: 6, keywords: ["3:2", "3：2", "3比2"] },
  { value: "3:2", score: 4, keywords: ["摄影横图", "相机画幅", "横向摄影", "横向展示图", "产品横图"] },
  { value: "2:1", score: 6, keywords: ["2:1", "2：1", "2比1"] },
  { value: "2:1", score: 5, keywords: ["wa海报", "whatsapp海报", "营销海报横版", "横版营销海报"] },
  { value: "1:2", score: 6, keywords: ["1:2", "1：2", "1比2"] },
  { value: "4:5", score: 6, keywords: ["4:5", "4：5", "4比5"] },
  { value: "4:5", score: 5, keywords: ["小红书封面", "ins封面", "instagram封面", "社媒封面", "笔记封面", "朋友圈配图"] },
  { value: "4:5", score: 4, keywords: ["社交媒体封面", "商品种草图", "内容封面", "穿搭封面", "美食封面", "种草封面"] },
  { value: "5:4", score: 6, keywords: ["5:4", "5：4", "5比4"] },
  { value: "5:4", score: 4, keywords: ["详情页首图", "产品展示图", "商品展示图", "亚马逊详情图", "横版商品图"] },
  { value: "21:9", score: 6, keywords: ["21:9", "21：9", "21比9"] },
  { value: "21:9", score: 5, keywords: ["超宽", "电影感宽屏", "电影横幅", "cinematic", "ultrawide"] },
];

/** 根据参考图真实像素尺寸，计算 GPT Image 2 edit 合法的精确输出尺寸 */
function computeGptImage2EditSize(width, height) {
  if (!width || !height || width <= 0 || height <= 0) return "auto";
  const MAX_EDGE = 3840;
  const MAX_RATIO = 3;
  const MIN_PIXELS = 655360;
  const MAX_PIXELS = 8294400;
  const TARGET_PIXELS = 1050000;
  const MULTIPLE = 16;

  let w = width;
  let h = height;

  // 长宽比超过 3:1 则让 API 自行决定
  const longEdge = Math.max(w, h);
  const shortEdge = Math.min(w, h);
  if (shortEdge === 0 || longEdge / shortEdge > MAX_RATIO) return "auto";

  // 像素不足则等比放大
  if (w * h < MIN_PIXELS) {
    const scale = Math.sqrt(MIN_PIXELS / (w * h));
    w = Math.ceil(w * scale);
    h = Math.ceil(h * scale);
  }

  // 最长边超限则等比缩小
  const maxEdge = Math.max(w, h);
  if (maxEdge > MAX_EDGE) {
    const scale = MAX_EDGE / maxEdge;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  if (w * h > TARGET_PIXELS) {
    const scale = Math.sqrt(TARGET_PIXELS / (w * h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  // 四舍五入到 16 的倍数
  w = Math.round(w / MULTIPLE) * MULTIPLE || MULTIPLE;
  h = Math.round(h / MULTIPLE) * MULTIPLE || MULTIPLE;

  // 最终校验
  if (Math.max(w, h) > MAX_EDGE || w * h > MAX_PIXELS || w * h < MIN_PIXELS) return "auto";

  return `${w}x${h}`;
}

function computeGptImage2UpscaleSize(width, height, targetSize = "2K") {
  if (!width || !height || width <= 0 || height <= 0) return "auto";

  const MAX_EDGE = 3840;
  const MAX_RATIO = 3;
  const MIN_PIXELS = 655360;
  const MAX_PIXELS = 8294400;
  const MULTIPLE = 16;
  const targetLongEdge = {
    "1K": 1024,
    "2K": 2048,
    "4K": 3840,
  }[String(targetSize || "").toUpperCase()] || 2048;

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (shortEdge === 0 || longEdge / shortEdge > MAX_RATIO) return "auto";

  const minScale = Math.sqrt(MIN_PIXELS / (width * height));
  const maxScale = Math.min(
    MAX_EDGE / longEdge,
    Math.sqrt(MAX_PIXELS / (width * height))
  );
  const requestedScale = targetLongEdge / longEdge;
  const scale = Math.min(maxScale, Math.max(requestedScale, minScale));
  let w = Math.round((width * scale) / MULTIPLE) * MULTIPLE;
  let h = Math.round((height * scale) / MULTIPLE) * MULTIPLE;
  w = Math.max(MULTIPLE, w);
  h = Math.max(MULTIPLE, h);

  if (Math.max(w, h) > MAX_EDGE || w * h > MAX_PIXELS || w * h < MIN_PIXELS) {
    return "auto";
  }

  return `${w}x${h}`;
}

function findClosestAspectRatio(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "1:1";
  }

  const target = width / height;
  let best = ASPECT_RATIO_CANDIDATES[0];
  let bestDiff = Math.abs(best.ratio - target);

  for (const candidate of ASPECT_RATIO_CANDIDATES.slice(1)) {
    const diff = Math.abs(candidate.ratio - target);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }

  return best.value;
}

function inferAspectRatioFromPrompt(text) {
  if (!text || typeof text !== "string") return "1:1";

  const normalized = text.toLowerCase();
  const compact = normalized.replace(/\s+/g, "");
  const hasAny = (keywords) => keywords.some((keyword) => compact.includes(keyword));

  const explicitRatioMatch = compact.match(/(21|16|9|8|5|4|3|2|1)\s*[:：/xX]\s*(9|16|8|5|4|3|2|1)/);
  if (explicitRatioMatch) {
    return findClosestAspectRatio(
      Number(explicitRatioMatch[1]),
      Number(explicitRatioMatch[2])
    );
  }

  const explicitBiMatch = compact.match(/(21|16|9|8|5|4|3|2|1)\s*比\s*(9|16|8|5|4|3|2|1)/);
  if (explicitBiMatch) {
    return findClosestAspectRatio(
      Number(explicitBiMatch[1]),
      Number(explicitBiMatch[2])
    );
  }

  const dimensionMatch = compact.match(/(\d{3,5})\s*[xX*＊]\s*(\d{3,5})/);
  if (dimensionMatch) {
    return findClosestAspectRatio(
      Number(dimensionMatch[1]),
      Number(dimensionMatch[2])
    );
  }

  const scores = new Map(ASPECT_RATIO_CANDIDATES.map((candidate) => [candidate.value, 0]));
  const addScore = (ratio, delta) => {
    scores.set(ratio, (scores.get(ratio) || 0) + delta);
  };
  for (const rule of ASPECT_RATIO_RULES) {
    if (rule.keywords.some((keyword) => compact.includes(keyword))) {
      addScore(rule.value, rule.score);
    }
  }

  if (compact.includes("淘宝") || compact.includes("天猫") || compact.includes("京东") || compact.includes("拼多多")) {
    if (compact.includes("主图")) {
      addScore("1:1", 6);
    }
    if (compact.includes("详情")) {
      addScore("9:16", 4);
      addScore("5:4", 2);
    }
  }
  if (compact.includes("亚马逊")) {
    if (compact.includes("主图")) {
      addScore("1:1", 6);
    }
    if (compact.includes("详情")) {
      addScore("5:4", 5);
    }
  }
  if (compact.includes("小红书")) {
    if (compact.includes("封面") || compact.includes("笔记")) {
      addScore("4:5", 6);
    }
    if (compact.includes("竖版") || compact.includes("长图")) {
      addScore("4:5", 2);
      addScore("9:16", 2);
    }
  }
  if (compact.includes("抖音") || compact.includes("快手") || compact.includes("视频号")) {
    addScore("9:16", 5);
    if (compact.includes("封面") || compact.includes("预告")) {
      addScore("9:16", 3);
    }
  }
  if (compact.includes("公众号") || compact.includes("微信文章")) {
    if (compact.includes("头图") || compact.includes("首图") || compact.includes("封面")) {
      addScore("16:9", 6);
    }
  }
  if (compact.includes("b站") || compact.includes("bilibili") || compact.includes("youtube")) {
    if (compact.includes("封面") || compact.includes("缩略图")) {
      addScore("16:9", 6);
    }
  }
  if (compact.includes("详情") && (compact.includes("长图") || compact.includes("长页"))) {
    addScore("9:16", 5);
  }
  if (compact.includes("壁纸")) {
    if (compact.includes("手机")) {
      addScore("9:16", 5);
    }
    if (compact.includes("电脑") || compact.includes("桌面")) {
      addScore("16:9", 5);
    }
    if (compact.includes("平板") || compact.includes("ipad")) {
      addScore("4:3", 5);
    }
  }
  if (compact.includes("封面")) {
    if (compact.includes("小红书") || compact.includes("ins") || compact.includes("instagram") || compact.includes("笔记")) {
      addScore("4:5", 4);
    } else if (compact.includes("视频") || compact.includes("短视频") || compact.includes("抖音") || compact.includes("快手")) {
      addScore("9:16", 4);
    } else if (compact.includes("书") || compact.includes("杂志") || compact.includes("小说")) {
      addScore("2:3", 4);
    }
  }
  if (compact.includes("电商") || compact.includes("商品")) {
    if (compact.includes("主图")) {
      addScore("1:1", 5);
    }
    if (compact.includes("详情")) {
      addScore("5:4", 3);
      addScore("9:16", 2);
    }
  }
  if (compact.includes("菜单") || compact.includes("价目表") || compact.includes("节目单") || compact.includes("a4") || compact.includes("传单")) {
    addScore("3:4", 4);
  }
  if (compact.includes("证件照")) {
    addScore("3:4", 5);
  }
  if (compact.includes("书籍") || compact.includes("小说") || compact.includes("杂志")) {
    if (compact.includes("封面")) {
      addScore("2:3", 5);
    }
    if (compact.includes("内页")) {
      addScore("3:4", 4);
    }
  }
  if (compact.includes("摄影") || compact.includes("相机")) {
    if (compact.includes("横图")) {
      addScore("3:2", 5);
    }
    if (compact.includes("竖图")) {
      addScore("2:3", 5);
    }
  }
  if (compact.includes("超宽") || compact.includes("全景") || compact.includes("电影感")) {
    addScore("21:9", 4);
  }

  // 冲突裁决：当平台场景和通用物料词混用时，优先采用更具体的平台目标比例。
  if (hasAny(["小红书"]) && hasAny(["封面", "笔记"])) {
    addScore("4:5", 8);
  }
  if (hasAny(["抖音", "快手", "视频号"]) && hasAny(["封面", "预告", "直播间", "直播带货"])) {
    addScore("9:16", 8);
  }
  if (hasAny(["公众号", "微信文章"]) && hasAny(["头图", "首图", "封面"])) {
    addScore("16:9", 8);
  }
  if (hasAny(["b站", "bilibili", "youtube"]) && hasAny(["封面", "缩略图"])) {
    addScore("16:9", 8);
  }
  if (hasAny(["淘宝", "天猫", "京东", "拼多多", "亚马逊"]) && hasAny(["主图", "白底图"])) {
    addScore("1:1", 8);
  }
  if (hasAny(["淘宝", "天猫", "京东", "拼多多"]) && hasAny(["详情", "长图", "长页"])) {
    addScore("9:16", 7);
  }
  if (hasAny(["亚马逊"]) && hasAny(["详情", "展示图"])) {
    addScore("5:4", 7);
  }
  if (hasAny(["海报"]) && hasAny(["小红书", "笔记"])) {
    addScore("4:5", 5);
  }
  if (hasAny(["海报"]) && hasAny(["抖音", "快手", "视频号", "手机尺寸"])) {
    addScore("9:16", 5);
  }
  if (hasAny(["海报"]) && hasAny(["公众号", "微信文章", "头图", "首图"])) {
    addScore("16:9", 5);
  }
  if (hasAny(["横版海报", "横版封面", "横版kv"])) {
    addScore("16:9", 6);
  }
  if (hasAny(["竖版海报", "宣传单页", "易拉宝", "a4海报"])) {
    addScore("3:4", 6);
  }
  if (hasAny(["书籍", "小说", "杂志"]) && hasAny(["封面", "海报"])) {
    addScore("2:3", 6);
  }

  let bestRatio = "1:1";
  let bestScore = 0;
  for (const candidate of ASPECT_RATIO_CANDIDATES) {
    const score = scores.get(candidate.value) || 0;
    if (score > bestScore) {
      bestRatio = candidate.value;
      bestScore = score;
      continue;
    }
    if (score === bestScore && bestScore > 0) {
      const tieBreakerOrder = ["9:16", "4:5", "16:9", "3:4", "1:1", "5:4", "2:3", "3:2", "4:3", "21:9"];
      if (tieBreakerOrder.indexOf(candidate.value) < tieBreakerOrder.indexOf(bestRatio)) {
        bestRatio = candidate.value;
      }
    }
  }

  if (bestScore > 0) {
    return bestRatio;
  }

  return "1:1";
}

/** 从提示词推测要出几张（如「三套」「3张」），与侧栏张数取较大值，上限 MAX_GEN_COUNT */
function inferLoopCountFromPrompt(text) {
  if (!text || typeof text !== "string") return 0;
  const compact = text.replace(/\s/g, "");
  let best = 0;
  const cnRe = /([0-9]{1,2}|[一二三四五六七八九十两]+)\s*(个)?\s*(套|张|款|组|幅|种|版|次|方案|版本|结果|风格)/g;
  let m;
  while ((m = cnRe.exec(compact)) !== null) {
    const n = parseQuantityToken(m[1]);
    const capped = Math.min(n, MAX_GEN_COUNT);
    if (capped >= 1) best = Math.max(best, capped);
  }
  const enRe = /\b([1-9])\s*(sets?|variants?|images?|pics?|results?|versions?|options?)\b/gi;
  let m2;
  while ((m2 = enRe.exec(text)) !== null) {
    const n = parseInt(m2[1], 10);
    if (n >= 1 && n <= MAX_GEN_COUNT) best = Math.max(best, n);
  }
  return best;
}

const STYLE_VARIANTS = ["极简清爽", "街头潮流", "科技未来", "复古海报", "手作拼贴", "高级时装"];
const MATERIAL_VARIANTS = ["纸张印刷肌理", "丝网印刷颗粒肌理", "蜡笔粉彩肌理", "塑料玩具质感", "绒面织物质感", "金属涂层质感"];
const COLOR_VARIANTS = ["高明度糖果配色", "低饱和莫兰迪配色", "高对比撞色配色", "暖色主导配色", "冷色主导配色", "黑白点缀配色"];
const LAYOUT_VARIANTS = ["居中主体构图", "偏左留白构图", "偏右留白构图", "近景特写构图", "中景平衡构图", "竖向海报构图"];
const GENERAL_VARIANTS = ["方案A：简洁干净", "方案B：细节丰富", "方案C：高对比醒目", "方案D：更时尚现代", "方案E：更活泼有趣", "方案F：更高级克制"];

function getVariantDescriptors(text, count) {
  if (count <= 1) return [];
  const compact = String(text || "").replace(/\s/g, "");
  let pool = GENERAL_VARIANTS;
  if (/材质|纹理|肌理|质感/.test(compact)) {
    pool = MATERIAL_VARIANTS;
  } else if (/配色|色系|颜色/.test(compact)) {
    pool = COLOR_VARIANTS;
  } else if (/构图|视角|机位|角度/.test(compact)) {
    pool = LAYOUT_VARIANTS;
  } else if (/风格/.test(compact)) {
    pool = STYLE_VARIANTS;
  } else if (/类型|版本|方案|结果/.test(compact)) {
    pool = GENERAL_VARIANTS;
  }

  return Array.from({ length: count }, (_, index) => pool[index % pool.length]);
}

function buildSingleResultPrompt(text, count, index = 0, variantDescriptor = "") {
  if (!text || count <= 1) return text;

  const cleaned = text
    .replace(/([给来做出整搞生成产出做成改成变成弄搞要请帮]*)\s*([0-9]{1,2}|[一二三四五六七八九十两]+)\s*(个)?\s*(套|张|款|组|幅|种|版|次|变|方案|版本|结果|风格)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const basePrompt = cleaned || text;
  return `${basePrompt}

本次变体方向：${variantDescriptor || `第 ${index + 1} 个独立方案`}

要求：
1. 本次请求只生成 1 个独立结果，不要在同一张图里放入多组、多套、多款、多版本或并排重复内容。
2. 这是第 ${index + 1} / ${count} 个结果，需要与其它结果保持明显差异，不要只是轻微改动。
3. 如果用户原本表达的是两组、三套、多个方案，含义是生成多张彼此不同的独立图片，而不是把它们拼进同一画面。
4. 单主体，单类型，单画面。no collage, no multiple subjects, no split layout, no duplicated objects.`;
}

function buildAgentPrompt(text, refImages = []) {
  const basePrompt = String(text || "").trim();
  if (!refImages.length) {
    return basePrompt;
  }

  return `${basePrompt}

Agent mode hidden instructions:
- Treat the provided reference image(s) as the primary grounding.
- keep composition
- keep lighting
- keep aspect ratio
- keep camera angle, framing, perspective, and scene layout
- keep subject identity, key shapes, proportions, and object relationships
- do not crop, zoom, rotate, or rearrange the scene unless the user explicitly asks for it
- only change the parts that are explicitly requested by the user
- if multiple reference images are provided, use the first image as the main composition and aspect-ratio anchor`;
}

function resolveAgentParams(baseParams, promptText, refImages = []) {
  const compactText = String(promptText || "").replace(/\s+/g, "");
  const needsHighFidelity = /海报|poster|品牌|branding|logo|字体|排版|版式|产品图|电商|包装|KV|banner|高清|高细节|细节/.test(compactText);

  return {
    ...baseParams,
    model: needsHighFidelity ? "gemini-3-pro-image-preview" : AGENT_DEFAULT_MODEL,
    image_size: refImages.length > 0 ? "auto" : "1:1",
    num: 1,
    service_tier: AGENT_DEFAULT_SERVICE_TIER,
  };
}

function parseAspectRatio(imageSize) {
  if (!imageSize || imageSize === "auto") return 1;
  const normalized = String(imageSize).trim().toLowerCase();
  const separator = normalized.includes("x") ? "x" : ":";
  const [w, h] = normalized.split(separator).map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  return w / h;
}

const REQUEST_TIMEOUT_MS = 90000;
const IMAGE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const GPT_IMAGE_2_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const VIDEO_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const GENERATION_STALE_MS = IMAGE_REQUEST_TIMEOUT_MS + 30 * 1000;
const VIDEO_GENERATION_STALE_MS = VIDEO_REQUEST_TIMEOUT_MS + 30 * 1000;
const GENERATION_RECOVERY_POLL_MS = 2000;
const GENERATION_RECOVERY_MAX_ATTEMPTS = Math.ceil((12 * 60 * 1000) / GENERATION_RECOVERY_POLL_MS);
const MAX_PARALLEL_GENERATIONS = 1;
const STORAGE_VERSION = "9";
const DEFAULT_CONVERSATION_TITLE = "新建对话";
const DEFAULT_CANVAS_BOARD_TITLE = "未命名画布";
const TEXT_EDIT_ENABLED = false;
const POINT_IMAGE_EDIT_ENABLED = false;
const VALID_SERVICE_TIERS = new Set(["default", "priority"]);
const DEFAULT_COMPOSER_MODE = "agent";
const DEFAULT_ENTRY_MODE = "agent";
const AGENT_DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const AGENT_DEFAULT_SERVICE_TIER = "priority";

function createConversation(overrides = {}) {
  const now = Date.now();
  return {
    id: overrides.id || `conv-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title || DEFAULT_CONVERSATION_TITLE,
    messages: overrides.messages || [],
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

function createCanvasBoard(overrides = {}) {
  const now = Date.now();
  return {
    id: overrides.id || `board-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title || DEFAULT_CANVAS_BOARD_TITLE,
    images: Array.isArray(overrides.images) ? overrides.images : [],
    texts: Array.isArray(overrides.texts) ? overrides.texts : [],
    shapes: Array.isArray(overrides.shapes) ? overrides.shapes : [],
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

function createClientRequestId(prefix = "canvas") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function deriveConversationTitle(currentTitle, messages) {
  const firstUserMessage = messages.find((msg) => msg.role === "user" && msg.text?.trim());
  if (firstUserMessage?.text) {
    const normalized = firstUserMessage.text.replace(/\s+/g, " ").trim();
    return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized;
  }
  return currentTitle || DEFAULT_CONVERSATION_TITLE;
}

async function makeMessagePreviewImage(img) {
  if (typeof img !== "string") {
    return img;
  }

  if (/^https?:\/\//i.test(img)) {
    return img;
  }

  if (/^data:image\//i.test(img)) {
    return compressImage(img, 160, 0.5);
  }

  return img;
}

function sanitizeStoredImageList(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return images;
  }

  return images.map((img) => {
    if (typeof img !== "string") {
      return img;
    }

    if (/^https?:\/\//i.test(img)) {
      return img;
    }

    if (/^data:image\//i.test(img)) {
      // Prevent localStorage from being filled with large base64 strings.
      return "";
    }

    return img;
  }).filter(Boolean);
}

async function uploadDataUrlToCloudAsset(dataUrl, filename = "image", scope = "canvas") {
  if (typeof dataUrl !== "string" || !/^data:image\//i.test(dataUrl)) return dataUrl;
  const res = await fetch("/api/cloud-assets/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, filename, scope }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.url) {
    throw new Error(data?.error || "上传云端素材失败");
  }
  return data.url;
}

function detectRefImageMeta(src) {
  return new Promise((resolve) => {
    if (!src || typeof src !== "string") {
      resolve({ ratio: "1:1", width: 0, height: 0, dimensionsLabel: "" });
      return;
    }

    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      const candidates = [
        [1, 1], [16, 9], [9, 16], [4, 3], [3, 4],
        [3, 2], [2, 3], [2, 1], [1, 2], [4, 5], [5, 4],
        [21, 9], [1, 4], [4, 1], [8, 1], [1, 8],
      ];
      let ratio = "1:1";
      let minDiff = Infinity;
      const currentRatio = width > 0 && height > 0 ? width / height : 1;

      for (const [w, h] of candidates) {
        const diff = Math.abs(currentRatio - w / h);
        if (diff < minDiff) {
          minDiff = diff;
          ratio = `${w}:${h}`;
        }
      }

      resolve({
        ratio,
        width,
        height,
        dimensionsLabel: width > 0 && height > 0 ? `${width} × ${height}` : "",
      });
    };
    img.onerror = () => resolve({ ratio: "1:1", width: 0, height: 0, dimensionsLabel: "" });
    img.src = src;
  });
}

function isPersistableMediaUrl(url) {
  return typeof url === "string" && (
    /^https?:\/\//i.test(url) ||
    /^\/api\/generated-images\//i.test(url) ||
    /^\/api\/cloud-assets\//i.test(url)
  );
}

function sanitizeUrlList(urls) {
  if (!Array.isArray(urls)) return [];
  return urls.filter(isPersistableMediaUrl);
}

function sanitizeMessagesForStorage(messages) {
  return messages.slice(0, 200).map((msg) => {
    return {
      ...msg,
      refImages: sanitizeStoredImageList(msg.refImages),
      requestRefImages: sanitizeStoredImageList(msg.requestRefImages),
      // 只保留 HTTPS URL，base64 生成图不存入 localStorage（太大会溢出）
      urls: sanitizeUrlList(msg.urls),
      tasks: Array.isArray(msg.tasks)
        ? msg.tasks.map((t) => ({ ...t, url: isPersistableMediaUrl(t.url) ? t.url : null }))
        : msg.tasks,
    };
  });
}

function restoreInterruptedMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((msg) => {
    if (msg?.status !== "generating") return msg;
    const tasks = Array.isArray(msg.tasks)
      ? msg.tasks.map((task) => (
        task?.status === "completed"
          ? task
          : { ...task, status: "failed", error: "生成连接已中断，请重试。" }
      ))
      : msg.tasks;
    const urls = Array.isArray(tasks) ? tasks.filter((task) => task?.url).map((task) => task.url) : msg.urls;
    return {
      ...msg,
      status: Array.isArray(tasks) && tasks.some((task) => task?.status === "completed") ? "completed" : "failed",
      tasks,
      urls,
      error: "生成连接已中断，请重试。",
    };
  });
}

function sanitizeConversationsForStorage(conversations) {
  return conversations.slice(0, 50).map((conversation) => ({
    ...conversation,
    messages: sanitizeMessagesForStorage(conversation.messages || []),
  }));
}

function safeParseStorageArray(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeCanvasImagesForStorage(items) {
  if (!Array.isArray(items)) return [];
  // base64 图片/视频太大，只保留可重新访问的远程或站内生成图链接。
  return items.filter((item) => item && isPersistableMediaUrl(item.image_url));
}

function sanitizeCanvasBoardsForStorage(boards) {
  if (!Array.isArray(boards)) return [];
  return boards.slice(0, 30).map((board) => ({
    ...board,
    title: board?.title || DEFAULT_CANVAS_BOARD_TITLE,
    images: sanitizeCanvasImagesForStorage(board?.images || []).slice(0, 100),
    texts: Array.isArray(board?.texts) ? board.texts.slice(0, 100) : [],
    shapes: Array.isArray(board?.shapes) ? board.shapes.slice(0, 200) : [],
  }));
}

function normalizeCanvasBoards(boards) {
  if (!Array.isArray(boards) || boards.length === 0) return [];
  return boards.map((board) => createCanvasBoard(board));
}

async function parseApiResponse(res) {
  const rawText = await res.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    if (/inactivity timeout/i.test(rawText)) {
      return {
        error: "生成超时。Netlify 免费函数等待时间有限，请优先尝试 512px 或 1K 模型后重试。",
      };
    }

    if (/^\s*</.test(rawText)) {
      return {
        error: "服务暂时返回了错误页，通常是部署平台超时或上游接口异常，请稍后重试。",
      };
    }

    return {
      error: `接口返回了非 JSON 内容：${rawText.slice(0, 120)}`,
    };
  }
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const timeoutController = new AbortController();
  const timer = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  const externalSignal = options?.signal;

  const cleanup = () => {
    window.clearTimeout(timer);
  };

  const handleExternalAbort = () => timeoutController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      timeoutController.abort();
    } else {
      externalSignal.addEventListener("abort", handleExternalAbort, { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...options,
      signal: timeoutController.signal,
    });
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener("abort", handleExternalAbort);
    }
    cleanup();
  }
}

function shouldAttemptGenerationRecovery(error) {
  if (!error || error.noRecovery) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("fetch")
    || message.includes("network")
    || message.includes("connection")
    || message.includes("timeout")
    || message.includes("请求超时")
    || message.includes("请求等待时间过长")
  );
}

async function recoverGenerationResult(clientRequestId) {
  if (!clientRequestId) return null;
  for (let attempt = 0; attempt < GENERATION_RECOVERY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`/api/generation-results/${encodeURIComponent(clientRequestId)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.success && Array.isArray(data?.data?.urls) && data.data.urls.length > 0) {
          return data;
        }
      }
      if (res.status !== 202) return null;
    } catch {}
    await new Promise((resolve) => window.setTimeout(resolve, GENERATION_RECOVERY_POLL_MS));
  }
  return null;
}

async function waitForRecoveredGenerationResult(clientRequestId) {
  const recovered = await recoverGenerationResult(clientRequestId);
  if (recovered) return { data: recovered, recovered: true };
  return new Promise(() => {});
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

const MODEL_LABELS = {
  "gemini-2.5-flash-image": "Nano Banana 1K",
  "gemini-2.5-flash-image-hd": "Nano Banana 1K HD",
  "gemini-3.1-flash-image-preview-512": "Nano Banana 2 512px",
  "gemini-3.1-flash-image-preview": "Nano Banana 2 1K",
  "gemini-3.1-flash-image-preview-2k": "Nano Banana 2 2K",
  "gemini-3.1-flash-image-preview-4k": "Nano Banana 2 4K",
  "gemini-3-pro-image-preview": "Pro 1K",
  "gemini-3-pro-image-preview-2k": "Pro 2K",
  "gemini-3-pro-image-preview-4k": "Pro 4K",
  "gpt-image-2": "GPT Image 2",
  "kling-v2-6": "Kling-V2-6 视频",
  "kling-v3": "Kling-V3 视频",
  "kling-v3-omni": "Kling-V3-Omni 视频",
};

const GPT_IMAGE_2_MODEL = "gpt-image-2";
const NANO_PRO_UPSCALE_MODEL = "gemini-3-pro-image-preview";
const KLING_VIDEO_MODELS = new Set(["kling-v2-6", "kling-v3", "kling-v3-omni"]);

function isKlingVideoModel(model) {
  const value = String(model || "").trim().toLowerCase();
  return KLING_VIDEO_MODELS.has(value) || value.startsWith("kling-video") || value.startsWith("kling-v");
}

function normalizeUpscaleRequest(request) {
  if (typeof request === "string") {
    return { provider: "image2", targetSize: request };
  }
  return {
    provider: request?.provider === "nano-pro" ? "nano-pro" : "image2",
    targetSize: String(request?.id || request?.targetSize || "2K").toUpperCase(),
  };
}

function resolveUpscaleModel(provider, targetSize) {
  return provider === "nano-pro" ? NANO_PRO_UPSCALE_MODEL : GPT_IMAGE_2_MODEL;
}

function getRefImageIdentity(image) {
  if (typeof image === "string") return image;
  return image?.src || image?.url || image?.dataUrl || image?.image_url || JSON.stringify(image || null);
}

function areSameRefImageList(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((image, index) => getRefImageIdentity(image) === getRefImageIdentity(right[index]));
}

function normalizeTextEditBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block?.text)
    .map((block, index) => {
      const bbox = block.bbox
        ? {
            x: Number(block.bbox.x || 0),
            y: Number(block.bbox.y || 0),
            w: Number(block.bbox.w || 0),
            h: Number(block.bbox.h || 0),
          }
        : null;
      const quad = Array.isArray(block.quad) && block.quad.length >= 4
        ? block.quad.map((point) => [Number(point?.[0] || 0), Number(point?.[1] || 0)])
        : bbox
          ? [
              [bbox.x, bbox.y],
              [bbox.x + bbox.w, bbox.y],
              [bbox.x + bbox.w, bbox.y + bbox.h],
              [bbox.x, bbox.y + bbox.h],
            ]
          : null;
      return {
        id: block.id || `ocr-${index}`,
        text: String(block.text || "").trim(),
        replacement: typeof block.replacement === "string" ? block.replacement : "",
        enabled: block.enabled !== false,
        bbox,
        quad,
        score: Number(block.score || 0),
        angle: Number(block.angle || 0),
        align: block.align || "center",
        font_path: block.font_path || null,
        font_size: block.font_size == null ? null : Number(block.font_size),
        font_weight: block.font_weight || "auto",
        style_name: block.style_name || "",
        fill: Array.isArray(block.fill) ? block.fill.map((value) => Number(value || 0)) : null,
        fill_confidence: Number(block.fill_confidence || 0),
        stroke_fill: Array.isArray(block.stroke_fill) ? block.stroke_fill.map((value) => Number(value || 0)) : null,
        stroke_confidence: Number(block.stroke_confidence || 0),
        stroke_width: Number(block.stroke_width || 0),
        shadow_fill: Array.isArray(block.shadow_fill) ? block.shadow_fill.map((value) => Number(value || 0)) : null,
        shadow_offset: Array.isArray(block.shadow_offset) ? block.shadow_offset.map((value) => Number(value || 0)) : null,
        line_boxes: Array.isArray(block.line_boxes) ? block.line_boxes : null,
        line_spacing: block.line_spacing == null ? null : Number(block.line_spacing),
        char_spacing: block.char_spacing == null ? null : Number(block.char_spacing),
        mask_box: block.mask_box || null,
        notes: block.notes || "",
      };
    })
    .filter((block) => block.text);
}

function getActiveTextReplacements(blocks = []) {
  return normalizeTextEditBlocks(blocks).filter((block) => {
    const replacement = String(block.replacement || "").trim();
    return block.enabled && replacement && replacement !== block.text;
  });
}

function buildTextEditPrompt(baseText, blocks = []) {
  const replacements = getActiveTextReplacements(blocks);
  if (replacements.length === 0) {
    return String(baseText || "").trim();
  }

  const header = String(baseText || "").trim()
    || "请编辑这张图中的文字，保留原有版式、字体风格、字号关系、颜色关系和整体视觉效果，只替换指定文案。";
  const instructions = replacements
    .map((block, index) => `${index + 1}. 将「${block.text}」替换为「${String(block.replacement).trim()}」`)
    .join("\n");

  return `${header}

已识别文字替换清单：
${instructions}

要求：
1. 仅修改以上指定文字，其它图形、背景、人物、装饰不要改动。
2. 尽量保持原有排版、对齐、字号层级、颜色风格与视觉权重。
3. 如果某段文字是多行排版，请继续保持合理换行。`;
}

function HomeInner() {
  const toast = useToast();
  const { theme, toggleTheme } = useTheme("dark");
  const initialConversationRef = useRef(createConversation());
  const [activeTool, setActiveTool] = useState("select");
  const [shapeMode, setShapeMode] = useState("rect");
  const [zoom, setZoom] = useState(100);
  const [prompt, setPrompt] = useState("");
  const [refImages, setRefImages] = useState([]);
  const [textEditBlocks, setTextEditBlocks] = useState([]);
  const [textEditPanelVisible, setTextEditPanelVisible] = useState(false);
  const [entryMode, setEntryMode] = useState(DEFAULT_ENTRY_MODE);
  const [composerMode, setComposerMode] = useState(DEFAULT_COMPOSER_MODE);
  const [params, setParams] = useState({
    model: "gemini-3.1-flash-image-preview-512",
    image_size: "1:1",
    num: 1,
    service_tier: "priority",
  });
  const setParamsClamped = useCallback((next) => {
    setParams((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      if (!resolved || typeof resolved !== "object") return resolved;
      const raw = resolved.num ?? prev.num ?? 1;
      const num = Math.min(MAX_GEN_COUNT, Math.max(1, Number(raw) || 1));
      const requestedServiceTier = String(
        resolved.service_tier ?? prev.service_tier ?? "priority"
      ).trim().toLowerCase();
      const service_tier = VALID_SERVICE_TIERS.has(requestedServiceTier)
        ? requestedServiceTier
        : "priority";
      return { ...resolved, num, service_tier };
    });
  }, []);
  const [showParams, setShowParams] = useState(false);
  const [conversations, setConversations] = useState([initialConversationRef.current]);
  const [activeConversationId, setActiveConversationId] = useState(initialConversationRef.current.id);
  const initialCanvasBoardRef = useRef(createCanvasBoard({ title: "默认画布" }));
  const [canvasBoards, setCanvasBoards] = useState([initialCanvasBoardRef.current]);
  const [activeCanvasBoardId, setActiveCanvasBoardId] = useState(initialCanvasBoardRef.current.id);
  const canvasHistory = useHistory([]);
  const canvasImages = canvasHistory.state;
  const [canvasGeneratingItems, setCanvasGeneratingItems] = useState([]);
  const canvasTextsHistory = useHistory([]);
  const canvasTexts = canvasTextsHistory.state;
  const canvasShapesHistory = useHistory([]);
  const canvasShapes = canvasShapesHistory.state;
  const [semanticSelection, setSemanticSelection] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedImageRect, setSelectedImageRect] = useState(null);
  const [activeGenerationCount, setActiveGenerationCount] = useState(0);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [panelWidth, setPanelWidth] = useState(340);
  const [isInspirationMode, setIsInspirationMode] = useState(false);
  const [inspirationUrl, setInspirationUrl] = useState("");
  const [activeInspirationUrl, setActiveInspirationUrl] = useState("");
  const [inspirationPanelWidth, setInspirationPanelWidth] = useState(380);
  const [isInspirationResizing, setIsInspirationResizing] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const canvasRef = useRef(null);
  const generationAbortRef = useRef(null);
  const activeGenerationRef = useRef(null);
  const inspirationResizeFrameRef = useRef(0);
  // 标记 localStorage 已加载完毕，加载前禁止持久化 effect 写入（避免覆盖已保存的数据）
  const persistReadyRef = useRef(false);
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0];
  useAuthSessionGuard();
  useCloudLocalStorageSync(CANVAS_CLOUD_STATE_KEYS, { overwriteOnFirstRestore: true });
  const activeCanvasBoard = canvasBoards.find((board) => board.id === activeCanvasBoardId) || canvasBoards[0];
  const messages = activeConversation?.messages || [];
  const isGenerating = activeGenerationCount > 0;
  const isBusy = isTextEditing;
  const isNavigationBusy = isGenerating || isTextEditing;
  const canSubmit = !isTextEditing && Boolean(String(prompt || "").trim() || getActiveTextReplacements(textEditBlocks).length > 0);
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const floatingTextPanelWidth = 280;
  const floatingTextPanelStyle = TEXT_EDIT_ENABLED && selectedImageRect && textEditPanelVisible && textEditBlocks.length > 0
    ? (() => {
        const gap = 16;
        const canvasRightLimit = Math.max(24, viewportWidth - panelWidth - 24);
        let left = selectedImageRect.right + gap;
        if (left + floatingTextPanelWidth > canvasRightLimit) {
          left = Math.max(24, selectedImageRect.left - floatingTextPanelWidth - gap);
        }
        const top = Math.min(
          Math.max(88, selectedImageRect.top + 4),
          Math.max(88, viewportHeight - 420)
        );
        return { left, top, width: floatingTextPanelWidth };
      })()
    : null;
  const historyMessages = conversations.flatMap((conversation) =>
    (conversation.messages || []).map((message) => ({
      ...message,
      _conversationId: conversation.id,
    }))
  );

  // Load from localStorage
  useEffect(() => {
    try {
      const ver = localStorage.getItem("lovart-version");
      if (ver !== STORAGE_VERSION) {
        const legacyMessages = localStorage.getItem("lovart-messages");
        localStorage.setItem("lovart-version", STORAGE_VERSION);
        if (legacyMessages && !localStorage.getItem("lovart-conversations")) {
          const parsedMessages = safeParseStorageArray(legacyMessages) || [];
          const migratedConversation = createConversation({
            title: deriveConversationTitle(DEFAULT_CONVERSATION_TITLE, parsedMessages),
            messages: parsedMessages,
          });
          setConversations([migratedConversation]);
          setActiveConversationId(migratedConversation.id);
          localStorage.removeItem("lovart-messages");
        }
      }
      const saved = localStorage.getItem("lovart-conversations");
      const savedActiveConversationId = localStorage.getItem("lovart-active-conversation");
      const savedImages = localStorage.getItem("lovart-canvas-images");
      const savedTexts = localStorage.getItem("lovart-canvas-texts");
      const savedShapes = localStorage.getItem("lovart-canvas-shapes");
      const savedBoards = localStorage.getItem("lovart-canvas-boards");
      const savedActiveBoardId = localStorage.getItem("lovart-active-canvas-board");
      const parsedConversations = safeParseStorageArray(saved);
      if (parsedConversations?.length > 0) {
        setConversations(parsedConversations.map((conversation) => ({
          ...conversation,
          messages: restoreInterruptedMessages(conversation.messages || []),
        })));
        setActiveConversationId(
          parsedConversations.some((conversation) => conversation.id === savedActiveConversationId)
            ? savedActiveConversationId
            : parsedConversations[0].id
        );
      }

      const parsedImages = safeParseStorageArray(savedImages);
      if (parsedImages) canvasHistory.setState(parsedImages);

      const parsedTexts = safeParseStorageArray(savedTexts);
      if (parsedTexts) canvasTextsHistory.setState(parsedTexts);

      const parsedShapes = safeParseStorageArray(savedShapes);
      if (parsedShapes) canvasShapesHistory.setState(parsedShapes);

      const parsedBoards = normalizeCanvasBoards(safeParseStorageArray(savedBoards));
      if (parsedBoards.length > 0) {
        const nextActiveBoard = parsedBoards.find((board) => board.id === savedActiveBoardId) || parsedBoards[0];
        setCanvasBoards(parsedBoards);
        setActiveCanvasBoardId(nextActiveBoard.id);
        canvasHistory.setState(nextActiveBoard.images || []);
        canvasTextsHistory.setState(nextActiveBoard.texts || []);
        canvasShapesHistory.setState(nextActiveBoard.shapes || []);
      } else {
        const migratedBoard = createCanvasBoard({
          id: initialCanvasBoardRef.current.id,
          title: "默认画布",
          images: parsedImages || [],
          texts: parsedTexts || [],
          shapes: parsedShapes || [],
          createdAt: initialCanvasBoardRef.current.createdAt,
          updatedAt: Date.now(),
        });
        setCanvasBoards([migratedBoard]);
        setActiveCanvasBoardId(migratedBoard.id);
      }
    } catch {
      // 读取失败时保留旧数据，避免一次异常把历史记录清空。
    } finally {
      // 无论成功或失败，标记加载完成，之后的持久化 effect 才允许写入
      persistReadyRef.current = true;
    }
  }, []);

  useEffect(() => {
    try {
      const rawDraft = localStorage.getItem(FLOATING_ENTRY_DRAFT_KEY);
      if (!rawDraft) return;
      const draft = JSON.parse(rawDraft);
      if (draft?.prompt) {
        setPrompt(String(draft.prompt));
      }
      if (draft?.entryMode === "agent" || draft?.entryMode === "quick") {
        setEntryMode(draft.entryMode);
      }
      if (Array.isArray(draft?.images) && draft.images.length > 0) {
        setRefImages(draft.images.filter((item) => typeof item === "string" && item));
      }
      localStorage.removeItem(FLOATING_ENTRY_DRAFT_KEY);
    } catch {}
  }, []);

  useEffect(() => {
    if (!activeConversationId && conversations[0]?.id) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversationId, conversations]);

  useEffect(() => {
    if (!canvasGeneratingItems.length) return undefined;

    const clearStaleGeneratingItems = () => {
      const now = Date.now();
      const staleItems = canvasGeneratingItems.filter((item) => {
        if (!item?.isGeneratingPlaceholder || !item?.createdAt) return false;
        const staleMs = item.requestTimeoutMs
          ? item.requestTimeoutMs + 30 * 1000
          : item.mediaType === "video"
            ? VIDEO_GENERATION_STALE_MS
            : GENERATION_STALE_MS;
        return now - item.createdAt > staleMs;
      });
      if (!staleItems.length) return;

      const staleItemIds = new Set(staleItems.map((item) => item.id));
      const staleTaskIdsByMessage = staleItems.reduce((acc, item) => {
        if (!item.aiMsgId || !item.taskId) return acc;
        if (!acc.has(item.aiMsgId)) acc.set(item.aiMsgId, new Set());
        acc.get(item.aiMsgId).add(item.taskId);
        return acc;
      }, new Map());

      setCanvasGeneratingItems((prev) => prev.filter((item) => !staleItemIds.has(item.id)));
      setConversations((prev) => prev.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((msg) => {
          const staleTaskIds = staleTaskIdsByMessage.get(msg.id);
          if (!staleTaskIds) return msg;
          const tasks = Array.isArray(msg.tasks)
            ? msg.tasks.map((task) => (
              staleTaskIds.has(task.id) && task.status !== "completed"
                ? { ...task, status: "failed", error: "生成连接已中断，请重试。" }
                : task
            ))
            : msg.tasks;
          const hasCompleted = Array.isArray(tasks) && tasks.some((task) => task?.status === "completed");
          const hasPending = Array.isArray(tasks) && tasks.some((task) => ["pending", "generating"].includes(task?.status));
          const urls = Array.isArray(tasks) ? tasks.filter((task) => task?.url).map((task) => task.url) : msg.urls;
          return {
            ...msg,
            tasks,
            urls,
            status: hasPending ? msg.status : hasCompleted ? "completed" : "failed",
            error: hasPending || hasCompleted ? null : "生成连接已中断，请重试。",
          };
        }),
      })));

      const activeAiMsgId = activeGenerationRef.current?.aiMsgId;
      if (activeAiMsgId && staleTaskIdsByMessage.has(activeAiMsgId)) {
        activeGenerationRef.current?.controller?.abort();
        activeGenerationRef.current = null;
        generationAbortRef.current = null;
        setActiveGenerationCount((value) => Math.max(0, value - 1));
      }
    };

    clearStaleGeneratingItems();
    const interval = window.setInterval(clearStaleGeneratingItems, 15000);
    return () => window.clearInterval(interval);
  }, [canvasGeneratingItems]);

  // Persist conversations
  useEffect(() => {
    if (!persistReadyRef.current) return;
    try {
      localStorage.setItem("lovart-conversations", JSON.stringify(sanitizeConversationsForStorage(conversations)));
      localStorage.setItem("lovart-active-conversation", activeConversationId || "");
    } catch {
      // 写入失败多半是容量超限；保留上一次可用历史，不主动清空。
    }
  }, [activeConversationId, conversations]);

  useEffect(() => {
    let cancelled = false;
    const firstRefImage = refImages?.[0];

    if (!firstRefImage) {
      setParamsClamped((prev) => ({
        ...prev,
        _autoRatio: undefined,
        _autoDimensions: undefined,
        _autoWidth: undefined,
        _autoHeight: undefined,
      }));
      return undefined;
    }

    void detectRefImageMeta(firstRefImage).then((meta) => {
      if (cancelled) return;
      setParamsClamped((prev) => ({
        ...prev,
        image_size: "auto",
        _autoRatio: meta.ratio,
        _autoDimensions: meta.dimensionsLabel || undefined,
        _autoWidth: meta.width || undefined,
        _autoHeight: meta.height || undefined,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [refImages, setParamsClamped]);

  useEffect(() => {
    if ((refImages?.length || 0) > 0) return;
    setTextEditBlocks([]);
  }, [refImages]);

  useEffect(() => {
    if (!persistReadyRef.current || !activeCanvasBoardId) return;
    setCanvasBoards((prev) => prev.map((board) => (
      board.id === activeCanvasBoardId
        ? {
            ...board,
            images: canvasImages,
            texts: canvasTexts,
            shapes: canvasShapes,
            updatedAt: Date.now(),
          }
        : board
    )));
  }, [activeCanvasBoardId, canvasImages, canvasTexts, canvasShapes]);

  useEffect(() => {
    if (!persistReadyRef.current) return;
    try {
      localStorage.setItem("lovart-canvas-boards", JSON.stringify(sanitizeCanvasBoardsForStorage(canvasBoards)));
      localStorage.setItem("lovart-active-canvas-board", activeCanvasBoardId || "");
    } catch {
      // 多画布同样遵循原有策略：写入失败时保留上一次可用数据。
    }
  }, [activeCanvasBoardId, canvasBoards]);

  // Persist canvas images
  useEffect(() => {
    if (!persistReadyRef.current) return;
    try {
      localStorage.setItem("lovart-canvas-images", JSON.stringify(sanitizeCanvasImagesForStorage(canvasImages).slice(0, 100)));
    } catch {
      // 保留上一次可用画布，避免刷新后整页变空。
    }
  }, [canvasImages]);

  useEffect(() => {
    if (!persistReadyRef.current) return;
    try {
      localStorage.setItem("lovart-canvas-texts", JSON.stringify(canvasTexts.slice(0, 100)));
    } catch {
      // 保留上一次可用文本数据。
    }
  }, [canvasTexts]);

  useEffect(() => {
    if (!persistReadyRef.current) return;
    try {
      localStorage.setItem("lovart-canvas-shapes", JSON.stringify(canvasShapes.slice(0, 200)));
    } catch {
      // 保留上一次可用形状数据。
    }
  }, [canvasShapes]);

  const handleAddCanvasText = useCallback((item) => {
    canvasTextsHistory.push((prev) => [...prev, item]);
  }, [canvasTextsHistory]);

  const handleUpdateCanvasText = useCallback((id, patch) => {
    canvasTextsHistory.push((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }, [canvasTextsHistory]);

  const handleDeleteCanvasText = useCallback((id) => {
    const item = canvasTexts.find((t) => t.id === id);
    canvasTextsHistory.push((prev) => prev.filter((t) => t.id !== id));
    if (String(item?.text || "").trim() && !item?.isDraft) {
      toast("已删除文案", "info", 1200);
    }
  }, [canvasTexts, canvasTextsHistory, toast]);

  const handleAddCanvasShape = useCallback((item) => {
    canvasShapesHistory.push((prev) => [...prev, item]);
  }, [canvasShapesHistory]);

  const handleUpdateCanvasShape = useCallback((id, patch) => {
    canvasShapesHistory.push((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  }, [canvasShapesHistory]);

  const handleDeleteCanvasShape = useCallback((id) => {
    canvasShapesHistory.push((prev) => prev.filter((s) => s.id !== id));
    toast("已删除形状", "info", 1200);
  }, [canvasShapesHistory, toast]);

  const updateConversationMessages = useCallback((conversationId, updater) => {
    setConversations((prev) => prev.map((conversation) => {
      if (conversation.id !== conversationId) {
        return conversation;
      }
      const nextMessages = typeof updater === "function"
        ? updater(conversation.messages || [])
        : updater;
      return {
        ...conversation,
        messages: nextMessages,
        title: deriveConversationTitle(conversation.title, nextMessages),
        updatedAt: Date.now(),
      };
    }));
  }, []);

  const updateMessage = useCallback((conversationId, messageId, updates) => {
    updateConversationMessages(conversationId, (prev) =>
      prev.map((message) => (message.id === messageId ? { ...message, ...updates } : message))
    );
  }, [updateConversationMessages]);

  const patchTask = useCallback((conversationId, aiMsgId, taskId, patch) => {
    updateConversationMessages(conversationId, (prev) =>
      prev.map((m) => {
        if (m.id !== aiMsgId || !m.tasks) return m;
        const tasks = m.tasks.map((t) =>
          t.id === taskId ? { ...t, ...patch } : t
        );
        const urls = tasks.filter((t) => t.url).map((t) => t.url);
        return { ...m, tasks, urls };
      })
    );
  }, [updateConversationMessages]);

  const resetComposer = useCallback(() => {
    setPrompt("");
    setRefImages([]);
    setTextEditBlocks([]);
    setTextEditPanelVisible(false);
    setShowParams(false);
    setSemanticSelection(null);
    setSelectedImage(null);
    canvasSelectionUrlsRef.current = [];
  }, []);

  const handleComposerModeChange = useCallback((nextMode) => {
    const resolvedMode = nextMode === "manual" ? "manual" : "agent";
    setComposerMode(resolvedMode);
    if (resolvedMode === "agent") {
      setShowParams(false);
    }
  }, []);

  const handleOpenInspirationUrl = useCallback(() => {
    const nextUrl = normalizeInspirationUrl(inspirationUrl);
    if (!nextUrl) return;
    setActiveInspirationUrl(nextUrl);
    setInspirationUrl(nextUrl);
  }, [inspirationUrl]);

  const handleInspirationResizeStart = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspirationPanelWidth;
    setIsInspirationResizing(true);

    const handlePointerMove = (moveEvent) => {
      const maxWidth = Math.min(window.innerWidth - panelWidth - 280, 1400);
      const nextWidth = Math.min(maxWidth, Math.max(220, startWidth + moveEvent.clientX - startX));
      if (inspirationResizeFrameRef.current) {
        window.cancelAnimationFrame(inspirationResizeFrameRef.current);
      }
      inspirationResizeFrameRef.current = window.requestAnimationFrame(() => {
        setInspirationPanelWidth(nextWidth);
        inspirationResizeFrameRef.current = 0;
      });
    };

    const handlePointerUp = () => {
      if (inspirationResizeFrameRef.current) {
        window.cancelAnimationFrame(inspirationResizeFrameRef.current);
        inspirationResizeFrameRef.current = 0;
      }
      setIsInspirationResizing(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [inspirationPanelWidth, panelWidth]);

  useEffect(() => {
    return () => {
      if (inspirationResizeFrameRef.current) {
        window.cancelAnimationFrame(inspirationResizeFrameRef.current);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const handleGenerate = useCallback(async (retryPayload = null) => {
    const sourceText = retryPayload?.text ?? prompt;
    const effectiveTextEditBlocks = retryPayload?.textEditBlocks || textEditBlocks;
    const composerText = String(sourceText || "").trim();
    const effectiveRefImages = retryPayload?.refImages || refImages;
    const effectiveSemanticSelection = retryPayload?.semanticSelection || semanticSelection;
    const activeEntryMode = retryPayload?.entryMode || entryMode;
    const requestedComposerMode = retryPayload?.composerMode || composerMode;
    const activeComposerMode = activeEntryMode === "quick" ? "agent" : requestedComposerMode;
    const baseText = buildTextEditPrompt(composerText, effectiveTextEditBlocks);
    const baseParams = retryPayload?.params || params;
    const effectiveParams = retryPayload?.disableAgentDefaults
      ? baseParams
      : activeComposerMode === "agent"
        ? resolveAgentParams(baseParams, composerText || baseText, effectiveRefImages)
        : baseParams;
    const text = activeComposerMode === "agent"
      ? buildAgentPrompt(baseText, effectiveRefImages)
      : baseText;
    const preserveComposer = Boolean(retryPayload?.preserveComposer);
    const hidePlaceholderPrompt = Boolean(retryPayload?.hidePlaceholderPrompt);
    const hideConversationMessages = Boolean(retryPayload?.hideConversationMessages);
    const editMode = retryPayload?.editMode || null;
    if (!text || !activeConversationId) return;

    if (
      POINT_IMAGE_EDIT_ENABLED
      && (
      effectiveSemanticSelection?.maskDataUrl
      && effectiveSemanticSelection?.imageUrl
      && !retryPayload?.disableSemanticEdit
      )
    ) {
      if (isTextEditing) return;
      const ts = Date.now();
      const conversationId = activeConversationId;
      const userMsgId = `user-object-edit-${ts}`;
      const aiMsgId = `ai-object-edit-${ts}`;
      const messageRefImages = await Promise.all(
        [effectiveSemanticSelection.imageUrl].map((img) => makeMessagePreviewImage(img))
      );
      const sharedParams = {
        ...effectiveParams,
        model: "object-mask-edit",
        image_size: "局部编辑",
        num: 1,
      };
      const userMsg = {
        id: userMsgId,
        role: "user",
        text: composerText,
        params: sharedParams,
        modelLabel: "SAM + GPT + Nano Edit",
        refImages: messageRefImages,
        requestRefImages: [effectiveSemanticSelection.imageUrl],
        semanticSelection: effectiveSemanticSelection,
        entryMode: activeEntryMode,
        composerMode: activeComposerMode,
      };
      const aiMsg = {
        id: aiMsgId,
        role: "assistant",
        text: composerText,
        params: sharedParams,
        modelLabel: "SAM + GPT + Nano Edit",
        status: "generating",
        urls: [],
        error: null,
        entryMode: activeEntryMode,
        composerMode: activeComposerMode,
      };
      updateConversationMessages(conversationId, (prev) => [...prev, userMsg, aiMsg]);
      setActiveGenerationCount((value) => value + 1);
      if (!preserveComposer) {
        setPrompt("");
      }

      try {
        const res = await fetchWithTimeout("/api/object-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: effectiveSemanticSelection.imageUrl,
            mask: effectiveSemanticSelection.maskDataUrl,
            prompt: composerText,
            selection: {
              bbox: effectiveSemanticSelection.bbox || null,
              point: effectiveSemanticSelection.point || null,
              image_size: effectiveSemanticSelection.imageSize || null,
              label: effectiveSemanticSelection.label || "",
              source_prompt: effectiveSemanticSelection.prompt || "",
              method: effectiveSemanticSelection.method || "",
            },
          }),
        }, 10 * 60 * 1000);
        const data = await parseApiResponse(res);
        if (!res.ok || data.error) {
          throw new Error(errStr(data.error || `局部编辑失败（${res.status}）`));
        }
        const urls = Array.isArray(data.data?.urls) ? data.data.urls.filter(Boolean) : [];
        if (urls.length === 0) {
          throw new Error("局部编辑未返回结果图片");
        }
        updateMessage(conversationId, aiMsgId, {
          status: "completed",
          urls,
          error: null,
        });
        canvasHistory.push((prev) => [
          ...prev,
          ...urls.map((url, index) => ({
            id: `${aiMsgId}-${index}`,
            image_url: url,
            prompt: composerText,
          })),
        ]);
        setSemanticSelection(null);
        toast(`局部编辑完成，${urls.length} 张结果已添加到画布`, "success", 2200);
      } catch (err) {
        updateMessage(conversationId, aiMsgId, {
          status: "failed",
          error: errStr(err),
        });
        toast(errStr(err) || "局部编辑失败", "info", 2200);
      } finally {
        setActiveGenerationCount((value) => Math.max(0, value - 1));
      }
      return;
    }

    const ts = Date.now();
    const conversationId = activeConversationId;
    const userMsgId = "user-" + ts;
    const aiMsgId = "ai-" + ts;
    const inferredQuickRatio = !effectiveRefImages.length && activeEntryMode === "quick"
      ? inferAspectRatioFromPrompt(composerText || text)
      : null;
    let resolvedParams = inferredQuickRatio
      ? {
          ...effectiveParams,
          image_size: inferredQuickRatio,
          _autoRatio: undefined,
          _autoDimensions: undefined,
          _autoWidth: undefined,
          _autoHeight: undefined,
        }
      : effectiveParams;
    const hasImages = effectiveRefImages.length > 0;
    if (hasImages && resolvedParams.image_size === "auto" && (!resolvedParams._autoRatio || !resolvedParams._autoWidth || !resolvedParams._autoHeight)) {
      const meta = await detectRefImageMeta(effectiveRefImages[0]);
      resolvedParams = {
        ...resolvedParams,
        _autoRatio: meta.ratio,
        _autoDimensions: meta.dimensionsLabel || resolvedParams._autoDimensions,
        _autoWidth: meta.width || resolvedParams._autoWidth,
        _autoHeight: meta.height || resolvedParams._autoHeight,
      };
    }
    const requestParams = resolvedParams;
    const isKlingVideoRequest = isKlingVideoModel(requestParams.model);
    const shouldUseEditApi = !isKlingVideoRequest && (Boolean(editMode) || hasImages);
    const modelLabel = MODEL_LABELS[requestParams.model] || requestParams.model;
    if (!isKlingVideoRequest && isTextEditing) return;

    const messageRefImages = hasImages
      ? await Promise.all(effectiveRefImages.map((img) => makeMessagePreviewImage(img)))
      : [];

    const inferred = inferLoopCountFromPrompt(composerText);
    const isEditLikeRequest = shouldUseEditApi;
    const requestedCount = isKlingVideoRequest
      ? 1
      : isEditLikeRequest
      ? (inferred || 1)
      : Math.max(effectiveParams.num || 1, inferred);
    const count = Math.min(
      Math.max(requestedCount, 1),
      MAX_GEN_COUNT
    );
    const variantDescriptors = getVariantDescriptors(composerText || text, count);
    const genParams = { ...requestParams, num: count };
    const displayText = composerText || "请按识别到的文本替换规则编辑图片中的文字";

    const userMsg = {
      id: userMsgId,
      role: "user",
      text: displayText,
      params: genParams,
      modelLabel,
      refImages: messageRefImages,
      requestRefImages: effectiveRefImages,
      textEditBlocks: effectiveTextEditBlocks,
      entryMode: activeEntryMode,
      composerMode: activeComposerMode,
    };
    const tasks = Array.from({ length: count }, (_, i) => ({
      id: `${aiMsgId}-task-${i}`,
      index: i,
      status: "pending",
      url: null,
      error: null,
    }));
    const aiMsg = {
      id: aiMsgId,
      role: "assistant",
      text: displayText,
      params: genParams,
      modelLabel,
      status: "generating",
      tasks,
      urls: [],
      mediaType: isKlingVideoRequest ? "video" : "image",
      error: null,
      entryMode: activeEntryMode,
      composerMode: activeComposerMode,
    };

    if (!hideConversationMessages) {
      updateConversationMessages(conversationId, (prev) => [...prev, userMsg, aiMsg]);
    }
    setActiveGenerationCount((value) => value + 1);
    if (!preserveComposer) {
      setPrompt("");
    }
    let generationState = null;
    try {
      const requestController = new AbortController();
      generationAbortRef.current = requestController;
      generationState = {
        conversationId,
        aiMsgId,
        controller: requestController,
        cancelled: false,
      };
      activeGenerationRef.current = generationState;
      const shouldCancelTaskForStaleGeneration = () =>
        generationState.cancelled;
      const preparedImages = await Promise.all(
        effectiveRefImages.map((img) => {
          if (typeof img !== "string") {
            return img;
          }
          if (/^https?:\/\//i.test(img)) {
            return img;
          }
          if (/^data:image\//i.test(img)) {
            return compressImage(img, 768, 0.68);
          }
          return img;
        })
      );

      const isGptImage2Request = requestParams.model === GPT_IMAGE_2_MODEL;
      const imageSize =
        requestParams.image_size === "auto"
          ? (isGptImage2Request
              ? computeGptImage2EditSize(requestParams._autoWidth, requestParams._autoHeight)
              : (requestParams._autoRatio || "1:1"))
          : requestParams.image_size;
      const placeholderAspectRatio = parseAspectRatio(
        requestParams.image_size === "auto"
          ? (requestParams._autoRatio || (isGptImage2Request ? "1:1" : imageSize))
          : imageSize
      );
      const imagePayload =
        preparedImages.length === 1 ? preparedImages[0] : preparedImages;
      const taskRequestTimeoutMs = isKlingVideoRequest
        ? VIDEO_REQUEST_TIMEOUT_MS
        : isGptImage2Request
          ? GPT_IMAGE_2_REQUEST_TIMEOUT_MS
          : IMAGE_REQUEST_TIMEOUT_MS;

      setCanvasGeneratingItems((prev) => [
        ...prev,
        ...tasks.map((task) => ({
          id: `${aiMsgId}-${task.id}`,
          aiMsgId,
          taskId: task.id,
          slotIndex: task.index,
          totalCount: count,
          prompt: displayText,
          hidePromptText: hidePlaceholderPrompt,
          isGeneratingPlaceholder: true,
          generationStatus: "pending",
          placeholderAspectRatio,
          mediaType: isKlingVideoRequest ? "video" : "image",
          requestTimeoutMs: taskRequestTimeoutMs,
          createdAt: ts,
        })),
      ]);

      const taskResults = await runWithConcurrency(
        tasks,
        Math.min(MAX_PARALLEL_GENERATIONS, count),
        async (task) => {
          if (shouldCancelTaskForStaleGeneration()) {
            return { status: "cancelled" };
          }

          const taskId = task.id;
          const canvasItemId = `${aiMsgId}-${taskId}`;
          const requestPrompt = buildSingleResultPrompt(
            text,
            count,
            task.index,
            variantDescriptors[task.index] || ""
          );
          const clientRequestId = createClientRequestId("canvas");
          const completeTaskWithUrl = (url, mediaTypeOverride = null) => {
            if (shouldCancelTaskForStaleGeneration()) {
              return { status: "cancelled" };
            }
            const mediaType = mediaTypeOverride || (isKlingVideoRequest ? "video" : "image");
            patchTask(conversationId, aiMsgId, taskId, {
              status: "completed",
              url,
              type: mediaType,
              error: null,
            });
            setCanvasGeneratingItems((prev) =>
              prev.filter((item) => item.id !== canvasItemId)
            );
            canvasHistory.push((prev) => [
              ...prev,
              {
                id: canvasItemId,
                image_url: url,
                media_type: mediaType,
                prompt: displayText,
                hidePromptText: hidePlaceholderPrompt,
              },
            ]);
            return { status: "completed" };
          };
          const tryRecoverTaskResult = async () => {
            const recovered = await recoverGenerationResult(clientRequestId);
            const recoveredUrls = Array.isArray(recovered?.data?.urls)
              ? recovered.data.urls.filter(Boolean)
              : [];
            if (recoveredUrls.length === 0) return null;
            return completeTaskWithUrl(recoveredUrls[0], recovered?.data?.mediaType);
          };
          patchTask(conversationId, aiMsgId, taskId, { status: "generating" });
          setCanvasGeneratingItems((prev) =>
            prev.map((item) =>
              item.id === canvasItemId
                ? { ...item, generationStatus: "generating" }
                : item
            )
          );

          try {
            let requestUrl = "/api/generate";
            let requestBody = {
              prompt: requestPrompt,
              model: requestParams.model,
              image_size: imageSize,
              num: 1,
              service_tier: requestParams.service_tier,
              quality: requestParams.quality,
              output_format: requestParams.output_format,
              output_compression: requestParams.output_compression,
              moderation: requestParams.moderation,
              _nanoResolution: requestParams._nanoResolution,
              _autoRatio: requestParams._autoRatio,
              ref_images: preparedImages,
              clientRequestId,
            };

            if (isKlingVideoRequest) {
              requestUrl = "/api/kling-video";
              requestBody = {
                prompt: requestPrompt,
                model: requestParams.model,
                image_size: imageSize,
                aspect_ratio: imageSize,
                duration: requestParams.duration || "5",
                mode: requestParams.mode || "pro",
                sound: requestParams.sound || "off",
                ref_images: preparedImages.slice(0, 2),
              };
            } else if (shouldUseEditApi) {
              requestUrl = "/api/edit";
              requestBody = {
                prompt: requestPrompt,
                image: imagePayload,
                model: requestParams.model,
                image_size: imageSize,
                num: 1,
                mode: editMode,
                service_tier: requestParams.service_tier,
                quality: requestParams.quality,
                output_format: requestParams.output_format,
                output_compression: requestParams.output_compression,
                moderation: requestParams.moderation,
                _nanoResolution: requestParams._nanoResolution,
                _autoRatio: requestParams._autoRatio,
                clientRequestId,
              };
            }

            const requestPromise = (async () => {
              const res = await fetchWithTimeout(requestUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: requestController.signal,
                body: JSON.stringify(requestBody),
              }, taskRequestTimeoutMs);
              const responseData = await parseApiResponse(res);
              return { res, data: responseData, recovered: false };
            })();
            const recoveredPromise = isKlingVideoRequest
              ? new Promise(() => {})
              : waitForRecoveredGenerationResult(clientRequestId);
            const { res, data, recovered } = await Promise.race([
              requestPromise,
              recoveredPromise,
            ]);
            if (recovered) {
              requestController.abort();
              await requestPromise.catch(() => null);
            }
            if (shouldCancelTaskForStaleGeneration()) {
              return { status: "cancelled" };
            }

            if (!recovered && (!res.ok || data.error)) {
              const errorMessage = errStr(data.error || `请求失败（${res.status}）`);
              patchTask(conversationId, aiMsgId, taskId, {
                status: "failed",
                error: errorMessage,
              });
              setCanvasGeneratingItems((prev) =>
                prev.filter((item) => item.id !== canvasItemId)
              );
              return { status: "failed", error: errorMessage };
            }

            const urls = data.data?.urls || [];
            const mediaType = data.data?.mediaType || (isKlingVideoRequest ? "video" : "image");
            const url = urls[0];
            if (!url) {
              const errorMessage = isKlingVideoRequest ? "未返回视频" : "未返回图片";
              patchTask(conversationId, aiMsgId, taskId, {
                status: "failed",
                error: errorMessage,
              });
              setCanvasGeneratingItems((prev) =>
                prev.filter((item) => item.id !== canvasItemId)
              );
              return { status: "failed", error: errorMessage };
            }
            patchTask(conversationId, aiMsgId, taskId, {
              status: "completed",
              url,
              type: mediaType,
              error: null,
            });
            setCanvasGeneratingItems((prev) =>
              prev.filter((item) => item.id !== canvasItemId)
            );
            canvasHistory.push((prev) => [
              ...prev,
              {
                id: canvasItemId,
                image_url: url,
                media_type: mediaType,
                prompt: displayText,
                hidePromptText: hidePlaceholderPrompt,
              },
            ]);
            return { status: "completed" };
          } catch (err) {
            if (generationState.cancelled) {
              return { status: "cancelled" };
            }
            if (shouldAttemptGenerationRecovery(err)) {
              const recoveredResult = await tryRecoverTaskResult();
              if (recoveredResult) return recoveredResult;
            }
            if (err?.name === "AbortError") {
              if (!generationState.cancelled) {
                patchTask(conversationId, aiMsgId, taskId, {
                  status: "failed",
                  error: "请求超时。可稍后重试，或减少张数以降低排队压力。",
                });
                setCanvasGeneratingItems((prev) =>
                  prev.filter((item) => item.id !== canvasItemId)
                );
                return { status: "failed", error: "请求超时。可稍后重试，或减少张数以降低排队压力。" };
              }
              setCanvasGeneratingItems((prev) =>
                prev.filter((item) => item.id !== canvasItemId)
              );
              return { status: "cancelled" };
            }
            patchTask(conversationId, aiMsgId, taskId, {
              status: "failed",
              error: errStr(err),
            });
            setCanvasGeneratingItems((prev) =>
              prev.filter((item) => item.id !== canvasItemId)
            );
            return { status: "failed", error: errStr(err) };
          }
        }
      );

      const successCount = taskResults.reduce((acc, result) => (
        result?.status === "completed" ? acc + 1 : acc
      ), 0);

      if (
        !generationState.cancelled
      ) {
        updateMessage(conversationId, aiMsgId, {
          status: successCount > 0 ? "completed" : "failed",
          mediaType: isKlingVideoRequest ? "video" : "image",
          error: successCount === 0
            ? (taskResults.find((result) => result?.error)?.error || "全部任务失败")
            : null,
        });
        toast(
          successCount > 0
            ? isKlingVideoRequest
              ? "视频生成完成，已添加到画布"
              : `生成完成，${successCount}/${count} 张已添加到画布`
            : isKlingVideoRequest
              ? "视频生成失败"
              : `生成结束，0/${count} 张成功`,
          successCount > 0 ? "success" : "info",
          2200
        );
      }

      if (!preserveComposer) {
        setRefImages((current) => (
          areSameRefImageList(current, effectiveRefImages) ? [] : current
        ));
      }
    } catch (err) {
      if (
        activeGenerationRef.current?.conversationId === conversationId &&
        activeGenerationRef.current?.aiMsgId === aiMsgId &&
        activeGenerationRef.current?.cancelled
      ) {
        return;
      }
      const msg = errStr(err);
      updateConversationMessages(conversationId, (prev) =>
        prev.map((m) => {
          if (m.id !== aiMsgId) return m;
          if (!m.tasks?.length) {
            return { ...m, status: "failed", error: msg };
          }
          return {
            ...m,
            status: "failed",
            error: msg,
            tasks: m.tasks.map((t) =>
              t.status === "completed"
                ? t
                : { ...t, status: "failed", error: msg }
            ),
          };
        })
      );
    } finally {
      setCanvasGeneratingItems((prev) =>
        prev.filter((item) => item.aiMsgId !== aiMsgId)
      );
      if (
        generationState && activeGenerationRef.current === generationState
      ) {
        activeGenerationRef.current = null;
      }
      if (generationState && generationAbortRef.current === generationState.controller) {
        generationAbortRef.current = null;
      }
      setActiveGenerationCount((value) => Math.max(0, value - 1));
    }
  }, [
    composerMode,
    entryMode,
    prompt,
    isTextEditing,
    activeConversationId,
    params,
    refImages,
    textEditBlocks,
    updateMessage,
    updateConversationMessages,
    patchTask,
    canvasHistory,
    semanticSelection,
    toast,
  ]);

  const handlePauseGenerate = useCallback(() => {
    const currentTask = activeGenerationRef.current;
    if (!currentTask) return;

    const { conversationId, aiMsgId, controller } = currentTask;
    currentTask.cancelled = true;

    updateConversationMessages(conversationId, (prev) =>
      prev.map((m) => {
        if (m.id !== aiMsgId) return m;
        if (m.tasks?.length) {
          const tasks = m.tasks.map((t) =>
            t.status === "pending" || t.status === "generating"
              ? { ...t, status: "failed", error: "已暂停" }
              : t
          );
          const urls = tasks.filter((t) => t.url).map((t) => t.url);
          return {
            ...m,
            tasks,
            urls,
            status: "paused",
            error: "已手动暂停",
          };
        }
        return { ...m, status: "paused", error: "已手动暂停" };
      })
    );
    setActiveGenerationCount((value) => Math.max(0, value - 1));
    setCanvasGeneratingItems((prev) =>
      prev.filter((item) => item.aiMsgId !== aiMsgId)
    );
    if (activeGenerationRef.current === currentTask) {
      activeGenerationRef.current = null;
    }
    if (generationAbortRef.current === controller) {
      generationAbortRef.current = null;
    }
    controller.abort();
    toast("已暂停当前生成", "info", 1500);
  }, [toast, updateConversationMessages]);

  const handleDeleteImage = useCallback((id) => {
    canvasHistory.push((prev) => prev.filter((img) => img.id !== id));
    setSelectedImage((prev) => (prev?.id === id ? null : prev));
    toast("已删除", "info", 1200);
  }, [canvasHistory, toast]);

  const handleSendToChat = useCallback((img) => {
    if (img?.media_type === "video" || img?.mediaType === "video") {
      toast("视频暂不能作为参考图发送到对话", "info", 1500);
      return;
    }
    if (img?.image_url) {
      setRefImages((prev) => [...prev, img.image_url]);
      toast("已发送到对话", "success", 1500);
    }
  }, [toast]);

  const handleTextEditBlocksChange = useCallback((next) => {
    setTextEditBlocks((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      return normalizeTextEditBlocks(resolved);
    });
  }, []);

  const handleRefImagesChange = useCallback((nextImages) => {
    const list = Array.isArray(nextImages) ? nextImages.filter(Boolean) : [];
    setRefImages(list);

    list.forEach((item, index) => {
      if (typeof item !== "string" || !/^data:image\//i.test(item)) return;
      void uploadDataUrlToCloudAsset(item, `reference-${index + 1}`, "canvas-reference")
        .then((url) => {
          setRefImages((prev) => prev.map((existing) => (existing === item ? url : existing)));
        })
        .catch(() => {
          toast("参考图云端保存失败，换设备可能无法恢复这张图", "warning", 2200);
        });
    });
  }, [toast]);

  const handleCancelTextEditPanel = useCallback(() => {
    setTextEditBlocks([]);
    setTextEditPanelVisible(false);
    toast("已取消文字编辑", "info", 1200);
  }, [toast]);

  const handleApplyTextEditPanel = useCallback(async (nextBlocks) => {
    const normalizedBlocks = normalizeTextEditBlocks(nextBlocks);
    const activeReplacements = getActiveTextReplacements(normalizedBlocks);
    if (activeReplacements.length === 0) {
      toast("请至少填写一条要替换的文案", "info", 1500);
      return;
    }
    if (isBusy) {
      toast("当前有任务进行中，请稍候再试", "info", 1500);
      return;
    }
    if (!activeConversationId) {
      toast("当前没有可用对话", "info", 1500);
      return;
    }

    const sourceImage = selectedImage?.image_url || refImages[0];
    if (!sourceImage) {
      toast("未找到要编辑的参考图", "info", 1500);
      return;
    }

    const displayText = String(prompt || "").trim() || "请替换这张图中的指定文字，并保持原尺寸、原版式与原视觉风格。";
    const ts = Date.now();
    const conversationId = activeConversationId;
    const userMsgId = `user-text-edit-${ts}`;
    const aiMsgId = `ai-text-edit-${ts}`;
    let previewImage = sourceImage;
    try {
      previewImage = await makeMessagePreviewImage(sourceImage);
    } catch {
      previewImage = sourceImage;
    }
    const sharedParams = {
      model: "python-text-edit",
      image_size: "原尺寸",
      num: 1,
    };
    const userMsg = {
      id: userMsgId,
      role: "user",
      text: displayText,
      params: sharedParams,
      modelLabel: "Python Text Edit",
      refImages: previewImage ? [previewImage] : [],
      textEditBlocks: normalizedBlocks,
    };
    const aiMsg = {
      id: aiMsgId,
      role: "assistant",
      text: "本地文字替换结果",
      params: sharedParams,
      modelLabel: "Python Text Edit",
      status: "generating",
      urls: [],
      error: null,
    };

    setTextEditBlocks(normalizedBlocks);
    setTextEditPanelVisible(false);
    updateConversationMessages(conversationId, (prev) => [...prev, userMsg, aiMsg]);
    setIsTextEditing(true);

    try {
      const res = await fetchWithTimeout("/api/text-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: sourceImage,
          blocks: normalizedBlocks,
          lang: "en",
        }),
      }, 10 * 60 * 1000);
      const data = await parseApiResponse(res);
      if (!res.ok || data.error) {
        throw new Error(errStr(data.error || `文字替换失败（${res.status}）`));
      }

      const urls = Array.isArray(data.data?.urls) ? data.data.urls.filter(Boolean) : [];
      if (urls.length === 0) {
        throw new Error("文字替换未返回结果图片");
      }

      updateMessage(conversationId, aiMsgId, {
        status: "completed",
        urls,
        error: null,
      });

      canvasHistory.push((prev) => [
        ...prev,
        ...urls.map((url, index) => ({
          id: `${aiMsgId}-${index}`,
          image_url: url,
          prompt: displayText,
        })),
      ]);
      toast(`文字替换完成，${urls.length} 张结果已添加到画布`, "success", 2200);
    } catch (err) {
      updateMessage(conversationId, aiMsgId, {
        status: "failed",
        error: errStr(err),
      });
      toast(errStr(err) || "文字替换失败", "info", 2200);
    } finally {
      setIsTextEditing(false);
    }
  }, [
    activeConversationId,
    canvasHistory,
    isBusy,
    prompt,
    refImages,
    selectedImage,
    toast,
    updateConversationMessages,
    updateMessage,
  ]);

  const handleSelectedImageRectChange = useCallback((nextRect) => {
    setSelectedImageRect((prev) => {
      if (!nextRect && !prev) return prev;
      if (!nextRect) return null;
      if (
        prev
        && prev.left === nextRect.left
        && prev.top === nextRect.top
        && prev.right === nextRect.right
        && prev.bottom === nextRect.bottom
        && prev.width === nextRect.width
        && prev.height === nextRect.height
      ) {
        return prev;
      }
      return nextRect;
    });
  }, []);

  const handleQuickEditImage = useCallback(async (actionId, img) => {
    if (!img?.image_url) return;

    if (actionId === "cutout") {
      if (isBusy) {
        toast("当前有任务进行中，请稍候再试", "info", 1500);
        return;
      }

      const meta = await detectRefImageMeta(img.image_url);
      setSelectedImage(img);
      setTextEditBlocks([]);
      setTextEditPanelVisible(false);
      setSemanticSelection(null);
      await handleGenerate({
        text: "请基于这张参考图进行专业抠图，完整保留主体，去除背景，输出干净透明背景效果，不要改变主体造型与细节，不要新增元素。",
        params: {
          ...params,
          image_size: "auto",
          _autoRatio: meta.ratio,
          _autoDimensions: meta.dimensionsLabel || undefined,
          num: 1,
        },
        refImages: [img.image_url],
        preserveComposer: true,
        hidePlaceholderPrompt: true,
        hideConversationMessages: true,
        editMode: "cutout",
        disableAgentDefaults: true,
        composerMode: "manual",
      });
      return;
    }

    if (actionId === "editText") {
      if (!TEXT_EDIT_ENABLED) {
        setTextEditBlocks([]);
        setTextEditPanelVisible(false);
        setSemanticSelection(null);
        toast("编辑文字功能已暂时停用", "info", 1800);
        return;
      }
      if (isBusy) {
        toast("当前有任务进行中，请稍候再试", "info", 1500);
        return;
      }
      setSelectedImage(img);
      setSemanticSelection(null);
      setRefImages((prev) => {
        if (prev.includes(img.image_url)) return prev;
        return [...prev, img.image_url];
      });
      toast("正在识别图片文字...", "info", 1200);

      try {
        const res = await fetchWithTimeout("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: img.image_url }),
        }, 120000);
        const data = await parseApiResponse(res);
        if (!res.ok || data.error) {
          throw new Error(errStr(data.error || `OCR 请求失败（${res.status}）`));
        }

        const blocks = Array.isArray(data.data?.blocks) ? data.data.blocks : [];
        const normalizedBlocks = normalizeTextEditBlocks(
          blocks.map((block) => ({
            ...block,
            replacement: "",
            enabled: true,
          }))
        );
        const recognizedLines = blocks
          .map((block, index) => `${index + 1}. ${block.text}`)
          .slice(0, 20);
        setTextEditBlocks(normalizedBlocks);
        setTextEditPanelVisible(normalizedBlocks.length > 0);

        const nextPrompt = recognizedLines.length > 0
          ? "请基于这张参考图编辑其中的文字，保留原有版式、层级、字体风格、颜色关系与视觉效果，只替换我指定的文案内容。"
          : "请基于这张参考图编辑其中的文字，保留原有版式与视觉风格，只修改文字相关内容。当前未识别到明确文字，请按图片内容继续编辑。";

        setPrompt(nextPrompt);
        toast(
          recognizedLines.length > 0
            ? `已识别 ${recognizedLines.length} 段文字`
            : "未识别到明确文字，已填入通用编辑指令",
          "success",
          1800
        );
      } catch (err) {
        setTextEditBlocks([]);
        setTextEditPanelVisible(false);
        setPrompt("请基于这张参考图编辑其中的文字，保留原有版式与视觉风格，只修改文字相关内容。");
        toast(errStr(err) || "文字识别失败，已回退到通用编辑指令", "info", 2200);
      }
      return;
    }

    const promptMap = {
    };
    const nextPrompt = promptMap[actionId];
    if (!nextPrompt) return;

    setRefImages((prev) => {
      if (prev.includes(img.image_url)) return prev;
      return [...prev, img.image_url];
    });
    setTextEditBlocks([]);
    setTextEditPanelVisible(false);
    setSemanticSelection(null);
    setSelectedImage(img);
    setPrompt(nextPrompt);
    toast("已填入快捷编辑指令", "success", 1500);
  }, [handleGenerate, isBusy, params, toast]);

  const handleQuickUpscaleImage = useCallback(async (upscaleRequest, img) => {
    const { provider, targetSize } = normalizeUpscaleRequest(upscaleRequest);
    if (!img?.image_url || !targetSize) return;
    if (isBusy) {
      toast("当前有任务进行中，请稍候再试", "info", 1500);
      return;
    }

    const meta = await detectRefImageMeta(img.image_url);
    const model = resolveUpscaleModel(provider, targetSize);
    const computedUpscaleSize = computeGptImage2UpscaleSize(meta.width, meta.height, targetSize);
    const imageSize = computedUpscaleSize === "auto"
      ? (provider === "image2" ? "auto" : targetSize)
      : computedUpscaleSize;
    const upscaleLabel = provider === "nano-pro" ? "Nano Pro" : "Image2";
    setTextEditBlocks([]);
    setTextEditPanelVisible(false);
    setSemanticSelection(null);
    const sizeRequirement = computedUpscaleSize === "auto"
      ? targetSize
      : `${computedUpscaleSize} (${targetSize})`;
    await handleGenerate({
      text: `请基于这张参考图做${upscaleLabel}高清放大与细节增强，输出尺寸尽量严格接近 ${sizeRequirement}，保持原图长宽比例与完整画面，不要裁切、不要缩小画布、不要加边框，保持主体、构图、文字内容与风格一致，不要改图，不要新增元素。`,
      params: {
        ...params,
        model,
        image_size: imageSize,
        _nanoResolution: provider === "nano-pro" ? targetSize : undefined,
        _autoRatio: meta.ratio,
        _autoDimensions: meta.dimensionsLabel || undefined,
        _autoWidth: meta.width || undefined,
        _autoHeight: meta.height || undefined,
        num: 1,
      },
      refImages: [img.image_url],
      preserveComposer: true,
      hidePlaceholderPrompt: true,
      hideConversationMessages: true,
      disableAgentDefaults: true,
      composerMode: "manual",
    });
  }, [handleGenerate, isBusy, params, toast]);

  const handleUpdateImage = useCallback(() => {}, []);

  /** 由画布选中同步到右侧参考图的 URL 列表（单选 / 框选多图） */
  const canvasSelectionUrlsRef = useRef([]);

  const handleSelectImage = useCallback((img) => {
    if (!img?.image_url) {
      const toRemove = [...canvasSelectionUrlsRef.current];
      canvasSelectionUrlsRef.current = [];
      setSelectedImage(null);
      setSemanticSelection(null);
      setTextEditPanelVisible(false);
      setRefImages((prev) =>
        prev.filter((u) => !toRemove.includes(u))
      );
      return;
    }
    const prevCanvasUrls = [...canvasSelectionUrlsRef.current];
    canvasSelectionUrlsRef.current = [img.image_url];
    setRefImages((prev) => {
      const withoutCanvas = prev.filter((u) => !prevCanvasUrls.includes(u));
      const seen = new Set(withoutCanvas);
      if (!seen.has(img.image_url)) {
        return [...withoutCanvas, img.image_url];
      }
      return withoutCanvas;
    });
    setSelectedImage(img);
    setSemanticSelection(null);
  }, []);

  /** 框选多张画布图片时，批量同步到右侧参考图（与模型最大参考图数量对齐） */
  const MAX_REF_IMAGES = 14;
  const handleSyncCanvasRefImages = useCallback((urls) => {
    const list = (urls || []).filter(Boolean);
    if (list.length < 2) return;
    const prevCanvasUrls = [...canvasSelectionUrlsRef.current];
    canvasSelectionUrlsRef.current = [...list];
    setTextEditPanelVisible(false);
    setRefImages((prev) => {
      const withoutCanvas = prev.filter((u) => !prevCanvasUrls.includes(u));
      const merged = [...withoutCanvas];
      for (const u of list) {
        if (merged.length >= MAX_REF_IMAGES) break;
        if (u && !merged.includes(u)) merged.push(u);
      }
      return merged;
    });
    toast("已同步到右侧参考图", "success", 1500);
  }, [toast]);

  const handleZoomChange = useCallback((updater) => {
    setZoom((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  // Drop image files onto canvas → show immediately, then replace with cloud URL for cross-device restore.
  const handleDropImages = useCallback((files, dropX, dropY) => {
    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const id = `drop-${Date.now()}-${i}`;
        const newImg = { id, image_url: dataUrl, prompt: file.name };
        canvasHistory.push((prev) => [...prev, newImg]);
        void uploadDataUrlToCloudAsset(dataUrl, file.name, "canvas-upload")
          .then((url) => {
            canvasHistory.push((prev) => prev.map((img) => (
              img.id === id ? { ...img, image_url: url } : img
            )));
          })
          .catch(() => {
            toast("图片已添加，但云端保存失败，换设备可能无法恢复", "warning", 2200);
          });
      };
      reader.readAsDataURL(file);
    });
    toast(`已添加 ${files.length} 张图片到画布`, "success");
  }, [canvasHistory, toast]);

  const handleDropGeneratedImage = useCallback((item, dropX, dropY) => {
    if (!item?.url) return;
    const mediaType = item.mediaType === "video" ? "video" : "image";
    const newImg = {
      id: `chat-drop-${Date.now()}`,
      image_url: item.url,
      media_type: mediaType,
      prompt: item.prompt || (mediaType === "video" ? "拖入视频" : "拖入图片"),
    };
    canvasHistory.push((prev) => [...prev, newImg]);
    toast("已添加到画布", "success", 1200);
  }, [canvasHistory, toast]);

  /** 画布内复制后粘贴（Ctrl/Cmd+V），或与系统剪贴板图片合并 */
  const handlePasteCanvasImages = useCallback(
    (items) => {
      if (!items?.length) return;
      const ts = Date.now();
      const nextItems = items.map((it, i) => ({
        id: `paste-${ts}-${i}`,
        image_url: it.image_url,
        prompt: (it.prompt && String(it.prompt).trim()) || "粘贴",
      }));
      canvasHistory.push((prev) => [...prev, ...nextItems]);
      nextItems.forEach((item) => {
        if (!/^data:image\//i.test(item.image_url || "")) return;
        void uploadDataUrlToCloudAsset(item.image_url, item.prompt, "canvas-paste")
          .then((url) => {
            canvasHistory.push((prev) => prev.map((img) => (
              img.id === item.id ? { ...img, image_url: url } : img
            )));
          })
          .catch(() => {
            toast("粘贴图片云端保存失败，换设备可能无法恢复", "warning", 2200);
          });
      });
      toast(`已粘贴 ${items.length} 张图片`, "success", 1500);
    },
    [canvasHistory, toast]
  );

  const handleRetry = useCallback((msg) => {
    const messageIndex = messages.findIndex((item) => item.id === msg.id);
    const previousUserMessage = messageIndex >= 0
      ? [...messages.slice(0, messageIndex)].reverse().find((item) => item.role === "user")
      : null;
    const retryText = msg.text?.trim() || previousUserMessage?.text?.trim() || "";
    const retryParams = msg.params || previousUserMessage?.params || params;
    const retryRefImages = previousUserMessage?.requestRefImages || previousUserMessage?.refImages || [];
    const retryTextEditBlocks = previousUserMessage?.textEditBlocks || [];
    const retryComposerMode = previousUserMessage?.composerMode || msg?.composerMode || "manual";
    const retryEntryMode = previousUserMessage?.entryMode || msg?.entryMode || "agent";
    const retrySemanticSelection = POINT_IMAGE_EDIT_ENABLED
      ? (previousUserMessage?.semanticSelection || null)
      : null;

    if (!retryText) {
      toast("未找到可重试的提示词", "info", 1500);
      return;
    }

    setPrompt(retryText);
    setEntryMode(retryEntryMode);
    setComposerMode(retryComposerMode);
    setParamsClamped(retryParams);
    setRefImages(retryRefImages);
    setSemanticSelection(retrySemanticSelection);
    setTextEditBlocks(normalizeTextEditBlocks(retryTextEditBlocks));
  }, [messages, params, setParamsClamped, toast]);

  const handleDownload = useCallback(async (msg) => {
    const url = msg.image_url;
    if (!url) return;
    const isVideo = msg.mediaType === "video" || msg.media_type === "video";
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${isVideo ? "video" : "image"}-${Date.now()}.${isVideo ? "mp4" : "png"}`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      toast("已下载", "success", 1200);
    } catch {
      window.open(url, "_blank");
    }
  }, [toast]);

  const handleImageClick = useCallback((msg) => {
    setSelectedImage(msg);
  }, []);

  // History panel: click an item → fill prompt with that text
  const handleSelectHistory = useCallback((msg) => {
    if (msg._conversationId) {
      setActiveConversationId(msg._conversationId);
    }
    if (msg.text) setPrompt(msg.text);
    if (msg.entryMode) setEntryMode(msg.entryMode);
    if (msg.composerMode) setComposerMode(msg.composerMode);
    if (msg.params) setParamsClamped(msg.params);
    setSemanticSelection(msg.semanticSelection || null);
    setTextEditBlocks(normalizeTextEditBlocks(msg.textEditBlocks || []));
    toast("已载入历史提示词", "info", 1200);
  }, [toast, setParamsClamped]);

  const handleClearHistory = useCallback(() => {
    setConversations((prev) => prev.map((conversation) => ({
      ...conversation,
      title: DEFAULT_CONVERSATION_TITLE,
      messages: [],
      updatedAt: Date.now(),
    })));
    localStorage.removeItem("lovart-conversations");
    localStorage.removeItem("lovart-active-conversation");
    toast("历史记录已清空", "info", 1500);
  }, [toast]);

  const handleNewConversation = useCallback(() => {
    if (isNavigationBusy) {
      toast("生成过程中暂时不能切换对话", "info", 1500);
      return;
    }
    const nextConversation = createConversation();
    setConversations((prev) => [nextConversation, ...prev]);
    setActiveConversationId(nextConversation.id);
    resetComposer();
  }, [isNavigationBusy, resetComposer, toast]);

  const handleNewCanvasBoard = useCallback(() => {
    if (isNavigationBusy) {
      toast("生成过程中暂时不能新建画布", "info", 1500);
      return;
    }
    const nextBoard = createCanvasBoard({ title: `画布 ${canvasBoards.length + 1}` });
    setCanvasBoards((prev) => [nextBoard, ...prev]);
    setActiveCanvasBoardId(nextBoard.id);
    canvasHistory.setState([]);
    canvasTextsHistory.setState([]);
    canvasShapesHistory.setState([]);
    setSelectedImage(null);
    setSemanticSelection(null);
    toast("已新建画布", "success", 1200);
  }, [canvasBoards.length, canvasHistory, canvasTextsHistory, canvasShapesHistory, isNavigationBusy, toast]);

  const handleSelectCanvasBoard = useCallback((boardId) => {
    if (isNavigationBusy) {
      toast("生成过程中暂时不能切换画布", "info", 1500);
      return;
    }
    const targetBoard = canvasBoards.find((board) => board.id === boardId);
    if (!targetBoard || targetBoard.id === activeCanvasBoardId) return;

    setCanvasBoards((prev) => prev.map((board) => (
      board.id === activeCanvasBoardId
        ? {
            ...board,
            images: canvasImages,
            texts: canvasTexts,
            shapes: canvasShapes,
            updatedAt: Date.now(),
          }
        : board
    )));
    setActiveCanvasBoardId(targetBoard.id);
    canvasHistory.setState(targetBoard.images || []);
    canvasTextsHistory.setState(targetBoard.texts || []);
    canvasShapesHistory.setState(targetBoard.shapes || []);
    setSelectedImage(null);
    setSemanticSelection(null);
    toast(`已切换到 ${targetBoard.title || "画布"}`, "info", 1200);
  }, [
    activeCanvasBoardId,
    canvasBoards,
    canvasHistory,
    canvasImages,
    canvasShapes,
    canvasShapesHistory,
    canvasTexts,
    canvasTextsHistory,
    isNavigationBusy,
    toast,
  ]);

  const handleRenameCanvasBoard = useCallback((boardId, title) => {
    const nextTitle = String(title || "").trim();
    if (!nextTitle) return;
    setCanvasBoards((prev) => prev.map((board) => (
      board.id === boardId ? { ...board, title: nextTitle, updatedAt: Date.now() } : board
    )));
  }, []);

  const handleDeleteCanvasBoard = useCallback((boardId) => {
    if (isNavigationBusy) {
      toast("生成过程中暂时不能删除画布", "info", 1500);
      return;
    }

    setCanvasBoards((prev) => {
      if (prev.length <= 1) {
        const nextBoard = createCanvasBoard({ title: "默认画布" });
        setActiveCanvasBoardId(nextBoard.id);
        canvasHistory.setState([]);
        canvasTextsHistory.setState([]);
        canvasShapesHistory.setState([]);
        setSelectedImage(null);
        setSemanticSelection(null);
        return [nextBoard];
      }

      const remaining = prev.filter((board) => board.id !== boardId);
      if (activeCanvasBoardId === boardId) {
        const nextBoard = remaining[0];
        setActiveCanvasBoardId(nextBoard.id);
        canvasHistory.setState(nextBoard.images || []);
        canvasTextsHistory.setState(nextBoard.texts || []);
        canvasShapesHistory.setState(nextBoard.shapes || []);
        setSelectedImage(null);
        setSemanticSelection(null);
      }
      return remaining;
    });
    toast("画布已删除", "info", 1200);
  }, [activeCanvasBoardId, canvasHistory, canvasTextsHistory, canvasShapesHistory, isNavigationBusy, toast]);

  const handleSelectConversation = useCallback((conversationId) => {
    if (isNavigationBusy) {
      toast("生成过程中暂时不能切换对话", "info", 1500);
      return;
    }
    setActiveConversationId(conversationId);
    resetComposer();
  }, [isNavigationBusy, resetComposer, toast]);

  const handleDeleteConversation = useCallback((conversationId) => {
    if (isNavigationBusy) {
      toast("生成过程中暂时不能删除对话", "info", 1500);
      return;
    }

    setConversations((prev) => {
      if (prev.length <= 1) {
        const nextConversation = createConversation();
        setActiveConversationId(nextConversation.id);
        resetComposer();
        return [nextConversation];
      }

      const remaining = prev.filter((conversation) => conversation.id !== conversationId);
      if (activeConversationId === conversationId) {
        setActiveConversationId(remaining[0]?.id || "");
        resetComposer();
      }
      return remaining;
    });

    toast("对话已删除", "info", 1200);
  }, [activeConversationId, isNavigationBusy, resetComposer, toast]);

  const handleDeleteMessage = useCallback((messageId) => {
    if (isNavigationBusy) {
      toast("生成过程中暂时不能删除记录", "info", 1500);
      return;
    }
    if (!activeConversationId) {
      return;
    }

    updateConversationMessages(activeConversationId, (prev) => prev.filter((message) => message.id !== messageId));
    toast("记录已删除", "info", 1200);
  }, [activeConversationId, isNavigationBusy, toast, updateConversationMessages]);

  return (
    <div className="h-screen flex overflow-hidden">
      <div
        className="absolute top-3 z-30 flex items-center gap-2 transition-[left]"
        style={{ left: isInspirationMode ? inspirationPanelWidth + 12 : 12 }}
      >
        <Link
          href="/"
          className="flex items-center px-0.5 py-0.5 transition-opacity hover:opacity-80"
          title="返回首页"
        >
          <BrandLogo
            className="h-7"
            showText={false}
            wordmarkOffsetClassName={`translate-y-[2px] ${theme === "light" ? "invert" : ""}`}
          />
        </Link>
        <button
          type="button"
          onClick={() => setIsInspirationMode((value) => !value)}
          className={`inline-flex h-7 translate-y-[1px] items-center gap-1.5 rounded-xl px-3 text-sm transition-all ${
            isInspirationMode
              ? theme === "light"
                ? "bg-black/10 text-black"
                : "bg-white/12 text-white"
              : theme === "light"
                ? "text-black/50 hover:bg-black/[0.05] hover:text-black/80"
                : "text-white/50 hover:bg-white/[0.06] hover:text-white"
          }`}
        >
          灵感模式
        </button>
      </div>
      {isInspirationMode && (
        <div
          className="relative hidden shrink-0 lg:block"
          style={{ width: inspirationPanelWidth }}
        >
          <aside className={`flex h-full flex-col border-r px-4 py-4 ${theme === "light" ? "border-black/8 bg-white/65" : "border-white/8 bg-white/[0.025]"}`}>
            <div className="mb-4 mt-10">
              <div className={`mb-2 text-sm font-semibold ${theme === "light" ? "text-[#111]" : "text-white"}`}>灵感模式</div>
              <p className={`text-xs leading-relaxed ${theme === "light" ? "text-black/45" : "text-white/40"}`}>
                边找参考边设计
              </p>
            </div>

            <div className={`rounded-2xl border p-3 ${theme === "light" ? "border-black/8 bg-white" : "border-white/8 bg-[#171719]"}`}>
              <div className="flex gap-2">
                <input
                  value={inspirationUrl}
                  onChange={(e) => setInspirationUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleOpenInspirationUrl();
                  }}
                  placeholder="输入设计网站链接"
                  className={`min-w-0 flex-1 rounded-xl px-3 py-2 text-xs outline-none ${theme === "light" ? "bg-black/[0.04] text-[#111] placeholder:text-black/30" : "bg-white/[0.06] text-white placeholder:text-white/30"}`}
                />
                <button
                  type="button"
                  onClick={handleOpenInspirationUrl}
                  className={`rounded-xl px-3 py-2 text-xs font-medium transition-all ${
                    theme === "light"
                      ? "bg-black/10 text-black hover:bg-black/15"
                      : "bg-white/12 text-white hover:bg-white/16"
                  }`}
                >
                  打开
                </button>
              </div>
            </div>

            <div className={`mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl border ${theme === "light" ? "border-black/8 bg-black/[0.03]" : "border-white/8 bg-black/30"}`}>
              {activeInspirationUrl ? (
                <iframe
                  src={activeInspirationUrl}
                  title="灵感网站预览"
                  sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                  className={`h-full w-full ${isInspirationResizing ? "pointer-events-none" : ""}`}
                />
              ) : (
                <div className={`flex h-full items-center justify-center px-8 text-center text-xs leading-relaxed ${theme === "light" ? "text-black/35" : "text-white/30"}`}>
                  输入一个设计网站链接后，这里会尝试预览。部分网站不允许嵌入，可用新窗口打开。
                </div>
              )}
            </div>
          </aside>
          <button
            type="button"
            aria-label="调整灵感面板宽度"
            onPointerDown={handleInspirationResizeStart}
            className={`absolute right-0 top-0 h-full w-2 translate-x-1/2 cursor-col-resize transition-colors ${theme === "light" ? "hover:bg-black/10" : "hover:bg-white/12"}`}
          />
        </div>
      )}
      <Canvas
        ref={canvasRef}
        images={canvasImages}
        generatingItems={canvasGeneratingItems}
        selectedImage={selectedImage}
        onSelectImage={handleSelectImage}
        onDeleteImage={handleDeleteImage}
        onUpdateImage={handleUpdateImage}
        onSendToChat={handleSendToChat}
        onQuickEditImage={handleQuickEditImage}
        onQuickUpscaleImage={handleQuickUpscaleImage}
        onDropImages={handleDropImages}
        onDropGeneratedImage={handleDropGeneratedImage}
        onPasteImages={handlePasteCanvasImages}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        zoom={zoom}
        onZoomChange={handleZoomChange}
        textItems={canvasTexts}
        onAddText={handleAddCanvasText}
        onUpdateText={handleUpdateCanvasText}
        onDeleteText={handleDeleteCanvasText}
        shapeItems={canvasShapes}
        onAddShape={handleAddCanvasShape}
        onUpdateShape={handleUpdateCanvasShape}
        onDeleteShape={handleDeleteCanvasShape}
        shapeMode={shapeMode}
        onShapeModeChange={setShapeMode}
        onSyncCanvasRefImages={handleSyncCanvasRefImages}
        onSelectedImageRectChange={handleSelectedImageRectChange}
        onSemanticSelectionChange={setSemanticSelection}
        semanticEditEnabled={POINT_IMAGE_EDIT_ENABLED}
        theme={theme}
      />
      {TEXT_EDIT_ENABLED && floatingTextPanelStyle && (
        <div
          className="fixed z-30"
          style={floatingTextPanelStyle}
        >
          <TextEditBlocksPanel
            blocks={textEditBlocks}
            onChange={handleTextEditBlocksChange}
            onCancel={handleCancelTextEditPanel}
            onApply={handleApplyTextEditPanel}
            title="编辑文字"
            subtitle="填写替换内容后，可直接取消或立即发送修改"
            applyLabel="立即使用"
            isApplying={isTextEditing}
          />
        </div>
      )}
      <ChatPanel
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onDeleteMessage={handleDeleteMessage}
        messages={messages}
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={handleGenerate}
        canSubmit={canSubmit}
        isGenerating={false}
        params={params}
        onParamsChange={setParamsClamped}
        showParams={showParams}
        onToggleParams={() => setShowParams(!showParams)}
        refImages={refImages}
        onRefImagesChange={handleRefImagesChange}
        textEditBlocks={textEditBlocks}
        onTextEditBlocksChange={handleTextEditBlocksChange}
        showTextEditPanelInline={false}
        onRetry={handleRetry}
        onDownload={handleDownload}
        onImageClick={handleImageClick}
        onPauseGenerate={handlePauseGenerate}
        entryMode={entryMode}
        onEntryModeChange={setEntryMode}
        composerMode={composerMode}
        onComposerModeChange={handleComposerModeChange}
        theme={theme}
        onToggleTheme={toggleTheme}
        width={panelWidth}
        onWidthChange={setPanelWidth}
        canvasBoards={canvasBoards}
        activeCanvasBoardId={activeCanvasBoardId}
        activeCanvasBoard={activeCanvasBoard}
        onNewCanvasBoard={handleNewCanvasBoard}
        onSelectCanvasBoard={handleSelectCanvasBoard}
        onRenameCanvasBoard={handleRenameCanvasBoard}
        onDeleteCanvasBoard={handleDeleteCanvasBoard}
        canvasHistoryMessages={historyMessages}
        onSelectCanvasHistory={handleSelectHistory}
        onClearCanvasHistory={handleClearHistory}
        canvasHistorySearch={historySearch}
        onCanvasHistorySearchChange={setHistorySearch}
      />
    </div>
  );
}

export default function Home() {
  return (
    <ToastProvider>
      <HomeInner />
    </ToastProvider>
  );
}
