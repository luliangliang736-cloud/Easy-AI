import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { LARK_IDENTITY, runLarkCliJson } from "@/lib/server/larkCliRuntime";

export const runtime = "nodejs";

const BASE_TOKEN = process.env.FEISHU_WA_BASE_TOKEN || "R2edbyyrZaGixJsH0v2cD1Mcnkg";
const TABLE_ID = process.env.FEISHU_WA_TABLE_ID || "tble6jwNnOTjv75V";
const SECOND_BATCH_TABLE_PREFIX = process.env.FEISHU_WA_SECOND_BATCH_PREFIX || "WA海报批量测试_第二批";
const AI_IMAGE_FIELD_NAME = "AI设计图";
const EDITABLE_FIELDS = new Set([
  "人物",
  "服装",
  "风格",
  "需求备注",
  "主文案（印尼语 ≤30）",
  "副文案（印尼语 ≤50）",
  "主文案（中文）",
  "副文案（中文）",
  "场景类型",
]);

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

async function listRecords(limit = 100) {
  const data = await runLarkCliJson([
    "base", "+record-list",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", LARK_IDENTITY,
    "--limit", String(limit),
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
  return rows.map((row, index) => ({
    id: recordIds[index],
    seq: String(row[fields.indexOf("任务序号")] || ""),
    priority: row[fields.indexOf("优先级")],
    role: String(row[fields.indexOf("人物")] || ""),
    outfit: String(row[fields.indexOf("服装")] || ""),
    style: String(row[fields.indexOf("风格")] || ""),
    scene: row[fields.indexOf("场景类型")],
    aiImage: row[fields.indexOf("AI设计图")],
    aiImageFieldId,
    manualImage: row[fields.indexOf("人工设计图")],
    zhHeadline: String(row[fields.indexOf("主文案（中文）")] || ""),
    zhSubline: String(row[fields.indexOf("副文案（中文）")] || ""),
    headline: String(row[fields.indexOf("主文案（印尼语 ≤30）")] || ""),
    subline: String(row[fields.indexOf("副文案（印尼语 ≤50）")] || ""),
    note: String(row[fields.indexOf("需求备注")] || ""),
  })).filter((item) => item.id);
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

function makeSecondBatchTableName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${SECOND_BATCH_TABLE_PREFIX}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function parseSecondBatchRequest(text = "") {
  const source = String(text || "");
  if (!/(第二批|第2批|二批)/.test(source)) return null;
  if (!/(创建|新建|建立|生成|复制).*(表格|表|批次|第二批|第2批|二批)/.test(source)) return null;
  return {
    limit: parseLimit(source, 39),
    reduceGreen: /(减少|降低|少一点|少一些|不要太多).*(绿色|绿)/.test(source) || /绿色.*(减少|降低|少一点|少一些|不要太多)/.test(source),
    rebalanceRole: /(人物|男生|Boy|女生|Girl|Robot|机器人|平衡|均衡)/i.test(source),
  };
}

function compactText(record) {
  return `${formatSelectValue(record.scene)} ${record.zhHeadline} ${record.zhSubline} ${record.headline} ${record.subline}`.toLowerCase();
}

function chooseSecondBatchRole(record, counts, targets) {
  const source = compactText(record);
  if (/(robot|机器人|自动|极速|5\s*menit|kilat|cepat|online|pindar)/i.test(source) && counts.Robot < targets.Robot) {
    counts.Robot += 1;
    return "Robot";
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
  counts.Girl += 1;
  return "Girl";
}

function chooseSecondBatchOutfit(record, role) {
  const source = compactText(record);
  if (role === "Robot") {
    return "仅使用库里的Robot标准形态：标准绿色主体机身、黑色屏幕脸、银白机械臂/脚部；最多只改变姿势/朝向/手势，不改变服饰、颜色、机身或屏幕脸";
  }
  if (/(vip|gold|member|会员|权益)/i.test(source)) return "高级商务服装";
  if (/(skor|credit|信用)/i.test(source)) return role === "Boy" ? "印尼制服" : "亲和职业装";
  if (/(pinjaman pertama|新用户|ojk|transparan)/i.test(source)) return "客服制服";
  if (/(gaji|发薪|limit|额度)/i.test(source)) return role === "Boy" ? "绿色客服制服" : "客服制服";
  if (/(sekolah|学费|教育|afpi)/i.test(source)) return "亲和职业装";
  return role === "Boy" ? "亲和职业装" : "客服制服";
}

function chooseSecondBatchStyle(record, index) {
  const source = compactText(record);
  if (/(vip|gold|member|会员|权益)/i.test(source)) return "VIP会员权益海报，高级金色与象牙白主视觉，礼遇感、会员徽章、干净明亮，品牌绿仅做小面积点缀";
  if (/(skor|credit|信用)/i.test(source)) return "信用修复教育海报，蓝白金融科技界面、分数仪表盘、向上箭头，可信专业，减少大面积绿色背景";
  if (/(pinjaman pertama|新用户|ojk|transparan)/i.test(source)) return "新用户引导海报，清爽浅色流程卡片、透明步骤、OJK信任背书，少量品牌绿按钮点缀";
  if (/(gaji|发薪|limit|额度)/i.test(source)) return "发薪日前救急海报，暖黄色行动氛围、手机额度卡片、快速到账动线，品牌绿只用于CTA或小图标";
  if (/(sekolah|学费|教育|afpi)/i.test(source)) return "教育缴费场景海报，温暖米色与书本学费元素，家庭安心感、合规可信，避免整张绿色";
  const variants = [
    "蓝白金融科技广告，清晰信息卡片、可信赖、明亮留白，少量品牌绿点缀",
    "金色权益感营销海报，高级渐变、会员礼遇、干净排版，避免重复绿色背景",
    "暖色生活场景海报，真实需求感、亲和人物、行动按钮突出，品牌色克制使用",
    "浅色合规信任海报，OJK/AFPI背书、清晰文字层级、简洁图标，绿色仅作辅助",
    "深蓝科技金融海报，数据卡片、速度感线条、专业可信，形成与绿色版差异",
  ];
  return variants[index % variants.length];
}

function buildSecondBatchRows(records, limit) {
  const selected = records.slice(0, limit);
  const robotTarget = Math.min(3, Math.max(1, Math.round(selected.length * 0.08)));
  const girlTarget = Math.ceil((selected.length - robotTarget) * 0.58);
  const boyTarget = Math.max(selected.length - robotTarget - girlTarget, 0);
  const counts = { Boy: 0, Girl: 0, Robot: 0 };
  const targets = { Boy: boyTarget, Girl: girlTarget, Robot: robotTarget };

  return selected.map((record, index) => {
    const role = chooseSecondBatchRole(record, counts, targets);
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
        `第二批自动重平衡：减少绿色重复，人物比例 Boy ${targets.Boy}/Girl ${targets.Girl}/Robot ${targets.Robot}`,
      ].filter(Boolean).join("；"),
    };
  });
}

async function createTable(name) {
  const data = await runLarkCliJson([
    "base", "+table-create",
    "--base-token", BASE_TOKEN,
    "--name", name,
    "--as", LARK_IDENTITY,
    "--jq", ".",
  ]);
  const table = data?.data?.table || data?.data || data?.table || {};
  const tableId = table?.id || table?.table_id || data?.data?.table_id || data?.table_id;
  if (!tableId) throw new Error("第二批表格创建失败：未返回 tableId");
  return tableId;
}

async function createSecondBatchFields(tableId) {
  const fields = [
    { name: "任务序号", type: "text" },
    { name: "优先级", type: "text" },
    { name: "场景类型", type: "text" },
    { name: "主文案（中文）", type: "text" },
    { name: "副文案（中文）", type: "text" },
    { name: "主文案（印尼语 ≤30）", type: "text" },
    { name: "副文案（印尼语 ≤50）", type: "text" },
    { name: "人物", type: "text" },
    { name: "服装", type: "text" },
    { name: "风格", type: "text" },
    { name: "需求备注", type: "text" },
    { name: AI_IMAGE_FIELD_NAME, type: "attachment" },
  ];
  for (const field of fields) {
    await runWithTempJson([
      "base", "+field-create",
      "--base-token", BASE_TOKEN,
      "--table-id", tableId,
      "--as", LARK_IDENTITY,
    ], field, ["--jq", "."]).catch(() => null);
  }
}

async function createSecondBatchTable({ limit = 39 } = {}) {
  const records = await listRecords(Math.min(Math.max(limit, 1), 50));
  if (records.length === 0) throw new Error("原表没有可复制的 WA 需求");
  const tableName = makeSecondBatchTableName();
  const tableId = await createTable(tableName);
  await createSecondBatchFields(tableId);
  const rows = buildSecondBatchRows(records, Math.min(limit, records.length));
  await runWithTempJson([
    "base", "+record-batch-create",
    "--base-token", BASE_TOKEN,
    "--table-id", tableId,
    "--as", LARK_IDENTITY,
  ], { fields: Object.keys(rows[0]), rows: rows.map((row) => Object.keys(rows[0]).map((field) => row[field] || "")) }, ["--jq", "."]);
  return { tableName, tableId, rows };
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

async function handleCommand(text = "") {
  const source = String(text || "").trim();
  if (!source) throw new Error("指令为空");

  const secondBatchRequest = parseSecondBatchRequest(source);
  if (secondBatchRequest) {
    const result = await createSecondBatchTable(secondBatchRequest);
    const roleCounts = result.rows.reduce((acc, row) => {
      acc[row.人物] = (acc[row.人物] || 0) + 1;
      return acc;
    }, {});
    return {
      reply: [
        `已创建第二批 WA 表格：${result.tableName}`,
        `表格 ID：${result.tableId}`,
        `已复制 ${result.rows.length} 条需求，不复制 AI设计图。`,
        `人物分布：${Object.entries(roleCounts).map(([key, value]) => `${key} ${value}条`).join("，")}。`,
        "风格已重新改写：减少大面积绿色重复，按 VIP/信用/新用户/发薪日/教育等主题做差异化。",
        "生成时请使用：批量生成第二批飞书WA海报前39张",
      ].join("\n"),
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

  if (/(筛选|过滤|查看|列出).*(Boy|Girl|Robot|robot|机器人)/i.test(source)) {
    const roleMatch = source.match(/Boy|Girl|Robot|robot|机器人/i);
    const role = /机器人|robot/i.test(roleMatch?.[0] || "") ? "Robot" : roleMatch?.[0];
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

  if (/(robot|机器人)/i.test(source) && /(减少|少一些|少一点|不要太多|降低)/.test(source)) {
    const targetMatch = source.match(/(?:保留|减少到|降到)\s*([0-9一二两三四五六七八九十]+)\s*(?:个|条|张)?/);
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
    reply: "我识别到你想操作飞书表格，但这个指令还不够明确。当前支持：查看前N张、查看第N张、统计人物、检查空字段、检查AI设计图、清空AI设计图、减少Robot、新增需求、复制第N张、确认删除第N张、修改第N张字段。",
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
