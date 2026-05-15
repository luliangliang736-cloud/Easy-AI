import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/server/authUser";
import { readUserCloudState, upsertUserCloudState } from "@/lib/server/cloudStateStore";

export const runtime = "nodejs";

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
    const result = await upsertUserCloudState(user.email, body?.items);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[CloudState] Save failed:", error);
    return NextResponse.json({ error: "保存云端记录失败" }, { status: 500 });
  }
}
