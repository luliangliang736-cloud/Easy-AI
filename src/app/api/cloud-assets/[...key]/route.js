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

    // ⚠️ Next 已对路径段做过一次百分号解码，这里绝不能再 decodeURIComponent：
    // 资产 key 内含编码邮箱（users/foo%40gmail.com/...），双重解码会把 %40 变成 @，
    // 导致与 expectedUserPrefix（encodeURIComponent 形式）不匹配，所有图片 403。
    const resolvedParams = await params;
    const keyFromParams = (resolvedParams?.key || []).join("/");
    const key = keyFromParams || getObjectKeyFromRequest(request);
    const expectedUserPrefix = `users/${encodeURIComponent(user.email.toLowerCase())}/`;
    const expectedSystemPrefix = "users/system-generated/";
    if (!key || (!isLocalDevAuthBypassEnabled() && !key.startsWith(expectedUserPrefix) && !key.startsWith(expectedSystemPrefix))) {
      return NextResponse.json({ error: "无权访问该素材" }, { status: 403 });
    }

    // ============================================================
    // ⚠️  302 缓存保护区 — 请勿随意修改或删除 Cache-Control ⚠️
    //
    // 【问题背景】
    // 每次请求此路由都会生成一个包含新时间戳的签名 URL，然后 302 跳转。
    // 若不设置 Cache-Control，浏览器不缓存 302，导致：
    //   1. 每次显示/粘贴同一张图片都要打服务器 → 生成新签名 → 重新从 OSS 拉取字节
    //   2. 画布图片粘贴速度慢（每次粘贴 = 完整网络链路）
    //
    // 【当前策略】
    //   Cache-Control: private, max-age=300（5 分钟浏览器本地缓存）
    //   → 5分钟内同一 /api/cloud-assets/xxx 请求直接命中缓存的签名URL和图片字节
    //   → 画布图片粘贴、再次显示近乎瞬间，无网络请求
    //
    // 【安全性】
    //   - private：仅浏览器本地缓存，CDN/代理不会缓存（用户数据不外泄）
    //   - max-age=300：远小于签名URL有效期（OSS_SIGNED_URL_EXPIRES_SECONDS=3600）
    //     不存在缓存到过期签名URL的风险
    //
    // 【禁止事项】
    //   ✗ 不要删除 Cache-Control 头（会导致每次图片加载都走完整链路，变慢）
    //   ✗ 不要把 private 改成 public（会被 CDN/代理缓存，可能导致用户数据互串）
    //   ✗ 不要把 max-age 设置超过 OSS_SIGNED_URL_EXPIRES_SECONDS（会缓存过期签名）
    // ============================================================
    const signedUrl = getCloudAssetSignedUrl(key);

    // raw=1：服务端拉取 OSS 字节后同源返回（绕过 302→OSS 的 CORS 限制），
    // 供前端"复制到系统剪贴板"读取 blob 使用。默认路径仍为 302，不影响图片显示。
    if (new URL(request.url).searchParams.get("raw") === "1") {
      const ossRes = await fetch(signedUrl);
      if (!ossRes.ok) {
        return NextResponse.json({ error: "读取素材失败" }, { status: 502 });
      }
      return new NextResponse(ossRes.body, {
        headers: {
          "Content-Type": ossRes.headers.get("content-type") || "application/octet-stream",
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[CloudAssets] Read failed:", error);
    return NextResponse.json({ error: "读取云端素材失败" }, { status: 500 });
  }
}
