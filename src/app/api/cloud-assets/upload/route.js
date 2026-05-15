import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/server/authUser";
import { copyImageUrlToCloudAsset, uploadCloudAsset } from "@/lib/server/cloudAssetStore";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const user = await getRequestUser(request);
    if (!user?.email) {
      return NextResponse.json({ error: "请先登录 EasyAI" }, { status: 401 });
    }

    const body = await request.json();
    const result = body?.sourceUrl
      ? {
          ok: true,
          url: await copyImageUrlToCloudAsset({
            userEmail: user.email,
            url: body.sourceUrl,
            filename: body?.filename,
            scope: body?.scope || "canvas",
          }),
        }
      : await uploadCloudAsset({
          userEmail: user.email,
          dataUrl: body?.dataUrl,
          filename: body?.filename,
          scope: body?.scope || "canvas",
        });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[CloudAssets] Upload failed:", error);
    return NextResponse.json({ error: error?.message || "上传云端素材失败" }, { status: 500 });
  }
}
