import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/server/authUser";
import { getCloudAssetStream } from "@/lib/server/cloudAssetStore";

export const runtime = "nodejs";

function nodeStreamToWeb(stream) {
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (error) => controller.error(error));
    },
    cancel() {
      stream.destroy();
    },
  });
}

function inferContentType(key = "") {
  const lower = String(key).toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

export async function GET(request, { params }) {
  try {
    const user = await getRequestUser(request);
    if (!user?.email) {
      return NextResponse.json({ error: "请先登录 EasyAI" }, { status: 401 });
    }

    const key = (params?.key || []).map((part) => decodeURIComponent(part)).join("/");
    const expectedPrefix = `users/${encodeURIComponent(user.email.toLowerCase())}/`;
    if (!key || !key.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "无权访问该素材" }, { status: 403 });
    }

    const result = await getCloudAssetStream(key);
    const contentType = result?.res?.headers?.["content-type"] || inferContentType(key);
    return new Response(nodeStreamToWeb(result.stream), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[CloudAssets] Read failed:", error);
    return NextResponse.json({ error: "读取云端素材失败" }, { status: 500 });
  }
}
