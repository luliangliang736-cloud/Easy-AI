/**
 * 多角度重渲染：把面板上的相机参数（水平旋转/垂直俯仰/推拉）翻译成改图提示词。
 * 与材质库同思路——参数只在后台组装提示词，前端只展示"多角度：右侧45° · 俯视30°"这类短标签。
 */

/** 方位九宫格预设（参考即梦/Lovart 的交互）：h 水平角度，v 垂直角度 */
export const CAMERA_DIRECTION_PRESETS = [
  { id: "up-left", name: "左上", h: -45, v: 30 },
  { id: "top", name: "俯视", h: 0, v: 45 },
  { id: "up-right", name: "右上", h: 45, v: 30 },
  { id: "left", name: "左视", h: -90, v: 0 },
  { id: "front", name: "正视", h: 0, v: 0 },
  { id: "right", name: "右视", h: 90, v: 0 },
  { id: "down-left", name: "左下", h: -45, v: -30 },
  { id: "bottom", name: "仰视", h: 0, v: -45 },
  { id: "down-right", name: "右下", h: 45, v: -30 },
];

export const MULTI_ANGLE_ZOOM_OPTIONS = [
  { id: "in", name: "拉近" },
  { id: "none", name: "不变" },
  { id: "out", name: "拉远" },
];

export const MULTI_ANGLE_H_RANGE = { min: -180, max: 180, step: 15 };
export const MULTI_ANGLE_V_RANGE = { min: -60, max: 60, step: 15 };

/**
 * 水平角度转成"环绕机位 + 可见面变化"的摄影描述。
 * 必须写清转动后应该看到主体的哪些面，否则模型容易忽略角度指令、原样复刻原图。
 */
function describeHorizontal(h) {
  const abs = Math.abs(h);
  if (abs === 0) return "";
  const side = h > 0 ? "右" : "左";
  if (abs === 180) return "把相机环绕到主体的正后方180度：画面展示主体的背面结构，原图正面完全不可见";
  if (abs > 135) return `把相机环绕到主体${side}后方约${abs}度：画面以主体的背面和${side}侧面为主，原图正面几乎不可见`;
  if (abs > 90) return `把相机环绕到主体${side}后方约${abs}度：画面同时看到主体的${side}侧面和部分背面，原图正面只剩很小的透视面`;
  if (abs === 90) return `把相机环绕到主体的正${side}侧90度（标准${side}侧面视图）：画面以主体${side}侧面为主，原图正面收缩成很窄的透视边`;
  if (abs >= 45) return `把相机向${side}环绕约${abs}度（${side}前方四分之三视角）：画面同时看到主体的正面和${side}侧面，两个面都清楚可见`;
  return `把相机向${side}环绕约${abs}度：主体的${side}侧面开始进入画面，正面产生明显的透视收缩，与原图的正对角度明显不同`;
}

/** 垂直角度转成"高低机位 + 可见面变化"的俯仰描述 */
function describeVertical(v) {
  const abs = Math.abs(v);
  if (abs === 0) return "";
  if (v > 0) {
    if (abs >= 60) return `同时切换成接近顶部的高机位俯拍（向下约${abs}度）：画面以主体的顶面为主，透视明显向下汇聚`;
    return `同时抬高相机改为俯拍（向下约${abs}度的高机位）：能明显看到主体的顶部表面，地面/桌面占据画面更多空间`;
  }
  if (abs >= 60) return `同时切换成贴近底部的低机位仰拍（向上约${abs}度）：画面以主体的底部结构为主，主体高耸，透视向上汇聚`;
  return `同时压低相机改为仰拍（向上约${abs}度的低机位）：能明显看到主体的底部结构，主体显得更高大，天空/背景占据画面上方更多空间`;
}

function describeZoom(zoom) {
  if (zoom === "in") return "并把镜头拉近：主体在画面中的占比明显变大，呈现更近的特写距离";
  if (zoom === "out") return "并把镜头拉远：主体在画面中的占比明显变小，露出完整全貌和更多周围空间";
  return "";
}

/** 参数是否等于默认（正视、无旋转、不变焦），此时无需生成 */
export function isDefaultAngle({ h = 0, v = 0, zoom = "none" } = {}) {
  return Number(h) === 0 && Number(v) === 0 && zoom === "none";
}

/**
 * 组装多角度改图提示词：只换机位，其它一切保持与原图一致。
 * 强调"同一主体、同一材质光照、脑补被遮挡结构"来压住模型漂移。
 */
export function buildMultiAnglePrompt({ h = 0, v = 0, zoom = "none" } = {}) {
  const viewParts = [describeHorizontal(Number(h)), describeVertical(Number(v))].filter(Boolean);
  const viewText = viewParts.length > 0 ? viewParts.join("；") : "保持当前正面视角";
  const zoomText = describeZoom(zoom);
  return [
    // 任务指令放最前并强制"必须变"，防止一致性约束压过角度指令导致原样复刻
    `任务：改变这张图的拍摄机位，把同一个主体重新渲染成新视角。具体机位变化：${viewText}${zoomText ? `；${zoomText}` : ""}。`,
    "硬性要求：输出图像的观察角度必须与原图明显不同，主体的透视关系、可见面必须按新机位重新计算，禁止原样复刻原图的机位和构图。",
    "同时这是同一个主体的另一个观察角度，不是新设计：主体的形状结构、比例、材质质感、颜色、表面细节、光照风格必须与原图保持一致；",
    "原图中被遮挡、新机位下会露出来的部分，按该主体的结构合理补全，风格统一；",
    "背景环境和光照氛围延续原图，但背景透视同样按新机位变化；主体完整入画，不裁切。",
    "输出清晰锐利的高质量渲染图。",
  ].join(" ");
}

/** 生成聊天/画布上展示的短标签，例如「多角度：右侧45° · 俯视30° · 拉近」 */
export function formatMultiAngleLabel({ h = 0, v = 0, zoom = "none" } = {}) {
  const parts = [];
  if (Number(h) !== 0) parts.push(`${h > 0 ? "右侧" : "左侧"}${Math.abs(h)}°`);
  if (Number(v) !== 0) parts.push(`${v > 0 ? "俯视" : "仰视"}${Math.abs(v)}°`);
  if (zoom === "in") parts.push("拉近");
  if (zoom === "out") parts.push("拉远");
  return `多角度：${parts.length > 0 ? parts.join(" · ") : "正视"}`;
}
