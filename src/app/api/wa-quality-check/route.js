import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const OPENAI_API_BASE_RAW = (
  process.env.WA_QUALITY_API_BASE
  || process.env.OPENAI_API_BASE
  || "https://api.openai.com/v1"
).replace(/\/$/, "");
const OPENAI_API_BASE = /\/v\d+$/i.test(OPENAI_API_BASE_RAW) ? OPENAI_API_BASE_RAW : `${OPENAI_API_BASE_RAW}/v1`;
const OPENAI_API_KEY = process.env.WA_QUALITY_API_KEY || process.env.OPENAI_API_KEY || "";
const OPENAI_API_VERSION = process.env.WA_QUALITY_API_VERSION || process.env.OPENAI_API_VERSION || "";
const OPENAI_API_KEY_HEADER = (
  process.env.WA_QUALITY_API_KEY_HEADER
  || process.env.OPENAI_API_KEY_HEADER
  || "authorization"
).trim().toLowerCase();
const OPENAI_API_STYLE = (
  process.env.WA_QUALITY_API_STYLE
  || process.env.OPENAI_API_STYLE
  || "auto"
).trim().toLowerCase();
const WA_QUALITY_MODEL = process.env.WA_QUALITY_MODEL || process.env.FLOATING_ASSISTANT_MODEL || process.env.OBJECT_PLAN_MODEL || "gpt-4.1-mini";
const WA_QUALITY_TIMEOUT_MS = Number(process.env.WA_QUALITY_TIMEOUT_MS || 60 * 1000);
const CHAT_COMPLETIONS_URL = `${OPENAI_API_BASE}/chat/completions`;

function withApiVersion(url) {
  if (!OPENAI_API_VERSION) return url;
  const nextUrl = new URL(url);
  if (!nextUrl.searchParams.has("api-version")) {
    nextUrl.searchParams.set("api-version", OPENAI_API_VERSION);
  }
  return nextUrl.toString();
}

function buildAzureDeploymentUrl(model) {
  return `${OPENAI_API_BASE_RAW}/openai/deployments/${encodeURIComponent(model)}/chat/completions`;
}

function buildAuthHeaders(apiKey) {
  if (!apiKey) return {};
  if (OPENAI_API_KEY_HEADER === "api-key" || OPENAI_API_KEY_HEADER === "x-api-key") {
    return { [OPENAI_API_KEY_HEADER]: apiKey };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

async function parseJsonSafely(response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw || "WA quality check returned non-JSON response");
  }
}

async function imageUrlToDataUrl(imageUrl, origin) {
  const rawUrl = String(imageUrl || "").trim();
  if (!rawUrl) throw new Error("缺少待质检图片");
  if (rawUrl.startsWith("data:image/")) return rawUrl;

  const absoluteUrl = rawUrl.startsWith("/")
    ? new URL(rawUrl, origin).toString()
    : rawUrl;
  const res = await fetch(absoluteUrl);
  if (!res.ok) throw new Error(`质检图片读取失败（${res.status}）`);
  const contentType = res.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function extractAssistantText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === "text" || part?.type === "output_text" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function normalizeQualityResult(value = {}) {
  const score = Math.max(0, Math.min(100, Number(value.score || 0)));
  const issues = Array.isArray(value.issues) ? value.issues.slice(0, 6).map((issue) => ({
    type: String(issue?.type || "general"),
    severity: ["low", "medium", "high"].includes(issue?.severity) ? issue.severity : "low",
    message: String(issue?.message || "").trim(),
  })).filter((issue) => issue.message) : [];
  return {
    score,
    passed: Boolean(value.passed) && score >= 80,
    issues,
    suggestedFix: String(value.suggestedFix || "").trim(),
  };
}

export async function POST(request) {
  try {
    if (!OPENAI_API_KEY) {
      throw new Error("未配置 OPENAI_API_KEY，暂时无法启用 WA 质检。");
    }

    const body = await request.json();
    const imageDataUrl = await imageUrlToDataUrl(body?.imageUrl, request.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WA_QUALITY_TIMEOUT_MS);

    try {
      const url = OPENAI_API_STYLE === "azure"
        ? buildAzureDeploymentUrl(WA_QUALITY_MODEL)
        : CHAT_COMPLETIONS_URL;
      const res = await fetch(withApiVersion(url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(OPENAI_API_KEY),
        },
        signal: controller.signal,
        body: JSON.stringify({
          ...(OPENAI_API_STYLE === "azure" ? {} : { model: WA_QUALITY_MODEL }),
          messages: [
            {
              role: "system",
              content: "你是 WA 金融营销海报质检员。只返回 JSON，不要输出额外文字。",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [
                    "请检查这张 WA 金融营销海报是否符合规范。",
                    "硬性规范：画面接近 2:1；左侧文案右侧人物/IP；主标题清晰且最大；副标题明显小于主标题；Logo+OJK 清晰可读；人物不遮挡文案；右侧元素不过多；背景不杂乱；不能出现医疗/红十字/心电图等行业差异大的符号；单独 smile logo 只能用白/黑/#3FCA58，logo 底色只能是纯白或 #3FCA58；EASYCASH 字样必须清晰。",
                    "请返回 JSON：{ score: 0-100, passed: boolean, issues: [{ type, severity, message }], suggestedFix: string }。",
                  ].join("\n"),
                },
                {
                  type: "image_url",
                  image_url: { url: imageDataUrl },
                },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "wa_quality_check",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  score: { type: "number" },
                  passed: { type: "boolean" },
                  issues: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        type: { type: "string" },
                        severity: { type: "string", enum: ["low", "medium", "high"] },
                        message: { type: "string" },
                      },
                      required: ["type", "severity", "message"],
                    },
                  },
                  suggestedFix: { type: "string" },
                },
                required: ["score", "passed", "issues", "suggestedFix"],
              },
            },
          },
        }),
      });
      const data = await parseJsonSafely(res);
      if (!res.ok) {
        throw new Error(data?.error?.message || data?.error || `WA 质检失败（${res.status}）`);
      }
      const rawText = extractAssistantText(data);
      const parsed = rawText ? JSON.parse(rawText) : {};
      return NextResponse.json({ success: true, data: normalizeQualityResult(parsed) });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "WA quality check failed" },
      { status: 500 }
    );
  }
}
