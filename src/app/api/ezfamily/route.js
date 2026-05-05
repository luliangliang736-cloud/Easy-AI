import { readdir, readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const EZFAMILY_ASSET_DIR = path.resolve(process.cwd(), "public", "ip-assets", "EZfamily");
const ROLE_DIRS = {
  boy: "Boy",
  "boy真人版": "Boy真人版",
  girl: "Girl",
  robot: "Robot",
};
const IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const PREFERRED_ROLE_IMAGES = {
  "boy真人版": "正视图",
};

function getContentType(filename) {
  return IMAGE_TYPES[path.extname(filename).toLowerCase()] || null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const role = String(searchParams.get("role") || "").toLowerCase();
  const requestedFile = searchParams.get("file");
  const shouldListAll = searchParams.get("all") === "1";
  const roleDir = ROLE_DIRS[role];

  if (!roleDir) {
    return NextResponse.json({ error: "Invalid EZfamily role" }, { status: 400 });
  }

  try {
    const assetDir = path.resolve(EZFAMILY_ASSET_DIR, roleDir);
    const entries = await readdir(assetDir, { withFileTypes: true });
    const images = entries
      .filter((entry) => entry.isFile() && getContentType(entry.name))
      .map((entry) => entry.name);

    if (images.length === 0) {
      return NextResponse.json({ error: "EZfamily asset not found" }, { status: 404 });
    }

    if (shouldListAll) {
      return NextResponse.json({
        items: images.map((filename) => ({
          name: filename,
          src: `/api/ezfamily?role=${encodeURIComponent(role)}&file=${encodeURIComponent(filename)}`,
        })),
      }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (requestedFile) {
      const safeName = path.basename(requestedFile);
      if (safeName !== requestedFile || !images.includes(safeName)) {
        return NextResponse.json({ error: "Invalid EZfamily asset" }, { status: 400 });
      }
      const image = await readFile(path.resolve(assetDir, safeName));
      return new NextResponse(image, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": getContentType(safeName),
        },
      });
    }

    const preferredKeyword = PREFERRED_ROLE_IMAGES[role];
    const candidateImages = preferredKeyword
      ? images.filter((name) => name.includes(preferredKeyword))
      : images;
    const pickPool = candidateImages.length > 0 ? candidateImages : images;
    const filename = pickPool[Math.floor(Math.random() * pickPool.length)];
    const image = await readFile(path.resolve(assetDir, filename));

    return new NextResponse(image, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": getContentType(filename),
      },
    });
  } catch {
    return NextResponse.json({ error: "EZfamily asset not found" }, { status: 404 });
  }
}
