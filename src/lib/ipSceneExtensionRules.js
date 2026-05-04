export const ENABLE_IP_SCENE_EXTENSION = true;

const OFFICE_REALISTIC_SCENE_URLS = [
  "/images/ip-scenes/office/realistic/office-realistic-1.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-2.png",
  "/images/ip-scenes/office/realistic/office-realistic-3.webp",
  "/images/ip-scenes/office/realistic/office-realistic-4.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-5.png",
  "/images/ip-scenes/office/realistic/office-realistic-6.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-7.png",
  "/images/ip-scenes/office/realistic/office-realistic-8.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-9.png",
  "/images/ip-scenes/office/realistic/office-realistic-10.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-11.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-12.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-13.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-14.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-15.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-16.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-17.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-18.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-19.png",
  "/images/ip-scenes/office/realistic/office-realistic-20.png",
  "/images/ip-scenes/office/realistic/office-realistic-21.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-22.webp",
  "/images/ip-scenes/office/realistic/office-realistic-23.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-24.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-25.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-26.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-27.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-28.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-29.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-30.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-31.png",
  "/images/ip-scenes/office/realistic/office-realistic-32.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-33.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-34.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-35.webp",
  "/images/ip-scenes/office/realistic/office-realistic-36.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-37.jpg",
  "/images/ip-scenes/office/realistic/office-realistic-38.png",
  "/images/ip-scenes/office/realistic/office-realistic-39.webp",
  "/images/ip-scenes/office/realistic/office-realistic-40.png",
];

const OFFICE_CARTOON_3D_SCENE_URLS = [
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-1.jpg",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-2.png",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-3.jpg",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-4.jpg",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-5.png",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-6.png",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-7.jpg",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-8.png",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-9.jpg",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-10.png",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-11.jpg",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-12.png",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-13.jpg",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-14.png",
  "/images/ip-scenes/office/cartoon-3d/office-cartoon-3d-15.webp",
];

const OFFICE_EZLOGO_URLS = [
  "/images/ip-scenes/office/ezlogo/ezlogo-white.png",
  "/images/ip-scenes/office/ezlogo/ezlogo-black.png",
  "/images/ip-scenes/office/ezlogo/ezlogo-green.png",
];

function pickRandom(items = []) {
  return items[Math.floor(Math.random() * items.length)] || "";
}

function detectRole(promptText = "") {
  const text = String(promptText || "");
  const match = text.match(/(^|[^a-z0-9])(girl|boy|robot)(?=$|[^a-z0-9])/i);
  if (!match) return "";
  const role = match[2].toLowerCase();
  if (role === "boy" && text.includes("真人版")) return "Boy真人版";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function hasIpFamilyIntent(promptText = "") {
  const compact = String(promptText || "").toLowerCase().replace(/\s+/g, "");
  return /(family|easyfamily|ip|家族|角色|人物|机器人|girl|boy|robot)/i.test(compact);
}

function hasOfficeSceneIntent(promptText = "") {
  const compact = String(promptText || "").toLowerCase().replace(/\s+/g, "");
  return /(场景|办公|办公室|工位|工作空间|工作场景|会议室|会议|协作|一起办公|电脑办公|实景办公|office|workspace|workplace|meeting|collaboration)/i.test(compact);
}

function detectScenePreset(promptText = "") {
  const compact = String(promptText || "").toLowerCase().replace(/\s+/g, "");
  if (/(3d卡通|三维卡通|卡通3d|卡通办公|卡通场景|3d场景|c4d|卡通渲染|cartoon3d|3dcartoon)/i.test(compact)) {
    return {
      sceneType: "office-cartoon-3d",
      sceneStyleLabel: "3D 卡通办公场景",
      sceneImageUrl: pickRandom(OFFICE_CARTOON_3D_SCENE_URLS),
    };
  }
  return {
    sceneType: "office-realistic",
    sceneStyleLabel: "实景办公场景",
    sceneImageUrl: pickRandom(OFFICE_REALISTIC_SCENE_URLS),
  };
}

function hasIpSingleEditIntent(promptText = "") {
  const compact = String(promptText || "").toLowerCase().replace(/\s+/g, "");
  return /(换装|换衣服|换服装|换套|改动作|换动作|改姿势|换姿势|换表情|改表情|换发型|改发型|加配饰|加道具|去掉道具|只改|单体|单独)/i.test(compact);
}

function detectAspectRatio(promptText = "") {
  const compact = String(promptText || "").toLowerCase().replace(/\s+/g, "");
  if (/(16[:：]?9|横版|横屏|宽屏|大屏|电脑壁纸|桌面壁纸|landscape|widescreen)/i.test(compact)) {
    return "16:9 横版";
  }
  if (/(9[:：]?16|竖版|竖屏|手机壁纸|story|postervertical|portrait)/i.test(compact)) {
    return "9:16 竖版";
  }
  if (/(1[:：]?1|正方形|方图|square)/i.test(compact)) {
    return "1:1 正方形";
  }
  if (/(4[:：]?3)/i.test(compact)) return "4:3";
  if (/(3[:：]?4)/i.test(compact)) return "3:4";
  return "";
}

export function detectIpSceneExtension(promptText, { hasUserReferenceImages = false, isWaTemplate = false } = {}) {
  if (!ENABLE_IP_SCENE_EXTENSION) return null;
  if (hasUserReferenceImages || isWaTemplate) return null;
  if (hasIpSingleEditIntent(promptText)) return null;

  const role = detectRole(promptText);
  if (!role) return null;
  if (!hasIpFamilyIntent(promptText) || !hasOfficeSceneIntent(promptText)) return null;
  const scenePreset = detectScenePreset(promptText);

  return {
    role,
    sceneType: scenePreset.sceneType,
    sceneStyleLabel: scenePreset.sceneStyleLabel,
    sceneImageUrl: scenePreset.sceneImageUrl,
    logoImageUrls: OFFICE_EZLOGO_URLS,
    aspectRatio: detectAspectRatio(promptText),
  };
}

export function buildIpSceneExtensionPrompt(sceneRequest = {}) {
  const role = sceneRequest.role || "Girl";
  const isRealisticRole = String(role || "").includes("真人版");
  const baseRole = String(role || "").replace("真人版", "") || role;
  const sceneStyleLabel = sceneRequest.sceneStyleLabel || "办公场景";
  const aspectRatio = sceneRequest.aspectRatio || "未指定，参考场景图的自然比例";
  const target = baseRole === "Robot"
    ? "将场景中的非人物主体、小动物、玩具、公仔、装饰角色、辅助机器人或合适的主角位置自然替换为参考图中的 EasyFamily Robot，不要生成通用圆头机器人或其它机器人形象。"
    : `将场景中的主要人物、办公人员、员工或主角自然替换为 EasyFamily ${role}。`;
  const roleIdentity = baseRole === "Robot"
    ? "Robot 必须严格参考 EasyFamily Robot 的原始外形、头身比例、脸部屏幕/五官表达、机身轮廓、耳机/侧边结构、手脚比例、材质和亲和气质；不要变成普通机器人、圆头机器人、白色家用机器人、科幻机器人或其它品牌机器人。"
    : isRealisticRole
      ? `${role} 必须严格参考 EasyFamily ${baseRole} 真人版素材的真实人物特征、发型轮廓、五官比例、眼镜、年轻亲和气质和品牌角色识别度；可以呈现真实人物摄影/半写实商业视觉质感，但不要变成陌生真人模特，也不要退回 3D 卡通、公仔或玩偶。`
      : `${role} 必须严格参考 EasyFamily ${role} 的原始脸型、发型轮廓、五官比例、眼睛大小、眉眼气质、头身比例和亲和表情；不要被办公场景参考图中的真人脸型、发型或服装模特带偏。`;
  const realisticRoleRequirement = isRealisticRole
    ? `- 真人版是 ${baseRole} 的独立视觉变体，只在用户明确写“真人版”时启用；本次必须以参考图中的真人版 ${baseRole} 身份为准，保持真实人物质感与 EasyFamily 识别度，不要混用普通卡通版 ${baseRole} 素材。
- 真人版 ${baseRole} 的正视图是身份锚点：优先保留其脸型、发型轮廓、眼镜、眉眼比例、鼻口关系、年龄气质和亲和表情；服装、姿势和场景可以变化，但不能换成参考场景里的陌生人物脸。
- 真人版的侧视图、背视图和三视图只用于校准头部轮廓、发型体积、侧脸结构、背面发型和整体比例一致性；它们不是构图参考，不要生成三视图排版、角色设定图或多角度展示板。`
    : "";
  const groupRequirement = isRealisticRole
    ? `- 真人版场景默认只生成 1 个 ${role} 主体；即使第一张办公场景参考图中有多人，也不要自动生成多人团队、家族组合、Robot 或其它 EasyFamily 成员，除非用户明确要求多人/团队合照。
- 如果参考办公场景里原本有多人，只保留一个主角位置用于 ${role}，其它人物可以弱化为背景虚化、背影、局部同事或直接移除，不能生成多个相似的 ${role}。`
    : `- 如果第一张办公场景参考图中明显有多个人物、多人会议、多人协作或群体互动，不要只生成单个 IP；应以 EasyFamily 家族化组合出现。
- 多人场景中，EasyFamily ${role} 是主角，同时可以自然加入 Girl、Boy、Robot 中的其他成员作为同事、协作者或 AI 助手，形成家族成员共同办公的画面。
- 家族化组合需要保持每个成员的角色识别度、比例关系、互动关系和空间站位，不要让多人角色互相遮挡或变成陌生人物。`;

  return `请基于第一张内置${sceneStyleLabel}参考图，生成一张 EasyFamily IP 场景化视觉图。参考图只作为办公场景方向和氛围参考，不要 1:1 复刻。

这不是 WA 海报模板，不要套用 WA 左文案右人物版式。
不要添加主标题、副标题、广告大字或营销海报式排版。
可以保留或生成少量环境小字，例如便利贴、桌牌、白板短词，但它们只能作为场景细节。

参考图使用规则：
- 第一张参考图是办公场景参考，用于理解办公主旨、空间氛围、人物与办公物件关系、光影方向和大致风格，不是要求像素级复刻。
- 后续参考图是 EasyFamily IP 角色参考，用于保留角色身份、脸型、发型、五官比例、身体比例、亲和气质和品牌角色识别度。
- 场景参考图不能改变 EasyFamily IP 的身份特征；场景只提供空间和氛围，不能提供新的角色脸、发型或机器人造型。
- 如果提供了后续 logo 参考图，它们是屏幕内容专用 EZlogo 素材，包含白色、黑色、品牌绿色版本；只在可见电脑/平板/大屏屏幕上使用，不要当作主画面 Logo 或合规标识。

场景变化要求：
- 在保持“实景办公场景”主旨的前提下，可以做中等幅度再设计，不要 1:1 复制原参考图。
- 可以改变镜头角度、视距、构图裁切、人物朝向、坐姿/站姿/手势和办公互动方式。
- 可以替换或调整场景里的物品样式和物品类型，例如电脑、平板、桌子、椅子、台灯、杯子、文件、便利贴、绿植、白板、收纳、办公装饰等。
- 可以参考原人物服饰的类型，但不要完全照抄；服装款式、材质、纹理、配色和细节可以重新设计，需适合 EasyFamily ${role} 和办公场景。
- 场景变化幅度建议约 20%-35%：要有新鲜感和设计感，但仍能看出是同类办公空间氛围。

画面比例要求：
- 用户指定的画面比例：${aspectRatio}。
- 如果用户指定了横版、竖版、正方形、16:9、9:16、1:1、4:3 或 3:4 等比例，需要按该比例重新组织构图。
- 可以对参考办公场景做适当裁剪、延展、补全边缘空间或重新安排主体位置，不要被参考图原始比例锁死。
- 裁剪时必须保留办公主旨、IP 主体、关键办公物件和自然空间关系；不要裁掉人物头部、手部、电脑/桌面等关键互动信息。
- 未指定比例时，优先保持参考场景图的自然比例和舒适构图。

屏幕内容要求：
- 如果场景里出现可见的电脑屏幕、笔记本屏幕、平板屏幕、会议大屏或显示器，EZlogo 是可选元素，不是必须出现。
- 这里的 EZlogo 指后续 logo 参考图里的实际图形素材，不是英文“EZlogo”文字；不要生成“EZlogo”这几个英文字母。
- 只有当屏幕面积、角度和画面构图适合时，才可以在屏幕上放置参考图中的 EZlogo 图形素材。
- 如果出现屏幕 logo，必须严格复制参考 logo 的形状结构，只能从白色、黑色、品牌绿色版本中选择一个与屏幕底色对比最清晰的版本。
- 不要把参考 logo 重绘成普通笑脸、圆脸、表情符号、抽象微笑、斜杠图标、字母 Z 或其它近似图标。
- 如果不适合放 logo，或者无法准确复制参考 logo，就让屏幕保持自然办公状态：空白、暗屏、浅色反光、简洁桌面背景或低干扰界面均可。
- 屏幕内容应保持简洁，可以是纯色/低干扰背景，也可以没有 logo；不要显示复杂 UI、数据图表、大段文字、网页界面或其它品牌内容。
- 如果屏幕角度太小或被遮挡，可以保持屏幕为空白/暗屏/浅色反光，不要强行生成 logo 或不可读文字。

主体替换要求：
- 指定角色：EasyFamily ${role}。
- ${target}
- 角色身份一致性是最高优先级之一：${roleIdentity}
${realisticRoleRequirement}
- 可以根据办公场景调整服装、姿势、角度和光影，但脸型、发型、五官比例、机器人结构和核心识别点必须来自 EasyFamily IP 参考图。
${groupRequirement}
- 替换后的 IP 必须自然融入原办公场景，比例、角度、姿态、脚底接触、遮挡关系、光影方向和阴影都要匹配。
- 看起来像 EasyFamily ${role} 本来就在这个办公室里，而不是后期贴图。
- 保持与第一张${sceneStyleLabel}参考图一致的办公质感，可以将 IP 适度转译成与场景匹配的实景融合、3D 卡通或半写实卡通质感，但不要丢失 EasyFamily 识别度。
- 如果画面中需要互动，可以让角色办公、看电脑、讨论任务、拿文件、使用白板或与办公设备互动。

禁止：
- 不要 1:1 复刻参考图，也不要只做简单贴脸替换。
- 不要重新设计成与办公无关的完全不同新场景。
- 不要加入 WA 模板、Logo+OJK 合规锁定区、主副标题或大面积营销文案。
- 不要在电脑、平板或大屏上强制生成 EZlogo；没有 logo 也可以。若出现 logo，只能使用参考 EZlogo。
- 不要在屏幕、电脑背面、杯子、便利贴或墙面上生成普通笑脸、抽象笑脸或错误 logo；只有能准确参考 logo 图形时才允许出现。
- 不要复制场景参考图里真人的人脸、发型或机器人造型；人物/Robot 的身份必须来自 EasyFamily IP 参考图。
- 不要把 Robot 生成为通用办公机器人、宠物机器人、圆形屏幕机器人或陌生科技产品。
- 不要让角色漂浮、比例失真、光影不一致或像贴纸。
- 不要把 EasyFamily 角色变成陌生 IP。`;
}
