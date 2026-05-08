import { NextResponse } from "next/server";
import {
  claimFeishuWaTask,
  createFeishuWaTask,
  updateFeishuWaTask,
} from "@/lib/server/feishuWaTaskQueue";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "claim";
    if (action !== "claim") {
      return NextResponse.json({ error: "不支持的任务操作" }, { status: 400 });
    }
    const task = await claimFeishuWaTask({ clientId: searchParams.get("clientId") || "easyai" });
    return NextResponse.json({ success: true, data: { task } });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "读取飞书 WA 任务失败" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.action === "complete" || body?.action === "fail") {
      const task = await updateFeishuWaTask(body.taskId, {
        status: body.action === "complete" ? "completed" : "failed",
        error: body.error || "",
      });
      return NextResponse.json({ success: true, data: { task } });
    }

    const task = await createFeishuWaTask({
      prompt: body?.prompt || body?.text || "",
      chatId: body?.chatId || "",
      messageId: body?.messageId || "",
    });
    return NextResponse.json({ success: true, data: { task } });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "创建飞书 WA 任务失败" }, { status: 500 });
  }
}
