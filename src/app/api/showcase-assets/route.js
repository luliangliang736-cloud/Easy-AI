import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SHOWCASE_DIR = path.resolve(process.cwd(), "..", "素材", "无限画布展示");
const IMAGE_TYPES = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function getImageContentType(filename) {
  return IMAGE_TYPES[path.extname(filename).toLowerCase()] || "";
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requestedFile = searchParams.get("file");

  try {
    if (requestedFile) {
      const safeName = path.basename(requestedFile);
      const contentType = getImageContentType(safeName);
      if (!contentType || safeName !== requestedFile) {
        return NextResponse.json({ error: "Invalid showcase image" }, { status: 400 });
      }

      const filePath = path.resolve(SHOWCASE_DIR, safeName);
      const image = await readFile(filePath);
      return new NextResponse(image, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    const entries = await readdir(SHOWCASE_DIR, { withFileTypes: true });
    const imageNames = entries
      .filter((entry) => entry.isFile() && getImageContentType(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
    const images = await Promise.all(imageNames.map(async (name) => {
      const fileStat = await stat(path.resolve(SHOWCASE_DIR, name));
      return {
        name,
        url: `/api/showcase-assets?file=${encodeURIComponent(name)}&v=${Math.round(fileStat.mtimeMs)}`,
      };
    }));

    return NextResponse.json({ images }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ images: [] }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
