import { randomUUID } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import {
  chooseWaTemplateIpRole,
} from "@/lib/oneClickCreationRules";
import { readGeneratedImage } from "@/lib/server/generatedImageStore";
import { readCloudAssetImage } from "@/lib/server/cloudAssetStore";
import { LARK_IDENTITY, runLarkCliJson } from "@/lib/server/larkCliRuntime";

export const runtime = "nodejs";

const BASE_TOKEN = process.env.FEISHU_WA_BASE_TOKEN || "R2edbyyrZaGixJsH0v2cD1Mcnkg";
const TABLE_ID = process.env.FEISHU_WA_TABLE_ID || "tbl5LlkOa5yLoGQf";
const AI_IMAGE_FIELD_NAME = "AI设计图";

const FIELD_ALIASES = {
  scene: ["场景类型", "标签"],
  headline: ["主文案（印尼语 ≤30）", "主文案-印尼语", "主文案（印尼语）"],
  subline: ["副文案（印尼语 ≤50）", "副文案-印尼语", "副文案（印尼语）"],
  role: ["人物"],
  outfit: ["服装"],
  style: ["风格"],
};

function normalizeText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("，");
  return String(value || "").trim();
}

function getField(record, fieldNames, name) {
  const index = fieldNames.indexOf(name);
  return index >= 0 ? record[index] : null;
}

function getFieldByAliases(record, fieldNames, aliases) {
  for (const name of aliases) {
    const value = normalizeText(getField(record, fieldNames, name));
    if (value) return value;
  }
  return "";
}

async function writeTempJson(payload) {
  const dir = path.join(process.cwd(), ".easyai-tmp");
  await mkdir(dir, { recursive: true });
  const filename = `easyai-feishu-json-${randomUUID()}.json`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, JSON.stringify(payload), "utf8");
  return { filePath, cliPath: `.easyai-tmp/${filename}` };
}

function resolveTableTarget() {
  return { tableId: TABLE_ID, tableName: "" };
}

// 视图与附件字段按表自动解析并缓存，换表时只需要更新 TABLE_ID
const resolvedViewIdByTable = new Map();
const resolvedAiImageFieldByTable = new Map();

async function resolveViewId(tableId = TABLE_ID) {
  if (process.env.FEISHU_WA_VIEW_ID) return process.env.FEISHU_WA_VIEW_ID;
  if (resolvedViewIdByTable.has(tableId)) return resolvedViewIdByTable.get(tableId);
  let viewId = "";
  try {
    const data = await runLarkCliJson([
      "base", "+view-list",
      "--base-token", BASE_TOKEN,
      "--table-id", tableId,
      "--as", LARK_IDENTITY,
      "--format", "json",
      "--jq", ".",
    ]);
    const views = Array.isArray(data?.data?.views) ? data.data.views : [];
    const view = views.find((item) => item?.type === "grid") || views[0];
    viewId = view?.id || "";
  } catch (error) {
    // bot 身份可能缺 base:view:read 权限；降级为不带视图读取（默认视图行序）
    console.warn("[feishu-wa-batch] view-list unavailable, fallback to default view:", error?.message || error);
  }
  resolvedViewIdByTable.set(tableId, viewId);
  return viewId;
}

async function resolveAiImageFieldId(tableId = TABLE_ID) {
  if (tableId === TABLE_ID && process.env.FEISHU_WA_AI_IMAGE_FIELD) return process.env.FEISHU_WA_AI_IMAGE_FIELD;
  const cached = resolvedAiImageFieldByTable.get(tableId);
  if (cached) return cached;
  const data = await runLarkCliJson([
    "base", "+field-list",
    "--base-token", BASE_TOKEN,
    "--table-id", tableId,
    "--as", LARK_IDENTITY,
    "--format", "json",
    "--jq", ".",
  ]);
  const fields = Array.isArray(data?.data?.fields) ? data.data.fields : [];
  const field = fields.find((item) => item?.name === AI_IMAGE_FIELD_NAME && item?.type === "attachment");
  if (!field?.id) throw new Error("未找到飞书 AI设计图 附件字段");
  resolvedAiImageFieldByTable.set(tableId, field.id);
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

  // 风格写法对齐「WA海报批量测试」：克制、可对比，品牌绿只做点缀
  const stylePool = [
    "蓝白金融科技广告，清晰信息卡片、可信赖、明亮留白，少量品牌绿点缀",
    "暖色生活场景海报，真实需求感、亲和人物、行动按钮突出，品牌色克制使用",
    "浅色合规信任海报，OJK/AFPI背书、清晰文字层级、简洁图标，绿色仅作辅助",
    "深蓝科技金融海报，数据卡片、速度感线条、专业可信，形成与绿色版差异",
    "发薪日前救急海报，暖黄色行动氛围、手机额度卡片、快速到账动线，品牌绿只用于CTA或小图标",
    "金色权益感营销海报，高级渐变、会员礼遇、干净排版，避免重复绿色背景",
    "新用户引导海报，清爽浅色流程卡片、透明步骤、OJK信任背书，少量品牌绿按钮点缀",
  ];
  let hash = 0;
  const seed = compact || "wa";
  for (let i = 0; i < seed.length; i += 1) hash = (hash + seed.charCodeAt(i) * (i + 1)) % 997;
  const style = stylePool[hash % stylePool.length];

  return {
    role,
    outfit: role === "Robot"
      ? "仅使用库里的Robot标准形态：标准绿色主体机身、黑色屏幕脸、银白机械臂/脚部；最多只改变姿势/朝向/手势，不改变服饰、颜色、机身或屏幕脸"
      : role === "Girl"
        ? "亲和职业装"
        : "商务服饰",
    style,
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
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 500);
  const safeStart = Math.max(Number(start) || 0, 0);
  const safeEnd = Math.max(Number(end) || 0, 0);
  // 使用视图 ID 保证按视图行序返回，直接取对应条数
  const readLimit = tail ? 200 : (safeEnd > 0 ? safeEnd : safeLimit);
  const target = resolveTableTarget();
  const viewId = await resolveViewId(target.tableId);
  const data = await runLarkCliJson([
    "base", "+record-list",
    "--base-token", BASE_TOKEN,
    "--table-id", target.tableId,
    ...(viewId ? ["--view-id", viewId] : []),
    "--as", LARK_IDENTITY,
    "--limit", String(Math.min(readLimit, 200)),
    "--format", "json",
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

  // 视图已按任务序号排序，直接切片即可
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
    const scene = getFieldByAliases(record, fields, FIELD_ALIASES.scene);
    const headline = getFieldByAliases(record, fields, FIELD_ALIASES.headline);
    const subline = getFieldByAliases(record, fields, FIELD_ALIASES.subline);
    if (!recordId || !headline || !subline) continue;

    const inferred = inferWaFields({ headline, subline, scene });
    const currentRole = getFieldByAliases(record, fields, FIELD_ALIASES.role);
    const currentOutfit = getFieldByAliases(record, fields, FIELD_ALIASES.outfit);
    const currentStyle = getFieldByAliases(record, fields, FIELD_ALIASES.style);
    const role = currentRole || inferred.role;
    const outfit = role === "Robot"
      ? "仅使用库里的Robot标准形态：标准绿色主体机身、黑色屏幕脸、银白机械臂/脚部；最多只改变姿势/朝向/手势，不改变服饰、颜色、机身或屏幕脸"
      : currentOutfit || inferred.outfit;
    const style = currentStyle || inferred.style;

    if (!currentRole || !currentOutfit || !currentStyle) {
      const jsonFile = await writeTempJson({ 人物: role, 服装: outfit, 风格: style });
      try {
        await runLarkCliJson([
          "base", "+record-upsert",
          "--base-token", BASE_TOKEN,
          "--table-id", target.tableId,
          "--record-id", recordId,
          "--as", LARK_IDENTITY,
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
      tableId: target.tableId,
      tableName: target.tableName,
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
  } else if (String(source || "").includes("/api/cloud-assets/")) {
    const image = await readCloudAssetImage(source);
    if (!image) throw new Error("云端生成图片不存在");
    buffer = image.buffer;
    ext = image.mimeType.includes("jpeg") || image.mimeType.includes("jpg") ? "jpg" : image.mimeType.includes("webp") ? "webp" : "png";
  } else {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`读取图片失败（${res.status}）`);
    buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/png";
    ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  }

  return writeTempBinary(buffer, ext);
}

async function uploadGeneratedImage({ recordId, imageUrl }) {
  if (!recordId || !imageUrl) throw new Error("recordId 和 imageUrl 必填");
  const target = resolveTableTarget();
  const tempFile = await imageSourceToTempFile(imageUrl);
  try {
    const aiImageFieldId = await resolveAiImageFieldId(target.tableId);
    console.log("[feishu-upload] recordId=%s fieldId=%s file=%s", recordId, aiImageFieldId, tempFile.cliPath);
    const result = await runLarkCliJson([
      "base", "+record-upload-attachment",
      "--base-token", BASE_TOKEN,
      "--table-id", target.tableId,
      "--record-id", recordId,
      "--field-id", aiImageFieldId,
      "--file", tempFile.cliPath,
      "--as", LARK_IDENTITY,
      "--jq", ".",
    ]);
    console.log("[feishu-upload] result ok=%s", result?.ok, JSON.stringify(result)?.slice(0, 200));
    if (!result?.ok) throw new Error(result?.error?.message || result?.msg || "附件上传失败");
    return result;
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
