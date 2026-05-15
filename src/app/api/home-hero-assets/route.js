import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const HERO_ASSET_DIR = path.resolve(process.cwd(), "public", "images", "home-hero-carousel");
const HERO_ASSET_LIST_CACHE = "public, max-age=60, stale-while-revalidate=300";
const HERO_MEDIA_CACHE = "public, max-age=31536000, immutable";
const DEFAULT_HERO_ASSET_FILES = ["1.mp4", "2.jpg", "3.mp4", "4.mp4", "5.jpg", "6.mp4", "7.jpg"];
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

function trimSlashes(value = "") {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function getDirectAssetBaseUrl() {
  const configured = String(process.env.HOME_HERO_ASSET_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/g, "");

  const homeAssetBaseUrl = String(process.env.HOME_ASSET_BASE_URL || "").trim();
  if (homeAssetBaseUrl) {
    return `${homeAssetBaseUrl.replace(/\/+$/g, "")}/home-hero-carousel`;
  }

  const bucket = String(process.env.OSS_BUCKET || "").trim();
  const endpoint = String(process.env.OSS_ENDPOINT || "").trim();
  const prefix = trimSlashes(process.env.HOME_HERO_ASSET_PREFIX || "home-hero-carousel");
  if (!bucket || !endpoint || process.env.HOME_HERO_USE_OSS_DIRECT !== "true") return "";
  return `https://${bucket}.${endpoint}${prefix ? `/${prefix}` : ""}`;
}

function getConfiguredAssetNames() {
  const configured = String(process.env.HOME_HERO_ASSET_FILES || "")
    .split(",")
    .map((item) => path.basename(item.trim()))
    .filter((item) => item && getMediaMeta(item));
  return configured.length > 0 ? configured : DEFAULT_HERO_ASSET_FILES;
}

function withVersion(url) {
  const version = String(process.env.HOME_HERO_ASSET_VERSION || "").trim();
  if (!version) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function getDirectAssetUrl(filename = "") {
  const baseUrl = getDirectAssetBaseUrl();
  if (!baseUrl) return "";
  return withVersion(`${baseUrl}/${encodeURIComponent(filename)}`);
}

function buildDirectAssetItems() {
  const baseUrl = getDirectAssetBaseUrl();
  if (!baseUrl) return [];
  return getConfiguredAssetNames().map((name, index) => ({
    type: getMediaMeta(name).type,
    src: getDirectAssetUrl(name),
    label: `EasyAI 创作首页封面 ${index + 1}`,
    name,
  }));
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

      const directUrl = getDirectAssetUrl(safeName);
      if (directUrl) {
        return NextResponse.redirect(directUrl, {
          status: 307,
          headers: {
            "Cache-Control": HERO_ASSET_LIST_CACHE,
          },
        });
      }

      const filePath = path.resolve(HERO_ASSET_DIR, safeName);
      const file = await readFile(filePath);
      const range = request.headers.get("range");
      const headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": HERO_MEDIA_CACHE,
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

    const directItems = buildDirectAssetItems();
    if (directItems.length > 0) {
      return NextResponse.json({ items: directItems }, {
        headers: {
          "Cache-Control": HERO_ASSET_LIST_CACHE,
        },
      });
    }

    const entries = await readdir(HERO_ASSET_DIR, { withFileTypes: true });
    const mediaEntries = entries
      .filter((entry) => entry.isFile() && getMediaMeta(entry.name))
      .map((entry) => ({ name: entry.name, meta: getMediaMeta(entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
    const items = await Promise.all(mediaEntries.map(async ({ name, meta }, index) => {
      const assetStat = await stat(path.resolve(HERO_ASSET_DIR, name));
      const version = `${assetStat.size}-${Math.floor(assetStat.mtimeMs)}`;
      return {
        type: meta.type,
        src: `/api/home-hero-assets?file=${encodeURIComponent(name)}&v=${encodeURIComponent(version)}`,
        label: `EasyAI 创作首页封面 ${index + 1}`,
        name,
      };
    }));

    return NextResponse.json({ items }, {
      headers: {
        "Cache-Control": HERO_ASSET_LIST_CACHE,
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
