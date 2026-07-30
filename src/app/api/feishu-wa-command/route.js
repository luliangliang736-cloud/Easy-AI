import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { LARK_IDENTITY, runLarkCliJson } from "@/lib/server/larkCliRuntime";

export const runtime = "nodejs";
export const maxDuration = 300;

const BASE_TOKEN = process.env.FEISHU_WA_BASE_TOKEN || "R2edbyyrZaGixJsH0v2cD1Mcnkg";
const TABLE_ID = process.env.FEISHU_WA_TABLE_ID || "tbl5LlkOa5yLoGQf";
const AI_IMAGE_FIELD_NAME = "AI设计图";
const EDITABLE_FIELDS = new Set([
  "人物",
  "服装",
  "风格",
  "需求备注",
  "主文案（印尼语 ≤30）",
  "副文案（印尼语 ≤50）",
  "主文案-印尼语",
  "副文案-印尼语",
  "主文案（中文）",
  "副文案（中文）",
  "主文案-中文",
  "副文案-中文",
  "场景类型",
  "标签",
]);

// WA 表格助手的 LLM 渠道可独立配置（WA_COMMAND_*），未配置时退回全局 OPENAI_*
const LLM_API_BASE_RAW = (process.env.WA_COMMAND_API_BASE || process.env.OPENAI_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
const LLM_API_BASE = /\/v\d+$/i.test(LLM_API_BASE_RAW) ? LLM_API_BASE_RAW : `${LLM_API_BASE_RAW}/v1`;
const LLM_API_KEY = process.env.WA_COMMAND_API_KEY || process.env.OPENAI_API_KEY || "";
const LLM_API_VERSION = process.env.WA_COMMAND_API_VERSION || process.env.OPENAI_API_VERSION || "";
const LLM_API_KEY_HEADER = (process.env.WA_COMMAND_API_KEY_HEADER || process.env.OPENAI_API_KEY_HEADER || "authorization").trim().toLowerCase();
const LLM_API_STYLE = (process.env.WA_COMMAND_API_STYLE || process.env.OPENAI_API_STYLE || "auto").trim().toLowerCase();
const WA_COMMAND_MODEL = process.env.WA_COMMAND_MODEL || process.env.OBJECT_PLAN_MODEL || "gpt-4o-mini";
const WA_COMMAND_LLM_TIMEOUT_MS = Number(process.env.WA_COMMAND_LLM_TIMEOUT_MS || 90 * 1000);

const ROBOT_OUTFIT = "仅使用库里的Robot标准形态：标准绿色主体机身、黑色屏幕脸、银白机械臂/脚部；最多只改变姿势/朝向/手势，不改变服饰、颜色、机身或屏幕脸";

function buildLlmAuthHeaders() {
  if (!LLM_API_KEY) return {};
  if (LLM_API_KEY_HEADER === "api-key" || LLM_API_KEY_HEADER === "x-api-key") {
    return { [LLM_API_KEY_HEADER]: LLM_API_KEY };
  }
  return { Authorization: `Bearer ${LLM_API_KEY}` };
}

function buildLlmChatUrl() {
  const url = LLM_API_STYLE === "azure"
    ? `${LLM_API_BASE_RAW}/openai/deployments/${encodeURIComponent(WA_COMMAND_MODEL)}/chat/completions`
    : `${LLM_API_BASE}/chat/completions`;
  if (!LLM_API_VERSION) return url;
  const nextUrl = new URL(url);
  if (!nextUrl.searchParams.has("api-version")) nextUrl.searchParams.set("api-version", LLM_API_VERSION);
  return nextUrl.toString();
}

async function callWaCommandLLM(messages) {
  if (!LLM_API_KEY) throw new Error("未配置 WA_COMMAND_API_KEY / OPENAI_API_KEY");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WA_COMMAND_LLM_TIMEOUT_MS);
  try {
    const res = await fetch(buildLlmChatUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildLlmAuthHeaders() },
      body: JSON.stringify({
        ...(LLM_API_STYLE === "azure" ? {} : { model: WA_COMMAND_MODEL }),
        messages,
        temperature: 0.9,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `LLM 请求失败（${res.status}）`);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      return content.map((part) => (part?.type === "text" || part?.type === "output_text" ? part.text : "")).join("").trim();
    }
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function parseLlmJsonArray(text = "") {
  const cleaned = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const VALID_ROLES = new Set(["Boy", "Girl", "Boy真人版", "Robot"]);

// 用 LLM 根据每条记录的主副文案主题 + 用户附加要求生成人物/服装/风格
async function generateVariationRowsWithLLM(records, instruction = "") {
  const recordLines = records.map((record) => JSON.stringify({
    seq: String(record.seq),
    场景: formatSelectValue(record.scene),
    中文主文案: record.zhHeadline,
    中文副文案: record.zhSubline,
    印尼语主文案: record.headline,
    印尼语副文案: record.subline,
    备注: record.note,
  }));
  const systemPrompt = [
    "你是印尼金融产品 WA 营销海报的设计企划，为每条海报记录生成「人物 / 服装 / 风格」三个字段。",
    "硬性规则：",
    "1. 「风格」用一句中文描述海报风格基调：配色 + 氛围 + 关键视觉元素。基调必须严格依据该条记录的主副文案主题推导，禁止引入文案中不存在的主题词（例如文案没提发薪日就绝不能出现“发薪日”，没提学费就不能出现“学费”，没提VIP就不能出现“会员”）。",
    "2. 用户的附加要求优先级最高。如果用户指定了色系数量分布（例如“3个绿色系、3个暖色系、1个浅蓝色系”），输出各色系的数量必须严格一致，并在风格描述开头写明主色系。",
    "3. 「人物」只能取：Boy、Girl、Boy真人版、Robot。整体男女大致均衡，与该条文案调性匹配；只有文案强调自动化/极速/线上流程时才可用 Robot。",
    "4. 「服装」从以下选择或在其基础上微调：绿色客服制服、客服制服、亲和职业装、高级商务服装、印尼制服。人物为 Robot 时服装必须原样输出：" + ROBOT_OUTFIT,
    "5. 各条之间风格要有明显差异，避免多条输出相同或高度相似的句子；本次输出也要和常规套路有新鲜感。",
    "6. 如果用户要求保持原版/沿用模板/风格不变/只换文案（对全部或某些条目），对应条目的「风格」必须以“保持原版，只换文案”开头（这是系统的原版锁定触发词），后面可以附加用户要求的具体小改说明；不要自行发挥新风格。",
    "只输出 JSON 数组，不要输出任何其他文字。每项格式：{\"seq\":\"1\",\"人物\":\"Girl\",\"服装\":\"客服制服\",\"风格\":\"...\"}",
  ].join("\n");
  const userPrompt = [
    instruction ? `用户附加要求：${instruction}` : "用户附加要求：无",
    `共 ${records.length} 条记录：`,
    ...recordLines,
  ].join("\n");

  const text = await callWaCommandLLM([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);
  const items = parseLlmJsonArray(text);
  if (!items) throw new Error("LLM 返回的不是有效 JSON 数组");

  const bySeq = new Map();
  for (const item of items) {
    const seq = String(item?.seq || "").trim();
    const role = String(item?.人物 || "").trim();
    const outfit = role === "Robot" ? ROBOT_OUTFIT : String(item?.服装 || "").trim();
    const style = String(item?.风格 || "").trim();
    if (!seq || !VALID_ROLES.has(role) || !outfit || !style) continue;
    bySeq.set(seq, { 人物: role, 服装: outfit, 风格: style });
  }
  const missing = records.filter((record) => !bySeq.has(String(record.seq)));
  if (missing.length > 0) {
    throw new Error(`LLM 输出缺少 ${missing.length} 条记录（第${missing.map((item) => item.seq).join("、")}张）`);
  }
  return bySeq;
}

function pickField(row, fields, names) {
  for (const name of names) {
    const index = fields.indexOf(name);
    if (index >= 0 && row[index] != null && String(row[index]).trim()) {
      return row[index];
    }
  }
  const first = names.map((name) => fields.indexOf(name)).find((index) => index >= 0);
  return first >= 0 ? row[first] : "";
}

async function writeTempJson(payload) {
  const dir = path.join(process.cwd(), ".easyai-tmp");
  await mkdir(dir, { recursive: true });
  const filename = `easyai-feishu-command-${randomUUID()}.json`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, JSON.stringify(payload), "utf8");
  return { filePath, cliPath: `.easyai-tmp/${filename}` };
}

async function runWithTempJson(argsBeforeJson, payload, argsAfterJson = []) {
  const jsonFile = await writeTempJson(payload);
  try {
    return await runLarkCliJson([...argsBeforeJson, "--json", `@${jsonFile.cliPath}`, ...argsAfterJson]);
  } finally {
    await unlink(jsonFile.filePath).catch(() => {});
  }
}

async function listRecords(limit = 200) {
  // lark-cli 限制：--limit 最大 200；--jq 必须搭配 --format json（默认 markdown 与 --jq 互斥）
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 200);
  const data = await runLarkCliJson([
    "base", "+record-list",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", LARK_IDENTITY,
    "--limit", String(safeLimit),
    "--format", "json",
    "--jq", ".",
  ]);
  if (!data?.ok) throw new Error(data?.error?.message || "读取飞书表格失败");
  const payload = data.data || {};
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const fieldIds = Array.isArray(payload.field_id_list) ? payload.field_id_list : [];
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const recordIds = Array.isArray(payload.record_id_list) ? payload.record_id_list : [];
  const aiImageFieldIndex = fields.indexOf("AI设计图");
  const aiImageFieldId = aiImageFieldIndex >= 0 ? fieldIds[aiImageFieldIndex] : "";
  return rows.map((row, index) => {
    // 只有数字型「任务序号」才作为序号；新表没有该字段时按行序编号，避免把“提需时间”当序号
    const seqRaw = String(pickField(row, fields, ["任务序号"]) || "").trim();
    return {
    id: recordIds[index],
    seq: /^\d+$/.test(seqRaw) ? seqRaw : String(index + 1),
    priority: pickField(row, fields, ["优先级"]),
    role: String(pickField(row, fields, ["人物"]) || ""),
    outfit: String(pickField(row, fields, ["服装"]) || ""),
    style: String(pickField(row, fields, ["风格"]) || ""),
    scene: pickField(row, fields, ["场景类型", "标签"]),
    aiImage: pickField(row, fields, ["AI设计图"]),
    aiImageFieldId,
    manualImage: pickField(row, fields, ["人工设计图"]),
    zhHeadline: String(pickField(row, fields, ["主文案（中文）", "主文案-中文"]) || ""),
    zhSubline: String(pickField(row, fields, ["副文案（中文）", "副文案-中文"]) || ""),
    headline: String(pickField(row, fields, ["主文案（印尼语 ≤30）", "主文案-印尼语", "主文案（印尼语）"]) || ""),
    subline: String(pickField(row, fields, ["副文案（印尼语 ≤50）", "副文案-印尼语", "副文案（印尼语）"]) || ""),
    note: String(pickField(row, fields, ["需求备注", "标签"]) || ""),
    };
  }).filter((item) => item.id);
}

async function listViews() {
  const data = await runLarkCliJson([
    "base", "+view-list",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", LARK_IDENTITY,
    "--jq", ".",
  ]);
  return Array.isArray(data?.data?.views) ? data.data.views : [];
}

async function ensureAiImageFieldIsEmpty() {
  const fieldsData = await runLarkCliJson([
    "base", "+field-list",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", LARK_IDENTITY,
    "--jq", ".",
  ]);
  const fields = Array.isArray(fieldsData?.data?.fields) ? fieldsData.data.fields : [];
  const oldField = fields.find((field) => field?.name === AI_IMAGE_FIELD_NAME && field?.type === "attachment");
  const viewOrders = [];
  const views = await listViews();

  for (const view of views) {
    const visible = await runLarkCliJson([
      "base", "+view-get-visible-fields",
      "--base-token", BASE_TOKEN,
      "--table-id", TABLE_ID,
      "--view-id", view.id,
      "--as", LARK_IDENTITY,
      "--jq", ".",
    ]).catch(() => null);
    const visibleFields = visible?.data?.visible_fields;
    if (Array.isArray(visibleFields) && visibleFields.length > 0) {
      viewOrders.push({ viewId: view.id, fields: visibleFields });
    }
  }

  if (oldField?.id) {
    await runLarkCliJson([
      "base", "+field-delete",
      "--base-token", BASE_TOKEN,
      "--table-id", TABLE_ID,
      "--field-id", oldField.id,
      "--as", LARK_IDENTITY,
      "--yes",
      "--jq", ".",
    ]);
  }

  const created = await runWithTempJson([
    "base", "+field-create",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", LARK_IDENTITY,
  ], { name: AI_IMAGE_FIELD_NAME, type: "attachment" }, ["--jq", "."]);

  for (const viewOrder of viewOrders) {
    const nextFields = viewOrder.fields.includes(AI_IMAGE_FIELD_NAME)
      ? viewOrder.fields
      : [
        ...viewOrder.fields.slice(0, Math.max(viewOrder.fields.indexOf("风格") + 1, 0)),
        AI_IMAGE_FIELD_NAME,
        ...viewOrder.fields.slice(Math.max(viewOrder.fields.indexOf("风格") + 1, 0)),
      ];
    await runWithTempJson([
      "base", "+view-set-visible-fields",
      "--base-token", BASE_TOKEN,
      "--table-id", TABLE_ID,
      "--view-id", viewOrder.viewId,
      "--as", LARK_IDENTITY,
    ], { visible_fields: nextFields }, ["--jq", "."]).catch(() => null);
  }

  return created?.data?.field?.id || "";
}

function parseChineseNumber(value = "") {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) return Number(text);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return 10;
  if (text.includes("十")) {
    const [ten, one] = text.split("十");
    return (digits[ten] || 1) * 10 + (digits[one] || 0);
  }
  return digits[text] || 0;
}

function parseRowUpdates(text = "") {
  const source = String(text || "");
  const rowMatch = source.match(/第\s*([0-9一二两三四五六七八九十]+)\s*张/);
  const seq = rowMatch ? String(parseChineseNumber(rowMatch[1]) || rowMatch[1]) : "";
  if (!seq) return null;

  const patch = {};
  const patterns = [
    ["人物", /人物\s*(?:改成|改为|设为|设置为|=|：|:)\s*([^，。,；;\n]+)/],
    ["服装", /服装\s*(?:改成|改为|设为|设置为|=|：|:)\s*([^，。,；;\n]+)/],
    ["风格", /风格\s*(?:改成|改为|设为|设置为|=|：|:)\s*([^，。,；;\n]+)/],
    ["需求备注", /需求备注\s*(?:改成|改为|设为|设置为|=|：|:)\s*([^，。,；;\n]+)/],
    ["主文案（印尼语 ≤30）", /(?:主标题|主文案|印尼语主文案)\s*(?:改成|改为|设为|设置为|=|：|:)\s*([^，。,；;\n]+)/],
    ["副文案（印尼语 ≤50）", /(?:副标题|副文案|印尼语副文案)\s*(?:改成|改为|设为|设置为|=|：|:)\s*([^，。,；;\n]+)/],
    ["主文案（中文）", /中文主文案\s*(?:改成|改为|设为|设置为|=|：|:)\s*([^，。,；;\n]+)/],
    ["副文案（中文）", /中文副文案\s*(?:改成|改为|设为|设置为|=|：|:)\s*([^，。,；;\n]+)/],
    ["场景类型", /(?:场景类型|场景)\s*(?:改成|改为|设为|设置为|=|：|:)\s*([^，。,；;\n]+)/],
  ];
  for (const [field, pattern] of patterns) {
    const match = source.match(pattern);
    if (match?.[1] && EDITABLE_FIELDS.has(field)) {
      patch[field] = field === "场景类型" ? [match[1].trim()] : match[1].trim();
    }
  }
  return Object.keys(patch).length > 0 ? { seq, patch } : null;
}

function formatSelectValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("、");
  return String(value || "");
}

function formatRecordSummary(record) {
  const aiImageCount = Array.isArray(record.aiImage) ? record.aiImage.length : 0;
  return [
    `### 飞书 WA 表格 · 第${record.seq}张`,
    `- 场景：${formatSelectValue(record.scene) || "未填"}`,
    `- 主标题：${record.headline || "未填"}`,
    `- 副标题：${record.subline || "未填"}`,
    `- 人物：${record.role || "未填"}`,
    `- 服装：${record.outfit || "未填"}`,
    `- 风格：${record.style || "未填"}`,
    `- AI设计图：${aiImageCount > 0 ? `${aiImageCount}张，已附在下方` : "空"}`,
  ].join("\n");
}

function getRecordImageUrls(record) {
  if (!record?.id || !record?.aiImageFieldId || !Array.isArray(record.aiImage)) return [];
  return record.aiImage
    .filter((file) => file?.file_token)
    .map((file) => {
      const params = new URLSearchParams({
        fileToken: file.file_token,
        recordId: record.id,
        fieldId: record.aiImageFieldId,
        name: file.name || "feishu-wa-image.png",
      });
      return `/api/feishu-wa-attachment?${params.toString()}`;
    });
}

function buildReplyWithImages(reply, records = []) {
  const images = records.flatMap((record) => getRecordImageUrls(record));
  return { reply, images };
}

function parseLimit(text = "", fallback = 10) {
  const match = String(text || "").match(/(?:前|查看|列出)\s*([0-9一二两三四五六七八九十]+)\s*(?:张|条|个)?/);
  const value = parseChineseNumber(match?.[1]);
  return value > 0 ? Math.min(value, 100) : fallback;
}

function parseRewriteVariationRequest(text = "") {
  const source = String(text || "");
  const compact = source.replace(/\s+/g, "");
  const mentionsVariationFields = /(人物|角色|服装|服饰|风格|Boy|Girl|Robot|robot|机器人|真人版)/i.test(source);
  const asksRewrite = /(重新|重写|改写|重填|重新填充|刷新|变化|换一版|换一批|平衡|均衡|减少|降低|增加|提高|添加|加入|只要|保留|控制在)/.test(source);
  if (!mentionsVariationFields || !asksRewrite) return null;
  if (/(创建|新建|建立).*(表格|表)/.test(source)) return null;


  const robotMatch = compact.match(/(?:robot|机器人)(?:只要|保留|减少到|降到|控制在)?([0-9一二两三四五六七八九十]+)(?:个|条|张)?/i);
  const robotTarget = robotMatch ? parseChineseNumber(robotMatch[1]) : null;
  const preferences = {
    reduceGreen: /(减少|降低|少一点|少一些|不要太多).*(绿色|绿)/.test(source) || /绿色.*(减少|降低|少一点|少一些|不要太多)/.test(source),
    increaseBoy: /(boy|男生|男性|男)/i.test(source) && /(增加|多一点|多一些|提高|偏多)/.test(source),
    increaseGirl: /(girl|女生|女性|女)/i.test(source) && /(增加|多一点|多一些|提高|偏多)/.test(source),
    includeBoyReal: /(boy真人版|真人版boy|男生真人版|真人男生|真人版)/i.test(source),
    robotTarget: robotTarget ?? undefined,
  };

  const rangeMatch = compact.match(/第([0-9一二两三四五六七八九十]+)(?:张)?(?:到|至|-|~)第?([0-9一二两三四五六七八九十]+)张?/);
  if (rangeMatch) {
    return {
      start: parseChineseNumber(rangeMatch[1]),
      end: parseChineseNumber(rangeMatch[2]),
      preferences,
    };
  }

  const singleMatch = compact.match(/第([0-9一二两三四五六七八九十]+)张/);
  if (singleMatch) {
    const seq = parseChineseNumber(singleMatch[1]);
    return { start: seq, end: seq, preferences };
  }

  if (/所有|全部|全表/.test(source)) return { all: true, preferences };

  // 未指定范围时默认操作全表，避免遗漏超出前N条的记录
  return { all: true, preferences };
}

function compactText(record) {
  return `${formatSelectValue(record.scene)} ${record.zhHeadline} ${record.zhSubline} ${record.headline} ${record.subline}`.toLowerCase();
}

function chooseSecondBatchRole(record, index, counts, targets) {
  const source = compactText(record);
  if (/(robot|机器人|自动|极速|5\s*menit|kilat|cepat|online|pindar)/i.test(source) && counts.Robot < targets.Robot) {
    counts.Robot += 1;
    return "Robot";
  }
  const boyRealNeeded = targets.Boy真人版 - counts.Boy真人版;
  const slotsLeft = Math.max(targets.total - index, 1);
  if (boyRealNeeded > 0 && (index % 4 === 1 || slotsLeft <= boyRealNeeded)) {
    counts.Boy真人版 += 1;
    return "Boy真人版";
  }
  if (/(skor|credit|信用|gaji|salary|发薪|limit|额度)/i.test(source) && counts.Boy < targets.Boy) {
    counts.Boy += 1;
    return "Boy";
  }
  if (counts.Girl < targets.Girl) {
    counts.Girl += 1;
    return "Girl";
  }
  if (counts.Boy < targets.Boy) {
    counts.Boy += 1;
    return "Boy";
  }
  if (counts.Boy真人版 < targets.Boy真人版) {
    counts.Boy真人版 += 1;
    return "Boy真人版";
  }
  counts.Girl += 1;
  return "Girl";
}

function chooseSecondBatchOutfit(record, role) {
  const source = compactText(record);
  if (role === "Robot") {
    return ROBOT_OUTFIT;
  }
  const isBoyRole = String(role || "").includes("Boy");
  if (/(vip|gold|member|会员|权益)/i.test(source)) return "高级商务服装";
  if (/(skor|credit|信用)/i.test(source)) return isBoyRole ? "印尼制服" : "亲和职业装";
  if (/(pinjaman pertama|新用户|ojk|transparan)/i.test(source)) return "客服制服";
  if (/(gaji|发薪|limit|额度)/i.test(source)) return isBoyRole ? "绿色客服制服" : "客服制服";
  if (/(sekolah|学费|教育|afpi)/i.test(source)) return "亲和职业装";
  return isBoyRole ? "亲和职业装" : "客服制服";
}

// 每个场景类别提供多个风格变体并按行序轮换，避免同类文案批量落到同一句风格
const SECOND_BATCH_STYLE_POOLS = [
  {
    pattern: /(vip|gold|member|会员|权益)/i,
    styles: [
      "VIP会员权益海报，高级金色与象牙白主视觉，礼遇感、会员徽章、干净明亮，品牌绿仅做小面积点缀",
      "轻奢深色权益海报，黑金渐变、会员卡片质感、精致排版，品牌绿只做高光点缀",
      "浅金礼遇感海报，香槟金与奶白配色、升级仪式感、简洁徽章元素，绿色仅用于CTA",
    ],
  },
  {
    pattern: /(skor|credit|信用)/i,
    styles: [
      "信用修复教育海报，蓝白金融科技界面、分数仪表盘、向上箭头，可信专业，减少大面积绿色背景",
      "浅灰蓝信任感海报，信用分数卡片、进度条向上、干净留白，品牌绿只做小图标",
      "深蓝专业金融海报，数据仪表与上升曲线、权威可信氛围，避免绿色主背景",
    ],
  },
  {
    pattern: /(pinjaman pertama|新用户|ojk|transparan)/i,
    styles: [
      "新用户引导海报，清爽浅色流程卡片、透明步骤、OJK信任背书，少量品牌绿按钮点缀",
      "白底极简信任海报，三步流程图示、OJK/AFPI标识区、清晰层级，绿色仅作辅助色",
      "浅青新手友好海报，圆角引导卡片、亲和插画感、步骤编号清晰，品牌绿克制使用",
    ],
  },
  {
    pattern: /(gaji|发薪|limit|额度|cair|dana)/i,
    styles: [
      "发薪日前救急海报，暖黄色行动氛围、手机额度卡片、快速到账动线，品牌绿只用于CTA或小图标",
      "蓝白金融科技海报，额度数字卡片、清晰信息层级、明亮留白，少量品牌绿点缀",
      "暖色生活场景海报，真实用钱需求感、亲和人物、醒目行动按钮，品牌色克制使用",
      "深蓝速度感海报，到账动线、速度线条、专业可信，与绿色版形成明显差异",
      "浅色清爽额度海报，大数字额度展示、简洁图标、高可读性排版，绿色仅作辅助",
    ],
  },
  {
    pattern: /(sekolah|学费|教育|afpi)/i,
    styles: [
      "教育缴费场景海报，温暖米色与书本学费元素，家庭安心感、合规可信，避免整张绿色",
      "浅蓝教育信任海报，书本与校园元素点缀、清晰缴费信息卡片，品牌绿只做小图标",
    ],
  },
];

const SECOND_BATCH_DEFAULT_STYLES = [
  "蓝白金融科技广告，清晰信息卡片、可信赖、明亮留白，少量品牌绿点缀",
  "金色权益感营销海报，高级渐变、会员礼遇、干净排版，避免重复绿色背景",
  "暖色生活场景海报，真实需求感、亲和人物、行动按钮突出，品牌色克制使用",
  "浅色合规信任海报，OJK/AFPI背书、清晰文字层级、简洁图标，绿色仅作辅助",
  "深蓝科技金融海报，数据卡片、速度感线条、专业可信，形成与绿色版差异",
];

function chooseSecondBatchStyle(record, index) {
  const source = compactText(record);
  for (const pool of SECOND_BATCH_STYLE_POOLS) {
    if (pool.pattern.test(source)) return pool.styles[index % pool.styles.length];
  }
  return SECOND_BATCH_DEFAULT_STYLES[index % SECOND_BATCH_DEFAULT_STYLES.length];
}

function buildSecondBatchRows(records, limit, preferences = {}) {
  const selected = records.slice(0, limit);
  const robotTarget = Number.isFinite(preferences.robotTarget) && preferences.robotTarget > 0
    ? Math.min(preferences.robotTarget, selected.length)
    : Math.min(3, Math.max(1, Math.round(selected.length * 0.08)));
  const humanTotal = Math.max(selected.length - robotTarget, 0);
  const boyRealTarget = preferences.includeBoyReal || selected.length >= 8
    ? Math.min(preferences.includeBoyReal ? Math.max(1, Math.round(selected.length * 0.12)) : Math.max(1, Math.round(selected.length * 0.08)), humanTotal)
    : 0;
  const regularHumanTotal = Math.max(humanTotal - boyRealTarget, 0);
  const girlRatio = preferences.increaseBoy ? 0.42 : preferences.increaseGirl ? 0.68 : 0.58;
  const girlTarget = Math.ceil(regularHumanTotal * girlRatio);
  const boyTarget = Math.max(regularHumanTotal - girlTarget, 0);
  const counts = { Boy: 0, Boy真人版: 0, Girl: 0, Robot: 0 };
  const targets = { Boy: boyTarget, Boy真人版: boyRealTarget, Girl: girlTarget, Robot: robotTarget, total: selected.length };

  return selected.map((record, index) => {
    const role = chooseSecondBatchRole(record, index, counts, targets);
    const outfit = chooseSecondBatchOutfit(record, role);
    const style = chooseSecondBatchStyle(record, index);
    return {
      "任务序号": String(index + 1),
      "优先级": formatSelectValue(record.priority),
      "场景类型": formatSelectValue(record.scene),
      "主文案（中文）": record.zhHeadline,
      "副文案（中文）": record.zhSubline,
      "主文案（印尼语 ≤30）": record.headline,
      "副文案（印尼语 ≤50）": record.subline,
      人物: role,
      服装: outfit,
      风格: style,
      需求备注: [
        record.note,
        `自动重平衡：减少绿色重复，人物比例 Boy ${targets.Boy}/Boy真人版 ${targets.Boy真人版}/Girl ${targets.Girl}/Robot ${targets.Robot}`,
      ].filter(Boolean).join("；"),
    };
  });
}

function parseCreatePatch(text = "") {
  const source = String(text || "");
  if (!/(新增|添加|创建).*(WA|wa|海报|需求|记录)/i.test(source)) return null;
  const labels = [
    ["主文案（印尼语 ≤30）", /(?:主标题|主文案|印尼语主文案)\s*[：:=]\s*([^，。,；;\n]+)/],
    ["副文案（印尼语 ≤50）", /(?:副标题|副文案|印尼语副文案)\s*[：:=]\s*([^，。,；;\n]+)/],
    ["主文案（中文）", /中文主文案\s*[：:=]\s*([^，。,；;\n]+)/],
    ["副文案（中文）", /中文副文案\s*[：:=]\s*([^，。,；;\n]+)/],
    ["人物", /人物\s*[：:=]\s*([^，。,；;\n]+)/],
    ["服装", /服装\s*[：:=]\s*([^，。,；;\n]+)/],
    ["风格", /风格\s*[：:=]\s*([^，。,；;\n]+)/],
    ["需求备注", /需求备注\s*[：:=]\s*([^，。,；;\n]+)/],
    ["场景类型", /(?:场景类型|场景)\s*[：:=]\s*([^，。,；;\n]+)/],
  ];
  const patch = {};
  for (const [field, pattern] of labels) {
    const match = source.match(pattern);
    if (match?.[1]) patch[field] = field === "场景类型" ? [match[1].trim()] : match[1].trim();
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function chooseNonRobotRole(index) {
  return index % 2 === 0
    ? { 人物: "Boy", 服装: "亲和职业装" }
    : { 人物: "Girl", 服装: "客服制服" };
}

async function updateRecord(recordId, patch) {
  return runWithTempJson([
    "base", "+record-upsert",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--record-id", recordId,
    "--as", LARK_IDENTITY,
  ], patch, ["--jq", "."]);
}

async function createRecord(patch) {
  return runWithTempJson([
    "base", "+record-upsert",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", LARK_IDENTITY,
  ], patch, ["--jq", "."]);
}

async function deleteRecord(recordId) {
  return runWithTempJson([
    "base", "+record-delete",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", LARK_IDENTITY,
    "--yes",
  ], { record_id_list: [recordId] }, ["--jq", "."]);
}

async function reduceRobots(target = 4) {
  const records = await listRecords();
  const robots = records.filter((item) => item.role === "Robot");
  if (robots.length <= target) {
    return { message: `当前 Robot 已经是 ${robots.length} 条，不需要减少。`, changed: [] };
  }

  const keepKeywords = /(5\s*Menit|Cair|Kilat|Cepatan|Verifikasi|Pencairan|cepat|online|PinDar)/i;
  const keep = new Set(
    robots
      .slice()
      .sort((a, b) => Number(keepKeywords.test(`${b.headline} ${b.subline}`)) - Number(keepKeywords.test(`${a.headline} ${a.subline}`)))
      .slice(0, target)
      .map((item) => item.id)
  );
  const changed = [];
  let index = 0;
  for (const record of robots) {
    if (keep.has(record.id)) continue;
    const patch = chooseNonRobotRole(index);
    index += 1;
    await updateRecord(record.id, patch);
    changed.push({ seq: record.seq, headline: record.headline, ...patch });
  }

  return {
    message: `已将 Robot 从 ${robots.length} 条减少到 ${target} 条，保留更适合科技/快速到账的记录。`,
    changed,
  };
}

function selectRecordsByRewriteRequest(records, request) {
  if (request?.all) return records;
  if (request?.start > 0 && request?.end > 0) {
    const start = Math.min(request.start, request.end);
    const end = Math.max(request.start, request.end);
    return records.filter((record, index) => {
      const seq = Number(record.seq) || index + 1;
      return seq >= start && seq <= end;
    });
  }
  // 未指定范围时处理全部记录，避免超出前N条的记录被遗漏
  if (Number.isFinite(request?.limit) && request.limit > 0) {
    return records.slice(0, Math.min(request.limit, records.length));
  }
  return records;
}

async function rewriteVariationFields(request) {
  const records = await listRecords(500);
  const selected = selectRecordsByRewriteRequest(records, request);
  if (selected.length === 0) throw new Error("没有找到需要重写的 WA 记录");

  // 优先用 LLM 按每条主副文案主题 + 用户附加要求生成；失败时退回规则轮换
  let patchBySeq = null;
  let source = "llm";
  try {
    patchBySeq = await generateVariationRowsWithLLM(selected, request?.instruction || "");
  } catch (error) {
    console.warn("[feishu-wa-command] LLM 重写失败，退回规则逻辑:", error?.message || error);
    source = "rules";
  }

  let fallbackRows = null;
  if (!patchBySeq) {
    fallbackRows = buildSecondBatchRows(selected, selected.length, request?.preferences || {});
  }

  const changed = [];
  for (let index = 0; index < selected.length; index += 1) {
    const record = selected[index];
    const patch = patchBySeq
      ? patchBySeq.get(String(record.seq))
      : {
        人物: fallbackRows[index].人物,
        服装: fallbackRows[index].服装,
        风格: fallbackRows[index].风格,
      };
    await updateRecord(record.id, patch);
    changed.push({ seq: record.seq || String(index + 1), ...patch });
  }

  const roleCounts = changed.reduce((acc, item) => {
    acc[item.人物] = (acc[item.人物] || 0) + 1;
    return acc;
  }, {});

  return { changed, roleCounts, source };
}

async function handleCommand(text = "") {
  const source = String(text || "").trim();
  if (!source) throw new Error("指令为空");

  const rewriteRequest = parseRewriteVariationRequest(source);
  if (rewriteRequest) {
    rewriteRequest.instruction = source;
    const result = await rewriteVariationFields(rewriteRequest);
    const preview = result.changed
      .slice(0, 8)
      .map((item) => `第${item.seq}张 -> ${item.人物} / ${item.服装} / ${item.风格}`)
      .join("\n");
    return {
      reply: [
        `已在当前 WA 主表重写 ${result.changed.length} 条的 人物 / 服装 / 风格。`,
        result.source === "llm"
          ? "风格基调按每条主副文案主题生成，并已套用你的附加要求。"
          : "本次 AI 生成不可用，已按内置规则填充。",
        "未改主文案、副文案、AI设计图，也没有创建新表。",
        `人物分布：${Object.entries(result.roleCounts).map(([key, value]) => `${key} ${value}条`).join("，")}。`,
        preview ? `预览：\n${preview}${result.changed.length > 8 ? "\n..." : ""}` : "",
      ].filter(Boolean).join("\n"),
    };
  }

  if (/(查看|列出|展示).*(前|所有|WA|wa|海报|需求|记录)/i.test(source)) {
    const records = await listRecords(parseLimit(source, 10));
    const limit = /所有/.test(source) ? records.length : parseLimit(source, 10);
    const items = records.slice(0, limit);
    return buildReplyWithImages(
      items.length > 0
        ? `当前显示 ${items.length} 条：\n${items.map((item) => formatRecordSummary(item)).join("\n\n")}`
        : "当前表格没有记录。",
      items
    );
  }

  const rowViewMatch = source.match(/(?:查看|显示|读取)\s*第\s*([0-9一二两三四五六七八九十]+)\s*张/);
  if (rowViewMatch) {
    const seq = String(parseChineseNumber(rowViewMatch[1]) || rowViewMatch[1]);
    const records = await listRecords();
    const target = records.find((item) => item.seq === seq);
    if (!target) throw new Error(`没有找到第${seq}张`);
    return buildReplyWithImages(formatRecordSummary(target), [target]);
  }

  if (/(筛选|过滤|查看|列出).*(Boy真人版|真人版|Boy|Girl|Robot|robot|机器人)/i.test(source)) {
    const roleMatch = source.match(/Boy真人版|真人版Boy|真人版|Boy|Girl|Robot|robot|机器人/i);
    const role = /机器人|robot/i.test(roleMatch?.[0] || "")
      ? "Robot"
      : /真人版/i.test(roleMatch?.[0] || "")
        ? "Boy真人版"
        : roleMatch?.[0];
    const records = await listRecords();
    const matched = records.filter((item) => item.role === role);
    return buildReplyWithImages(
      matched.length > 0
        ? `${role} 共 ${matched.length} 条：\n${matched.map((item) => formatRecordSummary(item)).join("\n\n")}`
        : `没有找到人物为 ${role} 的记录。`,
      matched
    );
  }

  if (/(统计|多少|分布).*(人物|角色|分布)/i.test(source) || /(统计|多少).*(Boy|Girl)/i.test(source)) {
    const records = await listRecords();
    const counts = records.reduce((acc, item) => {
      const key = item.role || "未填";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return {
      reply: `当前人物分布：${Object.entries(counts).map(([key, value]) => `${key} ${value}条`).join("，")}。`,
    };
  }

  if (/(检查|查看|统计).*(空字段|缺失|未填)/.test(source)) {
    const records = await listRecords();
    const requiredFields = [
      ["主标题", "headline"],
      ["副标题", "subline"],
      ["人物", "role"],
      ["服装", "outfit"],
      ["风格", "style"],
    ];
    const issues = records.map((record) => {
      const missing = requiredFields.filter(([, key]) => !String(record[key] || "").trim()).map(([label]) => label);
      return missing.length > 0 ? `第${record.seq}张缺少：${missing.join("、")}` : "";
    }).filter(Boolean);
    return { reply: issues.length > 0 ? issues.join("\n") : "主标题、副标题、人物、服装、风格都已填写。" };
  }

  if (/(检查|查看|统计).*(AI设计图|ai设计图|生成图|图片)/i.test(source) && !/(清空|删除|移除)/.test(source)) {
    const records = await listRecords();
    const empty = records.filter((record) => !Array.isArray(record.aiImage) || record.aiImage.length === 0);
    const filled = records.length - empty.length;
    return {
      reply: `AI设计图状态：已回填 ${filled} 条，未回填 ${empty.length} 条。${empty.length > 0 ? `\n未回填：${empty.map((item) => `第${item.seq}张`).join("、")}` : ""}`,
    };
  }

  if (/(清空|删除|移除).*(AI设计图|ai设计图|生成图|图片)/i.test(source)) {
    const fieldId = await ensureAiImageFieldIsEmpty();
    return { reply: `已清空飞书表格里的 AI设计图 字段，新字段 ID：${fieldId || "已创建"}。` };
  }

  if (/(robot|机器人)/i.test(source) && /(减少|少一些|少一点|不要太多|降低|只要|控制到|控制在)/.test(source)) {
    const targetMatch = source.match(/(?:保留|减少到|降到|控制到|控制在|只要)\s*([0-9一二两三四五六七八九十]+)\s*(?:个|条|张)?/);
    const target = targetMatch ? Math.max(parseChineseNumber(targetMatch[1]), 1) : 4;
    const result = await reduceRobots(target);
    const detail = result.changed.length
      ? `\n${result.changed.map((item) => `第${item.seq}张 -> ${item.人物} / ${item.服装}`).join("\n")}`
      : "";
    return { reply: `${result.message}${detail}` };
  }

  if (/(统计|查看|多少).*(robot|机器人)/i.test(source)) {
    const records = await listRecords();
    const robots = records.filter((item) => item.role === "Robot");
    return { reply: `当前 Robot 共 ${robots.length} 条：${robots.map((item) => `第${item.seq}张`).join("、") || "无"}。` };
  }

  const createPatch = parseCreatePatch(source);
  if (createPatch) {
    await createRecord(createPatch);
    return {
      reply: `已新增一条 WA 需求：${Object.entries(createPatch).map(([key, value]) => `${key}=${formatSelectValue(value)}`).join("，")}。`,
    };
  }

  const copyMatch = source.match(/(?:复制|拷贝|克隆)\s*第\s*([0-9一二两三四五六七八九十]+)\s*张/);
  if (copyMatch) {
    const seq = String(parseChineseNumber(copyMatch[1]) || copyMatch[1]);
    const records = await listRecords();
    const target = records.find((item) => item.seq === seq);
    if (!target) throw new Error(`没有找到第${seq}张`);
    await createRecord({
      "场景类型": target.scene,
      "主文案（中文）": target.zhHeadline,
      "主文案（印尼语 ≤30）": target.headline,
      "副文案（中文）": target.zhSubline,
      "副文案（印尼语 ≤50）": target.subline,
      人物: target.role,
      服装: target.outfit,
      风格: target.style,
      需求备注: target.note,
    });
    return { reply: `已复制第${seq}张为一条新 WA 需求。` };
  }

  const deleteMatch = source.match(/(?:删除|移除)\s*第\s*([0-9一二两三四五六七八九十]+)\s*张/);
  if (deleteMatch) {
    const seq = String(parseChineseNumber(deleteMatch[1]) || deleteMatch[1]);
    if (!/确认删除/.test(source)) {
      return { reply: `删除记录是高风险操作。如确认要删除第${seq}张，请输入：确认删除第${seq}张。` };
    }
    const records = await listRecords();
    const target = records.find((item) => item.seq === seq);
    if (!target) throw new Error(`没有找到第${seq}张`);
    await deleteRecord(target.id);
    return { reply: `已删除第${seq}张。` };
  }

  const rowUpdate = parseRowUpdates(source);
  if (rowUpdate) {
    const records = await listRecords();
    const target = records.find((item) => item.seq === rowUpdate.seq);
    if (!target) throw new Error(`没有找到第${rowUpdate.seq}张`);
    await updateRecord(target.id, rowUpdate.patch);
    return {
      reply: `已修改第${rowUpdate.seq}张：${Object.entries(rowUpdate.patch).map(([key, value]) => `${key}=${value}`).join("，")}。`,
    };
  }

  return {
    reply: "我识别到你想操作飞书表格，但这个指令还不够明确。当前支持：查看前N张、查看第N张、统计人物、检查空字段、检查AI设计图、清空AI设计图、减少Robot、重写人物服装风格、新增需求、复制第N张、确认删除第N张、修改第N张字段。",
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await handleCommand(body?.text || body?.command || "");
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "飞书指令处理失败" }, { status: 500 });
  }
}
