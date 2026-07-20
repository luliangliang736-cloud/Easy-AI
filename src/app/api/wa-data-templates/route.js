import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 完整模板图（含黑色数据表）直接放在模板库根目录
const WA_DATA_TEMPLATE_DIR = path.resolve(process.cwd(), "public", "ip-assets", "WA数据图模板库");
const IMAGE_TYPES = {
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function getContentType(filename) {
  return IMAGE_TYPES[path.extname(filename).toLowerCase()] || "";
}

async function listTemplateNames() {
  const entries = await readdir(WA_DATA_TEMPLATE_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && getContentType(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
}

async function sendTemplateImage(filename) {
  const contentType = getContentType(filename);
  if (!contentType) {
    return NextResponse.json({ error: "Invalid WA data template image" }, { status: 400 });
  }
  const image = await readFile(path.resolve(WA_DATA_TEMPLATE_DIR, filename));
  return new NextResponse(image, {
    headers: { "Cache-Control": "no-store", "Content-Type": contentType },
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requestedFile = searchParams.get("file");
  const random = searchParams.get("random");

  try {
    if (requestedFile) {
      const safeName = path.basename(requestedFile);
      if (safeName !== requestedFile) {
        return NextResponse.json({ error: "Invalid WA data template image" }, { status: 400 });
      }
      return await sendTemplateImage(safeName);
    }

    const imageNames = await listTemplateNames();
    if (random) {
      if (imageNames.length === 0) {
        return NextResponse.json({ error: "WA data template image not found" }, { status: 404 });
      }
      return await sendTemplateImage(imageNames[Math.floor(Math.random() * imageNames.length)]);
    }

    const templates = await Promise.all(imageNames.map(async (name) => {
      const fileStat = await stat(path.resolve(WA_DATA_TEMPLATE_DIR, name));
      return {
        name,
        url: `/api/wa-data-templates?file=${encodeURIComponent(name)}&v=${Math.round(fileStat.mtimeMs)}`,
      };
    }));

    return NextResponse.json({ templates }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ templates: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
