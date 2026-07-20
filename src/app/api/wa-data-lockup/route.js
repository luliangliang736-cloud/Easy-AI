import { readdir, readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const WA_DATA_LOCKUP_DIR = path.resolve(process.cwd(), "public", "ip-assets", "WA数据图模板库", "logo+OJK合规标识");
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const variant = String(searchParams.get("variant") || "").toLowerCase();

  try {
    const entries = await readdir(WA_DATA_LOCKUP_DIR, { withFileTypes: true });
    let imageNames = entries
      .filter((entry) => entry.isFile() && getContentType(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));

    if (variant === "black") {
      imageNames = imageNames.filter((name) => name.includes("黑色"));
    } else if (variant === "white") {
      imageNames = imageNames.filter((name) => name.includes("白色"));
    }

    if (imageNames.length === 0) {
      return NextResponse.json({ error: "WA data lockup asset not found" }, { status: 404 });
    }

    const filename = imageNames[Math.floor(Math.random() * imageNames.length)];
    const image = await readFile(path.resolve(WA_DATA_LOCKUP_DIR, filename));

    return new NextResponse(image, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": getContentType(filename),
      },
    });
  } catch {
    return NextResponse.json({ error: "WA data lockup asset not found" }, { status: 404 });
  }
}
