"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import Canvas from "@/components/Canvas";
import ChatPanel from "@/components/ChatPanel";
import HistoryPanel from "@/components/HistoryPanel";
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
  const cnRe = /([0-9]{1,2}|[一二三四五六七八九十两]+)(套|张|款|组|幅|种|版|次|变)/g;
  let m;
  while ((m = cnRe.exec(compact)) !== null) {
    const n = parseQuantityToken(m[1]);
    const capped = Math.min(n, MAX_GEN_COUNT);
    if (capped >= 1) best = Math.max(best, capped);
  }
  const enRe = /\b([1-9])\s*(sets?|variants?|images?|pics?)\b/gi;
  let m2;
  while ((m2 = enRe.exec(text)) !== null) {
    const n = parseInt(m2[1], 10);
    if (n >= 1 && n <= MAX_GEN_COUNT) best = Math.max(best, n);
  }
  return best;
}

const REQUEST_TIMEOUT_MS = 55000;
const STORAGE_VERSION = "9";
const DEFAULT_CONVERSATION_TITLE = "新建对话";

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

function HomeInner() {
  const toast = useToast();
  const { theme, toggleTheme } = useTheme("dark");
  const initialConversationRef = useRef(createConversation());
  const [activeTool, setActiveTool] = useState("select");
  const [shapeMode, setShapeMode] = useState("rect");
  const [zoom, setZoom] = useState(100);
  const [prompt, setPrompt] = useState("");
  const [refImages, setRefImages] = useState([]);
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
  const canvasTextsHistory = useHistory([]);
  const canvasTexts = canvasTextsHistory.state;
  const canvasShapesHistory = useHistory([]);
  const canvasShapes = canvasShapesHistory.state;
  const [selectedImage, setSelectedImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [panelWidth, setPanelWidth] = useState(340);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [historySearch, setHistorySearch] = useState("");
  const canvasRef = useRef(null);
  const generationAbortRef = useRef(null);
  const activeGenerationRef = useRef(null);
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0];
  const messages = activeConversation?.messages || [];
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
    setShowParams(false);
    setSelectedImage(null);
    canvasSelectionUrlsRef.current = [];
  }, []);

  const handleGenerate = useCallback(async () => {
    const text = prompt.trim();
    if (!text || isGenerating || !activeConversationId) return;

    const ts = Date.now();
    const conversationId = activeConversationId;
    const userMsgId = "user-" + ts;
    const aiMsgId = "ai-" + ts;
    const modelLabel = MODEL_LABELS[params.model] || params.model;
    const hasImages = refImages.length > 0;

    const messageRefImages = hasImages
      ? await Promise.all(refImages.map((img) => makeMessagePreviewImage(img)))
      : [];

    const inferred = inferLoopCountFromPrompt(text);
    const count = Math.min(
      Math.max(Math.max(params.num || 1, inferred), 1),
      MAX_GEN_COUNT
    );
    const genParams = { ...params, num: count };

    const userMsg = {
      id: userMsgId,
      role: "user",
      text,
      params: genParams,
      modelLabel,
      refImages: messageRefImages,
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
      text: "",
      params: genParams,
      modelLabel,
      status: "generating",
      tasks,
      urls: [],
      error: null,
    };

    updateConversationMessages(conversationId, (prev) => [...prev, userMsg, aiMsg]);
    setIsGenerating(true);
    setPrompt("");

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
        refImages.map((img) => {
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
        params.image_size === "auto"
          ? (params._autoRatio || "1:1")
          : params.image_size;
      const imagePayload =
        preparedImages.length === 1 ? preparedImages[0] : preparedImages;

      let successCount = 0;

      for (let i = 0; i < count; i++) {
        if (
          activeGenerationRef.current?.conversationId !== conversationId ||
          activeGenerationRef.current?.aiMsgId !== aiMsgId ||
          activeGenerationRef.current?.cancelled
        ) {
          break;
        }

        const taskId = tasks[i].id;
        patchTask(conversationId, aiMsgId, taskId, { status: "generating" });

        try {
          let res;
          if (hasImages) {
            res = await fetchWithTimeout("/api/edit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: requestController.signal,
              body: JSON.stringify({
                prompt: text,
                image: imagePayload,
                model: params.model,
                image_size: imageSize,
                num: 1,
              }),
            });
          } else {
            res = await fetchWithTimeout("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: requestController.signal,
              body: JSON.stringify({
                prompt: text,
                model: params.model,
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
            break;
          }

          if (!res.ok || data.error) {
            patchTask(conversationId, aiMsgId, taskId, {
              status: "failed",
              error: errStr(data.error || `请求失败（${res.status}）`),
            });
            continue;
          }

          const urls = data.data?.urls || [];
          const url = urls[0];
          if (!url) {
            patchTask(conversationId, aiMsgId, taskId, {
              status: "failed",
              error: "未返回图片",
            });
            continue;
          }

          patchTask(conversationId, aiMsgId, taskId, {
            status: "completed",
            url,
            error: null,
          });
          successCount += 1;
          canvasHistory.push((prev) => [
            ...prev,
            {
              id: `${aiMsgId}-${taskId}`,
              image_url: url,
              prompt: text,
            },
          ]);
        } catch (err) {
          if (
            activeGenerationRef.current?.conversationId !== conversationId ||
            activeGenerationRef.current?.aiMsgId !== aiMsgId
          ) {
            break;
          }
          if (err?.name === "AbortError") {
            if (!activeGenerationRef.current?.cancelled) {
              patchTask(conversationId, aiMsgId, taskId, {
                status: "failed",
                error: "请求超时。可尝试更小尺寸模型或稍后重试。",
              });
            }
            break;
          }
          patchTask(conversationId, aiMsgId, taskId, {
            status: "failed",
            error: errStr(err),
          });
        }
      }

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

      setRefImages([]);
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
    isGenerating,
    activeConversationId,
    params,
    refImages,
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

  const handleUpdateImage = useCallback(() => {}, []);

  /** 由画布选中同步到右侧参考图的 URL 列表（单选 / 框选多图） */
  const canvasSelectionUrlsRef = useRef([]);

  const handleSelectImage = useCallback((img) => {
    if (!img?.image_url) {
      setSelectedImage(null);
      setRefImages((prev) =>
        prev.filter((u) => !canvasSelectionUrlsRef.current.includes(u))
      );
      canvasSelectionUrlsRef.current = [];
      return;
    }
    setRefImages((prev) => {
      const withoutCanvas = prev.filter((u) => !canvasSelectionUrlsRef.current.includes(u));
      canvasSelectionUrlsRef.current = [img.image_url];
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
    setRefImages((prev) => {
      const withoutCanvas = prev.filter((u) => !canvasSelectionUrlsRef.current.includes(u));
      canvasSelectionUrlsRef.current = [...list];
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
    setPrompt(msg.text);
    if (msg.params) setParamsClamped(msg.params);
  }, [setParamsClamped]);

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
    if (isGenerating) {
      toast("生成过程中暂时不能切换对话", "info", 1500);
      return;
    }
    const nextConversation = createConversation();
    setConversations((prev) => [nextConversation, ...prev]);
    setActiveConversationId(nextConversation.id);
    resetComposer();
  }, [isGenerating, resetComposer, toast]);

  const handleSelectConversation = useCallback((conversationId) => {
    if (isGenerating) {
      toast("生成过程中暂时不能切换对话", "info", 1500);
      return;
    }
    setActiveConversationId(conversationId);
    resetComposer();
  }, [isGenerating, resetComposer, toast]);

  const handleDeleteConversation = useCallback((conversationId) => {
    if (isGenerating) {
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
  }, [activeConversationId, isGenerating, resetComposer, toast]);

  const handleDeleteMessage = useCallback((messageId) => {
    if (isGenerating) {
      toast("生成过程中暂时不能删除记录", "info", 1500);
      return;
    }
    if (!activeConversationId) {
      return;
    }

    updateConversationMessages(activeConversationId, (prev) => prev.filter((message) => message.id !== messageId));
    toast("记录已删除", "info", 1200);
  }, [activeConversationId, isGenerating, toast, updateConversationMessages]);

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
        selectedImage={selectedImage}
        onSelectImage={handleSelectImage}
        onDeleteImage={handleDeleteImage}
        onUpdateImage={handleUpdateImage}
        onSendToChat={handleSendToChat}
        onDropImages={handleDropImages}
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
      />
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
        isGenerating={isGenerating}
        params={params}
        onParamsChange={setParamsClamped}
        showParams={showParams}
        onToggleParams={() => setShowParams(!showParams)}
        refImages={refImages}
        onRefImagesChange={setRefImages}
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
