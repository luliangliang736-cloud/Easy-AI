"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Check,
  ChevronUp,
  Copy,
  Download,
  Gauge,
  ImageIcon,
  Loader2,
  Maximize2,
  Moon,
  Plus,
  RefreshCw,
  Send,
  Sun,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { compressImage } from "@/lib/imageUtils";
import { GENERATION_STAGE_ORDER, getGenerationStageCopy } from "@/lib/generationStages";
import BrandLogo from "@/components/BrandLogo";
import {
  buildEzFamilyTriggerPrompt,
  buildWaTemplatePrompt,
  chooseWaTemplateIpRole,
  detectEzFamilyTrigger,
  detectOneClickEntryMode,
  getLatestGeneratedImages,
  isObviousOneClickGenerateRequest,
  parseWaTemplateRequest,
  shouldReusePreviousGeneratedImages,
} from "@/lib/oneClickCreationRules";
import {
  buildIpSceneExtensionPrompt,
  detectIpSceneExtension,
} from "@/lib/ipSceneExtensionRules";
import SKILLS from "@/config/skills";
import IP_ASSETS from "@/config/ipAssets";

const CHAT_SESSION_KEY = "lovart-chat-fullscreen-session";
const IMAGE_HISTORY_KEY = "lovart-chat-image-history";
const IMAGE_HISTORY_LIMIT = 100;
const ATTACHMENT_ACCEPT = "image/*,.pdf,.doc,.docx,.txt,.md,.markdown,.rtf,.csv,.json,.xml,.xls,.xlsx,.ppt,.pptx";
const EZFAMILY_ASSET_URL = "/api/ezfamily";
const EZLOGO_ASSET_URL = "/ip-assets/EZlogo/EZlogo.jpg";
const WA_TEMPLATE_ASSET_URL = "/api/wa-templates";
const WA_LOCKUP_ASSET_URL = "/api/wa-lockup";
const WA_SMILE_LOGO_ASSET_URL = "/api/wa-smile-logo";

// ── 与悬浮框完全一致的生图参数常量 ──
const FLOATING_DEFAULT_MODEL = "gemini-3.1-flash-image-preview-512";
const FLOATING_DEFAULT_SERVICE_TIER = "priority";
const FLOATING_AGENT_DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const FLOATING_AGENT_DEFAULT_SERVICE_TIER = "priority";
const FLOATING_EDIT_MODEL = "gpt-image-2";
const GENERATION_STAGE_MIN_MS = 650;
const GENERATION_SAVING_STAGE_MS = 350;
const ONE_CLICK_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
const WA_QUALITY_CLIENT_TIMEOUT_MS = 18 * 1000;
const GENERATION_RECOVERY_POLL_MS = 2000;
const GENERATION_RECOVERY_MAX_ATTEMPTS = 60;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutError(message = "请求等待时间过长，请稍后重试。") {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = ONE_CLICK_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(createTimeoutError()), timeoutMs);
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && error?.name === "AbortError" && !externalSignal?.aborted) {
      throw createTimeoutError();
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abortFromExternal);
    }
  }
}

async function withTimeout(promise, timeoutMs, fallbackValue = null) {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = window.setTimeout(() => resolve(fallbackValue), timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

function createClientRequestId(prefix = "chat") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function recoverGenerationResult(clientRequestId) {
  if (!clientRequestId) return null;
  for (let attempt = 0; attempt < GENERATION_RECOVERY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`/api/generation-results/${encodeURIComponent(clientRequestId)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.success && Array.isArray(data?.data?.urls) && data.data.urls.length > 0) {
          return data;
        }
      }
      if (res.status !== 202) return null;
    } catch {}
    await wait(GENERATION_RECOVERY_POLL_MS);
  }
  return null;
}

async function fetchImageAsDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function fetchEzFamilyReferenceImages(role) {
  const roleText = String(role || "");
  const singleImageUrl = `${EZFAMILY_ASSET_URL}?role=${encodeURIComponent(roleText)}`;
  if (!roleText.includes("真人版")) {
    const image = await fetchImageAsDataUrl(singleImageUrl);
    return image ? [image] : [];
  }

  try {
    const res = await fetch(`${singleImageUrl}&all=1`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const items = Array.isArray(data.items) ? data.items : [];
    const orderedItems = [
      ...items.filter((item) => String(item?.name || "").includes("正视图")),
      ...items.filter((item) => !String(item?.name || "").includes("正视图")),
    ];
    const images = (await Promise.all(
      orderedItems
        .slice(0, 1)
        .map((item) => item?.src)
        .filter(Boolean)
        .map((src) => fetchImageAsDataUrl(src))
    )).filter(Boolean);
    if (images.length > 0) return images;
  } catch {
    // Fallback to a single identity reference.
  }

  const image = await fetchImageAsDataUrl(singleImageUrl);
  return image ? [image] : [];
}

async function runWaQualityCheck(imageUrl) {
  if (!imageUrl) return null;
  try {
    const res = await fetch("/api/wa-quality-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return null;
    return data.data || null;
  } catch {
    return null;
  }
}

function buildWaQualityFixPrompt(qualityCheck) {
  if (!qualityCheck) return "";
  const issues = Array.isArray(qualityCheck.issues)
    ? qualityCheck.issues
      .map((issue) => String(issue?.message || "").trim())
      .filter(Boolean)
      .slice(0, 4)
    : [];
  const suggestedFix = String(qualityCheck.suggestedFix || "").trim();
  if (!issues.length && !suggestedFix) return "";
  return [
    "",
    "本次是基于上一版 WA 海报质检结果的修复重生，请明确修正以下问题，但仍保持原始用户需求、2:1 WA 模板结构、品牌规范和主副标题内容不变。",
    issues.length ? `上一版问题：${issues.join("；")}` : "",
    suggestedFix ? `上一版建议：${suggestedFix}` : "",
    "修复优先级：先保证画面完整不裁切、主副标题清晰且层级正确、Logo/OJK/EASYCASH 清晰可读、人物和右侧元素不要挤压左侧文案；背景保持低干扰，不新增无关行业符号。",
  ].filter(Boolean).join("\n");
}

function buildWaQualityImprovement(previousQualityCheck, nextQualityCheck) {
  if (!previousQualityCheck || !nextQualityCheck) return null;
  const previousScore = Number(previousQualityCheck.score || 0);
  const nextScore = Number(nextQualityCheck.score || 0);
  const previousIssues = Array.isArray(previousQualityCheck.issues)
    ? previousQualityCheck.issues.filter((issue) => issue?.message)
    : [];
  const nextIssues = Array.isArray(nextQualityCheck.issues)
    ? nextQualityCheck.issues.filter((issue) => issue?.message)
    : [];
  const nextIssueTypes = new Set(nextIssues.map((issue) => issue.type).filter(Boolean));
  const resolvedIssues = previousIssues
    .filter((issue) => issue.type && !nextIssueTypes.has(issue.type))
    .map((issue) => issue.message)
    .slice(0, 3);
  const improvements = [];
  if (nextScore > previousScore) {
    improvements.push(`质检分数从 ${previousScore}/100 提升到 ${nextScore}/100`);
  } else if (nextScore === previousScore) {
    improvements.push(`质检分数保持在 ${nextScore}/100，主要变化体现在画面细节`);
  }
  if (resolvedIssues.length) {
    improvements.push(`上一版部分问题已减弱或未再被识别：${resolvedIssues.join("；")}`);
  }
  if (previousIssues.length > nextIssues.length) {
    improvements.push(`质检问题数量从 ${previousIssues.length} 项减少到 ${nextIssues.length} 项`);
  }
  if (!improvements.length) {
    improvements.push("已按上一版质检建议重新生成，可重点对比文字区、Logo/OJK 可读性、人物位置和背景干扰度");
  }
  return {
    previousScore,
    nextScore,
    delta: nextScore - previousScore,
    improvements: improvements.slice(0, 3),
    remainingIssues: nextIssues.map((issue) => issue.message).slice(0, 3),
  };
}

/** 根据参考图真实像素尺寸，计算 GPT Image 2 edit 合法的精确输出尺寸 */
function computeGptImage2EditSize(width, height) {
  if (!width || !height || width <= 0 || height <= 0) return "auto";
  const MAX_EDGE = 3840;
  const MAX_RATIO = 3;
  const MIN_PIXELS = 655360;
  const MAX_PIXELS = 8294400;
  const MULTIPLE = 16;

  let w = width;
  let h = height;

  const longEdge = Math.max(w, h);
  const shortEdge = Math.min(w, h);
  if (shortEdge === 0 || longEdge / shortEdge > MAX_RATIO) return "auto";

  if (w * h < MIN_PIXELS) {
    const scale = Math.sqrt(MIN_PIXELS / (w * h));
    w = Math.ceil(w * scale);
    h = Math.ceil(h * scale);
  }

  const maxEdge = Math.max(w, h);
  if (maxEdge > MAX_EDGE) {
    const scale = MAX_EDGE / maxEdge;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  w = Math.round(w / MULTIPLE) * MULTIPLE || MULTIPLE;
  h = Math.round(h / MULTIPLE) * MULTIPLE || MULTIPLE;

  if (Math.max(w, h) > MAX_EDGE || w * h > MAX_PIXELS || w * h < MIN_PIXELS) return "auto";

  return `${w}x${h}`;
}

function findClosestAspectRatio(width, height) {
  const candidates = [
    ["1:1", 1], ["16:9", 16 / 9], ["9:16", 9 / 16], ["4:3", 4 / 3],
    ["3:4", 3 / 4], ["3:2", 3 / 2], ["2:3", 2 / 3],
    ["2:1", 2 / 1], ["1:2", 1 / 2],
    ["4:5", 4 / 5], ["5:4", 5 / 4], ["21:9", 21 / 9],
  ];
  const target = width / height;
  let best = candidates[0];
  let bestDiff = Math.abs(best[1] - target);
  for (const c of candidates.slice(1)) {
    const diff = Math.abs(c[1] - target);
    if (diff < bestDiff) { best = c; bestDiff = diff; }
  }
  return best[0];
}

function inferAspectRatioFromPrompt(text) {
  if (!text || typeof text !== "string") return "1:1";
  const compact = text.toLowerCase().replace(/\s+/g, "");
  const ratioMatch = compact.match(/(21|16|9|8|5|4|3|2|1)\s*[:：/xX]\s*(9|16|8|5|4|3|2|1)/);
  if (ratioMatch) return findClosestAspectRatio(Number(ratioMatch[1]), Number(ratioMatch[2]));
  const biMatch = compact.match(/(21|16|9|8|5|4|3|2|1)\s*比\s*(9|16|8|5|4|3|2|1)/);
  if (biMatch) return findClosestAspectRatio(Number(biMatch[1]), Number(biMatch[2]));
  const dimMatch = compact.match(/(\d{3,5})\s*[xX*＊]\s*(\d{3,5})/);
  if (dimMatch) return findClosestAspectRatio(Number(dimMatch[1]), Number(dimMatch[2]));
  if (compact.includes("小红书") || compact.includes("笔记封面")) return "4:5";
  if (compact.includes("抖音") || compact.includes("快手") || compact.includes("竖屏")) return "9:16";
  if (compact.includes("公众号") || compact.includes("横版") || compact.includes("头图")) return "16:9";
  if (compact.includes("海报")) return "3:4";
  if (compact.includes("主图") || compact.includes("方图") || compact.includes("正方形")) return "1:1";
  return "1:1";
}

function detectRefImageMeta(dataUrl) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      resolve({ ratio: w > 0 && h > 0 ? findClosestAspectRatio(w, h) : "1:1", width: w, height: h });
    };
    img.onerror = () => resolve({ ratio: "1:1", width: 0, height: 0 });
    img.src = dataUrl;
  });
}

function buildAgentPrompt(text, refImages = []) {
  const base = String(text || "").trim();
  if (!refImages.length) return base;
  return `${base}

Agent mode hidden instructions:
- Treat the provided reference image(s) as the primary grounding.
- keep composition
- keep lighting
- keep aspect ratio
- keep camera angle, framing, perspective, and scene layout
- keep subject identity, key shapes, proportions, and object relationships
- do not crop, zoom, rotate, or rearrange the scene unless the user explicitly asks for it
- only change the parts that are explicitly requested by the user
- if multiple reference images are provided, use the first image as the main composition and aspect-ratio anchor`;
}

function resolveAgentParams(baseParams, promptText, refImages = []) {
  const compact = String(promptText || "").replace(/\s+/g, "");
  const needsHighFidelity = /海报|poster|品牌|branding|logo|字体|排版|版式|产品图|电商|包装|KV|banner|高清|高细节|细节/.test(compact);
  return {
    ...baseParams,
    model: needsHighFidelity ? "gemini-3-pro-image-preview" : FLOATING_AGENT_DEFAULT_MODEL,
    image_size: refImages.length > 0 ? "auto" : "1:1",
    num: 1,
    service_tier: FLOATING_AGENT_DEFAULT_SERVICE_TIER,
  };
}

function resolveFloatingGenerationModel({ hasImages = false, isAgentMode = false, agentParams = {} } = {}) {
  // 有参考图走 edit，无参考图走 generate，两条路都用 gpt-image-2
  return FLOATING_EDIT_MODEL;
}

function createMessage(role, text = "", extra = {}) {
  return {
    id: `chat-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    ...extra,
  };
}

function formatGenerationError(error) {
  const message = String(error?.message || "").trim();
  if (error?.name === "TimeoutError" || /failed to fetch|请求等待时间过长/i.test(message)) {
    return "生成请求连接中断或超时，请稍后重试。";
  }
  return message || "处理失败，请稍后重试。";
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatHistoryTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function normalizeInspirationUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function MarkdownRenderer({ text, isLightTheme }) {
  const textColor = isLightTheme ? "text-[#1f1f1f]" : "text-[#ececec]";
  const mutedColor = isLightTheme ? "text-black/55" : "text-white/55";
  const linkColor = isLightTheme ? "text-[#2563eb] hover:text-[#1d4ed8]" : "text-[#8ab4ff] hover:text-[#a8c7ff]";
  const borderColor = isLightTheme ? "border-black/12" : "border-white/10";
  const codeBg = isLightTheme ? "bg-black/[0.06] text-[#c7254e]" : "bg-white/[0.08] text-[#f8a5c2]";
  const codeBlockBg = isLightTheme ? "bg-black/[0.04] border border-black/10" : "bg-white/[0.04] border border-white/8";
  const blockquoteBorder = isLightTheme ? "border-black/20 text-black/60" : "border-white/20 text-white/60";

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p({ children }) { return <p className={`text-[15px] leading-[1.75] ${textColor} mb-3 last:mb-0`}>{children}</p>; },
        h1({ children }) { return <h1 className={`text-[20px] font-bold leading-8 mb-3 mt-6 first:mt-0 ${isLightTheme ? "text-[#111]" : "text-white"}`}>{children}</h1>; },
        h2({ children }) { return <h2 className={`text-[17px] font-semibold leading-7 mb-2 mt-5 first:mt-0 ${isLightTheme ? "text-[#111]" : "text-white"}`}>{children}</h2>; },
        h3({ children }) { return <h3 className={`text-[15px] font-semibold leading-7 mb-2 mt-4 first:mt-0 ${isLightTheme ? "text-[#111]" : "text-white"}`}>{children}</h3>; },
        ul({ children }) {
          return <ul className={`mb-3 last:mb-0 space-y-1 pl-4 ${isLightTheme ? "[&>li::marker]:text-black/40" : "[&>li::marker]:text-white/40"}`} style={{ listStyleType: "disc" }}>{children}</ul>;
        },
        ol({ children }) {
          return <ol className={`mb-3 last:mb-0 space-y-1 pl-5 ${isLightTheme ? "[&>li::marker]:text-black/50" : "[&>li::marker]:text-white/50"}`} style={{ listStyleType: "decimal" }}>{children}</ol>;
        },
        li({ children }) { return <li className={`text-[15px] leading-7 pl-1 ${textColor} [&>ul]:mt-1 [&>ol]:mt-1`}>{children}</li>; },
        a({ href, children }) {
          return <a href={href} target="_blank" rel="noreferrer" className={`underline underline-offset-2 break-all ${linkColor}`}>{children}</a>;
        },
        strong({ children }) { return <strong className={`font-semibold ${isLightTheme ? "text-[#111]" : "text-white"}`}>{children}</strong>; },
        em({ children }) { return <em className={`italic ${mutedColor}`}>{children}</em>; },
        code({ inline, children }) {
          if (inline) return <code className={`rounded px-1.5 py-0.5 text-[13px] font-mono ${codeBg}`}>{children}</code>;
          return <code className={`block w-full rounded-xl px-4 py-3 text-[13px] font-mono leading-6 overflow-x-auto whitespace-pre ${codeBlockBg} ${textColor} mb-3`}>{children}</code>;
        },
        pre({ children }) { return <pre className="mb-3 last:mb-0">{children}</pre>; },
        blockquote({ children }) { return <blockquote className={`border-l-4 pl-4 my-3 ${blockquoteBorder}`}>{children}</blockquote>; },
        hr() { return <hr className={`my-5 border-t ${borderColor}`} />; },
        table({ children }) {
          return <div className="overflow-x-auto mb-3"><table className={`w-full text-[13px] border-collapse ${textColor}`}>{children}</table></div>;
        },
        thead({ children }) { return <thead className={`border-b ${borderColor}`}>{children}</thead>; },
        th({ children }) { return <th className={`px-3 py-2 text-left font-semibold ${isLightTheme ? "text-[#111]" : "text-white"}`}>{children}</th>; },
        td({ children }) { return <td className={`px-3 py-2 border-b ${borderColor} ${textColor}`}>{children}</td>; },
      }}
    >
      {String(text || "")}
    </ReactMarkdown>
  );
}

function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClose}
    >
      <button type="button" onClick={onClose} className="absolute right-5 top-5 z-10 rounded-xl bg-white/10 p-2 text-white hover:bg-white/20"><X size={20} /></button>
      <div className="relative h-[90vh] w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <Image src={src} alt="预览" fill unoptimized className="rounded-xl object-contain shadow-2xl" />
      </div>
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const [theme, setTheme] = useState("dark");
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const skillsRef = useRef(null);
  const [refImages, setRefImages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState("understanding");
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [expandedQualityId, setExpandedQualityId] = useState(null);
  const [previewSrc, setPreviewSrc] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [isImageHistoryOpen, setIsImageHistoryOpen] = useState(false);
  const [imageHistory, setImageHistory] = useState([]);
  const [chatMode, setChatMode] = useState("chat");
  const [inspirationUrl, setInspirationUrl] = useState("");
  const [activeInspirationUrl, setActiveInspirationUrl] = useState("");
  const [inspirationPanelWidth, setInspirationPanelWidth] = useState(380);
  const [isInspirationResizing, setIsInspirationResizing] = useState(false);
  const [imageHistoryPanelSize, setImageHistoryPanelSize] = useState({ width: 320, height: 420 });
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const abortControllerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const promptTextareaRef = useRef(null);
  const imageHistoryMenuRef = useRef(null);
  const inspirationResizeFrameRef = useRef(0);
  const isLightTheme = theme === "light";
  const generationStageCopy = getGenerationStageCopy(generationStage);
  const activeGenerationStageIndex = Math.max(0, GENERATION_STAGE_ORDER.indexOf(generationStage));

  const showGenerationStage = useCallback(async (stage, duration = GENERATION_STAGE_MIN_MS, signal = null) => {
    setGenerationStage(stage);
    if (duration > 0) await wait(duration);
    if (signal?.aborted) {
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    try {
      const raw = window.localStorage.getItem(CHAT_SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw);
        if (Array.isArray(session.messages)) setMessages(session.messages);
        if (typeof session.prompt === "string") setPrompt(session.prompt);
        if (Array.isArray(session.refImages)) setRefImages(session.refImages);
      }
    } catch {}
    try {
      const rawImgHistory = window.localStorage.getItem(IMAGE_HISTORY_KEY);
      if (rawImgHistory) {
        const parsed = JSON.parse(rawImgHistory);
        if (Array.isArray(parsed)) {
          setImageHistory(
            parsed
              .filter((item) => item && Array.isArray(item.urls) && item.urls.length > 0)
              .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
              .slice(0, IMAGE_HISTORY_LIMIT)
          );
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  useEffect(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 160);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden";
  }, [prompt]);

  useEffect(() => {
    if (!isImageHistoryOpen) return;
    const handler = (e) => {
      if (previewSrc) return;
      if (!imageHistoryMenuRef.current?.contains(e.target)) {
        setIsImageHistoryOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [isImageHistoryOpen, previewSrc]);

  const handleImageHistoryResizeStart = useCallback((event, direction = "sw") => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = imageHistoryPanelSize;
    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const nextWidth = direction.includes("w")
        ? Math.min(640, Math.max(280, startSize.width - dx))
        : startSize.width;
      const nextHeight = direction.includes("s")
        ? Math.min(Math.max(320, window.innerHeight - 96), Math.max(260, startSize.height + dy))
        : startSize.height;
      setImageHistoryPanelSize({ width: nextWidth, height: nextHeight });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [imageHistoryPanelSize]);

  const saveSession = useCallback(() => {
    try {
      window.localStorage.setItem(CHAT_SESSION_KEY, JSON.stringify({ messages, prompt, refImages }));
    } catch {}
  }, [messages, prompt, refImages]);

  const handleBack = () => {
    saveSession();
    router.push("/");
  };

  const handleCopyText = async (message) => {
    const text = String(message?.text || "").trim();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand("copy"); ta.remove();
    }
    setCopiedMessageId(message.id);
    setTimeout(() => setCopiedMessageId((c) => (c === message.id ? null : c)), 1600);
  };

  const handleDownloadImage = async (src, index) => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `easy-ai-${Date.now()}-${index + 1}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      const a = document.createElement("a");
      a.href = src; a.download = `easy-ai-${Date.now()}-${index + 1}.png`;
      a.target = "_blank"; document.body.appendChild(a); a.click(); a.remove();
    }
  };

  const handleDeleteMessage = (messageId) => {
    setMessages((prev) => prev.filter((message) => message.id !== messageId));
  };

  const handleFilesAdd = async (files) => {
    const imageFiles = Array.from(files).filter((f) => f.type?.startsWith("image/"));
    if (!imageFiles.length) return;
    const rawUrls = await Promise.all(imageFiles.map(readFileAsDataURL));
    const compressed = await Promise.all(
      rawUrls.map(async (url) => { try { return await compressImage(url, 1280, 0.78); } catch { return url; } })
    );
    setRefImages((prev) => [...prev, ...compressed]);
  };

  const handlePaste = (event) => {
    const clipboardItems = Array.from(event.clipboardData?.items || []);
    const imageFilesFromItems = clipboardItems
      .filter((item) => item.type?.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    const imageFiles = imageFilesFromItems.length > 0
      ? imageFilesFromItems
      : Array.from(event.clipboardData?.files || []).filter((file) => file.type?.startsWith("image/"));

    if (!imageFiles.length) return;
    event.preventDefault();
    void handleFilesAdd(imageFiles);
  };

  const handleOpenInspirationUrl = () => {
    const nextUrl = normalizeInspirationUrl(inspirationUrl);
    if (!nextUrl) return;
    setActiveInspirationUrl(nextUrl);
    setInspirationUrl(nextUrl);
  };

  const handleInspirationResizeStart = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspirationPanelWidth;
    setIsInspirationResizing(true);

    const handlePointerMove = (moveEvent) => {
      const maxWidth = Math.min(window.innerWidth - 260, 1400);
      const nextWidth = Math.min(maxWidth, Math.max(180, startWidth + moveEvent.clientX - startX));
      if (inspirationResizeFrameRef.current) {
        window.cancelAnimationFrame(inspirationResizeFrameRef.current);
      }
      inspirationResizeFrameRef.current = window.requestAnimationFrame(() => {
        setInspirationPanelWidth(nextWidth);
        inspirationResizeFrameRef.current = 0;
      });
    };

    const handlePointerUp = () => {
      if (inspirationResizeFrameRef.current) {
        window.cancelAnimationFrame(inspirationResizeFrameRef.current);
        inspirationResizeFrameRef.current = 0;
      }
      setIsInspirationResizing(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (e.dataTransfer?.types?.some((t) => t === "Files")) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (files?.length) void handleFilesAdd(files);
  };

  useEffect(() => {
    if (!skillsOpen) return undefined;
    const handler = (e) => {
      if (skillsRef.current && !skillsRef.current.contains(e.target)) {
        setSkillsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [skillsOpen]);

  const handleSkillClick = useCallback(async (skill) => {
    setSkillsOpen(false);
    if (skill.ipBased && IP_ASSETS.length > 0) {
      const pick = IP_ASSETS[Math.floor(Math.random() * IP_ASSETS.length)];
      try {
        const res = await fetch(pick.url);
        const blob = await res.blob();
        const ext = (pick.url.split(".").pop() || "png").split("?")[0];
        const file = new File([blob], `ip-ref.${ext}`, { type: blob.type || "image/png" });
        await handleFilesAdd([file]);
      } catch { /* 静默跳过 */ }
    } else if (skill.ipBased && IP_ASSETS.length === 0) {
      setPrompt("（请先在 src/config/ipAssets.js 中添加您的IP图片）" + skill.prompt);
      return;
    }
    setPrompt(skill.prompt);
    if (skill.autoSend) setTimeout(() => handleSubmit(), 80);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleFilesAdd]);

  const handleSubmit = async (override = null) => {
    const activePrompt = override?.prompt ?? prompt;
    const activeRefImages = Array.isArray(override?.refImages) ? override.refImages : refImages;
    const text = String(activePrompt || "").trim();
    if (!text && activeRefImages.length === 0) return;
    if (isGenerating) return;
    const qualityFixPrompt = buildWaQualityFixPrompt(override?.qualityCheck);

    // ── WA 模板 / EZfamily / EZlogo 关键词自动触发参考图 ─────────────
    let autoRefImages = [];
    let apiText = text; // 对 API 使用的 prompt（可能被增强）
    const waTemplateRequest = parseWaTemplateRequest(text);
    const ezFamilyRole = detectEzFamilyTrigger(text);
    const hasEzLogoTrigger = /ezlogo/i.test(text);
    const ipSceneRequest = detectIpSceneExtension(text, {
      hasUserReferenceImages: activeRefImages.length > 0,
      isWaTemplate: Boolean(waTemplateRequest),
    });

    if (waTemplateRequest) {
      try {
        const templateImage = await fetchImageAsDataUrl(`${WA_TEMPLATE_ASSET_URL}?random=1`);
        if (templateImage) autoRefImages.push(templateImage);
        const role = ezFamilyRole || chooseWaTemplateIpRole(waTemplateRequest);
        autoRefImages.push(...await fetchEzFamilyReferenceImages(role));
        const lockupImage = await fetchImageAsDataUrl(WA_LOCKUP_ASSET_URL);
        if (lockupImage) autoRefImages.push(lockupImage);
        if (Math.random() < 0.28) {
          const smileLogoImage = await fetchImageAsDataUrl(WA_SMILE_LOGO_ASSET_URL);
          if (smileLogoImage) autoRefImages.push(smileLogoImage);
        }
        apiText = buildWaTemplatePrompt(waTemplateRequest, role);
      } catch { /* 静默跳过 */ }
    } else if (ipSceneRequest) {
      try {
        const sceneImage = await fetchImageAsDataUrl(ipSceneRequest.sceneImageUrl);
        if (sceneImage) autoRefImages.push(sceneImage);
        autoRefImages.push(...await fetchEzFamilyReferenceImages(ipSceneRequest.role));
        for (const logoUrl of ipSceneRequest.logoImageUrls || []) {
          const logoImage = await fetchImageAsDataUrl(logoUrl);
          if (logoImage) autoRefImages.push(logoImage);
        }
        apiText = buildIpSceneExtensionPrompt(ipSceneRequest);
      } catch { /* 静默跳过 */ }
    } else if (ezFamilyRole) {
      try {
        autoRefImages.push(...await fetchEzFamilyReferenceImages(ezFamilyRole));
        apiText = buildEzFamilyTriggerPrompt(text, ezFamilyRole, {
          hasUserReferenceImages: activeRefImages.length > 0,
        });
      } catch { /* 静默跳过 */ }
    } else if (hasEzLogoTrigger) {
      try {
        const logoImage = await fetchImageAsDataUrl(EZLOGO_ASSET_URL);
        if (logoImage) autoRefImages.push(logoImage);
        apiText = text.replace(/\bezlogo\b/gi, "").replace(/\s+/g, " ").trim();
        apiText = `${apiText || "参考图中的图形标志进行设计。"}

EZlogo trigger instructions:
- 第一张参考图是 EZlogo 的品牌标志结构锚点，必须以它的笑脸弧线、点状元素、整体几何关系和品牌识别为主体。
- 其它参考图只用于学习材质、色彩、光影、排版或超级符号风格，不要复刻其它参考图里的主体字母、符号或图形。
- “EZlogo”只是系统触发词，不要在画面中生成“EZlogo”文字，也不要把它理解成要生成英文字母“EZ”。`;
      } catch { /* 静默跳过 */ }
    }
    if (qualityFixPrompt) {
      apiText = `${apiText}\n${qualityFixPrompt}`;
    }
    // ─────────────────────────────────────────────────────

    // 继承上一条消息中生成的图片（与悬浮框逻辑一致）
    const inheritedImages = shouldReusePreviousGeneratedImages(text, activeRefImages)
      ? getLatestGeneratedImages(messages)
      : [];

    // WA 模板/EZlogo：系统资产必须作为第一参考图；其它图仅作为风格/场景参考
    // 无触发：正常使用 refImages
    const submittedImages = autoRefImages.length > 0
      ? (waTemplateRequest
        ? [...autoRefImages, ...activeRefImages, ...inheritedImages]
        : hasEzLogoTrigger
          ? [...autoRefImages, ...activeRefImages, ...inheritedImages]
        : (activeRefImages.length > 0 ? [...activeRefImages, ...autoRefImages] : [...autoRefImages, ...inheritedImages]))
      : [...activeRefImages, ...inheritedImages];
    const predictedMode = detectOneClickEntryMode(apiText, submittedImages);
    const bypassPlanner = autoRefImages.length > 0 || isObviousOneClickGenerateRequest(apiText, submittedImages, []);

    // 自动参考图只用于生成，不在气泡里展示
    const displayRefImages = autoRefImages.length > 0 ? activeRefImages : submittedImages;
    const userMsg = createMessage("user", text, { refImages: displayRefImages });
    const historyForApi = [...messages, userMsg].map((m) => ({
      role: m.role, text: m.text || "",
      images: Array.isArray(m.images) ? m.images.slice(0, 3) : [],
      refImages: Array.isArray(m.refImages) ? m.refImages.slice(0, 3) : [],
      attachments: [],
    }));

    setMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setRefImages([]);
    setGenerationStage("understanding");
    setIsGenerating(true);
    let activeClientRequestId = "";

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await showGenerationStage("understanding", GENERATION_STAGE_MIN_MS, abortController.signal);
      const plan = bypassPlanner
        ? {
            action: "generate",
            mode: predictedMode,
            assistantText: submittedImages.length > 0 ? "我直接按你的要求开始改图。" : "我直接按你的要求开始生图。",
            assistantModel: submittedImages.length > 0 ? "直连 GPT Image 2" : "直连 Nano",
          }
        : await (async () => {
            const res = await fetchWithTimeout("/api/floating-assistant", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: historyForApi, currentInput: apiText, refImages: submittedImages, attachments: [] }),
              signal: abortController.signal,
            }, 60 * 1000);
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.error) throw new Error(data.error || "对话判断失败");
            return data.data || {};
          })();

      const resolvedMode = plan.mode === "agent" ? "agent" : "quick";
      const assistantText = String(plan.assistantText || "").trim();

      if (plan.action === "reply") {
        setMessages((prev) => [...prev, createMessage("assistant", assistantText || "我来给你一些建议。", { modelLabel: plan.assistantModel })]);
        return;
      }

      // ── 生图逻辑与悬浮框完全一致 ──
      await showGenerationStage("preparing", GENERATION_STAGE_MIN_MS, abortController.signal);
      const hasImages = submittedImages.length > 0;
      const isAgentMode = resolvedMode === "agent";
      const firstRefMeta = hasImages ? await detectRefImageMeta(submittedImages[0]) : null;
      const quickImageSize = hasImages ? (firstRefMeta?.ratio || "1:1") : inferAspectRatioFromPrompt(text);
      const agentParams = resolveAgentParams(
        { model: FLOATING_AGENT_DEFAULT_MODEL, image_size: "1:1", num: 1, service_tier: FLOATING_AGENT_DEFAULT_SERVICE_TIER },
        text,
        submittedImages
      );
      const generationModel = resolveFloatingGenerationModel({ hasImages, isAgentMode, agentParams });
      // GPT Image 2 传精确像素尺寸以保持原图比例；其他模型传比例字符串
      const isGpt2 = generationModel === "gpt-image-2";
      const imageSize = hasImages
        ? (isGpt2 ? computeGptImage2EditSize(firstRefMeta?.width, firstRefMeta?.height) : (firstRefMeta?.ratio || "1:1"))
        : isAgentMode
          ? (agentParams.image_size === "auto" ? (firstRefMeta?.ratio || "1:1") : agentParams.image_size)
          : quickImageSize;
      const endpoint = hasImages ? "/api/edit" : "/api/generate";
      // apiText 可能已被触发词场景增强，优先用 apiText
      const finalPrompt = isAgentMode ? buildAgentPrompt(apiText, submittedImages) : apiText;
      activeClientRequestId = createClientRequestId("chat");
      const payload = hasImages
        ? { prompt: finalPrompt, image: submittedImages.length === 1 ? submittedImages[0] : submittedImages, model: generationModel, image_size: imageSize, num: 1, service_tier: isAgentMode ? agentParams.service_tier : FLOATING_DEFAULT_SERVICE_TIER, clientRequestId: activeClientRequestId }
        : { prompt: finalPrompt, model: generationModel, image_size: imageSize, num: 1, ref_images: submittedImages, service_tier: isAgentMode ? agentParams.service_tier : FLOATING_DEFAULT_SERVICE_TIER, clientRequestId: activeClientRequestId };

      setGenerationStage("generating");
      const genRes = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });
      const genData = await genRes.json().catch(() => ({}));
      if (!genRes.ok || genData.error) throw new Error(genData.error || "生成失败");
      const urls = Array.isArray(genData.data?.urls) ? genData.data.urls.filter(Boolean) : [];
      if (!urls.length) throw new Error("未返回结果图片");

      await showGenerationStage("saving", GENERATION_SAVING_STAGE_MS, abortController.signal);
      const assistantMessage = createMessage(
        "assistant",
        assistantText || (resolvedMode === "agent" ? "我已经按你的要求整理并生成了一版结果。" : "我已经帮你快速生成了一版结果。"),
        {
          images: urls,
          qualityCheck: null,
          qualityImprovement: null,
          modelLabel: `${plan.assistantModel || ""} · ${generationModel}`.replace(/^ · /, ""),
        }
      );
      setMessages((prev) => [...prev, assistantMessage]);

      if (waTemplateRequest) {
        void withTimeout(runWaQualityCheck(urls[0]), WA_QUALITY_CLIENT_TIMEOUT_MS, null)
          .then((qualityCheck) => {
            if (!qualityCheck) return;
            const qualityImprovement = buildWaQualityImprovement(override?.qualityCheck, qualityCheck);
            setMessages((prev) => prev.map((message) => (
              message.id === assistantMessage.id
                ? { ...message, qualityCheck, qualityImprovement }
                : message
            )));
          });
      }

      // 保存图片历史
      const imgEntry = { id: `img-${Date.now()}`, prompt: text.slice(0, 40) || "图片生成", urls: urls.slice(0, 4), createdAt: Date.now() };
      let storedHistory = [];
      try {
        const rawHistory = window.localStorage.getItem(IMAGE_HISTORY_KEY);
        const parsedHistory = rawHistory ? JSON.parse(rawHistory) : [];
        if (Array.isArray(parsedHistory)) storedHistory = parsedHistory;
      } catch {}
      const mergedHistory = [
        imgEntry,
        ...storedHistory.filter((item) => item?.id !== imgEntry.id),
      ].slice(0, IMAGE_HISTORY_LIMIT);
      try {
        window.localStorage.setItem(IMAGE_HISTORY_KEY, JSON.stringify(mergedHistory));
      } catch {}
      setImageHistory(mergedHistory);
    } catch (err) {
      if (err?.name === "AbortError") {
        // 用户手动取消，不添加错误消息
      } else {
        const recovered = await recoverGenerationResult(activeClientRequestId);
        const recoveredUrls = Array.isArray(recovered?.data?.urls) ? recovered.data.urls.filter(Boolean) : [];
        if (recoveredUrls.length > 0) {
          setMessages((prev) => [...prev, createMessage("assistant", "刚刚连接中断，但我已经恢复到生成结果。", {
            images: recoveredUrls,
            modelLabel: "已恢复的生成结果",
          })]);
          return;
        }
        setMessages((prev) => [...prev, createMessage("assistant", formatGenerationError(err))]);
      }
    } finally {
      setIsGenerating(false);
      setGenerationStage("understanding");
      abortControllerRef.current = null;
    }
  };

  const handleRegenerateMessage = (messageId) => {
    if (isGenerating) return;
    const messageIndex = messages.findIndex((item) => item.id === messageId);
    if (messageIndex <= 0) return;
    const targetMessage = messages[messageIndex];
    const sourceMessage = [...messages.slice(0, messageIndex)].reverse().find((item) => item.role === "user");
    if (!sourceMessage) return;
    void handleSubmit({
      prompt: sourceMessage.text || "",
      refImages: Array.isArray(sourceMessage.refImages) ? sourceMessage.refImages : [],
      qualityCheck: targetMessage?.qualityCheck,
    });
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGenerating(false);
    setGenerationStage("understanding");
  };

  if (!mounted) return null;

  const canSubmit = Boolean(String(prompt || "").trim()) || refImages.length > 0;

  return (
    <div
      className={`fixed inset-0 flex flex-col ${isLightTheme ? "bg-[#f9f9f9] text-[#111]" : "bg-[#0d0d0d] text-white"}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 拖拽覆盖层 */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-[300] flex flex-col items-center justify-center gap-3">
          <div className={`absolute inset-3 rounded-3xl border-2 border-dashed ${isLightTheme ? "border-[#9CFF3F]/70 bg-[#9CFF3F]/15 backdrop-blur-sm" : "border-[#9CFF3F]/60 bg-[#9CFF3F]/10 backdrop-blur-sm"}`} />
          <div className="relative z-10 flex flex-col items-center gap-2">
            <div className={`text-4xl`}>🖼️</div>
            <p className="text-base font-medium text-[#9CFF3F]">松开即可添加为参考图</p>
            <p className="text-xs text-[#9CFF3F]/70">支持 JPG、PNG、WebP、GIF 等图片格式</p>
          </div>
        </div>
      )}

      {/* ── Floating top controls ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-start justify-between px-5 py-3">

        {/* Left controls */}
        <div
          className="pointer-events-auto flex items-center gap-2 transition-transform"
          style={{
            transform: chatMode === "inspiration" ? `translateX(${inspirationPanelWidth}px)` : undefined,
          }}
        >
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center transition-opacity hover:opacity-80"
            title="返回首页"
            aria-label="返回首页"
          >
            <BrandLogo
              className="h-7"
              showText={false}
              wordmarkOffsetClassName={`translate-y-[2px] ${isLightTheme ? "invert" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={() => setChatMode((mode) => (mode === "inspiration" ? "chat" : "inspiration"))}
            className={`inline-flex h-7 translate-y-[1px] items-center gap-1.5 rounded-xl px-3 text-sm transition-all ${
              chatMode === "inspiration"
                ? isLightTheme
                  ? "bg-black/10 text-black"
                  : "bg-white/12 text-white"
                : isLightTheme
                  ? "text-black/50 hover:bg-black/[0.05] hover:text-black/80"
                  : "text-white/50 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            灵感模式
          </button>
        </div>

        {/* Right controls */}
        <div className="pointer-events-auto flex items-center gap-1">
          <div ref={imageHistoryMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setIsImageHistoryOpen((v) => !v);
              }}
              className={`w-8 h-8 rounded-full inline-flex items-center justify-center transition-all ${
                isImageHistoryOpen
                  ? isLightTheme
                    ? "bg-black/10 text-black"
                    : "bg-white/12 text-white"
                  : isLightTheme
                    ? "text-black/45 hover:bg-black/[0.06] hover:text-black/80"
                    : "text-white/45 hover:bg-white/[0.08] hover:text-white"
              }`}
              title="查看历史图片"
              aria-label="查看历史图片"
            >
              <ImageIcon size={15} />
            </button>

            {isImageHistoryOpen && (
              <div
                className={`absolute right-0 top-full z-50 mt-2 flex flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl ${isLightTheme ? "border-black/8 bg-white/96" : "border-white/8 bg-[#1b1c1d]/96"}`}
                style={{ width: imageHistoryPanelSize.width, height: imageHistoryPanelSize.height }}
              >
                <div className={`flex shrink-0 items-center justify-between border-b px-3 py-2 ${isLightTheme ? "border-black/8" : "border-white/6"}`}>
                  <div>
                    <div className={`text-sm font-medium ${isLightTheme ? "text-[#111]" : "text-white"}`}>历史图片</div>
                    <div className={`text-[11px] ${isLightTheme ? "text-black/35" : "text-white/35"}`}>点击缩略图可预览</div>
                  </div>
                  <span className={`text-[11px] ${isLightTheme ? "text-black/35" : "text-white/30"}`}>
                    {imageHistory.length}
                  </span>
                </div>

                <div className={`min-h-0 flex-1 px-3 pb-3 pt-2 ${isLightTheme ? "text-[#111]" : "text-white"}`}>
                  {imageHistory.length > 0 ? (
                    <div className="h-full space-y-3 overflow-auto py-1">
                      {imageHistory.slice(0, 12).map((item) => (
                        <div key={item.id}>
                          <div className={`mb-1.5 truncate text-[11px] ${isLightTheme ? "text-black/45" : "text-white/40"}`}>
                            {item.prompt}
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {item.urls.slice(0, 4).map((url, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setPreviewSrc(url)}
                                className={`relative aspect-square overflow-hidden rounded-lg ${isLightTheme ? "border border-black/8 bg-black/[0.03]" : "border border-white/8 bg-white/[0.03]"}`}
                              >
                                <Image src={url} alt={`生成图 ${i + 1}`} fill unoptimized className="object-cover" />
                              </button>
                            ))}
                          </div>
                          <div className={`mt-1 text-[10px] ${isLightTheme ? "text-black/30" : "text-white/25"}`}>
                            {formatHistoryTime(item.createdAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`py-5 text-center text-sm ${isLightTheme ? "text-black/45" : "text-white/40"}`}>
                      暂无图片记录
                    </div>
                  )}
                </div>
                <div
                  aria-hidden="true"
                  onPointerDown={(event) => handleImageHistoryResizeStart(event, "w")}
                  className="absolute bottom-3 left-0 top-3 w-2 -translate-x-1/2 cursor-ew-resize"
                />
                <div
                  aria-hidden="true"
                  onPointerDown={(event) => handleImageHistoryResizeStart(event, "s")}
                  className="absolute bottom-0 left-3 right-3 h-2 translate-y-1/2 cursor-ns-resize"
                />
                <div
                  aria-hidden="true"
                  onPointerDown={(event) => handleImageHistoryResizeStart(event, "sw")}
                  className="absolute bottom-0 left-0 h-5 w-5 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className={`w-8 h-8 rounded-full inline-flex items-center justify-center transition-all ${isLightTheme ? "text-black/45 hover:bg-black/[0.06] hover:text-black/80" : "text-white/45 hover:bg-white/[0.08] hover:text-white"}`}
          >
            {isLightTheme ? <Moon size={15} /> : <Sun size={15} />}
          </button>
          <button
            type="button"
            onClick={handleBack}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition-all ${isLightTheme ? "text-black/50 hover:bg-black/[0.05] hover:text-black/80" : "text-white/50 hover:bg-white/[0.06] hover:text-white"}`}
          >
            <ArrowLeft size={15} />
            返回
          </button>
        </div>
      </div>

      {/* ── Messages area ── */}
      <div className="flex-1 min-h-0 overflow-hidden lg:flex">
        {chatMode === "inspiration" && (
          <div
            className="relative hidden shrink-0 lg:block"
            style={{ width: inspirationPanelWidth }}
          >
            <aside className={`flex h-full flex-col border-r px-4 py-4 ${isLightTheme ? "border-black/8 bg-white/65" : "border-white/8 bg-white/[0.025]"}`}>
              <div className="mb-4">
                <div className={`mb-2 text-sm font-semibold ${isLightTheme ? "text-[#111]" : "text-white"}`}>灵感模式</div>
                <p className={`text-xs leading-relaxed ${isLightTheme ? "text-black/45" : "text-white/40"}`}>
                  边找参考边设计
                </p>
              </div>

              <div className={`rounded-2xl border p-3 ${isLightTheme ? "border-black/8 bg-white" : "border-white/8 bg-[#171719]"}`}>
                <div className="flex gap-2">
                  <input
                    value={inspirationUrl}
                    onChange={(e) => setInspirationUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleOpenInspirationUrl();
                    }}
                    placeholder="输入设计网站链接"
                    className={`min-w-0 flex-1 rounded-xl px-3 py-2 text-xs outline-none ${isLightTheme ? "bg-black/[0.04] text-[#111] placeholder:text-black/30" : "bg-white/[0.06] text-white placeholder:text-white/30"}`}
                  />
                  <button
                    type="button"
                    onClick={handleOpenInspirationUrl}
                    className={`rounded-xl px-3 py-2 text-xs font-medium transition-all ${
                      isLightTheme
                        ? "bg-black/10 text-black hover:bg-black/15"
                        : "bg-white/12 text-white hover:bg-white/16"
                    }`}
                  >
                    打开
                  </button>
                </div>
              </div>

              <div className={`mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl border ${isLightTheme ? "border-black/8 bg-black/[0.03]" : "border-white/8 bg-black/30"}`}>
                {activeInspirationUrl ? (
                  <iframe
                    src={activeInspirationUrl}
                    title="灵感网站预览"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                    className={`h-full w-full ${isInspirationResizing ? "pointer-events-none" : ""}`}
                  />
                ) : (
                  <div className={`flex h-full items-center justify-center px-8 text-center text-xs leading-relaxed ${isLightTheme ? "text-black/35" : "text-white/30"}`}>
                    输入一个设计网站链接后，这里会尝试预览。部分网站不允许嵌入，可用新窗口打开。
                  </div>
                )}
              </div>
            </aside>
            <button
              type="button"
              aria-label="调整灵感面板宽度"
              onPointerDown={handleInspirationResizeStart}
              className={`absolute right-0 top-0 h-full w-2 translate-x-1/2 cursor-col-resize transition-colors ${isLightTheme ? "hover:bg-black/10" : "hover:bg-white/12"}`}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
        <div className={`${chatMode === "inspiration" ? "max-w-2xl" : "max-w-3xl"} mx-auto px-4 sm:px-6 pt-8 pb-48`}>
          {messages.length === 0 && !isGenerating ? (
            <div className={`flex flex-col items-center justify-center min-h-[50vh] gap-4 ${isLightTheme ? "text-black" : "text-white"}`}>
              <BrandLogo className="h-10" showText={false} />
              <p className="text-[15px]">有什么我可以帮你的？</p>
            </div>
          ) : (
            <div className="space-y-8">
              {messages.map((message) => (
                <div key={message.id} className={`flex gap-4 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  {message.role === "assistant" && (
                    <div className="w-8 h-8 shrink-0 mt-0.5 flex items-center justify-center">
                      <BrandLogo className="h-6" showText={false} />
                    </div>
                  )}

                  <div className={`flex flex-col gap-2 ${message.role === "user" ? "items-end max-w-[78%]" : "items-start flex-1 min-w-0"}`}>
                    {message.refImages?.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end">
                        {message.refImages.map((src, i) => (
                          <button key={i} type="button" onClick={() => setPreviewSrc(src)}
                            className={`relative h-16 w-16 overflow-hidden rounded-xl ${isLightTheme ? "border border-black/10" : "border border-white/10"}`}
                          >
                            <Image src={src} alt={`参考图 ${i + 1}`} fill unoptimized className="object-cover" />
                          </button>
                        ))}
                      </div>
                    )}

                    {message.text ? (
                      <div className={
                        message.role === "user"
                          ? isLightTheme
                            ? "rounded-2xl rounded-tr-sm bg-[#f2f3f5] px-4 py-3 text-[15px] text-[#111]"
                            : "rounded-2xl rounded-tr-sm bg-white/[0.07] px-4 py-3 text-[15px] text-white"
                          : ""
                      }>
                        {message.role === "assistant"
                          ? <MarkdownRenderer text={message.text} isLightTheme={isLightTheme} />
                          : <span className="whitespace-pre-wrap leading-7">{message.text}</span>
                        }
                      </div>
                    ) : null}

                    {message.images?.length > 0 && (
                      <div className="w-full">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                          {message.images.map((src, i) => (
                            <div key={i} className={`relative aspect-square overflow-hidden rounded-2xl ${isLightTheme ? "border border-black/10" : "border border-white/10"}`}>
                              <button type="button" className="absolute inset-0" onClick={() => setPreviewSrc(src)}>
                                <Image src={src} alt={`生成结果 ${i + 1}`} fill unoptimized className="object-cover" />
                              </button>
                              <div className="absolute right-2 top-2 flex gap-1.5">
                                <button type="button" onClick={(e) => { e.stopPropagation(); setPreviewSrc(src); }} className="rounded-lg bg-black/60 p-1.5 text-white backdrop-blur-sm hover:bg-black/80"><Maximize2 size={14} /></button>
                                <button type="button" onClick={(e) => { e.stopPropagation(); void handleDownloadImage(src, i); }} className="rounded-lg bg-black/60 p-1.5 text-white backdrop-blur-sm hover:bg-black/80"><Download size={14} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                        {message.role === "assistant" && (
                          <div className="mt-2 flex items-center justify-start gap-2 px-0.5">
                            {message.text ? (
                              <button
                                type="button"
                                onClick={() => void handleCopyText(message)}
                                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-all ${isLightTheme ? "text-black/35 hover:bg-black/[0.04] hover:text-black/70" : "text-white/30 hover:bg-white/[0.05] hover:text-white/70"}`}
                              >
                                {copiedMessageId === message.id ? <Check size={12} /> : <Copy size={12} />}
                                {copiedMessageId === message.id ? "已复制" : "复制"}
                              </button>
                            ) : null}
                            {message.qualityCheck ? (
                              <button
                                type="button"
                                onClick={() => setExpandedQualityId((current) => (current === message.id ? null : message.id))}
                                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-all ${
                                  message.qualityCheck.passed
                                    ? isLightTheme
                                      ? "text-emerald-700 hover:bg-emerald-500/10"
                                      : "text-emerald-300 hover:bg-emerald-400/10"
                                    : isLightTheme
                                      ? "text-amber-700 hover:bg-amber-500/10"
                                      : "text-amber-300 hover:bg-amber-400/10"
                                }`}
                              >
                                <Gauge size={12} />
                                质检 {Number(message.qualityCheck.score || 0)}/100
                                <ChevronUp size={11} className={`transition-transform ${expandedQualityId === message.id ? "" : "rotate-180"}`} />
                              </button>
                            ) : null}
                            {message.qualityCheck ? (
                              <button
                                type="button"
                                onClick={() => handleRegenerateMessage(message.id)}
                                disabled={isGenerating}
                                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                                  isLightTheme
                                    ? "text-black/35 hover:bg-black/[0.04] hover:text-black/70"
                                    : "text-white/30 hover:bg-white/[0.05] hover:text-white/70"
                                }`}
                              >
                                <RefreshCw size={12} />
                                按建议重生
                              </button>
                            ) : null}
                          </div>
                        )}
                        {message.qualityCheck && expandedQualityId === message.id ? (
                          <div className={`mt-2 rounded-xl px-3 py-2 text-[12px] leading-6 ${
                            isLightTheme
                              ? "border border-black/8 bg-black/[0.035] text-black/65"
                              : "border border-white/10 bg-white/[0.04] text-white/65"
                          }`}>
                            {message.qualityImprovement ? (
                              <>
                                <div className={message.qualityImprovement.delta >= 0 ? "font-medium text-emerald-500" : "font-medium text-amber-400"}>
                                  本次优化（{message.qualityImprovement.previousScore}/100 → {message.qualityImprovement.nextScore}/100）
                                </div>
                                <div className="mt-1 space-y-1">
                                  {message.qualityImprovement.improvements.map((item, itemIndex) => (
                                    <div key={`${message.id}-improvement-${itemIndex}`}>优化：{item}</div>
                                  ))}
                                </div>
                                {message.qualityImprovement.remainingIssues.length > 0 ? (
                                  <div className="mt-2 opacity-80">
                                    仍可优化：{message.qualityImprovement.remainingIssues.join("；")}
                                  </div>
                                ) : null}
                                <div className="mt-2 text-[11px] opacity-60">
                                  分数仅供参考，具体以实际出图质量和使用场景为准。
                                </div>
                              </>
                            ) : (
                              <>
                                <div className={message.qualityCheck.passed ? "font-medium text-emerald-500" : "font-medium text-amber-400"}>
                                  {message.qualityCheck.passed ? "质检通过" : "质检需关注"}（{Number(message.qualityCheck.score || 0)}/100）
                                </div>
                                {Array.isArray(message.qualityCheck.issues) && message.qualityCheck.issues.length > 0 ? (
                                  <div className="mt-1 space-y-1">
                                    {message.qualityCheck.issues.slice(0, 3).map((issue, issueIndex) => (
                                      <div key={`${message.id}-quality-${issueIndex}`}>问题：{issue.message}</div>
                                    ))}
                                  </div>
                                ) : null}
                                {message.qualityCheck.suggestedFix ? (
                                  <div className="mt-1">建议：{message.qualityCheck.suggestedFix}</div>
                                ) : null}
                                <div className="mt-2 text-[11px] opacity-60">
                                  分数仅供参考，具体以实际出图质量和使用场景为准。
                                </div>
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {message.role === "user" && (
                      <div className="flex items-center justify-end gap-3 w-full px-0.5 mt-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(message.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-all ${isLightTheme ? "text-black/35 hover:bg-red-500/10 hover:text-red-500" : "text-white/30 hover:bg-red-500/10 hover:text-red-300"}`}
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      </div>
                    )}

                    {message.role === "assistant" && message.text && !message.images?.length && (
                      <div className="flex items-center gap-3 w-full px-0.5 mt-1">
                        <span className={`text-[11px] ${isLightTheme ? "text-black/30" : "text-white/25"}`}>
                          {message.modelLabel ? `${message.modelLabel}` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyText(message)}
                          className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-all ${isLightTheme ? "text-black/35 hover:bg-black/[0.04] hover:text-black/70" : "text-white/30 hover:bg-white/[0.05] hover:text-white/70"}`}
                        >
                          {copiedMessageId === message.id ? <Check size={12} /> : <Copy size={12} />}
                          {copiedMessageId === message.id ? "已复制" : "复制"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(message.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-all ${isLightTheme ? "text-black/35 hover:bg-red-500/10 hover:text-red-500" : "text-white/30 hover:bg-red-500/10 hover:text-red-300"}`}
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      </div>
                    )}
                  </div>

                </div>
              ))}

              {isGenerating && (
                <div className="flex gap-4 justify-start items-start">
                  <div className="w-8 h-8 shrink-0 mt-0.5 flex items-center justify-center">
                    <BrandLogo className="h-6" showText={false} />
                  </div>
                  <div className="w-full max-w-[320px]">
                    <div className={`relative aspect-square overflow-hidden rounded-2xl ${isLightTheme ? "bg-[#f1f1f1]" : "bg-white/[0.055]"}`}>
                      <div className={`absolute inset-0 animate-pulse ${isLightTheme ? "bg-gradient-to-br from-black/[0.02] via-white/60 to-black/[0.04]" : "bg-gradient-to-br from-white/[0.03] via-white/[0.10] to-white/[0.03]"}`} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex w-full max-w-[240px] flex-col items-center gap-3 px-6 text-center">
                          <Loader2 size={24} className="animate-spin text-[#3FCA58]" />
                          <div>
                            <p className={`text-[13px] font-medium ${isLightTheme ? "text-black/70" : "text-white/75"}`}>
                              {generationStageCopy.label}
                            </p>
                            <p className={`mt-1 text-[11px] leading-5 ${isLightTheme ? "text-black/42" : "text-white/38"}`}>
                              {generationStageCopy.detail}
                            </p>
                          </div>
                          <div className="flex w-full items-center gap-1.5">
                            {GENERATION_STAGE_ORDER.map((stage, index) => (
                              <span
                                key={stage}
                                className={`h-1 flex-1 rounded-full transition-colors ${
                                  index <= activeGenerationStageIndex
                                    ? "bg-[#3FCA58]"
                                    : isLightTheme
                                      ? "bg-black/10"
                                      : "bg-white/12"
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between px-1">
                      <span className={`text-[11px] ${isLightTheme ? "text-black/35" : "text-white/25"}`}>
                        生成完成后会自动显示
                      </span>
                      <button
                        type="button"
                        onClick={handleCancel}
                        title="停止生成"
                        className={`shrink-0 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium transition-all ${isLightTheme ? "text-black/40 hover:text-black/70 hover:bg-black/[0.06]" : "text-white/35 hover:text-white/65 hover:bg-white/[0.07]"}`}
                      >
                        <Square size={10} className="fill-current" />
                        停止
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>
      </div>

      {/* ── Floating input ── */}
      <div
        className={`absolute bottom-0 right-0 pointer-events-none ${chatMode === "inspiration" ? "left-0 lg:left-auto" : "left-0"}`}
        style={chatMode === "inspiration" ? { left: inspirationPanelWidth } : undefined}
      >
        {/* Gradient fade */}
        <div className={`h-16 ${isLightTheme ? "bg-gradient-to-t from-[#f9f9f9] to-transparent" : "bg-gradient-to-t from-[#0d0d0d] to-transparent"}`} />
        <div className={`pointer-events-auto pb-6 px-4 sm:px-6 ${isLightTheme ? "bg-[#f9f9f9]" : "bg-[#0d0d0d]"}`}>
          <div className={`${chatMode === "inspiration" ? "max-w-2xl" : "max-w-3xl"} mx-auto`}>

            {/* Ref image previews */}
            {refImages.length > 0 && (
              <div className={`flex flex-wrap gap-2 mb-3 px-1`}>
                {refImages.map((src, i) => (
                  <div key={i} className={`relative h-14 w-14 rounded-xl overflow-hidden ${isLightTheme ? "border border-black/10" : "border border-white/10"}`}>
                    <Image src={src} alt={`参考图 ${i + 1}`} fill unoptimized className="object-cover" />
                    <button type="button" onClick={() => setRefImages((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-black/65 text-white flex items-center justify-center hover:bg-black/85">
                      <X size={9} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input card */}
            <div className={`flex items-end gap-2 rounded-[22px] px-3 py-2.5 ${
              isLightTheme
                ? "bg-white border border-black/8 shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-within:shadow-[0_2px_16px_rgba(0,0,0,0.09)] focus-within:border-black/14"
                : "bg-[#1c1c1e] border border-white/10 shadow-[0_4px_24px_rgba(0,0,0,0.4)] focus-within:border-white/18"
            } transition-all`} onPaste={handlePaste}>
              <input ref={fileInputRef} type="file" accept={ATTACHMENT_ACCEPT} multiple className="hidden"
                onChange={(e) => { if (e.target.files?.length) void handleFilesAdd(e.target.files); e.target.value = ""; }} />

              <button type="button" onClick={() => fileInputRef.current?.click()}
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all self-end mb-0.5 ${isLightTheme ? "bg-black/[0.05] text-black/50 hover:bg-black/[0.09] hover:text-black/80" : "bg-white/[0.07] text-white/50 hover:bg-white/[0.12] hover:text-white/80"}`}
                title="添加图片">
                <Plus size={16} />
              </button>

              {/* Skills 下拉按钮 */}
              {SKILLS.length > 0 && (
                <div className="relative self-end mb-0.5" ref={skillsRef}>
                  <button
                    type="button"
                    onClick={() => setSkillsOpen((v) => !v)}
                    title="快捷技能"
                    className={`shrink-0 h-8 px-2 rounded-full flex items-center gap-1 text-[11px] font-medium transition-all ${
                      skillsOpen
                        ? isLightTheme
                          ? "bg-[#9CFF3F]/10 text-[#9CFF3F] border border-[#9CFF3F]/20"
                          : "bg-[#9CFF3F]/20 text-[#9CFF3F] border border-[#9CFF3F]/30"
                        : isLightTheme
                          ? "bg-black/[0.05] text-black/50 hover:bg-black/[0.09] hover:text-black/80"
                          : "bg-white/[0.07] text-white/50 hover:bg-white/[0.12] hover:text-white/80"
                    }`}
                  >
                    <span>Skills</span>
                    <ChevronUp size={12} className={`transition-transform ${skillsOpen ? "" : "rotate-180"}`} />
                  </button>

                  {skillsOpen && (
                    <div className={`absolute bottom-full left-0 mb-2 w-52 rounded-2xl shadow-xl border overflow-hidden z-50 ${
                      isLightTheme ? "bg-white border-black/8" : "bg-[#1c1c1e] border-white/10"
                    }`}>
                      <div className={`px-3 py-2 text-[10px] font-semibold tracking-widest uppercase ${isLightTheme ? "text-black/30 border-b border-black/6" : "text-white/25 border-b border-white/6"}`}>
                        Skills
                      </div>
                      {SKILLS.map((skill) => (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => handleSkillClick(skill)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors ${
                            isLightTheme ? "hover:bg-black/[0.04] text-[#111]" : "hover:bg-white/[0.06] text-white"
                          }`}
                        >
                          <span className="text-base leading-none">{skill.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{skill.label}</div>
                            <div className={`text-[11px] truncate mt-0.5 ${isLightTheme ? "text-black/35" : "text-white/35"}`}>
                              {skill.ipBased && IP_ASSETS.length > 0
                                ? `将随机选取 ${IP_ASSETS.length} 张IP图之一作参考`
                                : skill.prompt.slice(0, 36) + "…"}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <textarea
                ref={promptTextareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                rows={1}
                placeholder="释放创意，一键帮你完成重复且无聊的工作~"
                className={`flex-1 min-h-[28px] max-h-40 bg-transparent text-[15px] outline-none resize-none leading-7 overflow-y-hidden py-0.5 ${isLightTheme ? "text-[#111] placeholder:text-black/28" : "text-white placeholder:text-white/28"}`}
              />

              <button type="button" onClick={() => handleSubmit()} disabled={!canSubmit || isGenerating}
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all self-end mb-0.5 ${!canSubmit || isGenerating ? `${isLightTheme ? "bg-black/[0.05] text-black/25" : "bg-white/[0.05] text-white/25"} cursor-not-allowed` : "bg-[#0d0d0d] text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/90"}`}
              >
                {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>

            <p className={`mt-2.5 text-center text-[11px] ${isLightTheme ? "text-black/22" : "text-white/18"}`}>
              AI 可能会出错，重要信息请自行核实
            </p>
          </div>
        </div>
      </div>

      {previewSrc && <ImageLightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />}
    </div>
  );
}
