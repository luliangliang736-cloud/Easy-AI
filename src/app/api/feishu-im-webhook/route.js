import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { POST as runWaCommandRoute } from "../feishu-wa-command/route";
import { createFeishuWaTask } from "@/lib/server/feishuWaTaskQueue";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const LARK_CLI = process.env.LARK_CLI_PATH || path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");
const TABLE_ID = process.env.FEISHU_WA_TABLE_ID || "tble6jwNnOTjv75V";
const EVENT_VERIFY_TOKEN = process.env.FEISHU_EVENT_VERIFY_TOKEN || "";
const MAX_REPLY_IMAGES = 6;

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

async function writeTempJson(payload, prefix = "easyai-feishu-im") {
  const dir = path.join(process.cwd(), ".easyai-tmp");
  await mkdir(dir, { recursive: true });
  const filename = `${prefix}-${randomUUID()}.json`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, JSON.stringify(payload), "utf8");
  return { filePath, cliPath: `.easyai-tmp/${filename}` };
}

async function runLarkApi(method, apiPath, { params = null, data = null, files = [] } = {}, identity = "bot") {
  const tempFiles = [];
  try {
    const args = ["api", method, apiPath, "--as", identity, "--format", "json"];
    if (params) {
      const paramsFile = await writeTempJson(params, "easyai-feishu-im-params");
      tempFiles.push(paramsFile.filePath);
      args.push("--params", `@${paramsFile.cliPath}`);
    }
    if (data) {
      const dataFile = await writeTempJson(data, "easyai-feishu-im-data");
      tempFiles.push(dataFile.filePath);
      args.push("--data", `@${dataFile.cliPath}`);
    }
    for (const file of files) {
      args.push("--file", file);
    }
    return await runLarkCli(args);
  } finally {
    await Promise.all(tempFiles.map((file) => unlink(file).catch(() => {})));
  }
}

function extractTextMessage(body) {
  const message = body?.event?.message || body?.event?.message_event?.message;
  if (!message || message.message_type !== "text") return { text: "", chatId: "", messageId: "" };
  let content = {};
  try {
    content = JSON.parse(message.content || "{}");
  } catch {
    content = {};
  }
  return {
    text: String(content.text || "").trim(),
    chatId: String(message.chat_id || ""),
    messageId: String(message.message_id || ""),
  };
}

function isWaTableCommand(text = "") {
  const source = String(text || "").replace(/\s+/g, "");
  if (!source) return false;
  if (/生成前[0-9一二两三四五六七八九十]+张.*?(WA|wa|海报)/i.test(source)) return true;
  const hasTarget = /(WA|wa|海报|飞书|表格|文档|AI设计图|ai设计图|Robot|robot|机器人|Boy|Girl|第[0-9一二两三四五六七八九十]+张)/i.test(source);
  const hasAction = /(查看|显示|读取|列出|筛选|统计|检查|修改|改成|改为|设为|设置为|新增|添加|创建|复制|删除|移除|清空|减少|少一些|少一点|不要太多|多少)/.test(source);
  return hasTarget && hasAction;
}

function isBatchWaGenerationCommand(text = "") {
  const source = String(text || "").replace(/\s+/g, "");
  if (!/(飞书|表格|多维表|base|文档)/i.test(source) || !/(WA|wa|海报)/i.test(source)) return false;
  if (!/(生成|制作|生图|批量生成|批量制作)/.test(source)) return false;
  return /(?:前|后|最后)[0-9一二两三四五六七八九十]+(?:张|条|个)/.test(source)
    || /第[0-9一二两三四五六七八九十]+(?:张|条|个)?(?:到|至|-|—)(?:第)?[0-9一二两三四五六七八九十]+(?:张|条|个)?/.test(source)
    || /第[0-9一二两三四五六七八九十]+(?:张|条|个)/.test(source);
}

async function runWaTableCommand(text) {
  const response = await runWaCommandRoute(new Request("http://easyai.local/api/feishu-wa-command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "飞书表格指令处理失败");
  return {
    reply: payload?.data?.reply || "飞书表格指令已处理。",
    images: Array.isArray(payload?.data?.images) ? payload.data.images : [],
  };
}

async function sendTextMessage(chatId, text) {
  if (!chatId || !text) return null;
  const payload = {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  };
  return runLarkApi("POST", "/open-apis/im/v1/messages", payload, "bot")
    .catch(() => runLarkApi("POST", "/open-apis/im/v1/messages", payload, "user"));
}

function parseAttachmentProxyUrl(imageUrl = "") {
  const url = new URL(imageUrl, "http://easyai.local");
  if (url.pathname !== "/api/feishu-wa-attachment") return null;
  return {
    fileToken: url.searchParams.get("fileToken") || "",
    recordId: url.searchParams.get("recordId") || "",
    fieldId: url.searchParams.get("fieldId") || "",
    name: url.searchParams.get("name") || "feishu-wa-image.png",
  };
}

async function downloadFeishuAttachment({ fileToken, recordId, fieldId, name }) {
  const dir = path.join(process.cwd(), ".easyai-tmp");
  await mkdir(dir, { recursive: true });
  const safeExt = String(name || "").match(/\.([a-z0-9]+)$/i)?.[1] || "png";
  const filename = `easyai-feishu-im-image-${randomUUID()}.${safeExt}`;
  const filePath = path.join(dir, filename);
  const cliPath = `.easyai-tmp/${filename}`;
  const paramsFile = await writeTempJson({
    extra: JSON.stringify({
      bitablePerm: {
        tableId: TABLE_ID,
        attachments: {
          [fieldId]: {
            [recordId]: [fileToken],
          },
        },
      },
    }),
  }, "easyai-feishu-im-download");

  try {
    await execFileAsync(LARK_CLI, [
      "api",
      "GET",
      `/open-apis/drive/v1/medias/${fileToken}/download`,
      "--as",
      "user",
      "--params",
      `@${paramsFile.cliPath}`,
      "--output",
      cliPath,
    ], {
      cwd: process.cwd(),
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
      shell: process.platform === "win32",
      windowsHide: true,
    }).catch(async (error) => {
      const downloaded = await readFile(filePath).catch(() => null);
      if (downloaded?.length) return null;
      throw error;
    });
    return { filePath, cliPath };
  } finally {
    await unlink(paramsFile.filePath).catch(() => {});
  }
}

async function uploadImImage(cliPath) {
  const payload = {
    data: { image_type: "message" },
    files: [`image=${cliPath}`],
  };
  const data = await runLarkApi("POST", "/open-apis/im/v1/images", payload, "bot")
    .catch(() => runLarkApi("POST", "/open-apis/im/v1/images", payload, "user"));
  const imageKey = data?.data?.image_key || data?.image_key;
  if (!imageKey) throw new Error("飞书图片上传失败：未返回 image_key");
  return imageKey;
}

async function sendImageMessage(chatId, imageKey) {
  if (!chatId || !imageKey) return null;
  const payload = {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "image",
      content: JSON.stringify({ image_key: imageKey }),
    },
  };
  return runLarkApi("POST", "/open-apis/im/v1/messages", payload, "bot")
    .catch(() => runLarkApi("POST", "/open-apis/im/v1/messages", payload, "user"));
}

async function sendReplyImages(chatId, imageUrls = []) {
  for (const imageUrl of imageUrls.slice(0, MAX_REPLY_IMAGES)) {
    const attachment = parseAttachmentProxyUrl(imageUrl);
    if (!attachment?.fileToken || !attachment?.recordId || !attachment?.fieldId) continue;
    const downloaded = await downloadFeishuAttachment(attachment);
    try {
      const imageKey = await uploadImImage(downloaded.cliPath);
      await sendImageMessage(chatId, imageKey);
    } finally {
      await unlink(downloaded.filePath).catch(() => {});
    }
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body?.type === "url_verification" && body?.challenge) {
      if (EVENT_VERIFY_TOKEN && body?.token && body.token !== EVENT_VERIFY_TOKEN) {
        return NextResponse.json({ error: "invalid token" }, { status: 403 });
      }
      return NextResponse.json({ challenge: body.challenge });
    }

    const eventToken = body?.header?.token || body?.token || "";
    if (EVENT_VERIFY_TOKEN && eventToken && eventToken !== EVENT_VERIFY_TOKEN) {
      return NextResponse.json({ error: "invalid token" }, { status: 403 });
    }

    const { text, chatId, messageId } = extractTextMessage(body);
    if (!text || !chatId || (!isWaTableCommand(text) && !isBatchWaGenerationCommand(text))) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (isBatchWaGenerationCommand(text)) {
      const task = await createFeishuWaTask({ prompt: text, chatId, messageId });
      await sendTextMessage(chatId, `已同步到 EasyAI 一键创作任务队列：${text}\n任务 ID：${task.id}\n请打开一键创作页面，任务会自动进入现有批量 WA 生成流程。`);
      return NextResponse.json({ ok: true, taskId: task.id });
    }

    const result = await runWaTableCommand(text);
    await sendTextMessage(chatId, result.reply);
    await sendReplyImages(chatId, result.images);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || "飞书消息处理失败" }, { status: 200 });
  }
}
