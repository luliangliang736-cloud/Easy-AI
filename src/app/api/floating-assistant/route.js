import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const OPENAI_API_BASE_RAW = (
  process.env.FLOATING_ASSISTANT_API_BASE
  || process.env.OPENAI_API_BASE
  || "https://api.openai.com/v1"
).replace(/\/$/, "");
const OPENAI_API_BASE = /\/v\d+$/i.test(OPENAI_API_BASE_RAW) ? OPENAI_API_BASE_RAW : `${OPENAI_API_BASE_RAW}/v1`;
const OPENAI_API_KEY = process.env.FLOATING_ASSISTANT_API_KEY || process.env.OPENAI_API_KEY || "";
const OPENAI_API_VERSION = process.env.FLOATING_ASSISTANT_API_VERSION || process.env.OPENAI_API_VERSION || "";
const OPENAI_API_KEY_HEADER = (
  process.env.FLOATING_ASSISTANT_API_KEY_HEADER
  || process.env.OPENAI_API_KEY_HEADER
  || "authorization"
).trim().toLowerCase();
const OPENAI_API_STYLE = (
  process.env.FLOATING_ASSISTANT_API_STYLE
  || process.env.OPENAI_API_STYLE
  || "auto"
).trim().toLowerCase();
const FLOATING_ASSISTANT_MODEL = process.env.FLOATING_ASSISTANT_MODEL || process.env.OBJECT_PLAN_MODEL || "gpt-4.1-mini";
const FLOATING_ASSISTANT_TIMEOUT_MS = Number(process.env.FLOATING_ASSISTANT_TIMEOUT_MS || 60 * 1000);
const RESPONSES_URL = process.env.FLOATING_ASSISTANT_API_URL || `${OPENAI_API_BASE}/responses`;
const CHAT_COMPLETIONS_URL = `${OPENAI_API_BASE}/chat/completions`;

function withApiVersion(url) {
  if (!OPENAI_API_VERSION) {
    return url;
  }
  const nextUrl = new URL(url);
  if (!nextUrl.searchParams.has("api-version")) {
    nextUrl.searchParams.set("api-version", OPENAI_API_VERSION);
  }
  return nextUrl.toString();
}

function buildAzureDeploymentUrl(model, pathSuffix) {
  return `${OPENAI_API_BASE_RAW}/openai/deployments/${encodeURIComponent(model)}${pathSuffix}`;
}

function buildAuthHeaders(apiKey) {
  if (!apiKey) {
    return {};
  }
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
    throw new Error(raw || "Floating assistant API returned non-JSON response");
  }
}

function getApiErrorMessage(data, status) {
  return (
    data?.error?.message
    || data?.message
    || data?.error
    || `Request failed (${status})`
  );
}

async function postJsonWithTimeout(url, payload, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(withApiVersion(url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(OPENAI_API_KEY),
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafely(res);
    if (!res.ok) {
      throw new Error(`${getApiErrorMessage(data, res.status)} [status:${res.status}]`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const output = Array.isArray(data?.output) ? data.output : [];
  const chunks = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("").trim();
}

function extractChatCompletionsText(data) {
  const message = data?.choices?.[0]?.message;
  if (typeof message?.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => (part?.type === "text" || part?.type === "output_text" ? part?.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-8)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      text: String(message?.text || "").trim(),
      images: Array.isArray(message?.images) ? message.images.filter(Boolean).slice(0, 3) : [],
      refImages: Array.isArray(message?.refImages) ? message.refImages.filter(Boolean).slice(0, 3) : [],
      attachments: Array.isArray(message?.attachments) ? message.attachments.slice(0, 4) : [],
    }))
    .filter((message) => (
      message.text
      || message.images.length > 0
      || message.refImages.length > 0
      || message.attachments.length > 0
    ));
}

function buildUserText({ messages, currentInput, refImages, attachments }) {
  const normalizedMessages = normalizeMessages(messages);
  const historyText = normalizedMessages.length > 0
    ? normalizedMessages
        .map((message, index) => {
          const imageInfo = message.images.length > 0 ? `生成图: ${message.images.join(" | ")}` : "";
          const refImageInfo = message.refImages.length > 0 ? `参考图: ${message.refImages.join(" | ")}` : "";
          const attachmentInfo = message.attachments.length > 0
            ? `附件: ${message.attachments.map((item) => {
                const excerpt = String(item?.excerpt || "").trim();
                return excerpt
                  ? `${item.name}（摘要: ${excerpt.slice(0, 240)}）`
                  : `${item.name}`;
              }).join(" | ")}`
            : "";
          const suffix = [refImageInfo, imageInfo, attachmentInfo].filter(Boolean).join("；");
          return `${index + 1}. ${message.role === "assistant" ? "AI" : "用户"}：${message.text || "(无文本)"}${suffix ? ` [${suffix}]` : ""}`;
        })
        .join("\n")
    : "无历史消息";

  const currentAttachmentText = (Array.isArray(attachments) ? attachments : []).length > 0
    ? (attachments || [])
        .map((item) => {
          const excerpt = String(item?.excerpt || "").trim();
          return excerpt
            ? `${item.name}（摘要: ${excerpt.slice(0, 400)}）`
            : `${item.name}`;
        })
        .join(" | ")
    : "无";

  return [
    `最近对话：\n${historyText}`,
    `当前输入：${String(currentInput || "").trim()}`,
    `当前参考图：${Array.isArray(refImages) && refImages.length > 0 ? refImages.join(" | ") : "无"}`,
    `当前附件：${currentAttachmentText}`,
  ].join("\n\n");
}

function buildUserContent({ userText, messages, refImages }) {
  const content = [{ type: "input_text", text: userText }];
  const currentImages = Array.isArray(refImages) ? refImages.filter(Boolean).slice(0, 3) : [];
  const latestGeneratedImages = normalizeMessages(messages)
    .reverse()
    .find((message) => message.images.length > 0)?.images || [];
  const imagePool = currentImages.length > 0 ? currentImages : latestGeneratedImages.slice(0, 2);

  for (const src of imagePool) {
    content.push({ type: "input_image", image_url: src });
  }

  return content;
}

function buildChatUserContent({ userText, messages, refImages }) {
  const content = [{ type: "text", text: userText }];
  const currentImages = Array.isArray(refImages) ? refImages.filter(Boolean).slice(0, 3) : [];
  const latestGeneratedImages = normalizeMessages(messages)
    .reverse()
    .find((message) => message.images.length > 0)?.images || [];
  const imagePool = currentImages.length > 0 ? currentImages : latestGeneratedImages.slice(0, 2);

  for (const src of imagePool) {
    content.push({ type: "image_url", image_url: { url: src } });
  }

  return content;
}

function isWebSearchIntent(input = "") {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return false;
  return /(最新|最近|近日|近期|今天|今日|本周|本月|新闻|资讯|动态|热点|趋势|盘点|汇总|收集|搜一下|查一下|发生了什么|进展)/.test(text);
}

function getNumberEmoji(index) {
  const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];
  return emojis[index] || `${index + 1}.`;
}

function formatGeneralReplyText(text = "") {
  let value = String(text || "").replace(/\r/g, "").trim();
  if (!value) return "";

  value = value
    .replace(/([。！？])\s*(?=(\d+)\s*[、.])/g, "$1\n\n")
    .replace(/([：:])\s*(?=(\d+)\s*[、.])/g, "$1\n");

  value = value.replace(/(^|\n)\s*(\d+)\s*[、.]\s*/g, (_, prefix, num) => {
    const index = Math.max(Number(num) - 1, 0);
    return `${prefix}${getNumberEmoji(index)} `;
  });

  value = value.replace(/([，；;])\s*(\d+)\s*[、.]\s*/g, (_, __, num) => {
    const index = Math.max(Number(num) - 1, 0);
    return `\n${getNumberEmoji(index)} `;
  });

  const lines = value.split("\n").map((line) => line.trim());
  const normalizedLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      normalizedLines.push("");
      continue;
    }

    if (
      index === 0
      && !/^([1-9]\uFE0F?\u20E3|\d+\.)/.test(line)
      && !/^(📰|✨|📚|🎯|📌|💡|✅|👉|💬|🔎|📍)/.test(line)
    ) {
      normalizedLines.push(`✨ ${line}`);
      continue;
    }

    if (/^如果你想/.test(line)) {
      normalizedLines.push(`💬 ${line}`);
      continue;
    }

    if (/^(建议|总结|核心|重点|亮点|适合|理由|推荐理由|做法|方法|步骤|清单|方向|思路|可选项|你可以)/.test(line)) {
      normalizedLines.push(`📌 ${line}`);
      continue;
    }

    if (/^(价值|意义|适用场景|适合人群|适用人群|为什么值得)/.test(line)) {
      normalizedLines.push(`💡 ${line}`);
      continue;
    }

    normalizedLines.push(line);
  }

  return normalizedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatWebSearchReply(result = {}) {
  const lead = String(result?.lead || "").trim();
  const items = Array.isArray(result?.items) ? result.items.filter(Boolean).slice(0, 6) : [];
  const closing = String(result?.closing || "").trim();

  const sections = items.map((item, index) => {
    const title = String(item?.title || `信息 ${index + 1}`).trim();
    const source = String(item?.source || "").trim();
    const publishedAt = String(item?.published_at || "").trim();
    const summary = String(item?.summary || "").trim();
    const whyItMatters = String(item?.why_it_matters || "").trim();
    const url = String(item?.url || "").trim();

    return [
      `${getNumberEmoji(index)} ${title}`,
      source || publishedAt ? `🗞️ 来源：${[source, publishedAt].filter(Boolean).join(" · ")}` : "",
      summary ? `📌 核心：${summary}` : "",
      whyItMatters ? `💡 价值：${whyItMatters}` : "",
      url ? `🔗 链接：${url}` : "",
    ].filter(Boolean).join("\n");
  });

  return [
    lead || `📰 我基于实时联网结果，整理了一版更值得快速浏览的摘要（${items.length || 0} 条）`,
    sections.join("\n\n"),
    closing || "如果你愿意，我还可以继续按 OpenAI、Google、AI Agent、投融资 等主题再细分一版。",
  ].filter(Boolean).join("\n\n");
}

async function runWebSearchReply(currentInput) {
  if (!OPENAI_API_KEY) {
    throw new Error("未配置 OPENAI_API_KEY，暂时无法启用联网搜索。");
  }

  if (OPENAI_API_STYLE === "azure") {
    throw new Error("当前 Azure 风格接口暂未启用 web search。");
  }

  const responseSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      lead: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            source: { type: "string" },
            published_at: { type: "string" },
            summary: { type: "string" },
            why_it_matters: { type: "string" },
            url: { type: "string" },
          },
          required: ["title", "source", "published_at", "summary", "why_it_matters", "url"],
        },
      },
      closing: { type: "string" },
    },
    required: ["lead", "items", "closing"],
  };

  const systemText = [
    "你是一个可联网搜索的研究助手。",
    "你必须优先使用 web search tool 获取真实、最新、公开网页信息，再整理答案。",
    "默认聚焦最近且最相关的信息；如果用户明确指定领域或时间范围，优先遵循。",
    "输出必须是结构化中文摘要，适合直接展示在聊天窗口中。",
    "items 尽量返回 3-5 条，source 写媒体或机构名称，published_at 写相对时间或日期。",
    "summary 只写客观事实，why_it_matters 用一句话说明业务或产品价值。",
    "不要编造来源、不要捏造链接，信息不足时减少条目数。",
    "只返回 JSON。",
  ].join(" ");

  const data = await postJsonWithTimeout(
    RESPONSES_URL,
    {
      model: FLOATING_ASSISTANT_MODEL,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemText }] },
        { role: "user", content: [{ type: "input_text", text: String(currentInput || "").trim() }] },
      ],
      tools: [{ type: "web_search_preview" }],
      text: {
        format: {
          type: "json_schema",
          name: "floating_assistant_web_search",
          strict: true,
          schema: responseSchema,
        },
      },
    },
    FLOATING_ASSISTANT_TIMEOUT_MS
  );

  const rawText = extractResponsesText(data);
  const parsed = rawText ? JSON.parse(rawText) : null;
  if (!parsed) {
    throw new Error("联网搜索未返回有效结果");
  }

  return {
    action: "reply",
    mode: "quick",
    assistantText: formatWebSearchReply(parsed),
    assistantModel: `${FLOATING_ASSISTANT_MODEL} · web search`,
  };
}

function getAttachmentExtension(name = "") {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match ? match[1] : "";
}

function isDocumentExtractionIntent(input = "") {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return false;
  return /(提取|读取|读一下|识别|解析|总结|概括|梳理|摘录|提炼|文案|正文|内容|全文|翻译)/.test(text);
}

function formatAttachmentExtractionReply(attachments = []) {
  const normalizedAttachments = (Array.isArray(attachments) ? attachments : []).slice(0, 3);
  const extracted = normalizedAttachments.filter((item) => String(item?.excerpt || "").trim());

  if (extracted.length === 0) {
    const names = normalizedAttachments.map((item) => item?.name).filter(Boolean).join("、");
    return {
      action: "reply",
      mode: "quick",
      assistantText: names
        ? `我收到了附件 ${names}，但这次没有从文件正文里提取到可读文本。当前 PDF / DOCX / TXT 这类文本型文件可以直接提取；如果是扫描版 PDF、图片型文档，暂时还需要 OCR 才能继续识别。`
        : "我收到了附件，但这次没有从文件正文里提取到可读文本。当前 PDF / DOCX / TXT 这类文本型文件可以直接提取；如果是扫描版 PDF、图片型文档，暂时还需要 OCR 才能继续识别。",
      assistantModel: "文件解析",
    };
  }

  const sections = extracted.map((item, index) => {
    const extension = getAttachmentExtension(item?.name);
    const label = item?.name || `附件 ${index + 1}`;
    const tag = extension ? ` (${extension.toUpperCase()})` : "";
    return `【${label}${tag}】\n${String(item.excerpt || "").trim()}`;
  });

  return {
    action: "reply",
    mode: "quick",
    assistantText: `我已经从附件里提取到以下正文内容：\n\n${sections.join("\n\n")}`,
    assistantModel: "文件解析",
  };
}

async function runPlanner({ messages, currentInput, refImages, attachments }) {
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  if (isWebSearchIntent(currentInput) && normalizedAttachments.length === 0 && (!Array.isArray(refImages) || refImages.length === 0)) {
    try {
      return await runWebSearchReply(currentInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : "联网搜索暂时不可用";
      return {
        action: "reply",
        mode: "quick",
        assistantText: `这次联网搜索没有成功执行。原因：${message}\n\n你可以稍后重试，或者把搜索范围说得更具体一些，比如“收集最近 5 条 AI Agent 新闻”或“整理本周 OpenAI 动态”。`,
        assistantModel: `${FLOATING_ASSISTANT_MODEL} · web search`,
      };
    }
  }

  if (normalizedAttachments.length > 0 && isDocumentExtractionIntent(currentInput)) {
    return formatAttachmentExtractionReply(normalizedAttachments);
  }

  if (!OPENAI_API_KEY) {
    throw new Error("未配置 OPENAI_API_KEY，暂时无法启用悬浮对话助手。");
  }

  const systemText = [
    "你是 Easy AI 首页悬浮窗里的智能助手。",
    "你的任务是判断当前用户这轮输入更适合：1) 直接给建议回复；2) 进入图片生成。",
    "如果用户是在问思路、创意建议、文案建议、设计建议、怎么做、是否合适、如何优化、给我建议、帮我分析，应该返回 reply。",
    "如果用户明确要求生成图片、设计海报、出图、做封面、做 banner、做 logo、改图、延展图、风格参考生成，应该返回 generate。",
    "如果用户附带了参考图，通常优先返回 generate，且 mode 优先为 agent。",
    "generate 时 assistant_text 只需要一句简短自然的话，说明你理解了需求并开始生成。",
    "reply 时 assistant_text 直接给出有帮助的回复或必要的追问。",
    "普通 reply 请用适合聊天窗口阅读的轻量层级格式输出：首行给一句总结，可少量使用 emoji。",
    "如果是推荐、总结、步骤、清单类内容，优先换行分点，不要把 3-5 个项目挤在一个长段落里。",
    "可以使用 1. 2. 3. 或数字 emoji 作为标题项；次级信息可用“核心 / 建议 / 适合 / 理由 / 价值”等短标签。",
    "避免整段密集大段落，尽量让每个重点单独成行，方便直接在对话框里浏览。",
    "当 action 为 generate 时，你只负责判断模式并给一句自然回复，不要改写、润色、扩写、总结或整理用户原始生图提示词。",
    "mode 只能是 quick 或 agent。quick 适合简单直接的一句话出图；agent 适合带参考图、需要保持风格、对排版构图材质细节要求更高的任务。",
    "只返回 JSON，不要输出额外解释。",
  ].join(" ");

  const userText = buildUserText({ messages, currentInput, refImages, attachments });

  const responseSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["reply", "generate"] },
      mode: { type: "string", enum: ["quick", "agent"] },
      assistant_text: { type: "string" },
    },
    required: ["action", "mode", "assistant_text"],
  };

  let rawText = "";
  if (OPENAI_API_STYLE !== "azure") {
    try {
      const data = await postJsonWithTimeout(
        RESPONSES_URL,
        {
          model: FLOATING_ASSISTANT_MODEL,
          input: [
            { role: "system", content: [{ type: "input_text", text: systemText }] },
            { role: "user", content: buildUserContent({ userText, messages, refImages }) },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "floating_assistant_action",
              strict: true,
              schema: responseSchema,
            },
          },
        },
        FLOATING_ASSISTANT_TIMEOUT_MS
      );
      rawText = extractResponsesText(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      if (!/\[status:(404|405)\]/.test(message)) {
        throw error;
      }
    }
  }

  if (!rawText) {
    const chatUrl = OPENAI_API_STYLE === "azure"
      ? buildAzureDeploymentUrl(FLOATING_ASSISTANT_MODEL, "/chat/completions")
      : CHAT_COMPLETIONS_URL;
    const data = await postJsonWithTimeout(
      chatUrl,
      {
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: buildChatUserContent({ userText, messages, refImages }) },
        ],
        ...(OPENAI_API_STYLE === "azure" ? {} : { model: FLOATING_ASSISTANT_MODEL }),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "floating_assistant_action",
            strict: true,
            schema: responseSchema,
          },
        },
      },
      FLOATING_ASSISTANT_TIMEOUT_MS
    );
    rawText = extractChatCompletionsText(data);
  }

  const parsed = rawText ? JSON.parse(rawText) : null;
  if (!parsed?.action || !parsed?.mode) {
    throw new Error("悬浮助手未返回有效决策结果");
  }

  return {
    action: parsed.action === "reply" ? "reply" : "generate",
    mode: parsed.mode === "agent" ? "agent" : "quick",
    assistantText: parsed.action === "reply"
      ? formatGeneralReplyText(parsed.assistant_text || "")
      : String(parsed.assistant_text || "").trim(),
    assistantModel: FLOATING_ASSISTANT_MODEL,
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const data = await runPlanner({
      messages: body?.messages,
      currentInput: body?.currentInput,
      refImages: body?.refImages,
      attachments: body?.attachments,
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Floating assistant request failed" },
      { status: 500 }
    );
  }
}
