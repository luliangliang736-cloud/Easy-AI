"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import IP_ASSETS from "@/config/ipAssets";
import Link from "next/link";
import {
  Sparkles, ArrowRight, Wand2, Image as ImageIcon,
  Layers, Zap, Crown, Rocket, PenTool,
  Palette, RefreshCw, Download, MousePointer2, Sun, Moon, Bot, LayoutGrid,
} from "lucide-react";
import { useTheme } from "@/lib/useTheme";
import { compressImage } from "@/lib/imageUtils";
import { getGenerationStageCopy } from "@/lib/generationStages";
import {
  detectOneClickEntryMode,
  getLatestGeneratedImages,
  isObviousOneClickGenerateRequest,
  shouldReusePreviousGeneratedImages,
} from "@/lib/oneClickCreationRules";
import BrandLogo from "@/components/BrandLogo";
import FloatingEntryWidget from "@/components/FloatingEntryWidget";

const FLOATING_DEFAULT_MODEL = "gemini-3.1-flash-image-preview-512";
const FLOATING_DEFAULT_SERVICE_TIER = "priority";
const FLOATING_AGENT_DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const FLOATING_AGENT_DEFAULT_SERVICE_TIER = "priority";
const FLOATING_EDIT_MODEL = "gpt-image-2";
const FLOATING_HISTORY_STORAGE_KEY = "lovart-floating-entry-home-history";
const GENERATION_STAGE_MIN_MS = 650;
const GENERATION_SAVING_STAGE_MS = 350;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HERO_LAYOUT_PRESETS = {
  desktop: {
    container: "pb-10 lg:pb-14",
    title: "text-4xl lg:text-6xl leading-tight mb-5",
    description: "text-base lg:text-lg max-w-2xl mb-10",
    actions: "gap-4",
    primaryButton: "h-12 px-8",
    secondaryButton: "h-12 px-8",
  },
  mac13: {
    container: "pb-8 sm:pb-9 lg:pb-10",
    title: "text-3xl sm:text-[34px] lg:text-[44px] leading-[1.06] mb-3.5",
    description: "text-sm sm:text-[15px] lg:text-base max-w-lg mb-7",
    actions: "gap-3",
    primaryButton: "h-10 px-6 text-sm",
    secondaryButton: "h-10 px-6 text-sm",
  },
  mac14: {
    container: "pb-8 sm:pb-10 lg:pb-12",
    title: "text-3xl sm:text-4xl lg:text-5xl leading-[1.08] mb-4",
    description: "text-sm sm:text-base lg:text-[17px] max-w-xl mb-8",
    actions: "gap-3 sm:gap-4",
    primaryButton: "h-11 px-7 text-sm",
    secondaryButton: "h-11 px-7 text-sm",
  },
  mac16: {
    container: "pb-10 sm:pb-12 lg:pb-14",
    title: "text-[34px] sm:text-[40px] lg:text-[54px] leading-[1.08] mb-[18px]",
    description: "text-base lg:text-lg max-w-xl mb-9",
    actions: "gap-4",
    primaryButton: "h-11 px-[30px] text-sm",
    secondaryButton: "h-11 px-[30px] text-sm",
  },
};

function createFloatingMessage(role, text = "", extra = {}) {
  return {
    id: `floating-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    ...extra,
  };
}

function hasFloatingSessionContent({ prompt = "", refImages = [], attachments = [], messages = [] } = {}) {
  return Boolean(
    String(prompt || "").trim()
    || (Array.isArray(refImages) && refImages.length > 0)
    || (Array.isArray(attachments) && attachments.length > 0)
    || (Array.isArray(messages) && messages.length > 0)
  );
}

function buildFloatingHistoryTitle({ prompt = "", messages = [] } = {}) {
  const firstUserText = (Array.isArray(messages) ? messages : [])
    .find((item) => item?.role === "user" && String(item?.text || "").trim())?.text;
  const baseText = String(firstUserText || prompt || "").replace(/\s+/g, " ").trim();
  if (baseText) {
    return baseText.slice(0, 24);
  }
  return "未命名对话";
}

function createFloatingHistoryEntry({ prompt = "", refImages = [], attachments = [], messages = [] } = {}) {
  return {
    id: `floating-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: buildFloatingHistoryTitle({ prompt, messages }),
    updatedAt: Date.now(),
    prompt: String(prompt || ""),
    refImages: Array.isArray(refImages) ? refImages.slice(0, 6) : [],
    attachments: Array.isArray(attachments) ? attachments.slice(0, 8) : [],
    messages: Array.isArray(messages) ? messages.slice(-20) : [],
  };
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function isTextLikeFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return (
    type.startsWith("text/")
    || type.includes("json")
    || type.includes("xml")
    || type.includes("javascript")
    || type.includes("typescript")
    || type.includes("markdown")
    || /\.(txt|md|markdown|csv|json|xml|html|htm|js|ts|jsx|tsx|css|scss|sass|less|rtf)$/i.test(name)
  );
}

function isServerExtractableFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return (
    type === "application/pdf"
    || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || /\.pdf$/i.test(name)
    || /\.docx$/i.test(name)
  );
}

function buildAttachmentSummary(file, textContent = "") {
  const excerpt = String(textContent || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  return {
    id: `attachment-${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    mimeType: file.type || "",
    size: file.size || 0,
    excerpt,
  };
}

async function extractDocumentAttachments(files) {
  if (!files.length) return [];

  const payload = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mimeType: file.type || "",
      size: file.size || 0,
      dataUrl: await readFileAsDataURL(file),
    }))
  );

  const res = await fetch("/api/floating-attachments/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: payload }),
  });
  const data = await parseApiResponse(res);
  if (!res.ok || data.error) {
    throw new Error(data.error || `附件解析失败（${res.status}）`);
  }
  return Array.isArray(data.data?.attachments) ? data.data.attachments : [];
}

async function parseApiResponse(res) {
  const rawText = await res.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return {
      error: `接口返回了非 JSON 内容：${rawText.slice(0, 120)}`,
    };
  }
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
    ["1:1", 1],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
    ["2:1", 2 / 1],
    ["1:2", 1 / 2],
    ["4:5", 4 / 5],
    ["5:4", 5 / 4],
    ["21:9", 21 / 9],
  ];

  const target = width / height;
  let best = candidates[0];
  let bestDiff = Math.abs(best[1] - target);
  for (const candidate of candidates.slice(1)) {
    const diff = Math.abs(candidate[1] - target);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best[0];
}

function inferAspectRatioFromPrompt(text) {
  if (!text || typeof text !== "string") return "1:1";
  const compact = text.toLowerCase().replace(/\s+/g, "");

  const explicitRatioMatch = compact.match(/(21|16|9|8|5|4|3|2|1)\s*[:：/xX]\s*(9|16|8|5|4|3|2|1)/);
  if (explicitRatioMatch) {
    return findClosestAspectRatio(Number(explicitRatioMatch[1]), Number(explicitRatioMatch[2]));
  }

  const explicitBiMatch = compact.match(/(21|16|9|8|5|4|3|2|1)\s*比\s*(9|16|8|5|4|3|2|1)/);
  if (explicitBiMatch) {
    return findClosestAspectRatio(Number(explicitBiMatch[1]), Number(explicitBiMatch[2]));
  }

  const dimensionMatch = compact.match(/(\d{3,5})\s*[xX*＊]\s*(\d{3,5})/);
  if (dimensionMatch) {
    return findClosestAspectRatio(Number(dimensionMatch[1]), Number(dimensionMatch[2]));
  }

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
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      resolve({
        ratio: width > 0 && height > 0 ? findClosestAspectRatio(width, height) : "1:1",
        width,
        height,
      });
    };
    img.onerror = () => resolve({ ratio: "1:1", width: 0, height: 0 });
    img.src = dataUrl;
  });
}

function buildAgentPrompt(text, refImages = []) {
  const basePrompt = String(text || "").trim();
  if (!refImages.length) {
    return basePrompt;
  }

  return `${basePrompt}

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
  const compactText = String(promptText || "").replace(/\s+/g, "");
  const needsHighFidelity = /海报|poster|品牌|branding|logo|字体|排版|版式|产品图|电商|包装|KV|banner|高清|高细节|细节/.test(compactText);

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

const FEATURES = [
  { icon: Wand2, title: "AI 智能生图", desc: "输入文字描述，AI 为你生成高质量图片", iconColor: "text-violet-400" },
  { icon: Layers, title: "多图参考编辑", desc: "上传参考图进行风格迁移、材质替换等操作", iconColor: "text-blue-400" },
  { icon: PenTool, title: "交互式画布", desc: "自由拖拽、缩放、排列你的创作素材", iconColor: "text-emerald-400" },
  { icon: Palette, title: "多种模型选择", desc: "从极速到专业级，按需选择生成质量与速度", iconColor: "text-amber-400" },
  { icon: RefreshCw, title: "撤销 / 重做", desc: "完整的编辑历史，随时回退任意步骤", iconColor: "text-rose-400" },
  { icon: Download, title: "导出分享", desc: "一键导出画布或单张图片，支持复制到剪贴板", iconColor: "text-sky-400" },
];

const MODELS = [
  { icon: Zap, name: "Nano Banana", desc: "极速低价 · 适合快速出图", color: "text-green-400" },
  { icon: Rocket, name: "Nano Banana 2", desc: "推荐 · 高性价比 · 最高4K", color: "text-blue-400" },
  { icon: Crown, name: "Nano Banana Pro", desc: "专业画质 · Thinking · 最高4K", color: "text-amber-400" },
];

export default function HomePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [heroLayoutPreset, setHeroLayoutPreset] = useState("desktop");
  const [floatingPrompt, setFloatingPrompt] = useState("");
  const [floatingRefImages, setFloatingRefImages] = useState([]);
  const [floatingAttachments, setFloatingAttachments] = useState([]);
  const [floatingIsGenerating, setFloatingIsGenerating] = useState(false);
  const [floatingGenerationStage, setFloatingGenerationStage] = useState("understanding");
  const [floatingOutputError, setFloatingOutputError] = useState("");
  const [floatingMessages, setFloatingMessages] = useState([]);
  const [floatingHistory, setFloatingHistory] = useState([]);
  const [floatingRuntimeMode, setFloatingRuntimeMode] = useState("quick");
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme("dark");
  const floatingEntryMode = floatingIsGenerating
    ? floatingRuntimeMode
    : detectOneClickEntryMode(floatingPrompt, floatingRefImages);
  const showFloatingGenerationStage = useCallback(async (stage, duration = GENERATION_STAGE_MIN_MS, signal = null) => {
    setFloatingGenerationStage(stage);
    if (duration > 0) await wait(duration);
    if (signal?.aborted) {
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    }
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateMacHeroLayout = () => {
      const platform = String(window.navigator.platform || "").toLowerCase();
      const userAgent = String(window.navigator.userAgent || "").toLowerCase();
      const isMac = platform.includes("mac") || userAgent.includes("macintosh");

      if (!isMac) {
        setHeroLayoutPreset("desktop");
        return;
      }

      const { innerWidth: width, innerHeight: height } = window;
      if (width <= 1512 || height <= 900) {
        setHeroLayoutPreset("mac13");
        return;
      }
      if (width <= 1728 || height <= 1040) {
        setHeroLayoutPreset("mac14");
        return;
      }
      if (width <= 2056 || height <= 1180) {
        setHeroLayoutPreset("mac16");
        return;
      }

      setHeroLayoutPreset("desktop");
    };

    updateMacHeroLayout();
    window.addEventListener("resize", updateMacHeroLayout);
    return () => window.removeEventListener("resize", updateMacHeroLayout);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(FLOATING_HISTORY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setFloatingHistory(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        FLOATING_HISTORY_STORAGE_KEY,
        JSON.stringify(floatingHistory.slice(0, 12))
      );
    } catch {}
  }, [floatingHistory]);

  const heroPreset = HERO_LAYOUT_PRESETS[heroLayoutPreset] || HERO_LAYOUT_PRESETS.desktop;

  const resetFloatingConversation = () => {
    setFloatingPrompt("");
    setFloatingRefImages([]);
    setFloatingAttachments([]);
    setFloatingMessages([]);
    setFloatingOutputError("");
    setFloatingRuntimeMode("quick");
    setFloatingGenerationStage("understanding");
  };

  const archiveFloatingConversation = () => {
    const snapshot = {
      prompt: floatingPrompt,
      refImages: floatingRefImages,
      attachments: floatingAttachments,
      messages: floatingMessages,
    };
    if (!hasFloatingSessionContent(snapshot)) {
      return false;
    }
    setFloatingHistory((prev) => [createFloatingHistoryEntry(snapshot), ...prev].slice(0, 12));
    return true;
  };

  const handleFloatingNewChat = () => {
    if (floatingIsGenerating) return;
    archiveFloatingConversation();
    resetFloatingConversation();
  };

  const handleSelectFloatingHistory = (historyId) => {
    if (floatingIsGenerating) return;
    const item = floatingHistory.find((entry) => entry.id === historyId);
    if (!item) return;
    setFloatingPrompt(String(item.prompt || ""));
    setFloatingRefImages(Array.isArray(item.refImages) ? item.refImages : []);
    setFloatingAttachments(Array.isArray(item.attachments) ? item.attachments : []);
    setFloatingMessages(Array.isArray(item.messages) ? item.messages : []);
    setFloatingOutputError("");
    setFloatingRuntimeMode("quick");
  };

  const handleDeleteFloatingHistory = (historyId) => {
    if (floatingIsGenerating) return;
    setFloatingHistory((prev) => prev.filter((entry) => entry.id !== historyId));
  };

  const handleExpandFullscreen = useCallback(() => {
    try {
      const session = {
        messages: floatingMessages,
        prompt: floatingPrompt,
        refImages: floatingRefImages,
        attachments: floatingAttachments,
        runtimeMode: floatingRuntimeMode,
        history: floatingHistory,
      };
      window.localStorage.setItem("lovart-chat-fullscreen-session", JSON.stringify(session));
    } catch {}
    router.push("/chat");
  }, [floatingMessages, floatingPrompt, floatingRefImages, floatingAttachments, floatingRuntimeMode, floatingHistory, router]);

  const handleFloatingFilesAdd = async (files) => {
    const imageFiles = files.filter((file) => file.type?.startsWith("image/"));
    const otherFiles = files.filter((file) => !file.type?.startsWith("image/"));

    if (imageFiles.length) {
      const rawDataUrls = await Promise.all(imageFiles.map((file) => readFileAsDataURL(file)));
      const compressed = await Promise.all(
        rawDataUrls.map(async (dataUrl) => {
          try {
            return await compressImage(dataUrl, 1280, 0.78);
          } catch {
            return dataUrl;
          }
        })
      );
      setFloatingRefImages((prev) => [...prev, ...compressed]);
    }

    if (otherFiles.length) {
      const textFiles = otherFiles.filter((file) => isTextLikeFile(file));
      const extractableFiles = otherFiles.filter((file) => !isTextLikeFile(file) && isServerExtractableFile(file));
      const passthroughFiles = otherFiles.filter((file) => !isTextLikeFile(file) && !isServerExtractableFile(file));

      const textSummaries = await Promise.all(
        textFiles.map(async (file) => {
          let textContent = "";
          try {
            textContent = await readFileAsText(file);
          } catch {}
          return buildAttachmentSummary(file, textContent);
        })
      );

      let extractedSummaries = [];
      if (extractableFiles.length) {
        try {
          extractedSummaries = await extractDocumentAttachments(extractableFiles);
        } catch {
          extractedSummaries = extractableFiles.map((file) => buildAttachmentSummary(file));
        }
      }

      const passthroughSummaries = passthroughFiles.map((file) => buildAttachmentSummary(file));
      const summaries = [...textSummaries, ...extractedSummaries, ...passthroughSummaries];
      setFloatingAttachments((prev) => [...prev, ...summaries]);
    }
  };

  const handleFloatingImageRemove = (indexToRemove) => {
    setFloatingRefImages((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const handleFloatingAttachmentRemove = (attachmentId) => {
    setFloatingAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const handleFloatingDeleteMessage = (messageId) => {
    setFloatingMessages((prev) => prev.filter((message) => message.id !== messageId));
  };

  const handleFloatingSubmit = async () => {
    const prompt = String(floatingPrompt || "").trim();
    if (!prompt && floatingRefImages.length === 0) return;

    // ── EasyFamily 关键词自动触发 IP 参考图 ─────────────────
    let autoIpImage = null;
    let apiPromptText = prompt; // 对 API 使用的 prompt（场景二会被增强）
    const hasIpTrigger = /easyfamily/i.test(prompt);

    if (hasIpTrigger && IP_ASSETS.length > 0) {
      const pick = IP_ASSETS[Math.floor(Math.random() * IP_ASSETS.length)];
      try {
        const res = await fetch(pick.url);
        const blob = await res.blob();
        autoIpImage = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
        // 场景二：用户有参考图 + EasyFamily → IP 图作为第二张参考，prompt 保持原样
      } catch { /* 静默跳过 */ }
    }
    // ─────────────────────────────────────────────────────

    const inheritedImages = shouldReusePreviousGeneratedImages(prompt, floatingRefImages)
      ? getLatestGeneratedImages(floatingMessages)
      : [];

    // 场景一：无参考图 → IP 图单独作为参考
    // 场景二：有参考图 → [用户参考图, IP图]
    // 无触发：正常使用 floatingRefImages
    const submittedImages = autoIpImage
      ? (floatingRefImages.length > 0 ? [...floatingRefImages, autoIpImage] : [autoIpImage, ...inheritedImages])
      : [...floatingRefImages, ...inheritedImages];
    const submittedAttachments = [...floatingAttachments];
    const predictedMode = detectOneClickEntryMode(apiPromptText, submittedImages);
    const bypassPlannerForDirectGenerate = Boolean(autoIpImage) || isObviousOneClickGenerateRequest(
      apiPromptText,
      submittedImages,
      submittedAttachments
    );
    // autoIpImage 只用于生成，不在气泡里展示参考图
    const displayRefImages = autoIpImage ? floatingRefImages : submittedImages;
    const nextUserMessage = createFloatingMessage("user", prompt, {
      refImages: displayRefImages,
      attachments: submittedAttachments,
    });
    const historyForAssistant = [...floatingMessages, nextUserMessage].map((message) => ({
      role: message.role,
      text: message.text || "",
      images: Array.isArray(message.images) ? message.images.slice(0, 3) : [],
      refImages: Array.isArray(message.refImages) ? message.refImages.slice(0, 3) : [],
      attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, 4) : [],
    }));

    setFloatingMessages((prev) => [...prev, nextUserMessage]);
    setFloatingPrompt("");
    setFloatingRefImages([]);
    setFloatingAttachments([]);
    setFloatingRuntimeMode(predictedMode);
    setFloatingGenerationStage("understanding");
    setFloatingIsGenerating(true);
    setFloatingOutputError("");

    try {
      await showFloatingGenerationStage("understanding");
      const plan = bypassPlannerForDirectGenerate
        ? {
            action: "generate",
            mode: predictedMode,
            assistantText: submittedImages.length > 0
              ? "我直接按你的要求开始改图。"
              : "我直接按你的要求开始生图。",
            assistantModel: submittedImages.length > 0 ? "直连 GPT Image 2" : "直连 Nano",
          }
        : await (async () => {
            const plannerRes = await fetch("/api/floating-assistant", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: historyForAssistant,
                currentInput: apiPromptText,
                refImages: submittedImages,
                attachments: submittedAttachments,
              }),
            });
            const plannerData = await parseApiResponse(plannerRes);
            if (!plannerRes.ok || plannerData.error) {
              throw new Error(plannerData.error || `对话判断失败（${plannerRes.status}）`);
            }
            return plannerData.data || {};
          })();
      const resolvedMode = plan.mode === "agent" ? "agent" : "quick";
      const assistantText = String(plan.assistantText || "").trim();
      setFloatingRuntimeMode(resolvedMode);

      if (plan.action === "reply") {
        setFloatingMessages((prev) => [
          ...prev,
          createFloatingMessage("assistant", assistantText || "我先给你一些建议，你也可以继续补充需求。", {
            modelLabel: plan.assistantModel || "gpt-5.4",
          }),
        ]);
        return;
      }

      await showFloatingGenerationStage("preparing");
      const hasImages = submittedImages.length > 0;
      const isAgentMode = resolvedMode === "agent";
      const generationPrompt = apiPromptText; // 场景二已增强，含人物替换指令
      const firstRefMeta = hasImages ? await detectRefImageMeta(submittedImages[0]) : null;
      const quickImageSize = hasImages
        ? (firstRefMeta?.ratio || "1:1")
        : inferAspectRatioFromPrompt(generationPrompt);
      const agentParams = resolveAgentParams(
        {
          model: FLOATING_AGENT_DEFAULT_MODEL,
          image_size: "1:1",
          num: 1,
          service_tier: FLOATING_AGENT_DEFAULT_SERVICE_TIER,
        },
        generationPrompt,
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
      const finalPrompt = isAgentMode ? buildAgentPrompt(generationPrompt, submittedImages) : generationPrompt;
      const payload = hasImages
        ? {
            prompt: finalPrompt,
            image: submittedImages.length === 1 ? submittedImages[0] : submittedImages,
            model: generationModel,
            image_size: imageSize,
            num: 1,
            service_tier: isAgentMode ? agentParams.service_tier : FLOATING_DEFAULT_SERVICE_TIER,
          }
        : {
            prompt: finalPrompt,
            model: generationModel,
            image_size: imageSize,
            num: 1,
            ref_images: submittedImages,
            service_tier: isAgentMode ? agentParams.service_tier : FLOATING_DEFAULT_SERVICE_TIER,
          };

      setFloatingGenerationStage("generating");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseApiResponse(res);
      if (!res.ok || data.error) {
        throw new Error(data.error || `生成失败（${res.status}）`);
      }

      const urls = Array.isArray(data.data?.urls) ? data.data.urls.filter(Boolean) : [];
      if (urls.length === 0) {
        throw new Error("未返回结果图片");
      }

      await showFloatingGenerationStage("saving", GENERATION_SAVING_STAGE_MS);
      setFloatingMessages((prev) => [
        ...prev,
        createFloatingMessage(
          "assistant",
          assistantText || (resolvedMode === "agent" ? "我已经按你的要求整理并生成了一版结果。" : "我已经帮你快速生成了一版结果。"),
          {
            images: urls,
            modelLabel: `${plan.assistantModel || "gpt-5.4"} · ${generationModel}`,
          }
        ),
      ]);
    } catch (err) {
      setFloatingMessages((prev) => [
        ...prev,
        createFloatingMessage("assistant", err?.message || "处理失败，请稍后重试。"),
      ]);
      setFloatingOutputError("");
    } finally {
      setFloatingIsGenerating(false);
      setFloatingGenerationStage("understanding");
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary overflow-x-hidden overflow-y-auto">
      {/* Nav */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 lg:px-12 py-4 bg-bg-primary/70 backdrop-blur-xl border-b border-border-primary/60"
      >
        <div className="flex items-center">
          <BrandLogo
            className="h-9"
            wordmarkOffsetClassName={`translate-y-[2px] ${theme === "light" ? "invert" : ""}`}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsModeMenuOpen((prev) => !prev)}
              className="w-9 h-9 rounded-xl bg-bg-secondary text-text-secondary hover:text-[#3FCA58] hover:bg-bg-hover transition-all flex items-center justify-center"
              title="选择模式"
              aria-label="选择模式"
            >
              <LayoutGrid size={16} />
            </button>
            {isModeMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+16px)] z-50 w-44 overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary/95 p-1.5 shadow-2xl backdrop-blur-xl">
                <Link
                  href="/chat"
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-text-secondary transition-all hover:text-[#3FCA58]"
                >
                  一键创作模式
                  <ArrowRight size={14} />
                </Link>
                <Link
                  href="/canvas"
                  className="mt-1 flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-text-secondary transition-all hover:text-[#3FCA58]"
                >
                  工作台模式
                  <ArrowRight size={14} />
                </Link>
              </div>
            )}
          </div>
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-xl bg-bg-secondary text-text-secondary hover:text-[#3FCA58] hover:bg-bg-hover transition-all flex items-center justify-center"
            title={theme === "dark" ? "切换到浅色" : "切换到深色"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative w-full h-screen min-h-[600px] overflow-hidden">
        <video
          src="/videos/home-hero-easyfamily.mp4"
          aria-label="EasyAI 创作首页封面"
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      </section>

      {/* Hero copy */}
      <section className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto pt-32 lg:pt-40 pb-24 lg:pb-32 text-center transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <h1 className={`font-bold text-text-primary tracking-tight ${heroPreset.title}`}>
            用 <span style={{ color: "#3FCA58" }}>AI</span> 释放
            <br />你的创意想象力
        </h1>
        <p className={`text-text-secondary mx-auto leading-relaxed ${heroPreset.description}`}>
          输入文字描述，AI 即刻生成高质量图片。支持多图参考、风格迁移、材质替换，在交互式画布上自由编排你的创作。
        </p>
        <div className={`flex items-center justify-center ${heroPreset.actions}`}>
          <Link
            href="/chat"
            className={`rounded-full bg-[#3FCA58] text-white font-medium flex items-center gap-2.5 transition-all hover:bg-[#3FCA58]/90 hover:scale-[1.02] active:scale-[0.98] ${heroPreset.primaryButton}`}
          >
            一键创作模式
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Features */}
      <section id="features" className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto pt-10 lg:pt-12 pb-20 transition-all duration-700 delay-300 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="text-center mb-14">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-3">强大功能</h2>
          <p className="text-sm text-text-secondary">从生成到编辑，一站式 AI 创作体验</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={i}
                className={`rounded-2xl p-6 transition-all duration-300 ease-out hover:scale-[1.04] origin-center will-change-transform ${
                  theme === "light"
                    ? "bg-white border border-black/[0.04] shadow-[0_10px_30px_rgba(15,23,42,0.035)] hover:border-black/[0.06] hover:shadow-[0_16px_36px_rgba(15,23,42,0.055)]"
                    : "bg-bg-secondary hover:bg-bg-hover hover:shadow-lg hover:shadow-black/20"
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${theme === "light" ? "bg-slate-50" : "bg-bg-tertiary"} ${f.iconColor}`}>
                  <Icon size={20} />
                </div>
                <h3 className="text-sm font-semibold text-text-primary mb-2">{f.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Parallax showcase */}
      <section className="relative z-10 bg-bg-primary py-20 lg:py-28 overflow-hidden">
        <div className="mx-auto max-w-3xl px-6 text-center mb-10 lg:mb-14">
          <h2 className="mb-5 text-2xl lg:text-3xl font-semibold tracking-tight text-text-primary">
            一站式创作
          </h2>
          <p className="text-xs lg:text-sm text-text-secondary leading-relaxed">
            从灵感、草图到完整视觉表达，让 Easy AI 帮你把脑海中的画面快速呈现。
          </p>
        </div>
        <div className="h-[24vh] min-h-[160px] overflow-hidden lg:h-[30vh]">
          <div
            className="h-full w-full bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage: "url('/images/home-section-person-6.jpg')",
              backgroundAttachment: "fixed",
            }}
          />
        </div>
      </section>

      {/* Models */}
      <section className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto pt-16 lg:pt-24 pb-40 lg:pb-52 transition-all duration-700 delay-400 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="text-center mb-14">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-3">模型选择</h2>
          <p className="text-sm text-text-secondary">三档算力，灵活匹配你的创作需求</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {MODELS.map((m, i) => {
            const Icon = m.icon;
            return (
              <div
                key={i}
                className={`rounded-2xl p-8 text-center transition-all duration-300 ease-out hover:scale-[1.04] origin-center will-change-transform ${
                  theme === "light"
                    ? "bg-white border border-black/[0.04] shadow-[0_10px_30px_rgba(15,23,42,0.035)] hover:border-black/[0.06] hover:shadow-[0_16px_36px_rgba(15,23,42,0.055)]"
                    : "bg-bg-secondary hover:bg-bg-hover hover:shadow-lg hover:shadow-black/20"
                }`}
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 ${theme === "light" ? "bg-slate-50" : "bg-bg-tertiary"} ${m.color}`}>
                  <Icon size={26} />
                </div>
                <h3 className="text-base font-semibold text-text-primary mb-2">{m.name}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{m.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 bg-black text-white overflow-hidden">
        <div className="relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.675] bg-cover bg-[center_28%] bg-fixed"
            style={{ backgroundImage: "url('/images/home-section-person-6.jpg')" }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/20 to-black/50" />
          <div className="relative mx-auto max-w-5xl px-6 py-8 lg:px-0">
            <div className="grid min-h-32 grid-cols-1 items-center gap-10 md:grid-cols-[1fr_1fr]">
              <div>
                <div className="mb-4 flex items-center">
                  <BrandLogo className="h-7" />
                </div>
                <p className="max-w-[220px] text-xs leading-relaxed text-white/55">
                  Easy AI产品持续优化中
                </p>
              </div>

              <div className="md:justify-self-end">
                <h3 className="mb-4 text-xs font-medium text-white/85">联系我</h3>
                <ul className="space-y-2 text-xs text-white/45">
                  <li>邮箱：15638439536@163.com</li>
                  <li>微信：15638439536</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 text-[11px] text-white/35 md:flex-row md:items-center md:justify-between">
              <span>© 2026 Easy AI. All rights reserved.</span>
              <div className="flex items-center gap-5">
                <span>HOME</span>
                <span>CANVAS</span>
                <span>DESIGN</span>
              </div>
            </div>
          </div>
        </div>
      </footer>

      <FloatingEntryWidget
        storageKey="lovart-floating-entry-home-position"
        prompt={floatingPrompt}
        onPromptChange={setFloatingPrompt}
        onFilesAdd={handleFloatingFilesAdd}
        onPreviewImageRemove={handleFloatingImageRemove}
        onAttachmentRemove={handleFloatingAttachmentRemove}
        onSubmit={handleFloatingSubmit}
        canSubmit={Boolean(String(floatingPrompt || "").trim())}
        isSubmitting={floatingIsGenerating}
        generationStage={getGenerationStageCopy(floatingGenerationStage)}
        entryMode={floatingEntryMode}
        messages={floatingMessages}
        historyItems={floatingHistory}
        previewImages={floatingRefImages}
        attachmentItems={floatingAttachments}
        onNewChat={handleFloatingNewChat}
        onSelectHistory={handleSelectFloatingHistory}
        onDeleteHistory={handleDeleteFloatingHistory}
        onDeleteMessage={handleFloatingDeleteMessage}
        onExpandFullscreen={handleExpandFullscreen}
        outputError={floatingOutputError}
        outputIdleText={
          floatingEntryMode === "agent"
            ? "你可以直接提需求、问建议，或让它帮你生成图片。"
            : "一句话说出想法，它会自动判断是给建议还是直接出图。"
        }
        submitLabel="去生成"
      />

    </div>
  );
}
