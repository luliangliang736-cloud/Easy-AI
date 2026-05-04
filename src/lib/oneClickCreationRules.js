export function detectEzFamilyTrigger(promptText) {
  const text = String(promptText || "");
  const match = text.match(/(^|[^a-z0-9])(boy|girl|robot)(?=$|[^a-z0-9])/i);
  if (!match) return null;
  const role = match[2].toLowerCase();
  if (role === "boy" && text.includes("真人版")) return "Boy真人版";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function buildEzFamilyTriggerPrompt(promptText, role, { hasUserReferenceImages = false } = {}) {
  const originalPrompt = String(promptText || "").trim();
  const roleName = String(role || "").trim() || "Boy";
  const baseRole = roleName.replace("真人版", "") || roleName;
  const isRobot = baseRole.toLowerCase() === "robot";
  const identityName = `EasyFamily ${roleName}`;
  const targetInstruction = hasUserReferenceImages
    ? `- 第一张参考图是用户要修改/复刻/迁移的目标图，必须保留其构图、版式、背景、文字层级、人物姿势和画面比例。
- 后续自动加入的参考图是 ${identityName} 身份锚点，必须用它替换目标图中的主要人物/角色。`
    : `- 自动加入的参考图是 ${identityName} 身份锚点，必须把 ${identityName} 作为画面主角。`;
  const roleInstruction = isRobot
    ? "不要生成通用机器人、圆头机器人或陌生机器人；必须保留 EasyFamily Robot 的核心外形、脸部/屏幕比例、身体结构和品牌识别度。"
    : `不要生成通用 ${baseRole.toLowerCase()}、小男孩、小女孩、陌生真人或随机卡通人物；必须保留 ${identityName} 的核心脸型、发型轮廓、眼镜/五官比例、年轻亲和气质和品牌角色识别度。`;

  return `${originalPrompt}

EZfamily trigger instructions:
- “${baseRole.toLowerCase()}” 是系统触发词，只用于选择 ${identityName} 参考素材；不要把它理解成普通英文含义，也不要在画面中写出 “${baseRole.toLowerCase()}”。
${targetInstruction}
- ${roleInstruction}
- 可以根据用户需求调整服装、姿势、表情、道具和画面风格，但身份必须来自 ${identityName} 参考图。
- 如果用户说“复制/复刻/替换到这张图/海报”，优先保持目标图整体画面，只替换主人物身份，不要重做成全新无关构图。`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanLabeledValue(value = "") {
  return String(value || "")
    .trim()
    .replace(/^["“”']|["“”']$/g, "")
    .trim();
}

function pickLabeledLine(text, labels = [], stopLabels = []) {
  const stopPattern = stopLabels.map(escapeRegExp).join("|");
  for (const label of labels) {
    const safeLabel = escapeRegExp(label);
    const quotedPattern = new RegExp(`${safeLabel}\\s*[:：]?\\s*["“']([^"“”'\\n\\r]+)["”']`, "i");
    const quotedMatch = text.match(quotedPattern);
    if (quotedMatch?.[1]) return cleanLabeledValue(quotedMatch[1]);

    const pattern = stopPattern
      ? new RegExp(`${safeLabel}\\s*[:：]\\s*([\\s\\S]*?)(?=\\s*(?:${stopPattern})\\s*(?:[:：]|["“'])|$)`, "i")
      : new RegExp(`${safeLabel}\\s*[:：]\\s*([^\\n\\r]+)`, "i");
    const match = text.match(pattern);
    if (match?.[1]) return cleanLabeledValue(match[1]);
  }
  return "";
}

function detectWaOutfitStyle(text = "") {
  const explicit = pickLabeledLine(
    text,
    ["服饰", "服装", "穿搭", "人物服饰", "人物服装", "outfit", "clothing"],
    ["主标题", "标题", "副标题", "副文案", "headline", "subline", "subtitle"]
  );
  if (explicit) return explicit;

  const compact = String(text || "").toLowerCase().replace(/\s+/g, "");
  if (/(印尼医生制服|印度尼西亚医生制服|印尼医生|印度尼西亚医生|doctoruniform|doctorcoat|medicaluniform|医生制服|医生服|白大褂|护士服|nurseuniform)/i.test(compact)) {
    return "印尼医生制服人物：wear an Indonesian doctor-style uniform, clean white doctor coat or medical tunic, neat collar, professional healthcare staff styling, subtle Indonesian local styling if suitable; the outfit must be clearly visible on the character, but do not add hospital scenes, red cross symbols, pills, syringes, ECG lines, ambulance, or medical background icons";
  }
  if (/(印尼制服|印度尼西亚制服|制服服装|制服人物|职业制服|工作制服|uniform)/i.test(compact)) {
    return "职业制服人物：wear a clear professional uniform instead of casual clothing, with structured collar, neat shirt or jacket, coordinated skirt/trousers, badge/name-tag or simple work accessory when suitable; keep it modern, clean, friendly, and ad-friendly";
  }
  if (/(印尼传统服饰|印尼服饰|印尼传统|印度尼西亚传统服饰|印度尼西亚服饰|batik|kebaya|sarong|songket|peci|blangkon)/i.test(compact)) {
    return "印尼传统服饰：明显使用 Indonesian traditional clothing elements such as batik pattern, kebaya-inspired top, sarong/songket fabric details, peci/blangkon-inspired accessory when suitable; keep it modern, respectful, clean, and ad-friendly";
  }
  if (/(商务服饰|商务服装|商务装|商务版|商务风|西装|正装|职业装|职场|business|formal|suit|professional)/i.test(compact)) {
    return "商务服饰：西装、衬衫、职业装、金融顾问感，专业可信但保持年轻亲和";
  }
  if (/(休闲|日常|casual|轻松|卫衣|t恤|t-shirt|hoodie)/i.test(compact)) {
    return "休闲服饰：T恤、卫衣、轻便外套、日常穿搭，年轻轻松";
  }
  if (/(运动|活力|sports|sporty|运动服|棒球帽|球衣)/i.test(compact)) {
    return "运动活力服饰：运动外套、棒球帽、运动衫，活力但不夸张";
  }
  if (/(科技|tech|未来|机能|夹克|工装|utility)/i.test(compact)) {
    return "科技机能服饰：简洁夹克、机能细节、科技感配饰，干净高级";
  }
  if (/(节日|holiday|festive|庆祝|礼物|新年|圣诞)/i.test(compact)) {
    return "节日活动服饰：轻微节日配色或配饰，保持品牌专业感";
  }
  return "";
}

const WA_VISUAL_STYLE_RULES = [
  {
    pattern: /(达芬奇|文艺复兴|写实透视|renaissance|davinci|leonardo)/i,
    prompt: "文艺复兴写实透视风格：classical balanced composition, realistic perspective, soft sfumato-like transitions, warm museum-grade tones, elegant depth and proportion; adapt only as an aesthetic layer for the WA poster",
  },
  {
    pattern: /(米开朗基罗|雕塑人体|雄浑|michelangelo)/i,
    prompt: "古典雕塑雄浑风格：sculptural volume, strong anatomical form simplified for ad-friendly character design, marble-like light and shadow, monumental but clean composition",
  },
  {
    pattern: /(拉斐尔|柔美典雅|圣母画风|raphael)/i,
    prompt: "柔美典雅古典风格：harmonious composition, soft warm light, gentle facial expression, elegant curves, balanced classical color palette, calm and refined visual mood",
  },
  {
    pattern: /(波提切利|唯美线条|空灵画风|botticelli)/i,
    prompt: "唯美线条空灵风格：delicate flowing lines, airy composition, elegant contours, soft pastel classical palette, poetic and light decorative rhythm",
  },
  {
    pattern: /(伦勃朗|光影暗调|暗调油画|rembrandt)/i,
    prompt: "伦勃朗式古典暗调光影：dramatic chiaroscuro, warm dark oil-painting atmosphere, focused key light, deep shadows, premium classical depth; keep title readable",
  },
  {
    pattern: /(维米尔|静谧光影|静物静谧|vermeer)/i,
    prompt: "静谧室内光影风格：quiet soft window-like light, muted refined palette, calm spatial order, subtle texture, intimate classical stillness",
  },
  {
    pattern: /(莫奈|印象派|光影朦胧|monet|impressionism)/i,
    prompt: "印象派光影朦胧风格：soft atmospheric color, broken light, gentle blurry edges, pastel outdoor feeling, painterly texture while keeping ad text crisp",
  },
  {
    pattern: /(雷诺阿|暖调人物|柔色画风|renoir)/i,
    prompt: "暖调人物柔色风格：warm luminous palette, soft rounded portrait feeling, gentle painterly texture, friendly human warmth, low contrast background",
  },
  {
    pattern: /(梵高|凡高|狂野笔触|浓烈色彩|vangogh|van-gogh)/i,
    prompt: "后印象派浓烈笔触风格：expressive swirling brush texture, vivid color contrast, energetic strokes, emotional painterly background, controlled so the WA title remains readable",
  },
  {
    pattern: /(高更|原始质朴|平涂画风|gauguin)/i,
    prompt: "原始质朴平涂风格：bold flat color areas, simplified forms, warm earthy palette, decorative primitive rhythm, clean poster-like structure",
  },
  {
    pattern: /(塞尚|几何结构|静物之父|cezanne|cézanne)/i,
    prompt: "塞尚式几何结构风格：structured planes, simplified geometric volume, stable composition, muted painterly palette, analytical still-life-inspired layout",
  },
  {
    pattern: /(修拉|点彩|点彩像素|seurat|pointillism)/i,
    prompt: "点彩像素风格：small dot texture, optical color mixing feeling, pixel-like painterly surface, controlled dotted gradients, clean readable title area",
  },
  {
    pattern: /(毕加索|立体主义|解构画风|picasso|cubism)/i,
    prompt: "立体主义解构风格：fragmented geometric planes, angular simplified shapes, multiple-perspective decorative blocks, flat painterly color, ad-friendly abstraction",
  },
  {
    pattern: /(康定斯基|抽象几何色彩|kandinsky)/i,
    prompt: "抽象几何音乐感风格：circles, lines, triangles and rhythmical color accents, abstract balanced composition, expressive but clean decorative geometry",
  },
  {
    pattern: /(马列维奇|至上主义|极简几何|malevich|suprematism)/i,
    prompt: "至上主义极简几何风格：minimal floating geometric blocks, strong white space, black/red/neutral accents, radical but clean layout, strict readable hierarchy",
  },
  {
    pattern: /(达利|梦境荒诞写实|dali|dalí|surreal)/i,
    prompt: "超现实梦境写实风格：dreamlike but polished composition, subtle impossible shapes, soft surreal lighting, unusual symbolic elements kept minimal and non-distracting",
  },
  {
    pattern: /(马格里特|超现实隐喻|magritte)/i,
    prompt: "超现实隐喻写实风格：clean realistic objects with unexpected poetic placement, quiet mystery, clear sky/solid shapes, restrained surreal metaphor",
  },
  {
    pattern: /(夏加尔|梦幻童话漂浮|chagall)/i,
    prompt: "梦幻童话漂浮风格：floating poetic shapes, soft whimsical palette, dreamy composition, gentle stars/curves, magical but uncluttered advertising mood",
  },
  {
    pattern: /(弗里达|自画像情绪隐喻|frida|kahlo)/i,
    prompt: "情绪隐喻装饰肖像风格：symbolic decorative motifs, strong portrait presence, folk-inspired color accents, emotional but respectful and ad-friendly expression",
  },
  {
    pattern: /(安迪沃霍尔|沃霍尔|波普丝网|丝网印刷|warhol)/i,
    prompt: "波普丝网印刷风格：bold repeated color blocks, screen-print texture, high-contrast pop palette, commercial poster energy, clean graphic treatment",
  },
  {
    pattern: /(草间弥生|波点密集|kusama)/i,
    prompt: "波点迷幻装饰风格：dense but controlled polka-dot patterns, optical repetition, bright decorative rhythm, keep dots away from main title readability",
  },
  {
    pattern: /(村上隆|超扁平|日系超扁平|murakami|superflat)/i,
    prompt: "日系超扁平卡通风格：flat colorful cartoon shapes, flower-like playful motifs, crisp outlines, high-saturation cheerful accents, 2D poster feeling",
  },
  {
    pattern: /(巴斯奎特|街头涂鸦野性|basquiat)/i,
    prompt: "原始街头涂鸦表现风格：rough hand-drawn marks, crown-like doodle accents, raw energetic strokes, expressive urban texture, controlled to avoid messy text area",
  },
  {
    pattern: /(蒙克|表现主义情绪|munch)/i,
    prompt: "表现主义情绪风格：wavy emotional lines, moody color contrast, expressive sky/background rhythm, dramatic but controlled atmosphere",
  },
  {
    pattern: /(克里姆特|金色装饰|华丽纹样|klimt)/i,
    prompt: "金色装饰艺术风格：ornamental gold pattern accents, mosaic-like decoration, elegant flat decorative surfaces, premium ornate details kept around edges",
  },
  {
    pattern: /(莫迪里阿尼|拉长人像|modigliani)/i,
    prompt: "拉长人像优雅极简风格：elongated elegant character proportions, calm simplified face, muted palette, graceful minimal portrait rhythm",
  },
  {
    pattern: /(马蒂斯|野兽派|高饱和平涂|matisse|fauvism)/i,
    prompt: "野兽派高饱和平涂风格：bold saturated flat color, paper-cut-like shapes, lively simplified decorative composition, joyful strong contrast",
  },
  {
    pattern: /(宫崎骏|吉卜力|日系田园治愈|ghibli|miyazaki)/i,
    prompt: "日系田园治愈动画感：soft hand-painted watercolor-like background, warm natural light, gentle pastoral mood, clean friendly character expression; use broad animation-healing traits rather than copying any specific artist",
  },
  {
    pattern: /(阿尔丰斯穆夏|穆夏|曲线人物海报|mucha)/i,
    prompt: "穆夏装饰海报风格：art nouveau curves, elegant ornamental frames, flowing hair/line rhythm, floral decorative borders, refined vintage poster composition",
  },
  {
    pattern: /(亚瑟拉克姆|复古童话插画|rackham)/i,
    prompt: "复古童话插画风格：delicate ink lines, muted watercolor texture, whimsical old-storybook atmosphere, fine decorative details kept subtle",
  },
  {
    pattern: /(约翰豪|艾伦李|中土|魔幻史诗|暗黑童话|johnhowe|alanlee)/i,
    prompt: "史诗奇幻插画风格：cinematic fantasy lighting, misty depth, detailed painterly atmosphere, heroic but clean composition adapted for fintech poster readability",
  },
  {
    pattern: /(格雷格鲁特科夫斯基|rutkowski|史诗ai|热门光影大神)/i,
    prompt: "史诗级数字绘画光影风格：cinematic painterly lighting, dramatic depth, polished concept-art atmosphere, rich but controlled illumination; avoid copying any living artist directly",
  },
  {
    pattern: /(葛饰北斋|北斋|浮世绘海浪|hokusai)/i,
    prompt: "浮世绘海浪版画风格：Japanese woodblock print texture, wave-like decorative lines, flat color areas, cream paper background, strong outline rhythm",
  },
  {
    pattern: /(歌川广重|广重|浮世绘风景|hiroshige)/i,
    prompt: "浮世绘风景版画风格：flat landscape-inspired color blocks, subtle gradient sky, woodblock texture, elegant Japanese print composition",
  },
  {
    pattern: /(奈良美智|孤独小孩|nara)/i,
    prompt: "孤独童真极简插画风格：simple childlike character mood, sparse background, muted cute-but-cool palette, minimal emotional expression; use broad traits only",
  },
  {
    pattern: /(山本修作|治愈肌理水彩)/i,
    prompt: "治愈肌理水彩风格：soft watercolor texture, warm handmade grain, gentle low-saturation colors, cozy illustration mood, clean readable poster layout",
  },
  {
    pattern: /(kaws|解构卡通玩偶)/i,
    prompt: "解构潮流卡通玩偶风格：bold toy-like silhouette, simplified cartoon forms, street-art collectible feeling, strong clean outlines; use broad traits only and keep brand-friendly",
  },
  {
    pattern: /(丹尼尔阿沙姆|阿沙姆|灰白雕塑|arsham)/i,
    prompt: "灰白侵蚀雕塑极简风格：monochrome stone/plaster texture, eroded sculptural details, clean gallery-like minimalism, quiet futuristic art object mood",
  },
  {
    pattern: /(罗恩english|ronenglish|复古街头涂鸦)/i,
    prompt: "复古街头涂鸦商业风格：bold satirical pop-street energy, vintage billboard texture, playful graphic marks, bright commercial colors, controlled and brand-safe",
  },
  {
    pattern: /(杰夫昆斯|气球雕塑|koons)/i,
    prompt: "高光气球雕塑艺术风格：glossy balloon-like 3D forms, reflective surfaces, playful luxury pop-object feeling, clean studio lighting",
  },
  {
    pattern: /(巴尔蒂斯|静谧古典含蓄|balthus)/i,
    prompt: "静谧古典含蓄风格：quiet classical interior mood, muted colors, restrained composition, subtle psychological stillness, respectful and ad-appropriate",
  },
  {
    pattern: /(大卫霍克尼|霍克尼|明亮色块平涂|hockney)/i,
    prompt: "明亮色块平涂风格：sunny flat color areas, clean pool/landscape-like graphic blocks, optimistic modern palette, simple cheerful geometry; use broad traits only",
  },
  {
    pattern: /(培根|扭曲情绪人像|francisbacon)/i,
    prompt: "扭曲表现人像风格：distorted emotional portrait energy, smeared painterly forms, dark expressive mood, but keep it softened and suitable for a commercial ad",
  },
  {
    pattern: /(德库宁|抽象狂野笔触|dekooning)/i,
    prompt: "抽象表现狂野笔触风格：large energetic brush strokes, layered painterly marks, expressive color fields, keep the title area clean and readable",
  },
  {
    pattern: /(张大千|泼墨泼彩|dazhang|zhangdaqian)/i,
    prompt: "泼墨泼彩山水风格：Chinese ink splash and color wash, misty landscape rhythm, elegant abstract ink texture, brand-friendly restrained composition",
  },
  {
    pattern: /(徐悲鸿|中西融合写实|xubeihong)/i,
    prompt: "中西融合写实水墨风格：ink brush energy with realistic structure, elegant calligraphic lines, restrained monochrome plus brand accents, dignified composition",
  },
  {
    pattern: /(齐白石|写意花鸟|qibaishi)/i,
    prompt: "简约写意花鸟风格：minimal Chinese brush painting, expressive ink lines, sparse composition, small organic motifs, strong whitespace and poetic rhythm",
  },
  {
    pattern: /(吴冠中|极简线条水墨抽象|wuguanzhong)/i,
    prompt: "极简线条水墨抽象风格：thin black ink lines, abstract landscape rhythm, white space, small color accents, modern Chinese ink composition",
  },
  {
    pattern: /(ins小众治愈|小众治愈|ins治愈|instagram小众|instagram治愈|ins风|insstyle|莫兰迪|马卡龙|奶油风|盐系极简|韩系简约|日系清新|低饱和氛围感|复古奶油)/i,
    prompt: "ins 小众治愈风格：soft Instagram niche healing aesthetic, airy whitespace, warm cream/pastel palette, gentle natural light, soft grain, subtle rounded cards, delicate decorative dots/flowers/stars, calm composition, cozy and clean; avoid heavy contrast, neon, metallic, or aggressive tech effects",
  },
  {
    pattern: /(治愈风|治愈系|温柔风|柔和风|暖色治愈|温柔治愈|晴空治愈|healing|softwarm)/i,
    prompt: "温柔治愈风格：warm soft palette, gentle light, rounded shapes, airy spacing, calm background, soft shadows, friendly emotional tone, low visual pressure",
  },
  {
    pattern: /(炫酷风格|酷炫风格|炫酷|酷炫|coolstyle|科技酷感|科技炫酷)/i,
    prompt: "炫酷风格：high-impact cool visual style, darker or high-contrast brand color blocks, dynamic diagonal shapes, sharper lighting, glossy 3D accents, subtle neon green highlights, stronger depth and motion feeling; keep the WA layout readable and avoid clutter",
  },
  {
    pattern: /(赛博朋克|赛博|cyberpunk|neon|霓虹|霓虹赛博|元宇宙风|全息光影|量子科技)/i,
    prompt: "赛博霓虹风格：dark tech background, neon green/purple/blue accents, glowing lines, futuristic panels, strong contrast, subtle digital grid, glossy highlights; keep text readable and avoid excessive clutter",
  },
  {
    pattern: /(科技风|科技未来|未来感|未来科技|futuristic|techstyle|数字科技|智能科技|网格科技|深空极简|暗黑科技|人工智能风|数字化极简)/i,
    prompt: "未来科技风格：clean futuristic fintech look, cool gradients, glass panels, subtle grids, digital particles, precise geometric lines, green tech highlights, polished depth",
  },
  {
    pattern: /(高级感|高端|轻奢|轻奢极简|高级性冷淡|高端雅致|净版高级风|premium|luxury|minimalpremium)/i,
    prompt: "高级简洁风格：premium minimal design, restrained palette, refined spacing, subtle shadows, clean typography, matte texture, elegant brand green accents, no noisy decoration",
  },
  {
    pattern: /(极简主义|极简|现代简约|简约|minimal|minimalist|留白|留白极简|极简几何|数字化极简)/i,
    prompt: "极简留白风格：large clean whitespace, restrained decoration, precise alignment, simple geometric cards, calm palette, strong typography hierarchy, no unnecessary elements",
  },
  {
    pattern: /(可爱|萌系|cute|kawaii|甜美|软萌)/i,
    prompt: "可爱亲和风格：soft cute friendly design, rounded shapes, warmer pastel colors, playful but clean decorations, gentle character styling, keep it professional for fintech advertising",
  },
  {
    pattern: /(潮流|潮酷|街头|street|streetwear|潮牌|街头潮牌|年轻潮流|甜酷辣妹|元气亮色|多巴胺|糖果撞色|y2k|千禧)/i,
    prompt: "潮流街头风格：young trendy composition, bold typography, stickers or badges, dynamic color blocks, streetwear-inspired energy, playful layout accents; keep brand and text readable",
  },
  {
    pattern: /(电商|促销|大促|活动促销|sale|promo|campaign|爆款)/i,
    prompt: "电商促销风格：clear campaign visual hierarchy, energetic sale-like composition, bold cards, strong callout shapes, bright brand accents, commercial but not cluttered",
  },
  {
    pattern: /(节日|节庆|新年|春节|圣诞|开斋节|eid|ramadan|holiday|festive)/i,
    prompt: "节日活动风格：festive but controlled atmosphere, warm celebratory colors, subtle seasonal ornaments, gentle sparkles or ribbons, keep fintech brand trust and layout clarity",
  },
  {
    pattern: /(复古港风|港风|香港复古|港式复古|hongkongretro|hkretro)/i,
    prompt: "复古港风风格：make the design clearly feel like 80s-90s Hong Kong commercial poster aesthetics, with vintage film grain, slightly faded warm colors, bold Cantonese-era poster rhythm, neon-sign inspired color accents, retro street poster texture, cream/yellow/red/green tonal accents when suitable, strong but readable title hierarchy; do not make it only a generic green fintech template or generic paper texture",
  },
  {
    pattern: /(复古|怀旧|retro|vintage|胶片|film|复古港风|复古美式|欧式复古|中世纪复古|复古胶片|复古报刊|老式印刷风|90年代复古|美式复古|复古民国)/i,
    prompt: "复古怀旧风格：retro color palette, soft film grain, vintage card shapes, gentle faded texture, classic poster feeling, still clean and readable for modern fintech ads",
  },
  {
    pattern: /(3d风|3d海报|立体|c4d|blender|三维|立体感)/i,
    prompt: "3D 立体风格：polished 3D poster look, soft studio lighting, rounded 3D shapes, dimensional cards, clean shadows, glossy but controlled materials",
  },
  {
    pattern: /(扁平化插画|扁平|flat|插画风|illustration|矢量|vector|轻肌理插画|漫风简约)/i,
    prompt: "扁平插画风格：flat vector-inspired layout, clean shapes, simplified decorative elements, crisp color blocks, friendly illustration feeling, avoid realistic clutter",
  },
  {
    pattern: /(渐变|弥散|酸性渐变|gradient|meshgradient|aurora|极光|渐变流体|弥散渐变|镭射渐变|渐变梦幻)/i,
    prompt: "渐变弥散风格：soft mesh gradient or aurora gradient background, smooth color transitions, translucent panels, atmospheric depth, keep text area high contrast",
  },
  {
    pattern: /(玻璃拟态|毛玻璃|磨砂玻璃|glassmorphism|frostedglass|亚克力通透|玻璃通透)/i,
    prompt: "玻璃拟态风格：frosted glass panels, translucent layers, soft blur, subtle borders, clean highlights, airy modern interface feeling",
  },
  {
    pattern: /(新拟态|neumorphism|软塑|softui)/i,
    prompt: "新拟态软塑风格：soft extruded cards, gentle inner/outer shadows, low-contrast surfaces, rounded tactile panels, clean and calm composition",
  },
  {
    pattern: /(孟菲斯|memphis|波普|pop|波普风|波普艺术)/i,
    prompt: "孟菲斯波普风格：playful geometric shapes, dots, arcs, bright accents, energetic but controlled composition, avoid overwhelming the title area",
  },
  {
    pattern: /(国潮|新中式|东方|oriental|chinoiserie|国潮传统|国潮手绘|国风雅致|水墨写意|古风工笔|敦煌国风|宋式美学|中式留白|东方禅意|市井国潮|非遗纹样风)/i,
    prompt: "国潮新中式风格：modern oriental visual rhythm, refined line patterns, warm red/gold/green accents when suitable, elegant decorative frames, keep it modern and fintech-friendly",
  },
  {
    pattern: /(印尼风|印尼本土|东南亚|indonesia|indonesian|southeastasia)/i,
    prompt: "印尼本土化风格：subtle Indonesian/Southeast Asian inspired palette and decorative motifs, warm local-friendly mood, tasteful patterns, modern fintech advertising style",
  },
  {
    pattern: /(商务风|商务正装风|企业风|办公风|政企稳重风|businessstyle|corporate|professional|企业商务|品牌极简|商业轻奢|投行风|融资bp风|专业咨询风|高端提案风|数据可视化风)/i,
    prompt: "商务企业风格：professional corporate layout, trustworthy palette, clean cards, precise alignment, restrained decoration, confident and reliable fintech tone",
  },
  {
    pattern: /(年轻活力|活力|青春|vibrant|energetic|youth)/i,
    prompt: "年轻活力风格：bright energetic color accents, dynamic shapes, friendly rhythm, light motion feeling, optimistic youth-oriented fintech ad mood",
  },
  {
    pattern: /(自然|清新|森系|fresh|natural|organic|文艺清新|田园风|植物森系|水墨自然|山野极简|大地色系|日系侘寂|原木风|森系自然)/i,
    prompt: "自然清新风格：fresh light palette, organic soft shapes, subtle leaf/curve motifs, breathable whitespace, clean daylight feeling, avoid heavy decoration",
  },
  {
    pattern: /(暗黑|黑金|dark|darkmode|blackgold)/i,
    prompt: "暗黑高级风格：dark premium background, green/gold subtle highlights, strong contrast, elegant lighting, glossy cards, keep logo and title readable",
  },
  {
    pattern: /(手绘|涂鸦|doodle|handdrawn|sketch)/i,
    prompt: "手绘涂鸦风格：light doodle accents, hand-drawn lines, playful marks, warm human touch, but keep main layout polished and not messy",
  },
  {
    pattern: /(蒙德里安|mondrian|风格派|de stijl|destijl)/i,
    prompt: "蒙德里安 / De Stijl 风格：make the visual style clearly recognizable with black grid lines, rectangular color blocks, asymmetrical geometric layout, primary-color accents inspired by red/yellow/blue plus brand green used carefully, large white/cream negative space, flat 2D composition, strict right-angle structure; do not make it only generic green diagonal shapes or ordinary fintech geometry",
  },
  {
    pattern: /(低多边形|lowpoly|几何拼接|抽象艺术|解构主义|极简线条|拼贴艺术|极简切割|对角线几何)/i,
    prompt: "几何抽象风格：abstract geometric composition, clean linework, diagonal cuts, collage-like or low-poly accents when suitable, strong structure, keep the WA text area clean and readable",
  },
  {
    pattern: /(磨砂质感|金属质感|大理石纹理|木纹肌理|岩石质感|哑光高级|皮革肌理|磨砂金属|微噪点肌理|肌理质感)/i,
    prompt: "肌理质感风格：material-focused visual design, subtle grain or texture, matte/premium surfaces, refined lighting, tactile background details, avoid realistic clutter that distracts from the title",
  },
  {
    pattern: /(卡通q版|q版|美式卡通|二次元|复古像素|像素风)/i,
    prompt: "卡通潮流风格：playful cartoon-inspired visual language, friendly rounded shapes, clean colorful accents, light character-driven energy, keep fintech trust and layout clarity",
  },
  {
    pattern: /(少女粉系|梦幻仙气|珠光闪粉|马卡龙甜系|可爱萌系)/i,
    prompt: "少女甜系风格：soft pink or pastel palette, dreamy light, pearl/sparkle accents, rounded cute shapes, sweet but clean composition, avoid over-decorating the text area",
  },
  {
    pattern: /(工业风|硬核机械|军工风|机能风|废墟极简|粗犷肌理|硬核暗黑|机车复古|极简工业)/i,
    prompt: "工业硬核风格：structured mechanical feeling, dark or neutral palette, rough texture, utility details, bold geometric blocks, keep the fintech ad polished and readable",
  },
  {
    pattern: /(轻奢欧式|巴洛克|洛可可)/i,
    prompt: "欧式轻奢风格：elegant classical ornament accents, refined gold/cream tones when suitable, premium decorative framing, controlled luxury mood, avoid excessive ornate clutter",
  },
];

function detectWaVisualStyle(text = "") {
  const explicit = pickLabeledLine(
    text,
    ["风格", "画面风格", "视觉风格", "设计风格", "style"],
    ["主标题", "标题", "副标题", "副文案", "服饰", "服装", "人物服饰", "人物服装", "headline", "subline", "subtitle", "outfit", "clothing"]
  );
  if (explicit) {
    const explicitCompact = explicit.toLowerCase().replace(/\s+/g, "");
    for (const rule of WA_VISUAL_STYLE_RULES) {
      if (rule.pattern.test(explicitCompact)) return rule.prompt;
    }
    return explicit;
  }

  const compact = String(text || "").toLowerCase().replace(/\s+/g, "");
  for (const rule of WA_VISUAL_STYLE_RULES) {
    if (rule.pattern.test(compact)) return rule.prompt;
  }
  return "";
}

export function parseWaTemplateRequest(promptText) {
  const text = String(promptText || "").trim();
  if (!text) return null;

  const headlineLabels = ["主标题", "标题", "headline"];
  const sublineLabels = ["副标题", "副文案", "subline", "subtitle"];
  const headline = pickLabeledLine(text, headlineLabels, sublineLabels);
  const subline = pickLabeledLine(text, sublineLabels, headlineLabels);
  if (!headline || !subline) return null;

  return {
    headline,
    subline,
    outfitStyle: detectWaOutfitStyle(text),
    visualStyle: detectWaVisualStyle(text),
  };
}

export function chooseWaTemplateIpRole({ headline = "", subline = "" } = {}) {
  const compact = `${headline} ${subline}`.toLowerCase().replace(/\s+/g, "");
  if (/(robot|科技|安全|自动|cepat|5menit|menit|cair|limit)/i.test(compact)) return "Robot";
  if (/(hemat|bebas|cicilan|promo|diskon|extra|ekstra|优惠|省钱|促销)/i.test(compact)) return "Boy";
  const roles = ["Girl", "Boy", "Robot"];
  return roles[Math.floor(Math.random() * roles.length)];
}

function chooseWaTemplateProp({ headline = "", subline = "" } = {}) {
  const compact = `${headline} ${subline}`.toLowerCase().replace(/\s+/g, "");
  if (/(vip|gold|benefit|exclusive|eksklusif|会员|权益)/i.test(compact)) return "VIP card or crown badge";
  if (/(hemat|bebas|cicilan|promo|diskon|extra|ekstra|优惠|省钱|促销|折扣|分期)/i.test(compact)) return "coupon or cash, choose only one";
  if (/(cepat|5menit|menit|cair|limit|到账|放款|额度|快速|手机|app|aplikasi|download|下载)/i.test(compact)) return "cash received phone or stopwatch, choose only one";
  if (/(aman|tenang|trusted|secure|安心|安全|放心)/i.test(compact)) return "shield or check icon, choose only one";
  return "small check badge, abstract brand shape, or minimal financial accent, choose only one; avoid phone mockup by default";
}

function pickRandom(items = []) {
  return items[Math.floor(Math.random() * items.length)] || "";
}

function chooseWaTemplateBackgroundStyle(visualStyle = "") {
  if (visualStyle) {
    return `${visualStyle}; use the requested visual style as an auxiliary aesthetic layer through color palette, background texture, card/panel shape, decorative elements, lighting, and overall mood while preserving the original WA template layout, brand assets, and readability`;
  }
  return pickRandom([
    "low-interference micro gradient noise or frosted texture, 1%-5% opacity, only to add subtle material quality",
    "brand green tonal micro texture, low-saturation dots, diagonal grain, or soft wave pattern with very low contrast",
    "split-color geometric background using brand color diagonal cut, corner block, or L-shape occupying only 1/3-1/2 of the background",
    "low-saturation thin line grid, parallel diagonal lines, dotted frame, hexagon or circle outlines only near the edges",
    "diffused low-saturation gradient using brand green plus white or light gray, center kept clean",
    "minimal fluid or soft wave lines in pale green or pale blue, only on top/bottom edges or corners",
    "low-opacity brand icon matrix using smile logo, phone, coin, or small financial icons at 10%-20% opacity near edges only",
    "brand green tiny dots, small squares, or minimal particles sparsely distributed on background edges",
    "soft same-color light halo behind the character, subtle enough to separate subject from background",
    "slight edge blur or gentle vignette to guide focus toward text and character",
    "matte paper grain or fabric texture on white, light gray, or brand green base",
    "clean geometric shapes with soft shadows, low contrast, no busy scene",
    "minimal 3D curved ribbon background with low contrast and clear text area",
    "calm duotone brand color blocks, simple and spacious",
  ]);
}

function chooseWaTemplateCharacterRenderStyle(visualStyle = "") {
  const compact = String(visualStyle || "").toLowerCase().replace(/\s+/g, "");
  if (/(扁平|flat|vector|插画|illustration|几何抽象|abstractgeometric|孟菲斯|memphis|波普|手绘|doodle|像素|pixel|国潮手绘|水墨|工笔|蒙德里安|mondrian)/i.test(compact)) {
    return "当前视觉风格偏平面/插画：可以将 EZfamily 3D 参考角色转译成同身份的 2D flat/vector/illustration character，保留核心脸型、发型、五官比例、亲和表情和站位，但不要强行保持 3D 渲染；人物线条、色块、阴影和材质应与整体平面风格一致";
  }
  return "保持 3D 卡通金融广告质感，表情友好，动作自然";
}

function chooseWaTemplateCharacterVariation(outfitStyle = "") {
  if (outfitStyle) {
    return `strictly follow the user-specified outfit direction: ${outfitStyle}; the outfit is a primary requirement, not a minor variation; replace the default casual outfit with this clothing direction while preserving the EZfamily face identity, pose area, and template composition`;
  }
  return pickRandom([
    "change outfit color and small accessories while keeping the same core face identity",
    "adjust pose to pointing, presenting, waving, open-hand gesture, or confident standing; avoid holding a phone unless the copy or template requires it",
    "change casual clothing style, bag, jacket, shirt, or sleeve details",
    "slightly change hand gesture and body angle while preserving the original template position",
    "adapt the character styling to the selected background mood without changing identity",
  ]);
}

function chooseWaTemplateRightPanelStyle(visualStyle = "") {
  if (visualStyle) {
    return `adapt the right-side character backing panel to the requested style: ${visualStyle}; panel shape, color, lighting, and material should support the style without covering the character or text`;
  }
  return pickRandom([
    "rounded rectangle panel with a different corner radius and soft inner gradient",
    "cut-corner geometric panel, chamfered shape, or angled card behind the character",
    "layered color blocks behind the character, 2-3 layers maximum, low contrast",
    "glassmorphism translucent panel with subtle blur and soft shadow",
    "capsule or pill-shaped background block, fitted to the original character area",
    "organic blob or soft wave panel behind the character, clean and controlled",
    "diagonal split panel or partial frame that wraps the character area",
    "soft halo plus minimal panel outline instead of a solid block",
  ]);
}

export function buildWaTemplatePrompt({ headline = "", subline = "", outfitStyle = "", visualStyle = "" } = {}, role = "Girl") {
  const isRealisticRole = String(role || "").includes("真人版");
  const baseRole = String(role || "").replace("真人版", "") || role;
  const prop = chooseWaTemplateProp({ headline, subline });
  const backgroundStyle = chooseWaTemplateBackgroundStyle(visualStyle);
  const characterVariation = chooseWaTemplateCharacterVariation(outfitStyle);
  const characterRenderStyle = isRealisticRole
    ? `真人版商业视觉质感：参考图是 EasyFamily ${baseRole} 的真人版身份素材，必须保留 ${baseRole} 的核心脸型、发型轮廓、五官比例、眼镜、年轻亲和气质和品牌角色识别度；整体呈现为真实人物摄影/半写实商业广告质感，不要退回 3D 卡通、公仔、玩偶，也不要变成陌生真人模特`
    : chooseWaTemplateCharacterRenderStyle(visualStyle);
  const realisticRoleRequirement = isRealisticRole
    ? `- 真人版是 ${baseRole} 的独立视觉变体，只在用户明确写“真人版”时启用；本次必须以参考图中的真人版 ${baseRole} 身份为准，不能混用普通卡通版 ${baseRole} 素材，也不能改变原有 EasyFamily 身份特征。
- 真人版 ${baseRole} 的正视图是身份锚点：优先保留其脸型、发型轮廓、眼镜、眉眼比例、鼻口关系、年龄气质和亲和表情；服装、姿势和场景可以变化，但不能换成参考场景里的陌生人物脸。
- 真人版的侧视图、背视图和三视图只用于校准头部轮廓、发型体积、侧脸结构、背面发型和整体比例一致性；它们不是构图参考，不要生成三视图排版、角色设定图或多角度展示板。`
    : "";
  const rightPanelStyle = chooseWaTemplateRightPanelStyle(visualStyle);
  return `请基于第一张参考图的 WA 横版营销模板重新生成一张 2:1 设计图，并严格替换模板中的主标题和副标题。

固定版式要求：
- 画面比例必须保持 2:1 横版。
- 保持第一张参考图的整体版式逻辑：左侧文案区，右侧人物/IP/营销元素区。
- Logo + OJK 合规标识是固定品牌资产：参考第三张图中的 logo+OJK lockup，只能整体复制/替换，不要重绘、改字、拆分或改变比例。
- Logo + OJK 合规标识必须放回第一张模板图中原来的品牌合规区位置，通常在左下或左上；只允许为适配背景做轻微位置微调，不要移动到右侧。
- Logo + OJK 合规标识可以与主标题/副标题位于同一左侧版面，但必须和标题文案区保持清晰安全距离；不要贴近、挤压或碰到主标题/副标题。
- 当 Logo + OJK 位于左下时，它与副标题底部之间至少保留约 8%-12% 画面高度的留白；当 Logo + OJK 位于左上时，它与主标题顶部之间也要保留明显留白。
- 默认不要新增单独微笑 logo / smile icon / app icon；只有第一张模板图原本就有单独 logo 点位，或确实需要手机 app icon 时才允许出现。
- 如果画面中确实需要单独出现微笑 logo / smile icon / app icon，请参考第四张图中的单独 logo 版本。
- 单独微笑 logo 只允许使用三种颜色版本：白色、黑色、品牌绿色；不要生成橙色、红色、蓝色、渐变色或红色描边框。
- 任何单独出现的 smile logo / Easycash logo / app logo，底板或图标底色只能是纯白色或 #3FCA58 品牌绿色；不要使用蓝色、紫色、橙色、红色、灰色或渐变底。
- 如果 logo 出现在手机屏幕、卡片、贴纸、徽章或小图标里，也必须使用纯白色或 #3FCA58 作为 logo 底色。
- 如果出现 “EASYCASH / Easycash” 文字，必须清晰、完整、可读，不要模糊、不要错拼、不要变形。
- 保持大标题、正文、留白、卡片、背景层次的设计节奏。
- 新元素必须沿用第一张参考图中对应元素的占位位置、大小、层级和视觉重心，只允许轻微微调。
- 可以更换背景颜色、道具、IP 姿势和营销元素，但不能重新发明右侧构图。

必须使用的文案：
主标题：${headline}
副标题：${subline}

文案排版要求：
- 主标题必须放在第一张参考模板的主标题原始区域内，继承原始左边距、上边距和基线位置；不要整体下移。
- 主标题垂直位置最多只能相对参考模板微调约 3%，优先保持偏上且稳定的标题重心。
- 主标题必须是最大字号和最高视觉层级。
- 副标题必须放在主标题下方的副标题原始区域内，不能侵入主标题区域。
- 副标题字号必须明显小于主标题，建议为主标题字号的 35%-55%，不要接近主标题大小。
- 副标题行高和字重保持次级信息，不要用过粗或过大的样式。
- 主标题和副标题之间保持参考模板的间距关系；不要把副标题放大到像第二主标题。
- 如果文案较短，不要为了填满空间而放大副标题。
- 主标题和副标题整体不能向下压到 Logo + OJK 合规标识附近；文案组与 Logo + OJK 之间必须有明确分隔留白，优先缩小副标题或微调文案组，而不是让两块信息贴在一起。

视觉风格要求：
- 用户指定的视觉风格：${visualStyle || "未指定，使用默认年轻金融科技广告风格"}。
- 风格只是辅助审美层，用来满足不同用户的视觉偏好；优先级低于固定版式、主副标题准确性、Logo+OJK 合规标识、人物/IP 占位和可读性。
- 如果用户指定了“风格/画面风格/视觉风格”或在需求中写了某种风格关键词，需要在不改变核心规则的前提下体现该风格，不要只沿用参考模板默认外观。
- 指定风格建议体现在 3-4 个方面：整体配色、背景质感/纹理、右侧人物背板形态、装饰元素、光影氛围、字体/卡片节奏。
- 风格变化要克制且服务版式：仍然保持左侧文案区、右侧人物区、Logo+OJK 合规区和 2:1 横版结构。
- 如果用户指定艺术家或艺术流派名称，只提取其可识别的视觉特征作为审美参考；不要做完整临摹，不要牺牲品牌识别、信息可读性和商业海报属性。
- 如果用户指定的是具有明确视觉符号的命名风格，例如蒙德里安、复古港风、赛博朋克、孟菲斯、国潮、Y2K 等，必须出现 2-3 个该风格的可识别特征；不要只做普通换色、普通绿色几何或普通复古纹理。
- 如果是 ins 小众治愈风格，应使用柔和低饱和配色、轻盈留白、温柔光感、细腻纹理和少量精致小装饰。
- 如果是炫酷风格，应使用更强对比、动态斜切/几何、深浅层次、绿色高光、利落光影和更有冲击力的右侧背板。
- 如果是蒙德里安风格，应出现黑色网格线、矩形色块、非对称直角构图、大留白和红/黄/蓝/品牌绿点缀中的多个特征。
- 如果是复古港风风格，应出现港式复古商业海报感、胶片颗粒、暖调旧海报质感、霓虹招牌感色彩或 80s-90s 港风排版节奏中的多个特征。
- 如果是科技、赛博、渐变、玻璃拟态、3D、扁平、复古、国潮、印尼本土化、商务、节日、电商促销、暗黑高级等风格，也应按对应风格调整配色、材质、装饰和视觉氛围，但不要牺牲信息清晰度。
- 如果指定的是扁平插画、蒙德里安、几何抽象、孟菲斯、手绘、像素、国潮手绘等平面类风格，右侧人物也应同步转译成平面/插画表达；不要让 3D 人物硬插进平面画面里造成风格割裂。

背景变化要求：
- 本次背景变化方向：${backgroundStyle}。
- 背景可以比参考图更有变化，但必须低干扰、低对比、服务主体。
- 可选方向包括：微渐变噪点、磨砂质感、布纹/纸感肌理、品牌色同色系网点/斜纹/波浪、切割式色块/分屏设计、低饱和线条/网格、弥散渐变、极简流体线条、弱化品牌元素矩阵、品牌色散点、柔和光晕、轻微暗角。
- 背景装饰优先使用金融、消费信贷、品牌、抽象几何、低干扰纹理相关元素，例如手机、钱包、金币、钞票、check、盾牌、额度卡、箭头、圆点、线条、网格、品牌 smile logo 的低透明图案。
- 允许使用没有强行业含义的中立装饰元素，例如纸飞机、星点、抽象叶片、简单花形、小弧线、小几何符号，但必须低透明、小尺寸、只做边缘点缀。
- 背景不得出现与金融产品和商务人物差别太大的行业符号。
- 背景变化只能发生在原背景层级内，不能抢主标题、IP、Logo+OJK 合规标识。
- 左侧文案区必须保持高对比度和高可读性；背景纹理在文案区必须弱化。
- 背景元素主要放在边缘、角落、人物背后或非文案区，中心和文案区保持干净。
- 背景装饰透明度必须克制：纹理约 1%-5%，品牌图标矩阵约 10%-20%，线条和几何元素保持低饱和。
- 不要每次都使用纯色或单一弧形色块，但也不要做复杂场景背景；如果背景会抢焦点，宁可简化或不要这些背景元素。

右侧人物背板变化要求：
- 本次右侧人物背板变化方向：${rightPanelStyle}。
- 人物背后的板块/卡片/色块可以比参考模板有中等幅度变化，不要只是简单换颜色。
- 可以变化背板的形状、圆角、切角、层叠关系、渐变、玻璃质感、柔和光影、局部描边或内阴影。
- 背板必须仍然位于第一张模板图原右侧人物背景区域内，不能侵入左侧文案区或遮挡 Logo/OJK。
- 背板面积、视觉重心和人物承托关系应接近参考模板，但形态可以有约 15%-25% 的变化。
- 背板最多 2-3 层，不要复杂堆叠，不要做成真实场景背景。
- 背板变化应增强人物层次和新鲜感，不能抢人物脸部、手机/道具或主标题。

右侧元素要求：
- 使用 ${role} 风格的 EZfamily IP 角色作为右侧主视觉参考。
- 人物渲染方式：${characterRenderStyle}。
${realisticRoleRequirement}
- 本次人物变化方向：${characterVariation}。
- 如果用户指定了服饰关键词，人物服装必须作为最高优先级之一执行，并在结果中清晰可见；不要只换颜色，不要退回默认 T 恤/卫衣/随机休闲穿搭。
- 指定服饰时，至少要在上衣、外套、裙装/裤装、帽子/头饰、布料纹样、徽章/胸牌或配饰中体现 3 个以上相关特征。
- 如果指定职业制服或医生制服，必须让角色穿出对应职业感；允许出现制服、白大褂、工装外套、胸牌、整洁领口等服装特征，但不要把背景改成医院或医疗场景。
- 可以对 IP 做服饰、配饰、手势、姿势、朝向、小道具和渲染方式变化，但必须保持 EZfamily 的核心脸型、眼镜/五官比例、亲和气质和品牌角色识别度。
- 人物变化必须在第一张参考图原人物占位内完成，不要变成全新的陌生角色。
- 右侧只能有 1 个 IP 主角色，占右侧区域 60%-75% 高度，人物是唯一主焦点。
- IP 角色必须替换到第一张参考图中原人物/IP 的位置，继承原人物的站位、朝向、尺寸范围和视觉重心；位置偏移不要超过原位置约 8%。
- 核心金融道具只能选择 1 个：${prop}，并替换到第一张参考图中原道具/图标最接近的位置。
- 如果第一张参考图没有对应道具位置，核心道具只能放在 IP 手部附近或原右侧主要装饰区域内。
- 普通品牌口号类文案默认不要让人物拿手机，也不要在手机屏幕上展示 smile logo；只有文案明确提到 app、手机、下载、到账、额度、limit，或第一张模板原本有人物拿手机时才允许出现。
- 如果必须出现手机，手机屏幕应保持简洁，优先显示纯色界面、check 或简单状态，不要高频展示 Easycash/smile logo。
- 辅助装饰最多 2 个，必须复用第一张参考图中已有装饰点位；没有装饰点位时不要新增。
- 所有右侧人物、道具的位置、大小和层级必须参考第一张模板图，整体只做轻微替换和微调；但人物背后的板块允许按“右侧人物背板变化要求”做中等幅度变化。
- 人物脸部和身体前方保持干净，不要被漂浮元素遮挡。
- 如果文案没有明确提到 VIP、优惠、折扣、分期，不要生成 VIP 卡、百分号、优惠券、金币堆。
- 不要同时出现 VIP、百分号、金币、秒表、手机、星星等多个强视觉元素。
- 普通品牌口号类文案应保持右侧克制，只保留 IP、一个简洁道具和少量背景曲线。

品牌风格：
- 金融科技广告 Banner，年轻、可信赖、快捷。
- 字体使用圆润粗体无衬线风格，主标题最大、最醒目，副标题次之。

禁止：
- 不要改写主标题和副标题。
- 不要伪造、改写或重新排版 logo+OJK 合规标识。
- 不要把单独微笑 logo 改成白/黑/品牌绿以外的颜色。
- 不要让 logo 使用纯白或 #3FCA58 以外的底色。
- 不要生成模糊、拼错或不可读的 Easycash 字样。
- 不要出现医疗、医院、健康、红十字、医疗十字标、心电图、药丸、针筒、救护、餐饮、教育、宗教、运动赛事等行业差别太大的背景符号。
- 不要把安全感表达成医疗十字或健康图标；如果需要表达安全，只能使用金融风格盾牌、check 或锁形图标。
- 不要为了装饰而额外新增单独微笑 logo；没有明确点位或用途时不要出现。
- 不要让主标题整体下沉或偏离参考模板主标题区域。
- 不要把副标题做得接近主标题大小。
- 不要让人物遮挡主标题。
- 不要生成杂乱背景。
- 不要生成过多小字。
- 不要在右侧堆叠营销元素。
- 不要让人物默认拿手机；没有明确手机/app/到账/额度语义时不要出现手机屏幕 logo。
- 不要新增模板参考图中不存在的大面积漂浮元素。
- 不要把右侧元素移动到新的构图位置。
- 不要忽略用户指定的人物服饰关键词；如果用户指定制服、医生制服、传统服饰或职业装，禁止生成默认休闲服装。
- 不要完全忽略用户指定的视觉风格关键词；如果用户指定 ins 小众治愈、炫酷、高级、可爱、极简、科技、赛博、渐变、复古、国潮、电商、节日等风格，需要做出可感知的审美差异，但不得破坏核心版式和品牌规则。
- 如果用户指定扁平插画、蒙德里安、几何抽象、孟菲斯、手绘、像素等平面类风格，不要生成与画面不匹配的强 3D 人物；人物可以转译为 2D/flat/vector illustration，但必须保留 EZfamily 角色识别度。
- 不要改变左文案右元素的固定版式。`;
}

export function detectOneClickEntryMode(promptText, refImages = []) {
  if (Array.isArray(refImages) && refImages.length > 0) return "agent";
  const text = String(promptText || "").trim();
  if (!text) return "quick";
  const compact = text.toLowerCase().replace(/\s+/g, "");
  const agentSignals = [
    "海报", "poster", "品牌", "branding", "logo", "字体", "排版", "版式", "包装",
    "banner", "kv", "主视觉", "电商", "详情页", "详情图", "产品图", "广告",
    "营销", "视觉规范", "延展", "物料", "画册", "封面", "构图", "镜头", "景别",
    "光影", "材质", "质感", "高级感", "高细节", "高清", "风格统一",
  ];
  if (agentSignals.some((keyword) => compact.includes(keyword))) return "agent";
  const structured = text.length >= 48 || /[，。；：\n]/.test(text) || /(保持|保留|突出|强调|避免|不要|并且|同时|需要|要求)/.test(text);
  return structured ? "agent" : "quick";
}

export function getLatestGeneratedImages(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && Array.isArray(message.images) && message.images.length > 0) {
      return message.images.filter((src) => typeof src === "string" && src);
    }
  }
  return [];
}

export function shouldReusePreviousGeneratedImages(promptText, explicitRefImages = []) {
  if (Array.isArray(explicitRefImages) && explicitRefImages.length > 0) return false;
  const text = String(promptText || "").trim().toLowerCase();
  if (!text) return false;
  const editOrGenerate = /(换|改|继续|再来|重做|延续|保留|参考|基于|按照|照着|生成|出图|做一版|来一版|来一组|另一套|不同的|同风格|同款|变成)/.test(text);
  const contextual = /(这张|这个|这套|上一张|上一个|刚才|前面|之前|上次)/.test(text);
  const shortFollowup = /(再来一版|再来一个|换一组|换一版|继续改|继续做|换个配色|换个服装|再换套)/.test(text);
  return shortFollowup || (editOrGenerate && contextual) || /参考这个/.test(text);
}

export function isObviousOneClickGenerateRequest(promptText, refImages = [], attachments = []) {
  const text = String(promptText || "").trim().toLowerCase();
  if (!text) return false;
  if (Array.isArray(attachments) && attachments.length > 0) return false;
  const questionIntent = /(是什么|为什么|怎么|如何|分析|总结|解释|提取|读取|新闻|资讯|内容|文案|正文|描述|介绍|建议|推荐|帮我看看)/.test(text);
  const generateIntent = /(生成|生图|出图|画一张|画个|绘制|渲染|做一张|做个|做一版|做几版|做几套|来一张|来一版|来一组|来几版|来几组|来几套|给我一张|创建一张|设计一张|设计一组|设计几套)/.test(text);
  const editIntent = /(改成|变成|换成|换一版|换一组|换几版|换几组|继续改|继续做|重做|延展|参考这个|照着这个|按照这个|其它保持不变|不同样式|不同动作|不同姿势|不同服装|不同服饰)/.test(text);
  if (Array.isArray(refImages) && refImages.length > 0) return editIntent || generateIntent;
  return generateIntent && !questionIntent;
}
