import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/server/authUser";
import { removeUserCloudDeletions } from "@/lib/server/cloudStateStore";

export const runtime = "nodejs";

// 解除删除标记(撤销删除/重新添加曾删除的图):从服务端删除标记里移除指定条目,
// 否则恢复的画布内容会在下一次云同步时被服务端重新过滤掉。
export async function POST(request) {
  try {
    const user = await getRequestUser(request);
    if (!user?.email) {
      return NextResponse.json({ error: "请先登录 EasyAI" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const result = await removeUserCloudDeletions(user.email, body?.records || {});
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[CloudState] Undelete failed:", error);
    return NextResponse.json({ error: "撤销删除标记失败" }, { status: 500 });
  }
}
