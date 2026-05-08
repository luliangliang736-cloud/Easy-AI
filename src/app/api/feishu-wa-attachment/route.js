import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const LARK_CLI = process.env.LARK_CLI_PATH || path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");
const TABLE_ID = process.env.FEISHU_WA_TABLE_ID || "tble6jwNnOTjv75V";

async function writeTempJson(payload) {
  const dir = path.join(process.cwd(), ".easyai-tmp");
  await mkdir(dir, { recursive: true });
  const filename = `easyai-feishu-attachment-${randomUUID()}.json`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, JSON.stringify(payload), "utf8");
  return { filePath, cliPath: `.easyai-tmp/${filename}` };
}

function inferContentType(name = "") {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

async function downloadFeishuAttachment({ fileToken, recordId, fieldId }) {
  const dir = path.join(process.cwd(), ".easyai-tmp");
  await mkdir(dir, { recursive: true });
  const filename = `easyai-feishu-attachment-${randomUUID()}.bin`;
  const outputPath = path.join(dir, filename);
  const outputCliPath = `.easyai-tmp/${filename}`;
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
  });

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
      outputCliPath,
    ], {
      cwd: process.cwd(),
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
      shell: process.platform === "win32",
      windowsHide: true,
    });

    return await readFile(outputPath);
  } catch (error) {
    const downloaded = await readFile(outputPath).catch(() => null);
    if (downloaded?.length) return downloaded;
    const output = Buffer.from(error?.stdout || error?.stderr || "").toString("utf8").trim();
    let parsed = null;
    try {
      parsed = output ? JSON.parse(output) : null;
    } catch {
      parsed = null;
    }
    throw new Error(parsed?.error?.message || parsed?.msg || output || error?.message || "读取飞书图片失败");
  } finally {
    await unlink(paramsFile.filePath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileToken = String(searchParams.get("fileToken") || "").trim();
    const recordId = String(searchParams.get("recordId") || "").trim();
    const fieldId = String(searchParams.get("fieldId") || "").trim();
    const name = String(searchParams.get("name") || "");

    if (!fileToken || !recordId || !fieldId) {
      return NextResponse.json({ error: "缺少飞书附件参数" }, { status: 400 });
    }

    const buffer = await downloadFeishuAttachment({ fileToken, recordId, fieldId });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": inferContentType(name),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "读取飞书图片失败" }, { status: 500 });
  }
}
