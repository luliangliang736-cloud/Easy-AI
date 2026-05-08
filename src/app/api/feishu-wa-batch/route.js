import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";
import {
  chooseWaTemplateIpRole,
} from "@/lib/oneClickCreationRules";
import { readGeneratedImage } from "@/lib/server/generatedImageStore";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const LARK_CLI = process.env.LARK_CLI_PATH || path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");
const BASE_TOKEN = process.env.FEISHU_WA_BASE_TOKEN || "R2edbyyrZaGixJsH0v2cD1Mcnkg";
const TABLE_ID = process.env.FEISHU_WA_TABLE_ID || "tble6jwNnOTjv75V";
const AI_IMAGE_FIELD_NAME = "AI设计图";

function normalizeText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("，");
  return String(value || "").trim();
}

function getField(record, fieldNames, name) {
  const index = fieldNames.indexOf(name);
  return index >= 0 ? record[index] : null;
}

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
  const filename = `easyai-feishu-json-${randomUUID()}.json`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, JSON.stringify(payload), "utf8");
  return { filePath, cliPath: `.easyai-tmp/${filename}` };
}

async function resolveAiImageFieldId() {
  if (process.env.FEISHU_WA_AI_IMAGE_FIELD) return process.env.FEISHU_WA_AI_IMAGE_FIELD;
  const data = await runLarkCli([
    "base", "+field-list",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", "user",
    "--jq", ".",
  ]);
  const fields = Array.isArray(data?.data?.fields) ? data.data.fields : [];
  const field = fields.find((item) => item?.name === AI_IMAGE_FIELD_NAME && item?.type === "attachment");
  if (!field?.id) throw new Error("未找到飞书 AI设计图 附件字段");
  return field.id;
}

async function writeTempBinary(buffer, ext = "png") {
  const dir = path.join(process.cwd(), ".easyai-tmp");
  await mkdir(dir, { recursive: true });
  const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : "png";
  const filename = `easyai-feishu-wa-${randomUUID()}.${safeExt}`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, buffer);
  return { filePath, cliPath: `.easyai-tmp/${filename}` };
}

function inferWaFields({ headline = "", subline = "", scene = "" } = {}) {
  const source = `${scene} ${headline} ${subline}`;
  const compact = source.toLowerCase().replace(/\s+/g, "");
  const role = chooseWaTemplateIpRole({ headline, subline });

  if (/(vip|gold|benefit|exclusive|eksklusif|会员|权益)/i.test(compact)) {
    return {
      role: "Girl",
      outfit: "高级商务服装",
      style: "VIP会员权益，高级金色点缀，绿色品牌金融广告，礼遇感，干净明亮",
    };
  }
  if (/(skorkredit|credit|信用评分|信用修复|skor)/i.test(compact)) {
    return {
      role: "Boy",
      outfit: "印尼制服",
      style: "信用修复教育，分数仪表盘，向上箭头，可信金融科技感",
    };
  }
  if (/(pinjamanpertama|新用户|首次|transparan|ojk)/i.test(compact)) {
    return {
      role: "Girl",
      outfit: "客服制服",
      style: "新用户引导，流程简单透明，OJK信任背书，绿色清爽",
    };
  }
  if (/(gajihabis|发薪日|danacair|ceklimit|limitmu)/i.test(compact)) {
    return {
      role: "Boy",
      outfit: "绿色客服制服",
      style: "发薪日前救急，快速到账，手机额度卡片，强行动按钮",
    };
  }
  if (/(biayasekolah|sekolah|学费|教育|afpi)/i.test(compact)) {
    return {
      role: "Girl",
      outfit: "亲和职业装",
      style: "教育缴费场景，书本学费元素，合规可信，温暖绿色",
    };
  }

  return {
    role,
    outfit: role === "Robot" ? "仅使用库里的Robot标准形态：标准绿色主体机身、黑色屏幕脸、银白机械臂/脚部；最多只改变姿势/朝向/手势，不改变服饰、颜色、机身或屏幕脸" : "亲和职业装",
    style: "绿色品牌金融广告，干净明亮，可信赖，信息清晰",
  };
}

function buildPrompt({ scene, headline, subline, role, outfit, style }, index) {
  return `第${index}张
场景类型：${scene || "WA海报"}
主标题：${headline}
副标题：${subline}
人物：${role}
服装：${outfit}
风格：${style}`;
}

async function prepareBatch({ limit = 5, start = 0, end = 0, tail = false } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 50);
  const safeStart = Math.max(Number(start) || 0, 0);
  const safeEnd = Math.max(Number(end) || 0, 0);
  const readLimit = tail || safeStart > 0 || safeEnd > 0 ? 100 : safeLimit;
  const data = await runLarkCli([
    "base", "+record-list",
    "--base-token", BASE_TOKEN,
    "--table-id", TABLE_ID,
    "--as", "user",
    "--limit", String(readLimit),
    "--jq", ".",
  ]);
  if (!data?.ok) {
    throw new Error(data?.error?.message || "读取飞书表格失败");
  }

  const payload = data.data || {};
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const records = Array.isArray(payload.data) ? payload.data : [];
  const recordIds = Array.isArray(payload.record_id_list) ? payload.record_id_list : [];

  const indexedRecords = records.map((record, index) => ({
    record,
    recordId: recordIds[index],
    index,
  }));
  const selectedRecords = tail
    ? indexedRecords.slice(-safeLimit)
    : safeStart > 0 && safeEnd > 0
      ? indexedRecords.slice(safeStart - 1, safeEnd)
      : safeStart > 0
        ? indexedRecords.slice(safeStart - 1, safeStart)
        : indexedRecords.slice(0, safeLimit);

  const items = [];
  for (const selected of selectedRecords) {
    const { record, recordId, index } = selected;
    const scene = normalizeText(getField(record, fields, "场景类型"));
    const headline = normalizeText(getField(record, fields, "主文案（印尼语 ≤30）"));
    const subline = normalizeText(getField(record, fields, "副文案（印尼语 ≤50）"));
    if (!recordId || !headline || !subline) continue;

    const inferred = inferWaFields({ headline, subline, scene });
    const currentRole = normalizeText(getField(record, fields, "人物"));
    const currentOutfit = normalizeText(getField(record, fields, "服装"));
    const currentStyle = normalizeText(getField(record, fields, "风格"));
    const role = currentRole || inferred.role;
    const outfit = role === "Robot"
      ? "仅使用库里的Robot标准形态：标准绿色主体机身、黑色屏幕脸、银白机械臂/脚部；最多只改变姿势/朝向/手势，不改变服饰、颜色、机身或屏幕脸"
      : currentOutfit || inferred.outfit;
    const style = currentStyle || inferred.style;

    if (!currentRole || !currentOutfit || !currentStyle) {
      const jsonFile = await writeTempJson({ 人物: role, 服装: outfit, 风格: style });
      try {
        await runLarkCli([
          "base", "+record-upsert",
          "--base-token", BASE_TOKEN,
          "--table-id", TABLE_ID,
          "--record-id", recordId,
          "--as", "user",
          "--json", `@${jsonFile.cliPath}`,
        ]);
      } finally {
        await unlink(jsonFile.filePath).catch(() => {});
      }
    }

    items.push({
      index,
      label: `第${index + 1}张`,
      recordId,
      headline,
      subline,
      role,
      outfit,
      style,
      prompt: buildPrompt({ scene, headline, subline, role, outfit, style }, index + 1),
    });
  }

  return { items };
}

function getGeneratedImageFilename(source = "") {
  const text = String(source || "").trim();
  const match = text.match(/\/api\/generated-images\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

async function imageSourceToTempFile(source) {
  const filename = getGeneratedImageFilename(source);
  let buffer = null;
  let ext = "png";

  if (filename) {
    const image = await readGeneratedImage(filename);
    if (!image) throw new Error("本地生成图片不存在或已过期");
    buffer = image.buffer;
    ext = filename.split(".").pop() || "png";
  } else {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`读取图片失败（${res.status}）`);
    buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/png";
    ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  }

  return writeTempBinary(buffer, ext);
}

async function uploadGeneratedImage({ recordId, imageUrl, name }) {
  if (!recordId || !imageUrl) throw new Error("recordId 和 imageUrl 必填");
  const tempFile = await imageSourceToTempFile(imageUrl);
  try {
    const aiImageFieldId = await resolveAiImageFieldId();
    return await runLarkCli([
      "base", "+record-upload-attachment",
      "--base-token", BASE_TOKEN,
      "--table-id", TABLE_ID,
      "--record-id", recordId,
      "--field-id", aiImageFieldId,
      "--file", tempFile.cliPath,
      "--name", name || `EasyAI-WA-${Date.now()}.png`,
      "--as", "user",
      "--jq", ".",
    ]);
  } finally {
    await unlink(tempFile.filePath).catch(() => {});
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "prepare").trim();
    if (action === "upload") {
      const result = await uploadGeneratedImage(body);
      return NextResponse.json({ success: true, data: result });
    }
    const result = await prepareBatch(body);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "飞书 WA 批量处理失败" }, { status: 500 });
  }
}
