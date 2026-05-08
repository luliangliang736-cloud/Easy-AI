import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const LARK_CLI = process.env.LARK_CLI_PATH || path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");
const BASE_TOKEN = process.env.FEISHU_WA_BASE_TOKEN || "R2edbyyrZaGixJsH0v2cD1Mcnkg";
const TABLE_ID = process.env.FEISHU_WA_TABLE_ID || "tble6jwNnOTjv75V";
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

async function runLarkCli(args) {
  try {
    const { stdout } = await execFileAsync(LARK_CLI, args, {
      cwd: process.cwd(),
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    const text = Buffer.from(stdout || "").toString("utf8").trim();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    const output = Buffer.from(error?.stdout || error?.stderr || "").toString("utf8").trim();
    let parsed = null;
    try {
      parsed = output ? JSON.parse(output) : null;
    } catch {
      parsed = null;
    }
    throw new Error(parsed?.error?.message || parsed?.msg || output || error?.message || "飞书 CLI 执行失败");
  }
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
    return await runLarkCli([...argsBeforeJson, "--json", `@${jsonFile.cliPath}`, ...argsAfterJson]);
  } finally {
    await unlink(jsonFile.filePath).catch(() => {});
  }
}

async function listRecords(limit = 100) {
  const data = await runLarkCli([
    "base", "+record-list",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", "user",
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
  const data = await runLarkCli([
    "base", "+view-list",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", "user",
    "--jq", ".",
  ]);
  return Array.isArray(data?.data?.views) ? data.data.views : [];
}

async function ensureAiImageFieldIsEmpty() {
  const fieldsData = await runLarkCli([
    "base", "+field-list",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", "user",
    "--jq", ".",
  ]);
  const fields = Array.isArray(fieldsData?.data?.fields) ? fieldsData.data.fields : [];
  const oldField = fields.find((field) => field?.name === AI_IMAGE_FIELD_NAME && field?.type === "attachment");
  const viewOrders = [];
  const views = await listViews();

  for (const view of views) {
    const visible = await runLarkCli([
      "base", "+view-get-visible-fields",
      "--base-token", BASE_TOKEN,
      "--table-id", TABLE_ID,
      "--view-id", view.id,
      "--as", "user",
      "--jq", ".",
    ]).catch(() => null);
    const visibleFields = visible?.data?.visible_fields;
    if (Array.isArray(visibleFields) && visibleFields.length > 0) {
      viewOrders.push({ viewId: view.id, fields: visibleFields });
    }
  }

  if (oldField?.id) {
    await runLarkCli([
      "base", "+field-delete",
      "--base-token", BASE_TOKEN,
      "--table-id", TABLE_ID,
      "--field-id", oldField.id,
      "--as", "user",
      "--yes",
      "--jq", ".",
    ]);
  }

  const created = await runWithTempJson([
    "base", "+field-create",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", "user",
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
      "--as", "user",
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
    "--as", "user",
  ], patch, ["--jq", "."]);
}

async function createRecord(patch) {
  return runWithTempJson([
    "base", "+record-upsert",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", "user",
  ], patch, ["--jq", "."]);
}

async function deleteRecord(recordId) {
  return runWithTempJson([
    "base", "+record-delete",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", "user",
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
