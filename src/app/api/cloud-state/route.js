import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/server/authUser";
import { readUserCloudState, upsertUserCloudState } from "@/lib/server/cloudStateStore";
import { scheduleCloudStateSnapshots } from "@/lib/server/cloudStateSnapshots";

export const runtime = "nodejs";

// 云同步是常驻流量，借这个路由的加载启动每日快照调度
scheduleCloudStateSnapshots();

export async function GET(request) {
  try {
    const user = await getRequestUser(request);
    if (!user?.email) {
      return NextResponse.json({ error: "请先登录 EasyAI" }, { status: 401 });
    }

    const result = await readUserCloudState(user.email);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[CloudState] Read failed:", error);
    return NextResponse.json({ error: "读取云端记录失败" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const user = await getRequestUser(request);
    if (!user?.email) {
      return NextResponse.json({ error: "请先登录 EasyAI" }, { status: 401 });
    }

    const body = await request.json();
    // 客户端会带上本地数据归属的账号邮箱。若与当前登录账号不一致，
    // 说明浏览器里是上一个账号的残留数据（如另一标签页刚切换了账号），
    // 拒绝写入，防止旧账号数据被同步进新账号的云端存档。
    const claimedOwner = String(body?.owner || "").trim().toLowerCase();
    if (claimedOwner && claimedOwner !== String(user.email || "").toLowerCase()) {
      return NextResponse.json({ error: "本地数据归属与登录账号不一致，已拒绝同步" }, { status: 409 });
    }
    const result = await upsertUserCloudState(user.email, body?.items);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[CloudState] Save failed:", error);
    return NextResponse.json({ error: "保存云端记录失败" }, { status: 500 });
  }
}
