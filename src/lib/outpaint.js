/**
 * 扩图（outpainting）：前端把原图居中/偏置贴到一块更大的白色画布上，
 * 再让模型只补全白色空白区域。本文件负责提示词模板与展示标签。
 */

/** 支持的比例预设（0 表示"原比例"，配合倍数使用） */
export const OUTPAINT_RATIO_PRESETS = [
  { id: "original", name: "原比例", ratio: 0 },
  { id: "1:1", name: "1:1", ratio: 1 },
  { id: "3:4", name: "3:4", ratio: 3 / 4 },
  { id: "4:3", name: "4:3", ratio: 4 / 3 },
  { id: "9:16", name: "9:16", ratio: 9 / 16 },
  { id: "16:9", name: "16:9", ratio: 16 / 9 },
];

/** 「原比例」下的整体放大倍数预设 */
export const OUTPAINT_SCALE_PRESETS = [1.25, 1.5, 2];

/** 单侧最大扩展 = 原图对应边长的 1.5 倍（总画布最大约 4 倍面积，防止空白占比过高补不好） */
export const OUTPAINT_MAX_PAD_FACTOR = 1.5;

const RATIO_CANDIDATES = [
  [1, 1], [16, 9], [9, 16], [4, 3], [3, 4],
  [3, 2], [2, 3], [2, 1], [1, 2], [4, 5], [5, 4],
  [21, 9], [1, 4], [4, 1],
];

/** 从宽高挑一个最接近的标准比例标签（与 page.js detectRefImageMeta 的候选一致） */
export function pickClosestRatioLabel(width, height) {
  const current = width > 0 && height > 0 ? width / height : 1;
  let label = "1:1";
  let minDiff = Infinity;
  for (const [w, h] of RATIO_CANDIDATES) {
    const diff = Math.abs(current - w / h);
    if (diff < minDiff) {
      minDiff = diff;
      label = `${w}:${h}`;
    }
  }
  return label;
}

/** 把四边扩展量转成方向描述，供提示词与标签使用；pads 为图片像素 */
function describeDirections({ left = 0, right = 0, top = 0, bottom = 0 }, width, height) {
  const parts = [];
  const fmt = (value, base) => `${Math.round((value / base) * 100)}%`;
  if (left > 0) parts.push(`向左扩展约${fmt(left, width)}`);
  if (right > 0) parts.push(`向右扩展约${fmt(right, width)}`);
  if (top > 0) parts.push(`向上扩展约${fmt(top, height)}`);
  if (bottom > 0) parts.push(`向下扩展约${fmt(bottom, height)}`);
  return parts;
}

/**
 * 组装扩图提示词。合成图中原图内容原封不动，白色边框为待补全区域；
 * userText 是用户对扩展内容的约束（如"扩展区域保持纯白空白"），可为空。
 */
export function buildOutpaintPrompt({ pads, width, height, userText = "" } = {}) {
  const directions = describeDirections(pads || {}, width || 1, height || 1);
  const constraint = String(userText || "").trim();
  return [
    "任务：扩图（outpainting）。这张图中间的完整画面是原始图片，四周的纯白色空白边框是新增的待补全画布区域。",
    `本次扩展方向：${directions.length > 0 ? directions.join("，") : "四周均匀扩展"}。`,
    "硬性要求：原始画面的所有内容保持完全不变，不重绘、不变形、不裁切、不移动位置；",
    constraint
      ? `扩展区域的内容按以下要求补全：${constraint}。同时与原始画面的边缘无缝衔接，光照、色调、风格保持一致；`
      : "扩展内容：先识别原始画面的场景、主体和背景（例如室内桌面、纯色摄影棚背景、户外环境等），再基于识别到的内容把空白区域自然向外延展——延续背景的材质纹理、颜色渐变、透视和光照方向，原图边缘被裁切到一半的物体按其结构补完整，让扩展后的画面看起来就是同一场景更大的取景范围，衔接处不能有任何边界痕迹或色差；",
    "输出扩展后的完整画面，清晰锐利。",
  ].join(" ");
}

/** 画布/聊天上的短标签，例如「扩图：16:9 · 左+50% · 提示词」 */
export function formatOutpaintLabel({ pads, width, height, ratioLabel = "", userText = "" } = {}) {
  const directions = describeDirections(pads || {}, width || 1, height || 1)
    .map((text) => text.replace("扩展约", "+").replace("向", ""));
  const parts = [ratioLabel, ...directions].filter(Boolean);
  if (String(userText || "").trim()) parts.push("提示词");
  return `扩图：${parts.join(" · ") || "自由扩展"}`;
}
