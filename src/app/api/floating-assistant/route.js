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
    .slice(-16)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      text: String(message?.text || "").trim(),
      images: Array.isArray(message?.images) ? message.images.filter(Boolean).slice(0, 2) : [],
      refImages: Array.isArray(message?.refImages) ? message.refImages.filter(Boolean).slice(0, 2) : [],
      attachments: Array.isArray(message?.attachments) ? message.attachments.slice(0, 4) : [],
    }))
    .filter((message) => (
      message.text
      || message.images.length > 0
      || message.refImages.length > 0
      || message.attachments.length > 0
    ));
}

function buildAttachmentText(attachments = [], maxExcerpt = 400) {
  return attachments
    .map((item) => {
      const excerpt = String(item?.excerpt || "").trim();
      return excerpt ? `[附件: ${item.name}，摘要: ${excerpt.slice(0, maxExcerpt)}]` : `[附件: ${item.name}]`;
    })
    .join(" ");
}

/**
 * 前端传入的 messages 已包含当前用户消息（historyForApi = [...prev, userMsg]）。
 * 为避免重复，历史部分取 messages 去掉最后一条，当前消息单独用 currentInput + refImages 构建。
 */
function buildMultiTurnInput({ messages, currentInput, refImages, attachments }) {
  // 历史：去掉最后一条（已是当前消息的副本）
  const history = normalizeMessages(messages).slice(0, -1);
  const turns = history.map((msg) => {
    const textParts = [msg.text || "(无文本)"];
    if (msg.attachments.length > 0) textParts.push(buildAttachmentText(msg.attachments));
    if (msg.role === "assistant") {
      // /responses 端点：assistant 消息 content 类型必须是 output_text
      return {
        role: "assistant",
        content: [{ type: "output_text", text: textParts.filter(Boolean).join("\n") }],
      };
    }
    // user 消息
    const content = [{ type: "input_text", text: textParts.filter(Boolean).join("\n") }];
    for (const src of msg.refImages.slice(0, 2)) {
      content.push({ type: "input_image", image_url: src });
    }
    return { role: "user", content };
  });

  // 当前轮（包含完整 refImages，比 messages 末尾更准确）
  const currentTextParts = [String(currentInput || "").trim()];
  if (Array.isArray(attachments) && attachments.length > 0) {
    currentTextParts.push(buildAttachmentText(attachments));
  }
  const currentContent = [{ type: "input_text", text: currentTextParts.filter(Boolean).join("\n") }];
  for (const src of (Array.isArray(refImages) ? refImages.filter(Boolean).slice(0, 3) : [])) {
    currentContent.push({ type: "input_image", image_url: src });
  }

  return [...turns, { role: "user", content: currentContent }];
}

/** 构建真正的多轮 messages 数组（用于 /chat/completions 端点） */
function buildChatMultiTurnMessages({ systemText, messages, currentInput, refImages, attachments }) {
  const history = normalizeMessages(messages).slice(0, -1);
  const turns = history.map((msg) => {
    const textParts = [msg.text || "(无文本)"];
    if (msg.attachments.length > 0) textParts.push(buildAttachmentText(msg.attachments));
    const content = [{ type: "text", text: textParts.filter(Boolean).join("\n") }];
    const imagePool = msg.role === "assistant"
      ? msg.images.slice(0, 2)
      : msg.refImages.slice(0, 2);
    for (const src of imagePool) {
      content.push({ type: "image_url", image_url: { url: src } });
    }
    return { role: msg.role, content: content.length === 1 ? content[0].text : content };
  });

  const currentTextParts = [String(currentInput || "").trim()];
  if (Array.isArray(attachments) && attachments.length > 0) {
    currentTextParts.push(buildAttachmentText(attachments));
  }
  const currentContent = [{ type: "text", text: currentTextParts.filter(Boolean).join("\n") }];
  for (const src of (Array.isArray(refImages) ? refImages.filter(Boolean).slice(0, 3) : [])) {
    currentContent.push({ type: "image_url", image_url: { url: src } });
  }
  const currentMessage = {
    role: "user",
    content: currentContent.length === 1 ? currentContent[0].text : currentContent,
  };

  return [
    { role: "system", content: systemText },
    ...turns,
    currentMessage,
  ];
}

function isWebSearchIntent(input = "") {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return false;
  return /(最新|最近|近日|近期|今天|今日|本周|本月|新闻|资讯|动态|热点|趋势|盘点|汇总|收集|搜一下|查一下|发生了什么|进展)/.test(text);
}

function formatGeneralReplyText(text = "") {
  return String(text || "").replace(/\r/g, "").trim();
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
    const sourceMeta = [source, publishedAt].filter(Boolean).join(" · ");

    const numEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];
    const numEmoji = numEmojis[index] || `${index + 1}.`;
    return [
      `### ${numEmoji} ${title}`,
      sourceMeta ? `*📰 ${sourceMeta}*` : "",
      summary ? `**核心：** ${summary}` : "",
      whyItMatters ? `**💡 价值：** ${whyItMatters}` : "",
      url ? `🔗 [查看原文](${url})` : "",
    ].filter(Boolean).join("\n\n");
  });

  return [
    lead || `今日 ${items.length || 0} 条 AI 设计 新闻`,
    sections.join("\n\n---\n\n"),
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
    "你是 X-AI 首页悬浮窗里的智能助手。",
    "你的任务是判断当前用户这轮输入更适合：1) 直接给建议回复；2) 进入图片生成。",
    "如果用户是在问思路、创意建议、文案建议、设计建议、怎么做、是否合适、如何优化、给我建议、帮我分析，应该返回 reply。",
    "如果用户明确要求生成图片、设计海报、出图、做封面、做 banner、做 logo、改图、延展图、风格参考生成，应该返回 generate。",
    "如果用户附带了参考图，通常优先返回 generate，且 mode 优先为 agent。",
    "generate 时 assistant_text 只需要一句简短自然的话，说明你理解了需求并开始生成。",
    "reply 时 assistant_text 直接给出有帮助的回复或必要的追问，使用标准 Markdown 格式。",
    "reply 时 请用标准 Markdown 格式输出，允许在 ## 标题前加 emoji 点缀，正文列表项适当使用 emoji，整体风格参考 ChatGPT 输出样式。",
    "推荐、总结、步骤、清单类内容请用有序或无序列表分点展示，不要把多个要点挤在一个段落里。",
    "如果是对话类回复，不需要标题，直接用段落和列表即可。",
    "避免密集大段落，保持清晰易读。",
    "当 action 为 generate 时，你只负责判断模式并给一句自然回复，不要改写、润色、扩写、总结或整理用户原始生图提示词。",
    "mode 只能是 quick 或 agent。quick 适合简单直接的一句话出图；agent 适合带参考图、需要保持风格、对排版构图材质细节要求更高的任务。",
    "只返回 JSON，不要输出额外解释。",
  ].join(" ");

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

  const multiTurnInput = buildMultiTurnInput({ messages, currentInput, refImages, attachments });

  let rawText = "";
  if (OPENAI_API_STYLE !== "azure") {
    try {
      const data = await postJsonWithTimeout(
        RESPONSES_URL,
        {
          model: FLOATING_ASSISTANT_MODEL,
          input: [
            { role: "system", content: [{ type: "input_text", text: systemText }] },
            ...multiTurnInput,
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
        messages: buildChatMultiTurnMessages({ systemText, messages, currentInput, refImages, attachments }),
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
