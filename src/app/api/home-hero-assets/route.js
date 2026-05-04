import { readdir, readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const HERO_ASSET_DIR = path.resolve(process.cwd(), "public", "images", "home-hero-carousel");
const MEDIA_TYPES = {
  ".gif": { contentType: "image/gif", type: "image" },
  ".jpg": { contentType: "image/jpeg", type: "image" },
  ".jpeg": { contentType: "image/jpeg", type: "image" },
  ".mp4": { contentType: "video/mp4", type: "video" },
  ".png": { contentType: "image/png", type: "image" },
  ".webp": { contentType: "image/webp", type: "image" },
};

function getMediaMeta(filename) {
  return MEDIA_TYPES[path.extname(filename).toLowerCase()] || null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requestedFile = searchParams.get("file");

  try {
    if (requestedFile) {
      const safeName = path.basename(requestedFile);
      const meta = getMediaMeta(safeName);
      if (!meta || safeName !== requestedFile) {
        return NextResponse.json({ error: "Invalid hero asset" }, { status: 400 });
      }

      const filePath = path.resolve(HERO_ASSET_DIR, safeName);
      const file = await readFile(filePath);
      const range = request.headers.get("range");
      const headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Type": meta.contentType,
      };

      if (range) {
        const [, startText, endText] = range.match(/bytes=(\d*)-(\d*)/) || [];
        const start = startText ? Number(startText) : 0;
        const end = endText ? Number(endText) : file.length - 1;
        const safeEnd = Math.min(end, file.length - 1);

        if (Number.isNaN(start) || Number.isNaN(safeEnd) || start > safeEnd) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              ...headers,
              "Content-Range": `bytes */${file.length}`,
            },
          });
        }

        const chunk = file.subarray(start, safeEnd + 1);
        return new NextResponse(chunk, {
          status: 206,
          headers: {
            ...headers,
            "Content-Length": String(chunk.length),
            "Content-Range": `bytes ${start}-${safeEnd}/${file.length}`,
          },
        });
      }

      return new NextResponse(file, {
        headers: {
          ...headers,
          "Content-Length": String(file.length),
        },
      });
    }

    const entries = await readdir(HERO_ASSET_DIR, { withFileTypes: true });
    const items = entries
      .filter((entry) => entry.isFile() && getMediaMeta(entry.name))
      .map((entry) => ({ name: entry.name, meta: getMediaMeta(entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }))
      .map(({ name, meta }, index) => ({
        type: meta.type,
        src: `/api/home-hero-assets?file=${encodeURIComponent(name)}`,
        label: `EasyAI 创作首页封面 ${index + 1}`,
        name,
      }));

    return NextResponse.json({ items }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ items: [] }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
