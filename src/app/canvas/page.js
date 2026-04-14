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

function errStr(e) {
  if (!e) return "未知错误";
  if (typeof e === "string") return e;
  return e.message || e.error || JSON.stringify(e);
}

const REQUEST_TIMEOUT_MS = 55000;
const STORAGE_VERSION = "8";

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
  const [activeTool, setActiveTool] = useState("select");
  const [zoom, setZoom] = useState(100);
  const [prompt, setPrompt] = useState("");
  const [refImages, setRefImages] = useState([]);
  const [params, setParams] = useState({
    model: "gemini-3.1-flash-image-preview-512",
    image_size: "1:1",
    num: 1,
  });
  const [showParams, setShowParams] = useState(false);
  const [messages, setMessages] = useState([]);
  const canvasHistory = useHistory([]);
  const canvasImages = canvasHistory.state;
  const [selectedImage, setSelectedImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [panelWidth, setPanelWidth] = useState(340);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const canvasRef = useRef(null);
  const generationAbortRef = useRef(null);
  const activeGenerationRef = useRef(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const ver = localStorage.getItem("lovart-version");
      if (ver !== STORAGE_VERSION) {
        localStorage.removeItem("lovart-messages");
        localStorage.removeItem("lovart-canvas-images");
        localStorage.setItem("lovart-version", STORAGE_VERSION);
        return;
      }
      const saved = localStorage.getItem("lovart-messages");
      const savedImages = localStorage.getItem("lovart-canvas-images");
      if (saved) setMessages(JSON.parse(saved));
      if (savedImages) canvasHistory.setState(JSON.parse(savedImages));
    } catch {
      localStorage.removeItem("lovart-messages");
      localStorage.removeItem("lovart-canvas-images");
    }
  }, []);

  // Persist messages
  useEffect(() => {
    try {
      localStorage.setItem("lovart-messages", JSON.stringify(sanitizeMessagesForStorage(messages)));
    } catch {
      localStorage.removeItem("lovart-messages");
    }
  }, [messages]);

  // Persist canvas images
  useEffect(() => {
    try {
      localStorage.setItem("lovart-canvas-images", JSON.stringify(canvasImages.slice(0, 100)));
    } catch {
      localStorage.removeItem("lovart-canvas-images");
    }
  }, [canvasImages]);

  const updateMessage = useCallback((id, updates) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  }, []);

  const handleGenerate = useCallback(async () => {
    const text = prompt.trim();
    if (!text || isGenerating) return;

    const ts = Date.now();
    const userMsgId = "user-" + ts;
    const aiMsgId = "ai-" + ts;
    const modelLabel = MODEL_LABELS[params.model] || params.model;
    const hasImages = refImages.length > 0;

    const messageRefImages = hasImages
      ? await Promise.all(refImages.map((img) => makeMessagePreviewImage(img)))
      : [];

    const userMsg = {
      id: userMsgId, role: "user", text,
      params: { ...params }, modelLabel,
      refImages: messageRefImages,
    };
    const aiMsg = {
      id: aiMsgId, role: "assistant", text,
      params: { ...params }, modelLabel,
      status: "generating", urls: [], error: null,
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setIsGenerating(true);
    setPrompt("");

    try {
      const requestController = new AbortController();
      generationAbortRef.current = requestController;
      activeGenerationRef.current = {
        aiMsgId,
        controller: requestController,
        cancelled: false,
      };
      const preparedImages = await Promise.all(
        refImages.map((img) => {
          if (typeof img !== "string") {
            return img;
          }

          // Remote URLs should be passed through directly. Re-encoding them in
          // the browser can fail because of CORS and also wastes payload budget.
          if (/^https?:\/\//i.test(img)) {
            return img;
          }

          // Uploaded/local data URLs are compressed more aggressively so the
          // Netlify function is less likely to hit an inactivity timeout.
          if (/^data:image\//i.test(img)) {
            return compressImage(img, 768, 0.68);
          }

          return img;
        })
      );

      const imageSize = params.image_size === "auto"
        ? (params._autoRatio || "1:1")
        : params.image_size;

      let res;
      if (hasImages) {
        const image = preparedImages.length === 1 ? preparedImages[0] : preparedImages;
        res = await fetchWithTimeout("/api/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: requestController.signal,
          body: JSON.stringify({
            prompt: text, image,
            model: params.model, image_size: imageSize, num: params.num,
          }),
        });
      } else {
        res = await fetchWithTimeout("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: requestController.signal,
          body: JSON.stringify({
            prompt: text,
            model: params.model, image_size: imageSize, num: params.num,
          }),
        });
      }

      const data = await parseApiResponse(res);
      if (
        activeGenerationRef.current?.aiMsgId !== aiMsgId ||
        activeGenerationRef.current?.cancelled
      ) {
        return;
      }

      if (!res.ok || data.error) {
        updateMessage(aiMsgId, {
          status: "failed",
          error: errStr(data.error || `请求失败（${res.status}）`),
        });
        return;
      }

      const urls = data.data?.urls || [];
      if (urls.length > 0) {
        updateMessage(aiMsgId, { status: "completed", urls });
        const newCanvasImages = urls.map((url, i) => ({
          id: aiMsgId + "-" + i, image_url: url, prompt: text,
        }));
        canvasHistory.push((prev) => [...prev, ...newCanvasImages]);
        toast(`生成完成，${urls.length} 张图片已添加到画布`, "success");
      } else {
        updateMessage(aiMsgId, { status: "failed", error: "未返回图片" });
      }

      setRefImages([]);
    } catch (err) {
      const isTimeout = err?.name === "AbortError";
      if (
        activeGenerationRef.current?.aiMsgId === aiMsgId &&
        activeGenerationRef.current?.cancelled
      ) {
        return;
      }
      updateMessage(aiMsgId, {
        status: "failed",
        error: isTimeout
          ? "请求超时。当前部署平台可能已超时，请优先尝试 512px / 1K 模型，或稍后重试。"
          : "请求失败: " + errStr(err),
      });
    } finally {
      if (activeGenerationRef.current?.aiMsgId === aiMsgId) {
        activeGenerationRef.current = null;
      }
      generationAbortRef.current = null;
      setIsGenerating(false);
    }
  }, [prompt, params, refImages, isGenerating, updateMessage, canvasHistory, toast]);

  const handlePauseGenerate = useCallback(() => {
    const currentTask = activeGenerationRef.current;
    if (!currentTask) return;

    const { aiMsgId, controller } = currentTask;
    currentTask.cancelled = true;

    updateMessage(aiMsgId, {
      status: "paused",
      error: "已手动暂停",
    });
    setIsGenerating(false);
    generationAbortRef.current = null;
    controller.abort();
    toast("已暂停当前生成", "info", 1500);
  }, [toast, updateMessage]);

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

  // When selecting/deselecting a canvas image, sync it as a ref image in chat
  const canvasSelectionRef = useRef(null);
  const handleSelectImage = useCallback((img) => {
    // Remove previous canvas-selected image from refImages
    if (canvasSelectionRef.current) {
      const prevUrl = canvasSelectionRef.current;
      setRefImages((prev) => prev.filter((u) => u !== prevUrl));
    }
    setSelectedImage(img);
    if (img?.image_url) {
      canvasSelectionRef.current = img.image_url;
      setRefImages((prev) => [...prev, img.image_url]);
    } else {
      canvasSelectionRef.current = null;
    }
  }, []);

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

  const handleRetry = useCallback((msg) => {
    setPrompt(msg.text);
    if (msg.params) setParams(msg.params);
  }, []);

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
    if (msg.text) setPrompt(msg.text);
    if (msg.params) setParams(msg.params);
    toast("已载入历史提示词", "info", 1200);
  }, [toast]);

  const handleClearHistory = useCallback(() => {
    setMessages([]);
    localStorage.removeItem("lovart-messages");
    toast("历史记录已清空", "info", 1500);
  }, [toast]);

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
        messages={messages}
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
        activeTool={activeTool}
        onToolChange={setActiveTool}
        zoom={zoom}
        onZoomChange={handleZoomChange}
      />
      <ChatPanel
        messages={messages}
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={handleGenerate}
        isGenerating={isGenerating}
        params={params}
        onParamsChange={setParams}
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
