import { readdir, readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const WA_LOCKUP_DIR = path.resolve(process.cwd(), "public", "ip-assets", "WA模板库", "logo+OJK合规标识");
const IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function getContentType(filename) {
  return IMAGE_TYPES[path.extname(filename).toLowerCase()] || "";
}

export async function GET() {
  try {
    const entries = await readdir(WA_LOCKUP_DIR, { withFileTypes: true });
    const imageNames = entries
      .filter((entry) => entry.isFile() && getContentType(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));

    if (imageNames.length === 0) {
      return NextResponse.json({ error: "WA lockup asset not found" }, { status: 404 });
    }

    const filename = imageNames[Math.floor(Math.random() * imageNames.length)];
    const image = await readFile(path.resolve(WA_LOCKUP_DIR, filename));

    return new NextResponse(image, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": getContentType(filename),
      },
    });
  } catch {
    return NextResponse.json({ error: "WA lockup asset not found" }, { status: 404 });
  }
}
