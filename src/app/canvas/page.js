"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import Canvas from "@/components/Canvas";
import ChatPanel from "@/components/ChatPanel";
import HistoryPanel from "@/components/HistoryPanel";
import TextEditBlocksPanel from "@/components/TextEditBlocksPanel";
import { ToastProvider, useToast } from "@/components/Toast";
import { compressImage } from "@/lib/imageUtils";
import { useHistory } from "@/lib/useHistory";
import { useTheme } from "@/lib/useTheme";
import { MAX_GEN_COUNT } from "@/lib/genLimits";

function errStr(e) {
  if (!e) return "未知错误";
  if (typeof e === "string") return e;
  return e.message || e.error || JSON.stringify(e);
}

function parseQuantityToken(tok) {
  if (!tok) return 0;
  const t = String(tok).trim();
  if (/^\d{1,2}$/.test(t)) {
    const n = parseInt(t, 10);
    return n >= 1 && n <= 99 ? n : 0;
  }
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (t.length === 1 && map[t] !== undefined) return map[t];
  if (t === "十") return 10;
  const m10 = t.match(/^十([一二三四五六七八九])?$/);
  if (m10) return 10 + (m10[1] ? map[m10[1]] : 0);
  const m2 = t.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/);
  if (m2) {
    return map[m2[1]] * 10 + (m2[2] ? map[m2[2]] : 0);
  }
  return 0;
}

/** 从提示词推测要出几张（如「三套」「3张」），与侧栏张数取较大值，上限 MAX_GEN_COUNT */
function inferLoopCountFromPrompt(text) {
  if (!text || typeof text !== "string") return 0;
  const compact = text.replace(/\s/g, "");
  let best = 0;
  const cnRe = /([0-9]{1,2}|[一二三四五六七八九十两]+)\s*(个)?\s*(套|张|款|组|幅|种|版|次|变|方案|版本|结果|风格)/g;
  let m;
  while ((m = cnRe.exec(compact)) !== null) {
    const n = parseQuantityToken(m[1]);
    const capped = Math.min(n, MAX_GEN_COUNT);
    if (capped >= 1) best = Math.max(best, capped);
  }
  const enRe = /\b([1-9])\s*(sets?|variants?|images?|pics?|results?|versions?|options?)\b/gi;
  let m2;
  while ((m2 = enRe.exec(text)) !== null) {
    const n = parseInt(m2[1], 10);
    if (n >= 1 && n <= MAX_GEN_COUNT) best = Math.max(best, n);
  }
  return best;
}

const STYLE_VARIANTS = ["极简清爽", "街头潮流", "科技未来", "复古海报", "手作拼贴", "高级时装"];
const MATERIAL_VARIANTS = ["纸张印刷肌理", "丝网印刷颗粒肌理", "蜡笔粉彩肌理", "塑料玩具质感", "绒面织物质感", "金属涂层质感"];
const COLOR_VARIANTS = ["高明度糖果配色", "低饱和莫兰迪配色", "高对比撞色配色", "暖色主导配色", "冷色主导配色", "黑白点缀配色"];
const LAYOUT_VARIANTS = ["居中主体构图", "偏左留白构图", "偏右留白构图", "近景特写构图", "中景平衡构图", "竖向海报构图"];
const GENERAL_VARIANTS = ["方案A：简洁干净", "方案B：细节丰富", "方案C：高对比醒目", "方案D：更时尚现代", "方案E：更活泼有趣", "方案F：更高级克制"];

function getVariantDescriptors(text, count) {
  if (count <= 1) return [];
  const compact = String(text || "").replace(/\s/g, "");
  let pool = GENERAL_VARIANTS;
  if (/材质|纹理|肌理|质感/.test(compact)) {
    pool = MATERIAL_VARIANTS;
  } else if (/配色|色系|颜色/.test(compact)) {
    pool = COLOR_VARIANTS;
  } else if (/构图|视角|机位|角度/.test(compact)) {
    pool = LAYOUT_VARIANTS;
  } else if (/风格/.test(compact)) {
    pool = STYLE_VARIANTS;
  } else if (/类型|版本|方案|结果/.test(compact)) {
    pool = GENERAL_VARIANTS;
  }

  return Array.from({ length: count }, (_, index) => pool[index % pool.length]);
}

function buildSingleResultPrompt(text, count, index = 0, variantDescriptor = "") {
  if (!text || count <= 1) return text;

  const cleaned = text
    .replace(/([给来做出整搞生成产出做成改成变成弄搞要请帮]*)\s*([0-9]{1,2}|[一二三四五六七八九十两]+)\s*(个)?\s*(套|张|款|组|幅|种|版|次|变|方案|版本|结果|风格)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const basePrompt = cleaned || text;
  return `${basePrompt}

本次变体方向：${variantDescriptor || `第 ${index + 1} 个独立方案`}

要求：
1. 本次请求只生成 1 个独立结果，不要在同一张图里放入多组、多套、多款、多版本或并排重复内容。
2. 这是第 ${index + 1} / ${count} 个结果，需要与其它结果保持明显差异，不要只是轻微改动。
3. 如果用户原本表达的是两组、三套、多个方案，含义是生成多张彼此不同的独立图片，而不是把它们拼进同一画面。
4. 单主体，单类型，单画面。no collage, no multiple subjects, no split layout, no duplicated objects.`;
}

function parseAspectRatio(imageSize) {
  if (!imageSize || imageSize === "auto") return 1;
  const [w, h] = String(imageSize).split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  return w / h;
}

const REQUEST_TIMEOUT_MS = 90000;
const MAX_PARALLEL_GENERATIONS = 1;
const STORAGE_VERSION = "9";
const DEFAULT_CONVERSATION_TITLE = "新建对话";
const TEXT_EDIT_ENABLED = false;

function createConversation(overrides = {}) {
  const now = Date.now();
  return {
    id: overrides.id || `conv-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title || DEFAULT_CONVERSATION_TITLE,
    messages: overrides.messages || [],
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

function deriveConversationTitle(currentTitle, messages) {
  const firstUserMessage = messages.find((msg) => msg.role === "user" && msg.text?.trim());
  if (firstUserMessage?.text) {
    const normalized = firstUserMessage.text.replace(/\s+/g, " ").trim();
    return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized;
  }
  return currentTitle || DEFAULT_CONVERSATION_TITLE;
}

async function makeMessagePreviewImage(img) {
  if (typeof img !== "string") {
    return img;
  }

  if (/^https?:\/\//i.test(img)) {
    return img;
  }

  if (/^data:image\//i.test(img)) {
    return compressImage(img, 160, 0.5);
  }

  return img;
}

function detectRefImageMeta(src) {
  return new Promise((resolve) => {
    if (!src || typeof src !== "string") {
      resolve({ ratio: "1:1", width: 0, height: 0, dimensionsLabel: "" });
      return;
    }

    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      const candidates = [
        [1, 1], [16, 9], [9, 16], [4, 3], [3, 4],
        [3, 2], [2, 3], [4, 5], [5, 4],
        [21, 9], [1, 4], [4, 1], [8, 1], [1, 8],
      ];
      let ratio = "1:1";
      let minDiff = Infinity;
      const currentRatio = width > 0 && height > 0 ? width / height : 1;

      for (const [w, h] of candidates) {
        const diff = Math.abs(currentRatio - w / h);
        if (diff < minDiff) {
          minDiff = diff;
          ratio = `${w}:${h}`;
        }
      }

      resolve({
        ratio,
        width,
        height,
        dimensionsLabel: width > 0 && height > 0 ? `${width} × ${height}` : "",
      });
    };
    img.onerror = () => resolve({ ratio: "1:1", width: 0, height: 0, dimensionsLabel: "" });
    img.src = src;
  });
}

function sanitizeMessagesForStorage(messages) {
  return messages.slice(0, 200).map((msg) => {
    if (!Array.isArray(msg.refImages) || msg.refImages.length === 0) {
      return msg;
    }

    return {
      ...msg,
      refImages: msg.refImages.map((img) => {
        if (typeof img !== "string") {
          return img;
        }

        if (/^https?:\/\//i.test(img)) {
          return img;
        }

        if (/^data:image\//i.test(img)) {
          // Prevent localStorage from being filled with large base64 strings.
          return "";
        }

        return img;
      }).filter(Boolean),
    };
  });
}

function sanitizeConversationsForStorage(conversations) {
  return conversations.slice(0, 50).map((conversation) => ({
    ...conversation,
    messages: sanitizeMessagesForStorage(conversation.messages || []),
  }));
}

async function parseApiResponse(res) {
  const rawText = await res.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    if (/inactivity timeout/i.test(rawText)) {
      return {
        error: "生成超时。Netlify 免费函数等待时间有限，请优先尝试 512px 或 1K 模型后重试。",
      };
    }

    if (/^\s*</.test(rawText)) {
      return {
        error: "服务暂时返回了错误页，通常是部署平台超时或上游接口异常，请稍后重试。",
      };
    }

    return {
      error: `接口返回了非 JSON 内容：${rawText.slice(0, 120)}`,
    };
  }
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const timeoutController = new AbortController();
  const timer = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  const externalSignal = options?.signal;

  const cleanup = () => {
    window.clearTimeout(timer);
  };

  const handleExternalAbort = () => timeoutController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      timeoutController.abort();
    } else {
      externalSignal.addEventListener("abort", handleExternalAbort, { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...options,
      signal: timeoutController.signal,
    });
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener("abort", handleExternalAbort);
    }
    cleanup();
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

const MODEL_LABELS = {
  "gemini-2.5-flash-image": "Nano Banana 1K",
  "gemini-2.5-flash-image-hd": "Nano Banana 1K HD",
  "gemini-3.1-flash-image-preview-512": "Nano Banana 2 512px",
  "gemini-3.1-flash-image-preview": "Nano Banana 2 1K",
  "gemini-3.1-flash-image-preview-2k": "Nano Banana 2 2K",
  "gemini-3.1-flash-image-preview-4k": "Nano Banana 2 4K",
  "gemini-3-pro-image-preview": "Pro 1K",
  "gemini-3-pro-image-preview-2k": "Pro 2K",
  "gemini-3-pro-image-preview-4k": "Pro 4K",
};

const UPSCALE_MODELS = {
  flash: {
    "1K": "gemini-2.5-flash-image-hd",
    "2K": "gemini-3.1-flash-image-preview-2k",
    "4K": "gemini-3.1-flash-image-preview-4k",
  },
  flash2: {
    "1K": "gemini-3.1-flash-image-preview",
    "2K": "gemini-3.1-flash-image-preview-2k",
    "4K": "gemini-3.1-flash-image-preview-4k",
  },
  pro: {
    "1K": "gemini-3-pro-image-preview",
    "2K": "gemini-3-pro-image-preview-2k",
    "4K": "gemini-3-pro-image-preview-4k",
  },
};

function resolveUpscaleModel(currentModel, targetSize) {
  const family = currentModel?.startsWith("gemini-3-pro-image-preview")
    ? "pro"
    : currentModel?.startsWith("gemini-3.1-flash-image-preview")
      ? "flash2"
      : "flash";
  return UPSCALE_MODELS[family]?.[targetSize] || UPSCALE_MODELS.flash2[targetSize];
}

function normalizeTextEditBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block?.text)
    .map((block, index) => {
      const bbox = block.bbox
        ? {
            x: Number(block.bbox.x || 0),
            y: Number(block.bbox.y || 0),
            w: Number(block.bbox.w || 0),
            h: Number(block.bbox.h || 0),
          }
        : null;
      const quad = Array.isArray(block.quad) && block.quad.length >= 4
        ? block.quad.map((point) => [Number(point?.[0] || 0), Number(point?.[1] || 0)])
        : bbox
          ? [
              [bbox.x, bbox.y],
              [bbox.x + bbox.w, bbox.y],
              [bbox.x + bbox.w, bbox.y + bbox.h],
              [bbox.x, bbox.y + bbox.h],
            ]
          : null;
      return {
        id: block.id || `ocr-${index}`,
        text: String(block.text || "").trim(),
        replacement: typeof block.replacement === "string" ? block.replacement : "",
        enabled: block.enabled !== false,
        bbox,
        quad,
        score: Number(block.score || 0),
        angle: Number(block.angle || 0),
        align: block.align || "center",
        font_path: block.font_path || null,
        font_size: block.font_size == null ? null : Number(block.font_size),
        font_weight: block.font_weight || "auto",
        style_name: block.style_name || "",
        fill: Array.isArray(block.fill) ? block.fill.map((value) => Number(value || 0)) : null,
        fill_confidence: Number(block.fill_confidence || 0),
        stroke_fill: Array.isArray(block.stroke_fill) ? block.stroke_fill.map((value) => Number(value || 0)) : null,
        stroke_confidence: Number(block.stroke_confidence || 0),
        stroke_width: Number(block.stroke_width || 0),
        shadow_fill: Array.isArray(block.shadow_fill) ? block.shadow_fill.map((value) => Number(value || 0)) : null,
        shadow_offset: Array.isArray(block.shadow_offset) ? block.shadow_offset.map((value) => Number(value || 0)) : null,
        line_boxes: Array.isArray(block.line_boxes) ? block.line_boxes : null,
        line_spacing: block.line_spacing == null ? null : Number(block.line_spacing),
        char_spacing: block.char_spacing == null ? null : Number(block.char_spacing),
        mask_box: block.mask_box || null,
        notes: block.notes || "",
      };
    })
    .filter((block) => block.text);
}

function getActiveTextReplacements(blocks = []) {
  return normalizeTextEditBlocks(blocks).filter((block) => {
    const replacement = String(block.replacement || "").trim();
    return block.enabled && replacement && replacement !== block.text;
  });
}

function buildTextEditPrompt(baseText, blocks = []) {
  const replacements = getActiveTextReplacements(blocks);
  if (replacements.length === 0) {
    return String(baseText || "").trim();
  }

  const header = String(baseText || "").trim()
    || "请编辑这张图中的文字，保留原有版式、字体风格、字号关系、颜色关系和整体视觉效果，只替换指定文案。";
  const instructions = replacements
    .map((block, index) => `${index + 1}. 将「${block.text}」替换为「${String(block.replacement).trim()}」`)
    .join("\n");

  return `${header}

已识别文字替换清单：
${instructions}

要求：
1. 仅修改以上指定文字，其它图形、背景、人物、装饰不要改动。
2. 尽量保持原有排版、对齐、字号层级、颜色风格与视觉权重。
3. 如果某段文字是多行排版，请继续保持合理换行。`;
}

function HomeInner() {
  const toast = useToast();
  const { theme, toggleTheme } = useTheme("dark");
  const initialConversationRef = useRef(createConversation());
  const [activeTool, setActiveTool] = useState("select");
  const [shapeMode, setShapeMode] = useState("rect");
  const [zoom, setZoom] = useState(100);
  const [prompt, setPrompt] = useState("");
  const [refImages, setRefImages] = useState([]);
  const [textEditBlocks, setTextEditBlocks] = useState([]);
  const [textEditPanelVisible, setTextEditPanelVisible] = useState(false);
  const [params, setParams] = useState({
    model: "gemini-3.1-flash-image-preview-512",
    image_size: "1:1",
    num: 1,
  });
  const setParamsClamped = useCallback((next) => {
    setParams((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      if (!resolved || typeof resolved !== "object") return resolved;
      const raw = resolved.num ?? prev.num ?? 1;
      const num = Math.min(MAX_GEN_COUNT, Math.max(1, Number(raw) || 1));
      return { ...resolved, num };
    });
  }, []);
  const [showParams, setShowParams] = useState(false);
  const [conversations, setConversations] = useState([initialConversationRef.current]);
  const [activeConversationId, setActiveConversationId] = useState(initialConversationRef.current.id);
  const canvasHistory = useHistory([]);
  const canvasImages = canvasHistory.state;
  const [canvasGeneratingItems, setCanvasGeneratingItems] = useState([]);
  const canvasTextsHistory = useHistory([]);
  const canvasTexts = canvasTextsHistory.state;
  const canvasShapesHistory = useHistory([]);
  const canvasShapes = canvasShapesHistory.state;
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedImageRect, setSelectedImageRect] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [panelWidth, setPanelWidth] = useState(340);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [historySearch, setHistorySearch] = useState("");
  const canvasRef = useRef(null);
  const generationAbortRef = useRef(null);
  const activeGenerationRef = useRef(null);
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0];
  const messages = activeConversation?.messages || [];
  const isBusy = isGenerating || isTextEditing;
  const canSubmit = Boolean(String(prompt || "").trim() || getActiveTextReplacements(textEditBlocks).length > 0);
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const floatingTextPanelWidth = 280;
  const floatingTextPanelStyle = TEXT_EDIT_ENABLED && selectedImageRect && textEditPanelVisible && textEditBlocks.length > 0
    ? (() => {
        const gap = 16;
        const canvasRightLimit = Math.max(24, viewportWidth - panelWidth - 24);
        let left = selectedImageRect.right + gap;
        if (left + floatingTextPanelWidth > canvasRightLimit) {
          left = Math.max(24, selectedImageRect.left - floatingTextPanelWidth - gap);
        }
        const top = Math.min(
          Math.max(88, selectedImageRect.top + 4),
          Math.max(88, viewportHeight - 420)
        );
        return { left, top, width: floatingTextPanelWidth };
      })()
    : null;
  const historyMessages = conversations.flatMap((conversation) =>
    (conversation.messages || []).map((message) => ({
      ...message,
      _conversationId: conversation.id,
    }))
  );

  // Load from localStorage
  useEffect(() => {
    try {
      const ver = localStorage.getItem("lovart-version");
      if (ver !== STORAGE_VERSION) {
        const legacyMessages = localStorage.getItem("lovart-messages");
        localStorage.removeItem("lovart-conversations");
        localStorage.removeItem("lovart-active-conversation");
        localStorage.removeItem("lovart-canvas-images");
        localStorage.removeItem("lovart-canvas-texts");
        localStorage.setItem("lovart-version", STORAGE_VERSION);
        if (legacyMessages) {
          const parsedMessages = JSON.parse(legacyMessages);
          const migratedConversation = createConversation({
            title: deriveConversationTitle(DEFAULT_CONVERSATION_TITLE, parsedMessages),
            messages: parsedMessages,
          });
          setConversations([migratedConversation]);
          setActiveConversationId(migratedConversation.id);
          localStorage.removeItem("lovart-messages");
        }
        return;
      }
      const saved = localStorage.getItem("lovart-conversations");
      const savedActiveConversationId = localStorage.getItem("lovart-active-conversation");
      const savedImages = localStorage.getItem("lovart-canvas-images");
      const savedTexts = localStorage.getItem("lovart-canvas-texts");
      const savedShapes = localStorage.getItem("lovart-canvas-shapes");
      if (saved) {
        const parsedConversations = JSON.parse(saved);
        if (Array.isArray(parsedConversations) && parsedConversations.length > 0) {
          setConversations(parsedConversations);
          setActiveConversationId(
            parsedConversations.some((conversation) => conversation.id === savedActiveConversationId)
              ? savedActiveConversationId
              : parsedConversations[0].id
          );
        }
      }
      if (savedImages) canvasHistory.setState(JSON.parse(savedImages));
      if (savedTexts) {
        try {
          const parsed = JSON.parse(savedTexts);
          if (Array.isArray(parsed)) canvasTextsHistory.setState(parsed);
        } catch {
          localStorage.removeItem("lovart-canvas-texts");
        }
      }
      if (savedShapes) {
        try {
          const parsed = JSON.parse(savedShapes);
          if (Array.isArray(parsed)) canvasShapesHistory.setState(parsed);
        } catch {
          localStorage.removeItem("lovart-canvas-shapes");
        }
      }
    } catch {
      localStorage.removeItem("lovart-conversations");
      localStorage.removeItem("lovart-active-conversation");
      localStorage.removeItem("lovart-canvas-images");
      localStorage.removeItem("lovart-canvas-texts");
      localStorage.removeItem("lovart-canvas-shapes");
    }
  }, []);

  useEffect(() => {
    if (!activeConversationId && conversations[0]?.id) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversationId, conversations]);

  // Persist conversations
  useEffect(() => {
    try {
      localStorage.setItem("lovart-conversations", JSON.stringify(sanitizeConversationsForStorage(conversations)));
      localStorage.setItem("lovart-active-conversation", activeConversationId || "");
    } catch {
      localStorage.removeItem("lovart-conversations");
      localStorage.removeItem("lovart-active-conversation");
    }
  }, [activeConversationId, conversations]);

  useEffect(() => {
    let cancelled = false;
    const firstRefImage = refImages?.[0];

    if (!firstRefImage) {
      setParamsClamped((prev) => ({
        ...prev,
        _autoRatio: undefined,
        _autoDimensions: undefined,
      }));
      return undefined;
    }

    void detectRefImageMeta(firstRefImage).then((meta) => {
      if (cancelled) return;
      setParamsClamped((prev) => ({
        ...prev,
        image_size: "auto",
        _autoRatio: meta.ratio,
        _autoDimensions: meta.dimensionsLabel || undefined,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [refImages, setParamsClamped]);

  useEffect(() => {
    if ((refImages?.length || 0) > 0) return;
    setTextEditBlocks([]);
  }, [refImages]);

  // Persist canvas images
  useEffect(() => {
    try {
      localStorage.setItem("lovart-canvas-images", JSON.stringify(canvasImages.slice(0, 100)));
    } catch {
      localStorage.removeItem("lovart-canvas-images");
    }
  }, [canvasImages]);

  useEffect(() => {
    try {
      localStorage.setItem("lovart-canvas-texts", JSON.stringify(canvasTexts.slice(0, 100)));
    } catch {
      localStorage.removeItem("lovart-canvas-texts");
    }
  }, [canvasTexts]);

  useEffect(() => {
    try {
      localStorage.setItem("lovart-canvas-shapes", JSON.stringify(canvasShapes.slice(0, 200)));
    } catch {
      localStorage.removeItem("lovart-canvas-shapes");
    }
  }, [canvasShapes]);

  const handleAddCanvasText = useCallback((item) => {
    canvasTextsHistory.push((prev) => [...prev, item]);
  }, [canvasTextsHistory]);

  const handleUpdateCanvasText = useCallback((id, patch) => {
    canvasTextsHistory.push((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }, [canvasTextsHistory]);

  const handleDeleteCanvasText = useCallback((id) => {
    canvasTextsHistory.push((prev) => prev.filter((t) => t.id !== id));
    toast("已删除文案", "info", 1200);
  }, [canvasTextsHistory, toast]);

  const handleAddCanvasShape = useCallback((item) => {
    canvasShapesHistory.push((prev) => [...prev, item]);
  }, [canvasShapesHistory]);

  const handleUpdateCanvasShape = useCallback((id, patch) => {
    canvasShapesHistory.push((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  }, [canvasShapesHistory]);

  const handleDeleteCanvasShape = useCallback((id) => {
    canvasShapesHistory.push((prev) => prev.filter((s) => s.id !== id));
    toast("已删除形状", "info", 1200);
  }, [canvasShapesHistory, toast]);

  const updateConversationMessages = useCallback((conversationId, updater) => {
    setConversations((prev) => prev.map((conversation) => {
      if (conversation.id !== conversationId) {
        return conversation;
      }
      const nextMessages = typeof updater === "function"
        ? updater(conversation.messages || [])
        : updater;
      return {
        ...conversation,
        messages: nextMessages,
        title: deriveConversationTitle(conversation.title, nextMessages),
        updatedAt: Date.now(),
      };
    }));
  }, []);

  const updateMessage = useCallback((conversationId, messageId, updates) => {
    updateConversationMessages(conversationId, (prev) =>
      prev.map((message) => (message.id === messageId ? { ...message, ...updates } : message))
    );
  }, [updateConversationMessages]);

  const patchTask = useCallback((conversationId, aiMsgId, taskId, patch) => {
    updateConversationMessages(conversationId, (prev) =>
      prev.map((m) => {
        if (m.id !== aiMsgId || !m.tasks) return m;
        const tasks = m.tasks.map((t) =>
          t.id === taskId ? { ...t, ...patch } : t
        );
        const urls = tasks.filter((t) => t.url).map((t) => t.url);
        return { ...m, tasks, urls };
      })
    );
  }, [updateConversationMessages]);

  const resetComposer = useCallback(() => {
    setPrompt("");
    setRefImages([]);
    setTextEditBlocks([]);
    setTextEditPanelVisible(false);
    setShowParams(false);
    setSelectedImage(null);
    canvasSelectionUrlsRef.current = [];
  }, []);

  const handleGenerate = useCallback(async (retryPayload = null) => {
    const sourceText = retryPayload?.text ?? prompt;
    const effectiveTextEditBlocks = retryPayload?.textEditBlocks || textEditBlocks;
    const composerText = String(sourceText || "").trim();
    const text = buildTextEditPrompt(composerText, effectiveTextEditBlocks);
    const effectiveParams = retryPayload?.params || params;
    const effectiveRefImages = retryPayload?.refImages || refImages;
    const preserveComposer = Boolean(retryPayload?.preserveComposer);
    const hidePlaceholderPrompt = Boolean(retryPayload?.hidePlaceholderPrompt);
    const editMode = retryPayload?.editMode || null;
    if (!text || isBusy || !activeConversationId) return;

    const ts = Date.now();
    const conversationId = activeConversationId;
    const userMsgId = "user-" + ts;
    const aiMsgId = "ai-" + ts;
    const modelLabel = MODEL_LABELS[effectiveParams.model] || effectiveParams.model;
    const hasImages = effectiveRefImages.length > 0;

    const messageRefImages = hasImages
      ? await Promise.all(effectiveRefImages.map((img) => makeMessagePreviewImage(img)))
      : [];

    const inferred = inferLoopCountFromPrompt(composerText);
    const count = Math.min(
      Math.max(Math.max(effectiveParams.num || 1, inferred), 1),
      MAX_GEN_COUNT
    );
    const variantDescriptors = getVariantDescriptors(composerText || text, count);
    const genParams = { ...effectiveParams, num: count };
    const displayText = composerText || "请按识别到的文本替换规则编辑图片中的文字";

    const userMsg = {
      id: userMsgId,
      role: "user",
      text: displayText,
      params: genParams,
      modelLabel,
      refImages: messageRefImages,
      textEditBlocks: effectiveTextEditBlocks,
    };
    const tasks = Array.from({ length: count }, (_, i) => ({
      id: `${aiMsgId}-task-${i}`,
      index: i,
      status: "pending",
      url: null,
      error: null,
    }));
    const aiMsg = {
      id: aiMsgId,
      role: "assistant",
      text: displayText,
      params: genParams,
      modelLabel,
      status: "generating",
      tasks,
      urls: [],
      error: null,
    };

    updateConversationMessages(conversationId, (prev) => [...prev, userMsg, aiMsg]);
    setIsGenerating(true);
    if (!preserveComposer) {
      setPrompt("");
    }

    try {
      const requestController = new AbortController();
      generationAbortRef.current = requestController;
      activeGenerationRef.current = {
        conversationId,
        aiMsgId,
        controller: requestController,
        cancelled: false,
      };
      const preparedImages = await Promise.all(
        effectiveRefImages.map((img) => {
          if (typeof img !== "string") {
            return img;
          }
          if (/^https?:\/\//i.test(img)) {
            return img;
          }
          if (/^data:image\//i.test(img)) {
            return compressImage(img, 768, 0.68);
          }
          return img;
        })
      );

      const imageSize =
        effectiveParams.image_size === "auto"
          ? (effectiveParams._autoRatio || "1:1")
          : effectiveParams.image_size;
      const placeholderAspectRatio = parseAspectRatio(imageSize);
      const imagePayload =
        preparedImages.length === 1 ? preparedImages[0] : preparedImages;

      setCanvasGeneratingItems((prev) => [
        ...prev,
        ...tasks.map((task) => ({
          id: `${aiMsgId}-${task.id}`,
          aiMsgId,
          taskId: task.id,
          slotIndex: task.index,
          totalCount: count,
          prompt: displayText,
          hidePromptText: hidePlaceholderPrompt,
          isGeneratingPlaceholder: true,
          generationStatus: "pending",
          placeholderAspectRatio,
        })),
      ]);

      const taskResults = await runWithConcurrency(
        tasks,
        Math.min(MAX_PARALLEL_GENERATIONS, count),
        async (task) => {
          if (
            activeGenerationRef.current?.conversationId !== conversationId ||
            activeGenerationRef.current?.aiMsgId !== aiMsgId ||
            activeGenerationRef.current?.cancelled
          ) {
            return { status: "cancelled" };
          }

          const taskId = task.id;
          const canvasItemId = `${aiMsgId}-${taskId}`;
          const requestPrompt = buildSingleResultPrompt(
            text,
            count,
            task.index,
            variantDescriptors[task.index] || ""
          );
          patchTask(conversationId, aiMsgId, taskId, { status: "generating" });
          setCanvasGeneratingItems((prev) =>
            prev.map((item) =>
              item.id === canvasItemId
                ? { ...item, generationStatus: "generating" }
                : item
            )
          );

          try {
            let res;
            if (hasImages) {
              res = await fetchWithTimeout("/api/edit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: requestController.signal,
                body: JSON.stringify({
                  prompt: requestPrompt,
                  image: imagePayload,
                  model: effectiveParams.model,
                  image_size: imageSize,
                  num: 1,
                  mode: editMode,
                }),
              });
            } else {
              res = await fetchWithTimeout("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: requestController.signal,
                body: JSON.stringify({
                  prompt: requestPrompt,
                  model: effectiveParams.model,
                  image_size: imageSize,
                  num: 1,
                }),
              });
            }

            const data = await parseApiResponse(res);
            if (
              activeGenerationRef.current?.conversationId !== conversationId ||
              activeGenerationRef.current?.aiMsgId !== aiMsgId ||
              activeGenerationRef.current?.cancelled
            ) {
              return { status: "cancelled" };
            }

            if (!res.ok || data.error) {
              patchTask(conversationId, aiMsgId, taskId, {
                status: "failed",
                error: errStr(data.error || `请求失败（${res.status}）`),
              });
              setCanvasGeneratingItems((prev) =>
                prev.filter((item) => item.id !== canvasItemId)
              );
              return { status: "failed" };
            }

            const urls = data.data?.urls || [];
            const url = urls[0];
            if (!url) {
              patchTask(conversationId, aiMsgId, taskId, {
                status: "failed",
                error: "未返回图片",
              });
              setCanvasGeneratingItems((prev) =>
                prev.filter((item) => item.id !== canvasItemId)
              );
              return { status: "failed" };
            }

            patchTask(conversationId, aiMsgId, taskId, {
              status: "completed",
              url,
              error: null,
            });
            setCanvasGeneratingItems((prev) =>
              prev.filter((item) => item.id !== canvasItemId)
            );
            canvasHistory.push((prev) => [
              ...prev,
              {
                id: canvasItemId,
                image_url: url,
                prompt: displayText,
              },
            ]);
            return { status: "completed" };
          } catch (err) {
            if (
              activeGenerationRef.current?.conversationId !== conversationId ||
              activeGenerationRef.current?.aiMsgId !== aiMsgId
            ) {
              return { status: "cancelled" };
            }
            if (err?.name === "AbortError") {
              if (!activeGenerationRef.current?.cancelled) {
                patchTask(conversationId, aiMsgId, taskId, {
                  status: "failed",
                  error: "请求超时。可稍后重试，或减少张数以降低排队压力。",
                });
                setCanvasGeneratingItems((prev) =>
                  prev.filter((item) => item.id !== canvasItemId)
                );
                return { status: "failed" };
              }
              setCanvasGeneratingItems((prev) =>
                prev.filter((item) => item.id !== canvasItemId)
              );
              return { status: "cancelled" };
            }
            patchTask(conversationId, aiMsgId, taskId, {
              status: "failed",
              error: errStr(err),
            });
            setCanvasGeneratingItems((prev) =>
              prev.filter((item) => item.id !== canvasItemId)
            );
            return { status: "failed" };
          }
        }
      );

      const successCount = taskResults.reduce((acc, result) => (
        result?.status === "completed" ? acc + 1 : acc
      ), 0);

      if (
        activeGenerationRef.current?.conversationId === conversationId &&
        activeGenerationRef.current?.aiMsgId === aiMsgId &&
        !activeGenerationRef.current?.cancelled
      ) {
        updateMessage(conversationId, aiMsgId, {
          status: successCount > 0 ? "completed" : "failed",
          error: successCount === 0 ? "全部任务失败" : null,
        });
        toast(
          successCount > 0
            ? `生成完成，${successCount}/${count} 张已添加到画布`
            : `生成结束，0/${count} 张成功`,
          successCount > 0 ? "success" : "info",
          2200
        );
      }

      if (!preserveComposer) {
        setRefImages([]);
      }
    } catch (err) {
      if (
        activeGenerationRef.current?.conversationId === conversationId &&
        activeGenerationRef.current?.aiMsgId === aiMsgId &&
        activeGenerationRef.current?.cancelled
      ) {
        return;
      }
      const msg = errStr(err);
      updateConversationMessages(conversationId, (prev) =>
        prev.map((m) => {
          if (m.id !== aiMsgId) return m;
          if (!m.tasks?.length) {
            return { ...m, status: "failed", error: msg };
          }
          return {
            ...m,
            status: "failed",
            error: msg,
            tasks: m.tasks.map((t) =>
              t.status === "completed"
                ? t
                : { ...t, status: "failed", error: msg }
            ),
          };
        })
      );
    } finally {
      setCanvasGeneratingItems((prev) =>
        prev.filter((item) => item.aiMsgId !== aiMsgId)
      );
      if (
        activeGenerationRef.current?.conversationId === conversationId &&
        activeGenerationRef.current?.aiMsgId === aiMsgId
      ) {
        activeGenerationRef.current = null;
      }
      generationAbortRef.current = null;
      setIsGenerating(false);
    }
  }, [
    prompt,
    isBusy,
    activeConversationId,
    params,
    refImages,
    textEditBlocks,
    updateMessage,
    updateConversationMessages,
    patchTask,
    canvasHistory,
    toast,
  ]);

  const handlePauseGenerate = useCallback(() => {
    const currentTask = activeGenerationRef.current;
    if (!currentTask) return;

    const { conversationId, aiMsgId, controller } = currentTask;
    currentTask.cancelled = true;

    updateConversationMessages(conversationId, (prev) =>
      prev.map((m) => {
        if (m.id !== aiMsgId) return m;
        if (m.tasks?.length) {
          const tasks = m.tasks.map((t) =>
            t.status === "pending" || t.status === "generating"
              ? { ...t, status: "failed", error: "已暂停" }
              : t
          );
          const urls = tasks.filter((t) => t.url).map((t) => t.url);
          return {
            ...m,
            tasks,
            urls,
            status: "paused",
            error: "已手动暂停",
          };
        }
        return { ...m, status: "paused", error: "已手动暂停" };
      })
    );
    setIsGenerating(false);
    setCanvasGeneratingItems((prev) =>
      prev.filter((item) => item.aiMsgId !== aiMsgId)
    );
    generationAbortRef.current = null;
    controller.abort();
    toast("已暂停当前生成", "info", 1500);
  }, [toast, updateConversationMessages]);

  const handleDeleteImage = useCallback((id) => {
    canvasHistory.push((prev) => prev.filter((img) => img.id !== id));
    setSelectedImage((prev) => (prev?.id === id ? null : prev));
    toast("已删除", "info", 1200);
  }, [canvasHistory, toast]);

  const handleSendToChat = useCallback((img) => {
    if (img?.image_url) {
      setRefImages((prev) => [...prev, img.image_url]);
      toast("已发送到对话", "success", 1500);
    }
  }, [toast]);

  const handleTextEditBlocksChange = useCallback((next) => {
    setTextEditBlocks((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      return normalizeTextEditBlocks(resolved);
    });
  }, []);

  const handleCancelTextEditPanel = useCallback(() => {
    setTextEditBlocks([]);
    setTextEditPanelVisible(false);
    toast("已取消文字编辑", "info", 1200);
  }, [toast]);

  const handleApplyTextEditPanel = useCallback(async (nextBlocks) => {
    const normalizedBlocks = normalizeTextEditBlocks(nextBlocks);
    const activeReplacements = getActiveTextReplacements(normalizedBlocks);
    if (activeReplacements.length === 0) {
      toast("请至少填写一条要替换的文案", "info", 1500);
      return;
    }
    if (isBusy) {
      toast("当前有任务进行中，请稍候再试", "info", 1500);
      return;
    }
    if (!activeConversationId) {
      toast("当前没有可用对话", "info", 1500);
      return;
    }

    const sourceImage = selectedImage?.image_url || refImages[0];
    if (!sourceImage) {
      toast("未找到要编辑的参考图", "info", 1500);
      return;
    }

    const displayText = String(prompt || "").trim() || "请替换这张图中的指定文字，并保持原尺寸、原版式与原视觉风格。";
    const ts = Date.now();
    const conversationId = activeConversationId;
    const userMsgId = `user-text-edit-${ts}`;
    const aiMsgId = `ai-text-edit-${ts}`;
    let previewImage = sourceImage;
    try {
      previewImage = await makeMessagePreviewImage(sourceImage);
    } catch {
      previewImage = sourceImage;
    }
    const sharedParams = {
      model: "python-text-edit",
      image_size: "原尺寸",
      num: 1,
    };
    const userMsg = {
      id: userMsgId,
      role: "user",
      text: displayText,
      params: sharedParams,
      modelLabel: "Python Text Edit",
      refImages: previewImage ? [previewImage] : [],
      textEditBlocks: normalizedBlocks,
    };
    const aiMsg = {
      id: aiMsgId,
      role: "assistant",
      text: "本地文字替换结果",
      params: sharedParams,
      modelLabel: "Python Text Edit",
      status: "generating",
      urls: [],
      error: null,
    };

    setTextEditBlocks(normalizedBlocks);
    setTextEditPanelVisible(false);
    updateConversationMessages(conversationId, (prev) => [...prev, userMsg, aiMsg]);
    setIsTextEditing(true);

    try {
      const res = await fetchWithTimeout("/api/text-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: sourceImage,
          blocks: normalizedBlocks,
          lang: "en",
        }),
      }, 10 * 60 * 1000);
      const data = await parseApiResponse(res);
      if (!res.ok || data.error) {
        throw new Error(errStr(data.error || `文字替换失败（${res.status}）`));
      }

      const urls = Array.isArray(data.data?.urls) ? data.data.urls.filter(Boolean) : [];
      if (urls.length === 0) {
        throw new Error("文字替换未返回结果图片");
      }

      updateMessage(conversationId, aiMsgId, {
        status: "completed",
        urls,
        error: null,
      });

      canvasHistory.push((prev) => [
        ...prev,
        ...urls.map((url, index) => ({
          id: `${aiMsgId}-${index}`,
          image_url: url,
          prompt: displayText,
        })),
      ]);
      toast(`文字替换完成，${urls.length} 张结果已添加到画布`, "success", 2200);
    } catch (err) {
      updateMessage(conversationId, aiMsgId, {
        status: "failed",
        error: errStr(err),
      });
      toast(errStr(err) || "文字替换失败", "info", 2200);
    } finally {
      setIsTextEditing(false);
    }
  }, [
    activeConversationId,
    canvasHistory,
    isBusy,
    prompt,
    refImages,
    selectedImage,
    toast,
    updateConversationMessages,
    updateMessage,
  ]);

  const handleSelectedImageRectChange = useCallback((nextRect) => {
    setSelectedImageRect((prev) => {
      if (!nextRect && !prev) return prev;
      if (!nextRect) return null;
      if (
        prev
        && prev.left === nextRect.left
        && prev.top === nextRect.top
        && prev.right === nextRect.right
        && prev.bottom === nextRect.bottom
        && prev.width === nextRect.width
        && prev.height === nextRect.height
      ) {
        return prev;
      }
      return nextRect;
    });
  }, []);

  const handleQuickEditImage = useCallback(async (actionId, img) => {
    if (!img?.image_url) return;

    if (actionId === "cutout") {
      if (isBusy) {
        toast("当前有任务进行中，请稍候再试", "info", 1500);
        return;
      }

      const meta = await detectRefImageMeta(img.image_url);
      setSelectedImage(img);
      setTextEditBlocks([]);
      setTextEditPanelVisible(false);
      await handleGenerate({
        text: "请基于这张参考图进行专业抠图，完整保留主体，去除背景，输出干净透明背景效果，不要改变主体造型与细节，不要新增元素。",
        params: {
          ...params,
          image_size: "auto",
          _autoRatio: meta.ratio,
          _autoDimensions: meta.dimensionsLabel || undefined,
          num: 1,
        },
        refImages: [img.image_url],
        preserveComposer: true,
        hidePlaceholderPrompt: true,
        editMode: "cutout",
      });
      return;
    }

    if (actionId === "editText") {
      if (!TEXT_EDIT_ENABLED) {
        setTextEditBlocks([]);
        setTextEditPanelVisible(false);
        toast("编辑文字功能已暂时停用", "info", 1800);
        return;
      }
      if (isBusy) {
        toast("当前有任务进行中，请稍候再试", "info", 1500);
        return;
      }
      setSelectedImage(img);
      setRefImages((prev) => {
        if (prev.includes(img.image_url)) return prev;
        return [...prev, img.image_url];
      });
      toast("正在识别图片文字...", "info", 1200);

      try {
        const res = await fetchWithTimeout("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: img.image_url }),
        }, 120000);
        const data = await parseApiResponse(res);
        if (!res.ok || data.error) {
          throw new Error(errStr(data.error || `OCR 请求失败（${res.status}）`));
        }

        const blocks = Array.isArray(data.data?.blocks) ? data.data.blocks : [];
        const normalizedBlocks = normalizeTextEditBlocks(
          blocks.map((block) => ({
            ...block,
            replacement: "",
            enabled: true,
          }))
        );
        const recognizedLines = blocks
          .map((block, index) => `${index + 1}. ${block.text}`)
          .slice(0, 20);
        setTextEditBlocks(normalizedBlocks);
        setTextEditPanelVisible(normalizedBlocks.length > 0);

        const nextPrompt = recognizedLines.length > 0
          ? "请基于这张参考图编辑其中的文字，保留原有版式、层级、字体风格、颜色关系与视觉效果，只替换我指定的文案内容。"
          : "请基于这张参考图编辑其中的文字，保留原有版式与视觉风格，只修改文字相关内容。当前未识别到明确文字，请按图片内容继续编辑。";

        setPrompt(nextPrompt);
        toast(
          recognizedLines.length > 0
            ? `已识别 ${recognizedLines.length} 段文字`
            : "未识别到明确文字，已填入通用编辑指令",
          "success",
          1800
        );
      } catch (err) {
        setTextEditBlocks([]);
        setTextEditPanelVisible(false);
        setPrompt("请基于这张参考图编辑其中的文字，保留原有版式与视觉风格，只修改文字相关内容。");
        toast(errStr(err) || "文字识别失败，已回退到通用编辑指令", "info", 2200);
      }
      return;
    }

    const promptMap = {
    };
    const nextPrompt = promptMap[actionId];
    if (!nextPrompt) return;

    setRefImages((prev) => {
      if (prev.includes(img.image_url)) return prev;
      return [...prev, img.image_url];
    });
    setTextEditBlocks([]);
    setTextEditPanelVisible(false);
    setSelectedImage(img);
    setPrompt(nextPrompt);
    toast("已填入快捷编辑指令", "success", 1500);
  }, [handleGenerate, isBusy, params, toast]);

  const handleQuickUpscaleImage = useCallback(async (targetSize, img) => {
    if (!img?.image_url || !targetSize) return;
    if (isBusy) {
      toast("当前有任务进行中，请稍候再试", "info", 1500);
      return;
    }

    const meta = await detectRefImageMeta(img.image_url);
    const model = resolveUpscaleModel(params.model, targetSize);
    setTextEditBlocks([]);
    setTextEditPanelVisible(false);
    await handleGenerate({
      text: `请基于这张参考图做高清放大与细节增强，直接输出 ${targetSize} 高分辨率版本，保持主体、构图、文字内容与风格一致，不要改图，不要新增元素。`,
      params: {
        ...params,
        model,
        image_size: "auto",
        _autoRatio: meta.ratio,
        _autoDimensions: meta.dimensionsLabel || undefined,
        num: 1,
      },
      refImages: [img.image_url],
      preserveComposer: true,
    });
  }, [handleGenerate, isBusy, params, toast]);

  const handleUpdateImage = useCallback(() => {}, []);

  /** 由画布选中同步到右侧参考图的 URL 列表（单选 / 框选多图） */
  const canvasSelectionUrlsRef = useRef([]);

  const handleSelectImage = useCallback((img) => {
    if (!img?.image_url) {
      const toRemove = [...canvasSelectionUrlsRef.current];
      canvasSelectionUrlsRef.current = [];
      setSelectedImage(null);
      setTextEditPanelVisible(false);
      setRefImages((prev) =>
        prev.filter((u) => !toRemove.includes(u))
      );
      return;
    }
    const prevCanvasUrls = [...canvasSelectionUrlsRef.current];
    canvasSelectionUrlsRef.current = [img.image_url];
    setRefImages((prev) => {
      const withoutCanvas = prev.filter((u) => !prevCanvasUrls.includes(u));
      const seen = new Set(withoutCanvas);
      if (!seen.has(img.image_url)) {
        return [...withoutCanvas, img.image_url];
      }
      return withoutCanvas;
    });
    setSelectedImage(img);
  }, []);

  /** 框选多张画布图片时，批量同步到右侧参考图（与模型最大参考图数量对齐） */
  const MAX_REF_IMAGES = 14;
  const handleSyncCanvasRefImages = useCallback((urls) => {
    const list = (urls || []).filter(Boolean);
    if (list.length < 2) return;
    const prevCanvasUrls = [...canvasSelectionUrlsRef.current];
    canvasSelectionUrlsRef.current = [...list];
    setTextEditPanelVisible(false);
    setRefImages((prev) => {
      const withoutCanvas = prev.filter((u) => !prevCanvasUrls.includes(u));
      const merged = [...withoutCanvas];
      for (const u of list) {
        if (merged.length >= MAX_REF_IMAGES) break;
        if (u && !merged.includes(u)) merged.push(u);
      }
      return merged;
    });
    toast("已同步到右侧参考图", "success", 1500);
  }, [toast]);

  const handleZoomChange = useCallback((updater) => {
    setZoom((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  // Drop image files onto canvas → convert to data URL → add as canvas items
  const handleDropImages = useCallback((files, dropX, dropY) => {
    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const id = `drop-${Date.now()}-${i}`;
        const newImg = { id, image_url: dataUrl, prompt: file.name };
        canvasHistory.push((prev) => [...prev, newImg]);
      };
      reader.readAsDataURL(file);
    });
    toast(`已添加 ${files.length} 张图片到画布`, "success");
  }, [canvasHistory, toast]);

  const handleDropGeneratedImage = useCallback((item, dropX, dropY) => {
    if (!item?.url) return;
    const newImg = {
      id: `chat-drop-${Date.now()}`,
      image_url: item.url,
      prompt: item.prompt || "拖入图片",
    };
    canvasHistory.push((prev) => [...prev, newImg]);
    toast("已添加到画布", "success", 1200);
  }, [canvasHistory, toast]);

  /** 画布内复制后粘贴（Ctrl/Cmd+V），或与系统剪贴板图片合并 */
  const handlePasteCanvasImages = useCallback(
    (items) => {
      if (!items?.length) return;
      const ts = Date.now();
      canvasHistory.push((prev) => [
        ...prev,
        ...items.map((it, i) => ({
          id: `paste-${ts}-${i}`,
          image_url: it.image_url,
          prompt: (it.prompt && String(it.prompt).trim()) || "粘贴",
        })),
      ]);
      toast(`已粘贴 ${items.length} 张图片`, "success", 1500);
    },
    [canvasHistory, toast]
  );

  const handleRetry = useCallback((msg) => {
    const messageIndex = messages.findIndex((item) => item.id === msg.id);
    const previousUserMessage = messageIndex >= 0
      ? [...messages.slice(0, messageIndex)].reverse().find((item) => item.role === "user")
      : null;
    const retryText = msg.text?.trim() || previousUserMessage?.text?.trim() || "";
    const retryParams = msg.params || previousUserMessage?.params || params;
    const retryRefImages = previousUserMessage?.refImages || [];
    const retryTextEditBlocks = previousUserMessage?.textEditBlocks || [];

    if (!retryText) {
      toast("未找到可重试的提示词", "info", 1500);
      return;
    }

    setPrompt(retryText);
    setParamsClamped(retryParams);
    setRefImages(retryRefImages);
    setTextEditBlocks(normalizeTextEditBlocks(retryTextEditBlocks));
  }, [messages, params, setParamsClamped, toast]);

  const handleDownload = useCallback(async (msg) => {
    const url = msg.image_url;
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `image-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      toast("已下载", "success", 1200);
    } catch {
      window.open(url, "_blank");
    }
  }, [toast]);

  const handleImageClick = useCallback((msg) => {
    setSelectedImage(msg);
  }, []);

  // History panel: click an item → fill prompt with that text
  const handleSelectHistory = useCallback((msg) => {
    if (msg._conversationId) {
      setActiveConversationId(msg._conversationId);
    }
    if (msg.text) setPrompt(msg.text);
    if (msg.params) setParamsClamped(msg.params);
    setTextEditBlocks(normalizeTextEditBlocks(msg.textEditBlocks || []));
    toast("已载入历史提示词", "info", 1200);
  }, [toast, setParamsClamped]);

  const handleClearHistory = useCallback(() => {
    setConversations((prev) => prev.map((conversation) => ({
      ...conversation,
      title: DEFAULT_CONVERSATION_TITLE,
      messages: [],
      updatedAt: Date.now(),
    })));
    localStorage.removeItem("lovart-conversations");
    localStorage.removeItem("lovart-active-conversation");
    toast("历史记录已清空", "info", 1500);
  }, [toast]);

  const handleNewConversation = useCallback(() => {
    if (isBusy) {
      toast("生成过程中暂时不能切换对话", "info", 1500);
      return;
    }
    const nextConversation = createConversation();
    setConversations((prev) => [nextConversation, ...prev]);
    setActiveConversationId(nextConversation.id);
    resetComposer();
  }, [isBusy, resetComposer, toast]);

  const handleSelectConversation = useCallback((conversationId) => {
    if (isBusy) {
      toast("生成过程中暂时不能切换对话", "info", 1500);
      return;
    }
    setActiveConversationId(conversationId);
    resetComposer();
  }, [isBusy, resetComposer, toast]);

  const handleDeleteConversation = useCallback((conversationId) => {
    if (isBusy) {
      toast("生成过程中暂时不能删除对话", "info", 1500);
      return;
    }

    setConversations((prev) => {
      if (prev.length <= 1) {
        const nextConversation = createConversation();
        setActiveConversationId(nextConversation.id);
        resetComposer();
        return [nextConversation];
      }

      const remaining = prev.filter((conversation) => conversation.id !== conversationId);
      if (activeConversationId === conversationId) {
        setActiveConversationId(remaining[0]?.id || "");
        resetComposer();
      }
      return remaining;
    });

    toast("对话已删除", "info", 1200);
  }, [activeConversationId, isBusy, resetComposer, toast]);

  const handleDeleteMessage = useCallback((messageId) => {
    if (isBusy) {
      toast("生成过程中暂时不能删除记录", "info", 1500);
      return;
    }
    if (!activeConversationId) {
      return;
    }

    updateConversationMessages(activeConversationId, (prev) => prev.filter((message) => message.id !== messageId));
    toast("记录已删除", "info", 1200);
  }, [activeConversationId, isBusy, toast, updateConversationMessages]);

  const historyWidth = historyCollapsed ? 40 : 220;

  return (
    <div className="h-screen flex overflow-hidden">
      <Link
        href="/"
        className="absolute top-3 z-30 flex items-center gap-2.5 px-3 py-2 rounded-2xl bg-bg-secondary/90 backdrop-blur-xl border border-border-primary hover:bg-bg-hover transition-all"
        style={{ left: historyWidth + 8 }}
        title="返回首页"
      >
        <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center">
          <span className="text-white text-sm font-bold leading-none">E</span>
        </div>
        <span className="text-lg font-semibold text-text-primary tracking-tight">Easy AI</span>
      </Link>
      <HistoryPanel
        messages={historyMessages}
        onSelectHistory={handleSelectHistory}
        onClearHistory={handleClearHistory}
        collapsed={historyCollapsed}
        onCollapsedChange={setHistoryCollapsed}
        search={historySearch}
        onSearchChange={setHistorySearch}
      />
      <Canvas
        ref={canvasRef}
        images={canvasImages}
        generatingItems={canvasGeneratingItems}
        selectedImage={selectedImage}
        onSelectImage={handleSelectImage}
        onDeleteImage={handleDeleteImage}
        onUpdateImage={handleUpdateImage}
        onSendToChat={handleSendToChat}
        onQuickEditImage={handleQuickEditImage}
        onQuickUpscaleImage={handleQuickUpscaleImage}
        onDropImages={handleDropImages}
        onDropGeneratedImage={handleDropGeneratedImage}
        onPasteImages={handlePasteCanvasImages}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        zoom={zoom}
        onZoomChange={handleZoomChange}
        textItems={canvasTexts}
        onAddText={handleAddCanvasText}
        onUpdateText={handleUpdateCanvasText}
        onDeleteText={handleDeleteCanvasText}
        shapeItems={canvasShapes}
        onAddShape={handleAddCanvasShape}
        onUpdateShape={handleUpdateCanvasShape}
        onDeleteShape={handleDeleteCanvasShape}
        shapeMode={shapeMode}
        onShapeModeChange={setShapeMode}
        onSyncCanvasRefImages={handleSyncCanvasRefImages}
        onSelectedImageRectChange={handleSelectedImageRectChange}
      />
      {TEXT_EDIT_ENABLED && floatingTextPanelStyle && (
        <div
          className="fixed z-30"
          style={floatingTextPanelStyle}
        >
          <TextEditBlocksPanel
            blocks={textEditBlocks}
            onChange={handleTextEditBlocksChange}
            onCancel={handleCancelTextEditPanel}
            onApply={handleApplyTextEditPanel}
            title="编辑文字"
            subtitle="填写替换内容后，可直接取消或立即发送修改"
            applyLabel="立即使用"
            isApplying={isTextEditing}
          />
        </div>
      )}
      <ChatPanel
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onDeleteMessage={handleDeleteMessage}
        messages={messages}
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={handleGenerate}
        canSubmit={canSubmit}
        isGenerating={isBusy}
        params={params}
        onParamsChange={setParamsClamped}
        showParams={showParams}
        onToggleParams={() => setShowParams(!showParams)}
        refImages={refImages}
        onRefImagesChange={setRefImages}
        textEditBlocks={textEditBlocks}
        onTextEditBlocksChange={handleTextEditBlocksChange}
        showTextEditPanelInline={false}
        onRetry={handleRetry}
        onDownload={handleDownload}
        onImageClick={handleImageClick}
        onPauseGenerate={handlePauseGenerate}
        theme={theme}
        onToggleTheme={toggleTheme}
        width={panelWidth}
        onWidthChange={setPanelWidth}
      />
    </div>
  );
}

export default function Home() {
  return (
    <ToastProvider>
      <HomeInner />
    </ToastProvider>
  );
}
