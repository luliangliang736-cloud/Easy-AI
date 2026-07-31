// 材质库数据：来源于材质球文档，用于画布"一键换材质"功能。
// 初版只收录"软质织物"分类，后续按文档扩充其它分类（现代复合 / 硬质工业 / 风格系列）。
// thumb 为材质球缩略图（当前为占位渲染图，可随时替换为文档官方切图）。

export const MATERIAL_CATEGORIES = ["软质织物", "现代复合", "充气软体", "硬质工业", "抽象艺术"];

export const MATERIALS = [
  {
    id: "knit-fabric",
    category: "软质织物",
    name: "针织布料",
    thumb: "/images/materials/knit-fabric.png",
    prompt:
      "细密针织布料材质：表面有规则织物经纬纹理，纤维感清晰，漫反射为主，触感柔软，局部有轻微拉伸与压缩褶皱",
  },
  {
    id: "soft-padded",
    category: "软质织物",
    name: "软包填充",
    thumb: "/images/materials/soft-padded.png",
    prompt:
      "软包填充材质：内部像填充棉支撑，表面鼓胀柔软，边缘自然圆滑，有轻微压痕、凹陷和布料张力变化",
  },
  {
    id: "translucent-fabric",
    category: "软质织物",
    name: "半透明织物",
    thumb: "/images/materials/translucent-fabric.png",
    prompt:
      "半透明织物覆膜材质：具有轻微透光感，表面仍保留织物纹理，内部有柔和体积感，反射弱，边缘有淡淡透光层次",
  },
  {
    id: "striped-emboss",
    category: "软质织物",
    name: "条纹压纹",
    thumb: "/images/materials/striped-emboss.png",
    prompt:
      "条纹压纹贴片材质：表面有方向一致的细密条纹或微沟槽，略带浮雕厚度，边缘清晰，反射柔和",
  },
  {
    id: "suede-fabric",
    category: "软质织物",
    name: "绒面布料",
    thumb: "/images/materials/suede-fabric.png",
    prompt:
      "绒面/磨砂布料材质：表面细腻柔雾，短绒感明显，粗糙度较高，无强反光，适合表现柔软亲和的触感",
  },
  {
    id: "soft-rubber-coat",
    category: "软质织物",
    name: "软胶涂层",
    thumb: "/images/materials/soft-rubber-coat.png",
    prompt:
      "软胶涂层材质：表面平滑但不镜面，带轻微弹性和柔和高光，质感介于橡胶与软塑之间",
  },
  {
    id: "mesh-fabric",
    category: "现代复合",
    name: "网格织物",
    thumb: "/images/materials/mesh-fabric.png",
    prompt:
      "细密网格织物材质：由规则孔洞或编织网格构成，具有轻微半透明感，可见细密交织结构和局部透光层次",
  },
  {
    id: "soft-foam",
    category: "现代复合",
    name: "软质泡棉",
    thumb: "/images/materials/soft-foam.png",
    prompt:
      "软质泡棉材质：表面哑光、细腻，有轻微颗粒感，带柔软填充质感，受压区域会产生轻微凹陷和自然起伏",
  },
  {
    id: "paper-emboss",
    category: "现代复合",
    name: "纸质压纹",
    thumb: "/images/materials/paper-emboss.png",
    prompt:
      "纸质压纹材质：表面带规则凸点、凹凸纹或压印纹理，漫反射强，质感干净，有轻微厚度感",
  },
  {
    id: "satin-plastic",
    category: "现代复合",
    name: "缎面塑胶",
    thumb: "/images/materials/satin-plastic.png",
    prompt:
      "缎面塑胶材质：表面平滑但不强镜面，反射柔和，倒角处有细腻亮边，整体干净现代",
  },
  {
    id: "translucent-film",
    category: "现代复合",
    name: "半透明薄膜",
    thumb: "/images/materials/translucent-film.png",
    prompt:
      "半透明薄膜材质：轻微透光和折射，边缘有柔和亮线，表面可带雾感",
  },
  {
    id: "frosted-coating",
    category: "现代复合",
    name: "磨砂涂层",
    thumb: "/images/materials/frosted-coating.png",
    prompt:
      "磨砂涂层材质：表面低反射、细颗粒、柔雾感明显，整体干净、克制、现代",
  },
  {
    id: "flex-band",
    category: "现代复合",
    name: "柔性带状",
    thumb: "/images/materials/flex-band.png",
    prompt:
      "柔性带状材质：表面细腻平滑或带轻微织物纹理，具有柔韧弹性感，反射克制",
  },
  {
    id: "clear-acrylic",
    category: "现代复合",
    name: "透明亚克力",
    thumb: "/images/materials/clear-acrylic.png",
    prompt:
      "透明硬质亚克力材质：具有真实厚度感，边缘折射明显，局部高光清晰，通透但不过度镜面",
  },
  {
    id: "cable-cord",
    category: "现代复合",
    name: "线缆",
    thumb: "/images/materials/cable-cord.png",
    prompt:
      "线缆材质：表面光滑，有柔和高光，材质具有柔韧感，边缘清晰",
  },
  {
    id: "composite-sheet",
    category: "现代复合",
    name: "复合片材",
    thumb: "/images/materials/composite-sheet.png",
    prompt:
      "复合片材材质：表面可呈现纸质、塑胶或织物纹理，边缘可见厚度，质感轻薄但有支撑性",
  },
  {
    id: "inflatable-pvc",
    category: "充气软体",
    name: "充气橡胶",
    thumb: "/images/materials/inflatable-pvc.png",
    prompt:
      "充气橡胶/软体PVC材质：表面柔软有弹性，轻微膨胀张力感，受压处有自然凹陷和褶皱，反射柔和，具有充气物的饱满触感",
  },
  {
    id: "inflatable-softpack",
    category: "充气软体",
    name: "软包织物",
    thumb: "/images/materials/inflatable-softpack.png",
    prompt:
      "软包织物材质：表面有细密织物纹理，漫反射为主，触感柔软，受拉伸和挤压时会产生自然褶皱、压痕和布料张力变化",
  },
  {
    id: "inflatable-knit",
    category: "充气软体",
    name: "细密针织",
    thumb: "/images/materials/inflatable-knit.png",
    prompt:
      "细密针织材质：可见规则经纬编织结构，纤维感清晰，粗糙度中高，反射克制，适合表现柔软、亲和、可触摸的表面",
  },
  {
    id: "inflatable-pillow",
    category: "充气软体",
    name: "枕头填充",
    thumb: "/images/materials/inflatable-pillow-v2.png",
    prompt:
      "枕头/填充棉材质：内部有柔软填充感，表面蓬松，受压后出现自然凹陷、鼓包和回弹感，整体柔和、轻盈",
  },
  {
    id: "inflatable-film",
    category: "充气软体",
    name: "半透明充气膜",
    thumb: "/images/materials/inflatable-film.png",
    prompt:
      "半透明充气膜材质：轻微透光，带柔和折射和雾感，表面有柔软张力，受压处出现微弱形变，边缘可见透光层次",
  },
  {
    id: "inflatable-seam",
    category: "充气软体",
    name: "缝线压边",
    thumb: "/images/materials/inflatable-seam-v2.png",
    prompt:
      "缝线/压边细节材质：表面有轻微缝合线、压边、折边或热压封边痕迹，细节克制，增强软体工业制品的真实感",
  },
  {
    id: "terrazzo",
    category: "硬质工业",
    name: "水磨石",
    thumb: "/images/materials/terrazzo.png",
    prompt:
      "水磨石/terrazzo材质：表面含有大量不规则碎石颗粒与斑点，颗粒大小不一，嵌入基材内部，漫反射为主，质感坚硬、厚实、略带石材颗粒感",
  },
  {
    id: "matte-plastic",
    category: "硬质工业",
    name: "哑光塑料",
    thumb: "/images/materials/matte-plastic.png",
    prompt:
      "细颗粒哑光塑料材质：表面低反射，带均匀微砂纹，触感细腻，边缘高光柔和，整体干净克制",
  },
  {
    id: "rubber-blast",
    category: "硬质工业",
    name: "橡胶喷砂",
    thumb: "/images/materials/rubber-blast.png",
    prompt:
      "橡胶喷砂涂层材质：表面粗糙度中高，带细小speckle颗粒，反射很弱，触感偏软，适合表现防滑、耐磨、功能性涂层",
  },
  {
    id: "micro-mesh",
    category: "硬质工业",
    name: "微网格压纹",
    thumb: "/images/materials/micro-mesh.png",
    prompt:
      "微网格压纹材质：表面有规则细密网格、蜂窝纹或织物状压纹，纹理尺度小且均匀，反射克制，近看细节清晰",
  },
  {
    id: "fine-ridges",
    category: "硬质工业",
    name: "细横纹",
    thumb: "/images/materials/fine-ridges.png",
    prompt:
      "细横纹压纹材质：表面由密集平行细线组成，具有方向性纹理，低反射，边缘能看到轻微纹理延续",
  },
  {
    id: "satin-resin",
    category: "硬质工业",
    name: "缎面树脂",
    thumb: "/images/materials/satin-resin.png",
    prompt:
      "缎面树脂/半透塑胶材质：具有真实厚度感，边缘略带透光和柔和折射，表面反射受控，不是完全透明，也不是强镜面",
  },
  {
    id: "matte-ceramic",
    category: "硬质工业",
    name: "哑光陶瓷",
    thumb: "/images/materials/matte-ceramic.png",
    prompt:
      "哑光陶瓷/人造石材质：表面平整细腻，漫反射明显，触感硬质，边缘干净，具有轻微粉感",
  },
  {
    id: "raised-patch",
    category: "硬质工业",
    name: "凸起贴片",
    thumb: "/images/materials/raised-patch.png",
    prompt:
      "凸起贴片/浮雕涂层材质：表面比基底略高，边缘清晰，倒角柔和，材质与底面可形成轻微反差，投下细微接触阴影",
  },
  {
    id: "coarse-stone",
    category: "硬质工业",
    name: "粗颗粒石材",
    thumb: "/images/materials/coarse-stone.png",
    prompt:
      "深色粗颗粒石材/沥青质感基底材质：表面有大量不规则孔洞、斑点与颗粒凹凸，粗糙度高，反射弱，质感厚重、硬质、偏工业",
  },
  {
    id: "clear-lacquer",
    category: "硬质工业",
    name: "透明清漆",
    thumb: "/images/materials/clear-lacquer.png",
    prompt:
      "薄层透明清漆材质：覆盖在纹理表面之上，产生轻微柔和高光，底层纹理仍然清晰可见，增强精致感但不形成强镜面",
  },
  {
    id: "confetti-scraps",
    category: "抽象艺术",
    name: "彩屑拼贴",
    thumb: "/images/materials/confetti-scraps.png",
    prompt:
      "彩屑拼贴材质：浅色哑光基底上密布不规则彩色碎纸屑片（珊瑚红、青绿、藏蓝等），碎屑略微嵌入表面并带轻微厚度，漫反射为主，整体呈拼贴艺术感",
  },
  {
    id: "streak-glaze",
    category: "抽象艺术",
    name: "波纹釉彩",
    thumb: "/images/materials/streak-glaze.png",
    prompt:
      "波纹釉彩材质：釉面基底上环绕流动的水平波浪条纹，双色对比（如蓝底奶油色条纹），条纹略微凸起带笔刷釉料质感，表面缎面柔光，不强镜面",
  },
];

// 通用负面约束：摘自实测提示词的通用项，保证材质替换时画面干净、形态不跑偏。
// 注意：不包含"不要人物/手/脸"（IP 角色图换材质是常见场景）；配色类负面在选择了配色方案时动态追加。
const MATERIAL_NEGATIVE =
  "不要低清晰度、不要模糊糊边、不要柔焦、不要景深虚化、不要运动模糊、不要低模、不要改变主体造型、不要扭曲原始轮廓、不要添加输入图之外的额外元素、不要多余元素、不要镜面电镀铬、不要廉价塑料感、不要过度卡通玩具风、不要粗糙大颗粒、不要颗粒过重、不要噪点、不要脏污划痕、不要材质混乱、不要过曝高光、不要死黑阴影、不要复杂杂乱背景、不要杂乱构图、不要涂抹感、不要可见灯具、不要摄影棚设备、不要背景灯板、不要长段文字、不要错误文字、不要水印";

// 通用渲染风格：所有材质替换统一前置，保证商业级干净渲染效果。
// 注意：不含视角/构图/白背景指令，换材质必须保持原图构图与背景不变。
const MATERIAL_RENDER_STYLE =
  "渲染方式：3D品牌视觉渲染，柔光棚拍主光（大面积软箱），商业产品光效，反射受控，不过曝高光，阴影柔和，AO极轻；轮廓干净利落，边缘锐利不糊，超高分辨率，细节极清晰，画面超干净，无噪点、无脏污、无涂抹感。";

// ============ 组合探索：多材质 × 配色方案 ============
// 模板来自实测有效的"不同材质不同颜色"提示词，出图效果已验证，改动前请先实测对比。

/** 预设配色方案：main 主色 + aux 辅助色（第一组为实测验证过的方案） */
export const MATERIAL_PALETTES = [
  { id: "electric-violet", name: "电光紫", main: "#5338FF", aux: ["#C5FB00", "#1B1B23", "#FFFFFF"] },
  { id: "coral-pop", name: "珊瑚跳色", main: "#FF5C38", aux: ["#FFD84D", "#1B1B23", "#FFF6EC"] },
  { id: "mint-fresh", name: "薄荷清新", main: "#22C55E", aux: ["#B9FBC0", "#0F172A", "#FFFFFF"] },
  { id: "ocean-blue", name: "海洋蓝调", main: "#2563EB", aux: ["#7DD3FC", "#0B1020", "#F5F8FF"] },
  { id: "mono-ink", name: "极简黑白", main: "#1B1B23", aux: ["#8E8E96", "#D9D9DE", "#FFFFFF"] },
];

// 组合模式渲染方式：忠于实测模板（组合转译允许重排视角/背景，与单材质替换不同）。
const COMBO_RENDER_STYLE =
  "渲染方式：3D品牌视觉渲染，柔和均匀主光，商业产品光效，反射受控，不过曝高光，阴影柔和，AO极轻；三分之四视角（3/4），构图简洁克制，主体突出，留白充足；统一倒角与厚度，轮廓干净利落；高分辨率，细节清晰，画面超干净，无噪点，极简白色背景。";

// 组合模式负面：忠于实测模板；仅去掉"不要人物/手/脸"（IP 角色图是常见素材，加了会毁图）。
const COMBO_NEGATIVE =
  "不要低清晰度；不要模糊；不要糊边；不要柔焦；不要景深虚化；不要运动模糊；不要低模；不要粗糙大纹理；不要杂乱构图；不要复杂背景；不要多余元素；不要脏污划痕；不要噪点；不要颗粒过重；不要廉价塑料感；不要过度卡通玩具风；不要镜面电镀铬；不要过曝高光；不要死黑阴影；不要长段文字；不要水印；不要logo错误；不要可见灯具；不要摄影棚设备；不要背景灯板；不要扭曲原始轮廓；不要添加输入图之外的额外元素";

// 选择了配色方案时追加的负面（防止原图颜色顶掉手动配色）。
const COMBO_COLOR_NEGATIVE =
  "不要保留参考图原有配色；不要弱化当前选择的配色方案；不要让原图色相覆盖手动配色";

// ============ DIY 材质：通用质感补充 ============
// 官方材质的 prompt 都自带粗糙度/反射/透光描述，而用户 DIY 时往往只写"是什么材质"，
// 所以对 DIY 材质统一追加一段物理质感约束，保证光影表现与官方材质一致。
const DIY_MATERIAL_SUPPLEMENT =
  "该材质的粗糙度、反射强度与透光表现需符合其真实物理特性，高光与阴影过渡细腻自然，光影响应与画面整体光照环境保持一致";

// 选中图片时快捷换材质条展示的推荐材质：跨类别挑质感差异最大的 4 个，一眼能看出"换材质"能干什么
const QUICK_SWAP_MATERIAL_IDS = ["knit-fabric", "inflatable-pvc", "clear-acrylic", "matte-ceramic"];

/** 快捷换材质推荐列表（按 QUICK_SWAP_MATERIAL_IDS 顺序返回官方材质对象） */
export function getQuickSwapMaterials() {
  return QUICK_SWAP_MATERIAL_IDS
    .map((id) => MATERIALS.find((m) => m.id === id))
    .filter(Boolean);
}

/** DIY 材质判定：MaterialPanel 保存的自定义材质 id 以 diy- 开头 */
export function isDiyMaterial(material) {
  return typeof material?.id === "string" && material.id.startsWith("diy-");
}

/** 材质描述文案：DIY 材质自动补上通用物理质感约束，官方材质原样使用 */
function buildMaterialPromptText(material) {
  return isDiyMaterial(material) ? `${material.prompt}。${DIY_MATERIAL_SUPPLEMENT}` : material.prompt;
}

/** 配色描述文案：兼容辅助色数量 0~4（配色由用户 DIY，颜色数量不固定） */
function buildPaletteText(palette) {
  if (!palette) return "";
  const aux = Array.isArray(palette.aux) ? palette.aux.filter(Boolean) : [];
  const auxText = aux.length > 0 ? `，${aux.join("、")} 为辅助色` : "，不使用其它辅助色";
  return `配色要求：当前选择的配色方案为 ${palette.main} 为主色${auxText}。色值：${[palette.main, ...aux].join("、")}；必须将该配色方案作为画面主要可见配色执行。`;
}

/** 用户补充指令段：限定材质替换范围（如"只换服饰，皮肤不变"），空指令返回空串不影响原模板 */
function buildUserScopeText(userInstruction) {
  const instruction = String(userInstruction || "").trim();
  if (!instruction) return "";
  return `用户补充要求（优先级最高，与其他要求冲突时以此为准）：${instruction}。材质只应用到用户指定的部位或元素上，用户未提及或要求保持的区域（例如人物皮肤、五官、头发、背景等）必须保持原图完全不变。`;
}

/** 组装"组合探索"的改图提示词：多材质由模型分配到不同元素，配色方案可选；userInstruction 可选（限定替换范围） */
export function buildComboEditPrompt(materialList, palette, userInstruction = "") {
  const materialText = materialList.map((m) => `${buildMaterialPromptText(m)}。`).join("；");
  const colorText = buildPaletteText(palette);
  const scopeText = buildUserScopeText(userInstruction);
  const negative = palette ? `${COMBO_NEGATIVE}；${COMBO_COLOR_NEGATIVE}` : COMBO_NEGATIVE;
  return [
    scopeText,
    COMBO_RENDER_STYLE,
    scopeText
      ? `材质：${materialText} 请按用户补充要求把这些材质分配到指定的元素上，相邻元素材质对比明显，材质分层清楚。基于参考图生成目标视觉结果。`
      : `材质：${materialText} 请将这些材质分配到画面中不同的元素上，相邻元素材质对比明显，材质分层清楚。基于参考图生成目标视觉结果。`,
    "结构要求：形状以原图为准，严格保留主体轮廓、元素相对位置、图形数量、视觉层级和整体构图，只做材质、体积、光影或风格转译。",
    colorText,
    "输出清晰锐利，材质和小元素可辨。",
    `语言模型最终负向 Prompt：${negative}`,
  ]
    .filter(Boolean)
    .join("  ");
}

/** 组装"文案直出 + 材质"的生成提示词：按用户文案生成主体并应用所选材质/配色（材质关键词不对用户展示） */
export function buildMaterialCreatePrompt(userText, materialList, palette) {
  const materials = (Array.isArray(materialList) ? materialList : []).filter(Boolean);
  const materialText = materials.map((m) => `${buildMaterialPromptText(m)}。`).join("；");
  const distributeText =
    materials.length > 1
      ? " 请将这些材质分配到画面中不同的元素上，相邻元素材质对比明显，材质分层清楚。"
      : "";
  const colorText = buildPaletteText(palette);
  const negative = palette ? `${COMBO_NEGATIVE}；${COMBO_COLOR_NEGATIVE}` : COMBO_NEGATIVE;
  return [
    `生成内容：${String(userText || "").trim()}。`,
    COMBO_RENDER_STYLE,
    `主体表面材质要求：${materialText}${distributeText}`,
    colorText,
    "输出清晰锐利，材质和小元素可辨。",
    `语言模型最终负向 Prompt：${negative}`,
  ]
    .filter(Boolean)
    .join("  ");
}

/** 组装"一键换材质"的改图提示词；palette 可选，选了则同时替换配色；userInstruction 可选（限定替换范围） */
export function buildMaterialEditPrompt(material, palette, userInstruction = "") {
  const colorText = buildPaletteText(palette);
  const scopeText = buildUserScopeText(userInstruction);
  const negative = palette
    ? `${MATERIAL_NEGATIVE}、${COMBO_COLOR_NEGATIVE.replaceAll("；", "、")}`
    : MATERIAL_NEGATIVE;
  return [
    scopeText
      ? `请基于这张参考图改图。${scopeText}目标材质为「${material.name}」。`
      : `请将这张参考图中主体的表面材质替换为「${material.name}」。`,
    MATERIAL_RENDER_STYLE,
    `目标材质效果：${buildMaterialPromptText(material)}。`,
    "结构要求：形状以原图为准，严格保留主体轮廓、元素相对位置、图形数量、视觉层级和整体构图，姿态、透视、光照方向和背景完全不变，只做材质与质感转译。",
    colorText,
    "要求高分辨率，细节清晰，微纹理可见但尺度很细，材质过渡真实自然，材质分层清楚，材质和小元素可辨。",
    `语言模型最终负向 Prompt：${negative}。`,
  ]
    .filter(Boolean)
    .join("");
}
