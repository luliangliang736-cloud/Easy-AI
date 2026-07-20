import { readdir, readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DATA_TABLE_DIR = path.resolve(process.cwd(), "public", "ip-assets", "WA数据图模板库", "黑色数据表");
const IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function getContentType(filename) {
  return IMAGE_TYPES[path.extname(filename).toLowerCase()] || "";
}

// 返回黑色数据表图片（base64），供前端传给后端做叠加
export async function GET() {
  try {
    const entries = await readdir(DATA_TABLE_DIR, { withFileTypes: true });
    const images = entries
      .filter((e) => e.isFile() && getContentType(e.name))
      .map((e) => e.name);

    if (images.length === 0) {
      return NextResponse.json({ error: "黑色数据表图片未找到" }, { status: 404 });
    }

    // 固定使用第一张（只有一张）
    const filename = images[0];
    const buf = await readFile(path.resolve(DATA_TABLE_DIR, filename));
    const contentType = getContentType(filename);
    const base64 = `data:${contentType};base64,${buf.toString("base64")}`;

    return NextResponse.json({ dataTable: base64 }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "加载黑色数据表失败" }, { status: 500 });
  }
}
