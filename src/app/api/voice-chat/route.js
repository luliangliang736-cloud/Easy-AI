import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const API_BASE_RAW = (
  process.env.FLOATING_ASSISTANT_API_BASE
  || process.env.OPENAI_API_BASE
  || "https://api.openai.com/v1"
).replace(/\/$/, "");
const API_BASE = /\/v\d+$/i.test(API_BASE_RAW) ? API_BASE_RAW : `${API_BASE_RAW}/v1`;
const API_KEY = process.env.FLOATING_ASSISTANT_API_KEY || process.env.OPENAI_API_KEY || "";
const API_VERSION = process.env.FLOATING_ASSISTANT_API_VERSION || process.env.OPENAI_API_VERSION || "";
const API_KEY_HEADER = (
  process.env.FLOATING_ASSISTANT_API_KEY_HEADER
  || process.env.OPENAI_API_KEY_HEADER
  || "authorization"
).trim().toLowerCase();
const VOICE_MODEL = process.env.FLOATING_ASSISTANT_MODEL || process.env.OBJECT_PLAN_MODEL || "gpt-4.1-mini";
const TIMEOUT_MS = 20000;

function withApiVersion(url) {
  if (!API_VERSION) return url;
  const nextUrl = new URL(url);
  if (!nextUrl.searchParams.has("api-version")) {
    nextUrl.searchParams.set("api-version", API_VERSION);
  }
  return nextUrl.toString();
}

function buildAuthHeaders() {
  if (!API_KEY) return {};
  if (API_KEY_HEADER === "api-key" || API_KEY_HEADER === "x-api-key") {
    return { [API_KEY_HEADER]: API_KEY };
  }
  return { authorization: `Bearer ${API_KEY}` };
}

const SYSTEM_PROMPT = `你是"小亿"，一个可爱的 AI 图像创作助手，形象是一只绿色小机器人，性格活泼、暖心、有点小俏皮。

对话规则（严格遵守）：
- 回复必须简短，像正常说话一样，不超过 40 个字
- 绝对不使用 Markdown 格式（不用 #、**、- 等符号）
- 语气自然温暖，适当用"呀、哦、嗯、好嘞、没问题呀"
- 当用户叫你"小亿"时，用自然的方式回应，比如"诶！我在！"或"嗯嗯？有什么我能帮你的？"
- 如果用户问图片生成相关的问题，简单引导他们点击打开对话框
- 每次回复都要让人感到轻松愉快`;

export async function POST(request) {
  try {
    const body = await request.json();
    const userText = String(body?.text || "").trim();

    if (!userText) {
      return NextResponse.json({ success: false, error: "text is required" }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const chatUrl = `${API_BASE}/chat/completions`;

    let res;
    try {
      res = await fetch(withApiVersion(chatUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: VOICE_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userText },
          ],
          max_tokens: 120,
          temperature: 0.8,
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error?.message || `API error ${res.status}`);
    }

    const reply = data?.choices?.[0]?.message?.content || "嗯，我在想呢～";

    return NextResponse.json({ success: true, reply: reply.trim() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err?.message || "语音服务暂时不可用" },
      { status: 500 }
    );
  }
}
