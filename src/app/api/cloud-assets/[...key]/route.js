import { NextResponse } from "next/server";
import { isLocalDevAuthBypassEnabled } from "@/lib/authBypass";
import { getRequestUser } from "@/lib/server/authUser";
import { getCloudAssetSignedUrl } from "@/lib/server/cloudAssetStore";

export const runtime = "nodejs";

function getObjectKeyFromRequest(request) {
  const pathname = new URL(request.url).pathname;
  return decodeURIComponent(pathname.replace(/^\/api\/cloud-assets\/?/, ""));
}

export async function GET(request, { params }) {
  try {
    const user = await getRequestUser(request);
    if (!user?.email) {
      return NextResponse.json({ error: "请先登录 EasyAI" }, { status: 401 });
    }

    const keyFromParams = (params?.key || []).map((part) => decodeURIComponent(part)).join("/");
    const key = keyFromParams || getObjectKeyFromRequest(request);
    const expectedUserPrefix = `users/${encodeURIComponent(user.email.toLowerCase())}/`;
    const expectedSystemPrefix = "users/system-generated/";
    if (!key || (!isLocalDevAuthBypassEnabled() && !key.startsWith(expectedUserPrefix) && !key.startsWith(expectedSystemPrefix))) {
      return NextResponse.json({ error: "无权访问该素材" }, { status: 403 });
    }

    const signedUrl = getCloudAssetSignedUrl(key);
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: {
        // 浏览器缓存跳转5分钟：同一图片在5分钟内不再走服务器，直接命中签名URL和图片字节缓存
        // 签名URL有效期3600s，远大于此缓存时间，无过期风险
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[CloudAssets] Read failed:", error);
    return NextResponse.json({ error: "读取云端素材失败" }, { status: 500 });
  }
}
