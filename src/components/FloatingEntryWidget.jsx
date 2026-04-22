"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Loader2,
  Minus,
  Minimize2,
  Maximize2,
  Moon,
  Send,
  Plus,
  Sun,
  Trash2,
  X,
} from "lucide-react";

const BALL_SIZE = 120;
const PANEL_WIDTH = 480;
const PANEL_HEIGHT = 560;
const VIEWPORT_PADDING = 16;
const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 360;
const MAX_PANEL_WIDTH = 960;
const MAX_PANEL_HEIGHT = 1080;
const ATTACHMENT_ACCEPT =
  "image/*,.pdf,.doc,.docx,.txt,.md,.markdown,.rtf,.csv,.json,.xml,.xls,.xlsx,.ppt,.pptx";

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function clampBallPosition(position, viewport) {
  const width = viewport?.width || 0;
  const height = viewport?.height || 0;
  return {
    x: clamp(position?.x ?? width - BALL_SIZE - 24, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, width - BALL_SIZE - VIEWPORT_PADDING)),
    y: clamp(position?.y ?? height - BALL_SIZE - 24, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, height - BALL_SIZE - VIEWPORT_PADDING)),
  };
}

function getDefaultBallPosition() {
  if (typeof window === "undefined") {
    return { x: VIEWPORT_PADDING, y: VIEWPORT_PADDING };
  }
  return clampBallPosition(
    {
      x: window.innerWidth - BALL_SIZE - 24,
      y: window.innerHeight - BALL_SIZE - 24,
    },
    { width: window.innerWidth, height: window.innerHeight }
  );
}

function clampPanelPosition(position, panelSize, viewport) {
  const width = viewport?.width || 0;
  const height = viewport?.height || 0;
  return {
    left: clamp(
      position?.left ?? VIEWPORT_PADDING,
      VIEWPORT_PADDING,
      Math.max(VIEWPORT_PADDING, width - panelSize.width - VIEWPORT_PADDING)
    ),
    top: clamp(
      position?.top ?? VIEWPORT_PADDING,
      VIEWPORT_PADDING,
      Math.max(VIEWPORT_PADDING, height - panelSize.height - VIEWPORT_PADDING)
    ),
  };
}

function getPanelPositionFromBall(position, panelSize, viewport) {
  return clampPanelPosition(
    {
      left: position.x + BALL_SIZE - panelSize.width,
      top: position.y - panelSize.height - 14,
    },
    panelSize,
    viewport
  );
}

function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    const handler = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-xl bg-bg-secondary/80 p-2 text-text-primary transition-all hover:bg-bg-hover"
      >
        <X size={20} />
      </button>
      <img
        src={src}
        alt="预览"
        className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
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

function renderAssistantTextBlock(text, isLightTheme) {
  const lines = String(text || "").split("\n");

  return (
    <div className="space-y-1.5">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();

        if (!line) {
          return <div key={`blank-${index}`} className="h-2" />;
        }

        if (/^(\d+\.\s|[1-9]\uFE0F?\u20E3\s)/.test(line)) {
          return (
            <div
              key={`title-${index}`}
              className={`pt-3 text-[18px] font-semibold leading-8 ${
                isLightTheme ? "text-[#111111]" : "text-white"
              }`}
            >
              {line}
            </div>
          );
        }

        if (/^(📰|✨|📚|🎯|📌|🔎|📍|💡|✅|👉|💬|📝)/.test(line)) {
          return (
            <div
              key={`lead-${index}`}
              className={`text-[17px] font-semibold leading-8 ${
                isLightTheme ? "text-[#111111]" : "text-white"
              }`}
            >
              {line}
            </div>
          );
        }

        if (/^(🗞️ 来源：|- 来源：)/.test(line)) {
          return (
            <div
              key={`source-${index}`}
              className={`text-[13px] leading-6 ${
                isLightTheme ? "text-black/50" : "text-white/50"
              }`}
            >
              {line}
            </div>
          );
        }

        if (/^(🔗 链接：|- 链接：)/.test(line)) {
          const url = line.replace(/^(🔗 链接：|- 链接：)/, "").trim();
          return (
            <div
              key={`link-${index}`}
              className={`text-[13px] leading-6 break-all ${
                isLightTheme ? "text-black/60" : "text-white/60"
              }`}
            >
              <span className={isLightTheme ? "text-black/42" : "text-white/42"}>🔗 链接：</span>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className={`underline underline-offset-2 ${
                  isLightTheme ? "text-[#2563eb] hover:text-[#1d4ed8]" : "text-[#8ab4ff] hover:text-[#a8c7ff]"
                }`}
              >
                {url}
              </a>
            </div>
          );
        }

        if (/^(💡 价值：|- 价值：)/.test(line)) {
          return (
            <div
              key={`value-${index}`}
              className={`text-[14px] font-medium leading-7 ${
                isLightTheme ? "text-[#8a5a00]" : "text-[#f3c969]"
              }`}
            >
              {line}
            </div>
          );
        }

        if (/^(📌 (核心|摘要)：|- (核心|摘要)：)/.test(line)) {
          return (
            <div
              key={`summary-${index}`}
              className={`text-[15px] leading-7 ${
                isLightTheme ? "text-[#222222]" : "text-text-primary"
              }`}
            >
              {line}
            </div>
          );
        }

        return (
          <div
            key={`body-${index}`}
            className={`whitespace-pre-wrap text-[15px] leading-7 ${
              isLightTheme ? "text-[#222222]" : "text-text-primary"
            }`}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
}

export default function FloatingEntryWidget({
  storageKey,
  prompt,
  onPromptChange,
  onSubmit,
  onFilesAdd,
  onPreviewImageRemove,
  onAttachmentRemove,
  messages = [],
  historyItems = [],
  previewImages = [],
  attachmentItems = [],
  canSubmit = false,
  isSubmitting = false,
  entryMode = "quick",
  submitLabel = "开始",
  outputError = "",
  outputIdleText = "结果输出区域",
  defaultExpanded = false,
  showLauncher = true,
  onNewChat,
  onSelectHistory,
  onDeleteHistory,
  onClose,
}) {
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [dragOver, setDragOver] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [viewport, setViewport] = useState(() => (
    typeof window === "undefined"
      ? { width: 0, height: 0 }
      : { width: window.innerWidth, height: window.innerHeight }
  ));
  const [ballPosition, setBallPosition] = useState(getDefaultBallPosition);
  const [panelSize, setPanelSize] = useState({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
  const [panelPosition, setPanelPosition] = useState({ left: VIEWPORT_PADDING, top: VIEWPORT_PADDING });
  const fileInputRef = useRef(null);
  const attachmentsRef = useRef([]);
  const restorePanelFrameRef = useRef(null);
  const [previewSrc, setPreviewSrc] = useState(null);
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelTheme, setPanelTheme] = useState("dark");
  const [isLogoMenuOpen, setIsLogoMenuOpen] = useState(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const outputEndRef = useRef(null);
  const logoMenuRef = useRef(null);
  const currentEntryMode = entryMode === "agent" ? "agent" : "quick";
  const isLightTheme = panelTheme === "light";

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleResize = () => {
      const nextViewport = { width: window.innerWidth, height: window.innerHeight };
      setViewport(nextViewport);
      setBallPosition((prev) => clampBallPosition(prev, nextViewport));
      setPanelSize((prev) => {
        const nextSize = {
          width: clamp(prev.width, MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, nextViewport.width - VIEWPORT_PADDING * 2)),
          height: clamp(prev.height, MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, nextViewport.height - VIEWPORT_PADDING * 2)),
        };
        setPanelPosition((current) => clampPanelPosition(current, nextSize, nextViewport));
        return nextSize;
      });
    };

    const frameId = window.requestAnimationFrame(() => {
      const nextViewport = { width: window.innerWidth, height: window.innerHeight };
      const nextBallPosition = getDefaultBallPosition();
      const nextPanelSize = {
        width: clamp(PANEL_WIDTH, MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, nextViewport.width - VIEWPORT_PADDING * 2)),
        height: clamp(PANEL_HEIGHT, MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, nextViewport.height - VIEWPORT_PADDING * 2)),
      };
      setViewport(nextViewport);
      setBallPosition(nextBallPosition);
      setPanelSize(nextPanelSize);
      setPanelPosition(getPanelPositionFromBall(nextBallPosition, nextPanelSize, nextViewport));
      setReady(true);
    });
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
    };
  }, [storageKey]);

  const displayAttachments = useMemo(() => {
    const externalImages = (Array.isArray(previewImages) ? previewImages : [])
      .filter((src) => typeof src === "string" && src)
      .map((src, index) => ({
        id: `external-${index}-${src.slice(0, 24)}`,
        name: `图片${index + 1}`,
        isImage: true,
        previewUrl: src,
        sourceType: "external",
        externalIndex: index,
      }));
    const externalFiles = (Array.isArray(attachmentItems) ? attachmentItems : [])
      .filter((item) => item && !item.isImage)
      .map((item) => ({
        id: item.id,
        name: item.name,
        isImage: false,
        previewUrl: "",
        sourceType: "attachment",
      }));
    return [...externalImages, ...externalFiles, ...attachments];
  }, [attachmentItems, attachments, previewImages]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => () => {
    attachmentsRef.current.forEach((item) => {
      if (item.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
  }, []);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSubmitting, outputError]);

  useEffect(() => {
    if (!isLogoMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!logoMenuRef.current?.contains(event.target)) {
        setIsLogoMenuOpen(false);
        setIsHistoryPanelOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isLogoMenuOpen]);

  useEffect(() => {
    if (!expanded) {
      setIsLogoMenuOpen(false);
      setIsHistoryPanelOpen(false);
    }
  }, [expanded]);

  const startDragging = (event, { toggleOnClick = false } = {}) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startPos = ballPosition;
    let moved = false;

    const handleMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        moved = true;
      }
      setBallPosition(clampBallPosition({
        x: startPos.x + deltaX,
        y: startPos.y + deltaY,
      }, {
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      if (toggleOnClick && !moved) {
        setPanelPosition((prev) => {
          const safePrev = clampPanelPosition(prev, panelSize, viewport);
          const nearBall = getPanelPositionFromBall(ballPosition, panelSize, viewport);
          if (safePrev.left === VIEWPORT_PADDING && safePrev.top === VIEWPORT_PADDING) {
            return nearBall;
          }
          return safePrev;
        });
        setExpanded((prev) => !prev);
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const startPanelDragging = (event) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startPos = panelPosition;

    const handleMove = (moveEvent) => {
      setPanelPosition(clampPanelPosition({
        left: startPos.left + moveEvent.clientX - startX,
        top: startPos.top + moveEvent.clientY - startY,
      }, panelSize, {
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const startResizing = (corner, event) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = panelSize;
    const startPosition = panelPosition;

    const handleMove = (moveEvent) => {
      const nextViewport = { width: window.innerWidth, height: window.innerHeight };
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      let nextWidth = startSize.width;
      let nextHeight = startSize.height;
      let nextLeft = startPosition.left;
      let nextTop = startPosition.top;

      if (corner.includes("e")) {
        nextWidth = clamp(
          startSize.width + deltaX,
          MIN_PANEL_WIDTH,
          Math.min(MAX_PANEL_WIDTH, nextViewport.width - VIEWPORT_PADDING * 2)
        );
      }
      if (corner.includes("s")) {
        nextHeight = clamp(
          startSize.height + deltaY,
          MIN_PANEL_HEIGHT,
          Math.min(MAX_PANEL_HEIGHT, nextViewport.height - VIEWPORT_PADDING * 2)
        );
      }
      if (corner.includes("w")) {
        nextWidth = clamp(
          startSize.width - deltaX,
          MIN_PANEL_WIDTH,
          Math.min(MAX_PANEL_WIDTH, nextViewport.width - VIEWPORT_PADDING * 2)
        );
        nextLeft = startPosition.left + (startSize.width - nextWidth);
      }
      if (corner.includes("n")) {
        nextHeight = clamp(
          startSize.height - deltaY,
          MIN_PANEL_HEIGHT,
          Math.min(MAX_PANEL_HEIGHT, nextViewport.height - VIEWPORT_PADDING * 2)
        );
        nextTop = startPosition.top + (startSize.height - nextHeight);
      }

      const nextSize = { width: nextWidth, height: nextHeight };
      const safePosition = clampPanelPosition(
        { left: nextLeft, top: nextTop },
        nextSize,
        nextViewport
      );

      setPanelSize(nextSize);
      setPanelPosition(safePosition);
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;
    await onSubmit?.();
  };

  const handleFileDrop = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const newAttachments = files.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      isImage: Boolean(file.type?.startsWith("image/")),
      previewUrl: file.type?.startsWith("image/") ? URL.createObjectURL(file) : "",
      sourceType: "local",
    }));

    setAttachments((prev) => [...prev, ...newAttachments]);

    await onFilesAdd?.(files);

    newAttachments.forEach((item) => {
      if (item.isImage && item.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    const tempIds = new Set(newAttachments.map((item) => item.id));
    setAttachments((prev) => prev.filter((item) => !tempIds.has(item.id)));
  };

  const handleFileInputChange = (event) => {
    const files = event.target.files;
    if (files?.length) {
      void handleFileDrop(files);
    }
    event.target.value = "";
  };

  const handleRemoveAttachment = (item) => {
    if (!item) return;

    if (item.sourceType === "external") {
      onPreviewImageRemove?.(item.externalIndex);
      return;
    }

    if (item.sourceType === "attachment") {
      onAttachmentRemove?.(item.id);
      return;
    }

    setAttachments((prev) => {
      const target = prev.find((entry) => entry.id === item.id);
      if (target?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((entry) => entry.id !== item.id);
    });
  };

  const handleDownloadImage = async (src, index) => {
    if (!src) return;

    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `easy-ai-${Date.now()}-${index + 1}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      const anchor = document.createElement("a");
      anchor.href = src;
      anchor.download = `easy-ai-${Date.now()}-${index + 1}.png`;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
  };

  const handleCopyText = async (message) => {
    const text = String(message?.text || "").trim();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    setCopiedMessageId(message.id);
    window.setTimeout(() => {
      setCopiedMessageId((current) => (current === message.id ? null : current));
    }, 1600);
  };

  const toggleFullscreen = () => {
    if (isFullscreen) {
      const previousFrame = restorePanelFrameRef.current;
      if (previousFrame) {
        setPanelSize(previousFrame.size);
        setPanelPosition(previousFrame.position);
      }
      setIsFullscreen(false);
      return;
    }

    restorePanelFrameRef.current = {
      size: panelSize,
      position: panelPosition,
    };
    const nextViewport = { width: window.innerWidth, height: window.innerHeight };
    const nextSize = {
      width: Math.max(MIN_PANEL_WIDTH, nextViewport.width - VIEWPORT_PADDING * 2),
      height: Math.max(MIN_PANEL_HEIGHT, nextViewport.height - VIEWPORT_PADDING * 2),
    };
    setPanelSize(nextSize);
    setPanelPosition({ left: VIEWPORT_PADDING, top: VIEWPORT_PADDING });
    setIsFullscreen(true);
  };

  const togglePanelTheme = () => {
    setPanelTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  const handleNewChatClick = () => {
    onNewChat?.();
    setIsLogoMenuOpen(false);
    setIsHistoryPanelOpen(false);
  };

  const handleHistorySelect = (historyId) => {
    onSelectHistory?.(historyId);
    setIsLogoMenuOpen(false);
    setIsHistoryPanelOpen(false);
  };

  const handleHistoryDelete = (historyId, event) => {
    event.preventDefault();
    event.stopPropagation();
    onDeleteHistory?.(historyId);
  };

  const placeholder = entryMode === "quick"
    ? "一句话描述你想生成什么..."
    : "直接描述目标效果，我来帮你处理思路...";

  if (!ready) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]">
      {expanded && (
        <button
          type="button"
          className="absolute inset-0 pointer-events-auto bg-black/0"
          onClick={() => setExpanded(false)}
          aria-label="关闭悬浮入口"
        />
      )}

      {expanded && (
        <div
          className={`pointer-events-auto fixed overflow-hidden rounded-[26px] backdrop-blur-2xl flex flex-col ${
            isLightTheme
              ? "border border-black/8 bg-white/95 text-[#111111] shadow-[0_24px_80px_rgba(15,23,42,0.16)]"
              : "border border-white/8 bg-[#141414]/94 text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          }`}
          style={{
            left: panelPosition.left,
            top: panelPosition.top,
            width: panelSize.width,
            height: panelSize.height,
          }}
        >
          {!isFullscreen && (
            <>
              <div
                className="absolute left-0 top-0 z-20 h-5 w-5 cursor-nwse-resize"
                onPointerDown={(event) => startResizing("nw", event)}
              />
              <div
                className="absolute left-5 right-5 top-0 z-20 h-3 cursor-ns-resize"
                onPointerDown={(event) => startResizing("n", event)}
              />
              <div
                className="absolute right-0 top-0 z-20 h-5 w-5 cursor-nesw-resize"
                onPointerDown={(event) => startResizing("ne", event)}
              />
              <div
                className="absolute bottom-5 left-0 top-5 z-20 w-3 cursor-ew-resize"
                onPointerDown={(event) => startResizing("w", event)}
              />
              <div
                className="absolute left-0 bottom-0 z-20 h-5 w-5 cursor-nesw-resize"
                onPointerDown={(event) => startResizing("sw", event)}
              />
              <div
                className="absolute bottom-0 left-5 right-5 z-20 h-3 cursor-ns-resize"
                onPointerDown={(event) => startResizing("s", event)}
              />
              <div
                className="absolute right-0 bottom-0 z-20 h-5 w-5 cursor-nwse-resize"
                onPointerDown={(event) => startResizing("se", event)}
              />
              <div
                className="absolute bottom-5 right-0 top-5 z-20 w-3 cursor-ew-resize"
                onPointerDown={(event) => startResizing("e", event)}
              />
            </>
          )}

          <div
            className={`flex items-center justify-between px-4 py-3 cursor-move select-none ${
              isLightTheme
                ? "border-b border-black/8 bg-black/[0.02]"
                : "border-b border-white/6 bg-white/[0.02]"
            }`}
            onPointerDown={startPanelDragging}
          >
            <div className="flex min-w-0 items-center">
              <div
                ref={logoMenuRef}
                className="relative"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setIsLogoMenuOpen((prev) => !prev)}
                  className={`floating-logo-wrap rounded-xl px-1.5 py-1 transition-all ${
                    isLightTheme
                      ? "hover:bg-black/[0.05]"
                      : "hover:bg-white/[0.06]"
                  }`}
                  title="打开会话菜单"
                >
                  <Image
                    src="/images/floating-header-logo.svg"
                    alt="Easy AI"
                    width={114}
                    height={24}
                    className="floating-logo-image h-6 w-auto object-contain"
                  />
                </button>

                {isLogoMenuOpen && (
                  <div
                    className={`absolute left-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl ${
                      isLightTheme
                        ? "border-black/8 bg-white/96"
                        : "border-white/8 bg-[#1b1c1d]/96"
                    }`}
                  >
                    <div className="p-2">
                      <button
                        type="button"
                        onClick={handleNewChatClick}
                        disabled={isSubmitting}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                          isLightTheme
                            ? "text-[#111111] hover:bg-black/[0.045] disabled:text-black/30"
                            : "text-text-primary hover:bg-white/[0.05] disabled:text-white/30"
                        }`}
                      >
                        <span>新聊天</span>
                        <span className={isLightTheme ? "text-black/30" : "text-white/25"}>+</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsHistoryPanelOpen((prev) => !prev)}
                        className={`mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                          isLightTheme
                            ? "text-[#111111] hover:bg-black/[0.045]"
                            : "text-text-primary hover:bg-white/[0.05]"
                        }`}
                      >
                        <span>历史记录</span>
                        <span className={isLightTheme ? "text-black/30" : "text-white/25"}>{isHistoryPanelOpen ? "−" : "›"}</span>
                      </button>
                    </div>

                    {isHistoryPanelOpen && (
                      <div className={`border-t px-2 pb-2 pt-1 ${isLightTheme ? "border-black/8" : "border-white/6"}`}>
                        {historyItems.length > 0 ? (
                          <div className="max-h-56 space-y-1 overflow-auto py-1">
                            {historyItems.slice(0, 8).map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => handleHistorySelect(item.id)}
                                className={`w-full rounded-xl px-3 py-2.5 text-left transition-all ${
                                  isLightTheme
                                    ? "hover:bg-black/[0.045]"
                                    : "hover:bg-white/[0.05]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className={`min-w-0 truncate text-sm ${isLightTheme ? "text-[#111111]" : "text-text-primary"}`}>
                                    {item.title || "未命名对话"}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(event) => handleHistoryDelete(item.id, event)}
                                    className={`shrink-0 rounded-lg p-1 transition-all ${
                                      isLightTheme
                                        ? "text-black/35 hover:bg-black/[0.05] hover:text-black/70"
                                        : "text-white/35 hover:bg-white/[0.06] hover:text-white/75"
                                    }`}
                                    title="删除这条历史"
                                    aria-label="删除这条历史"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                                <div className={`mt-1 text-[11px] ${isLightTheme ? "text-black/40" : "text-text-tertiary"}`}>
                                  {formatHistoryTime(item.updatedAt)}
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className={`px-3 py-4 text-sm ${isLightTheme ? "text-black/45" : "text-text-tertiary"}`}>
                            暂无历史记录
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={togglePanelTheme}
                className={`w-7 h-7 rounded-full transition-all inline-flex items-center justify-center ${
                  isLightTheme
                    ? "text-black/45 hover:text-black/80 hover:bg-black/[0.06]"
                    : "text-white/45 hover:text-white hover:bg-white/[0.08]"
                }`}
                title={isLightTheme ? "切换到深色" : "切换到浅色"}
              >
                {isLightTheme ? <Moon size={14} /> : <Sun size={14} />}
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className={`w-7 h-7 rounded-full transition-all inline-flex items-center justify-center ${
                  isLightTheme
                    ? "text-black/45 hover:text-black/80 hover:bg-black/[0.06]"
                    : "text-white/45 hover:text-white hover:bg-white/[0.08]"
                }`}
                title={isFullscreen ? "退出全屏" : "全屏显示"}
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className={`w-7 h-7 rounded-full transition-all inline-flex items-center justify-center ${
                  isLightTheme
                    ? "text-black/45 hover:text-black/80 hover:bg-black/[0.06]"
                    : "text-white/45 hover:text-white hover:bg-white/[0.08]"
                }`}
                title="收起"
              >
                <Minus size={14} />
              </button>
            </div>
          </div>

          <div className="flex-1 px-4 pt-4 pb-3 min-h-0 overflow-auto">
            <div className="min-h-full">
              {messages.length > 0 || isSubmitting || outputError ? (
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[88%] ${message.role === "user" ? "" : "w-full"}`}>
                        {message.refImages?.length > 0 && (
                          <div className={`mb-2 flex flex-wrap gap-1.5 ${message.role === "user" ? "justify-end" : ""}`}>
                            {message.refImages.map((src, index) => (
                              <button
                                key={`${message.id}-ref-${index}`}
                                type="button"
                                className={`relative h-12 w-12 overflow-hidden rounded-lg ${
                                  isLightTheme
                                    ? "border border-black/10 bg-black/[0.04]"
                                    : "border border-border-primary bg-bg-hover"
                                }`}
                                onClick={() => setPreviewSrc(src)}
                              >
                                <Image
                                  src={src}
                                  alt={`参考图 ${index + 1}`}
                                  fill
                                  unoptimized
                                  className="object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        )}

                        {message.text ? (
                          <div
                            className={`text-sm leading-relaxed ${
                              message.role === "user"
                                ? isLightTheme
                                  ? "rounded-2xl rounded-tr-md bg-[#f2f2f2] border border-black/8 px-4 py-3 text-[#111111]"
                                  : "rounded-2xl rounded-tr-md bg-accent/15 border border-accent/20 px-4 py-3 text-text-primary"
                                : `${isLightTheme ? "px-0 py-0 text-[#111111]" : "px-0 py-0 text-text-primary"}`
                            }`}
                          >
                            <div className={message.role === "assistant" ? "" : "whitespace-pre-wrap"}>
                              {message.role === "assistant"
                                ? renderAssistantTextBlock(message.text, isLightTheme)
                                : message.text}
                            </div>
                          </div>
                        ) : null}

                        {message.attachments?.length > 0 && (
                          <div className={`mt-2 flex flex-wrap gap-2 ${message.role === "user" ? "justify-end" : ""}`}>
                            {message.attachments.map((item) => (
                              <div
                                key={item.id || `${message.id}-${item.name}`}
                                className={`max-w-full rounded-2xl px-3 py-2 text-[12px] ${
                                  isLightTheme
                                    ? "border border-black/8 bg-black/[0.035] text-black/70"
                                    : "border border-border-primary bg-bg-hover text-text-secondary"
                                }`}
                              >
                                <div className="truncate font-medium">{item.name}</div>
                                {item.excerpt ? (
                                  <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] opacity-75">
                                    {item.excerpt}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}

                        {message.role === "assistant" && (message.text || message.modelLabel) ? (
                          <div className="mt-2 flex items-center justify-between gap-3 px-1">
                            <div className={`min-w-0 text-[11px] ${isLightTheme ? "text-black/45" : "text-text-tertiary"}`}>
                              {message.modelLabel ? `模型：${message.modelLabel}` : ""}
                            </div>
                            {message.text ? (
                              <button
                                type="button"
                                onClick={() => void handleCopyText(message)}
                                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-all ${
                                  isLightTheme
                                    ? "text-black/45 hover:bg-black/[0.04] hover:text-black/80"
                                    : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                                }`}
                                title="复制文案"
                              >
                                {copiedMessageId === message.id ? <Check size={12} /> : <Copy size={12} />}
                                {copiedMessageId === message.id ? "已复制" : "复制"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {message.images?.length > 0 && (
                          <div className={`mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 ${message.role === "user" ? "justify-items-end" : ""}`}>
                            {message.images.map((src, index) => (
                              <div
                                key={`${message.id}-img-${index}`}
                                className={`relative aspect-square w-full overflow-hidden rounded-2xl ${
                                  isLightTheme
                                    ? "border border-black/10 bg-black/[0.04]"
                                    : "border border-border-primary bg-bg-hover"
                                }`}
                              >
                                <button
                                  type="button"
                                  className="absolute inset-0"
                                  onClick={() => setPreviewSrc(src)}
                                  title="放大查看"
                                >
                                  <Image
                                    src={src}
                                    alt={`生成结果 ${index + 1}`}
                                    fill
                                    unoptimized
                                    className="object-cover transition-opacity hover:opacity-95"
                                  />
                                </button>
                                <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setPreviewSrc(src);
                                    }}
                                    className="rounded-lg bg-black/60 p-1.5 text-white backdrop-blur-sm transition-all hover:bg-black/80"
                                    title="放大查看"
                                  >
                                    <Maximize2 size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void handleDownloadImage(src, index);
                                    }}
                                    className="rounded-lg bg-black/60 p-1.5 text-white backdrop-blur-sm transition-all hover:bg-black/80"
                                    title="下载图片"
                                  >
                                    <Download size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {isSubmitting && (
                    <div className="flex justify-start">
                      <div className={`max-w-[88%] rounded-2xl rounded-tl-md px-4 py-3 ${
                        isLightTheme
                          ? "border border-black/10 bg-black/[0.04]"
                          : "border border-border-primary bg-bg-hover"
                      }`}>
                        <div className="flex items-center gap-3">
                          <Loader2 size={18} className="text-accent animate-spin" />
                          <div>
                            <p className={`text-sm ${isLightTheme ? "text-[#111111]" : "text-text-primary"}`}>
                              {currentEntryMode === "agent" ? "正在理解你的需求并判断是否需要生图..." : "正在生成内容..."}
                            </p>
                            <p className={`mt-0.5 text-xs ${isLightTheme ? "text-black/45" : "text-text-tertiary"}`}>
                              处理结果会继续显示在这里
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {outputError ? (
                    <div className="flex justify-start">
                      <div className="max-w-[88%] rounded-2xl rounded-tl-md border border-rose-400/20 bg-rose-500/5 px-4 py-3">
                        <p className="text-sm text-rose-300">处理失败</p>
                        <p className="mt-1 text-xs leading-6 text-text-tertiary">
                          {outputError}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  <div ref={outputEndRef} />
                </div>
              ) : (
                <div className={`h-full min-h-[120px] text-xs leading-6 ${isLightTheme ? "text-black/45" : "text-text-tertiary"}`}>
                  {outputIdleText}
                </div>
              )}
            </div>
          </div>

          <div className="px-4 pb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <div
              className={`rounded-xl p-2.5 transition-all ${
                dragOver
                  ? "bg-accent/10 border-2 border-dashed border-accent/50"
                  : isLightTheme
                    ? "bg-black/[0.03] border border-black/10 focus-within:border-accent/40"
                    : "bg-bg-tertiary border border-border-primary focus-within:border-accent/40"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDragOver(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDragOver(false);
                void handleFileDrop(event.dataTransfer.files);
              }}
            >
              {displayAttachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {displayAttachments.slice(-3).map((item) => (
                    item.isImage ? (
                      <div
                        key={item.id}
                        className={`relative h-12 w-12 rounded-lg overflow-hidden ${
                          isLightTheme
                            ? "border border-black/10 bg-black/[0.04]"
                            : "border border-border-primary bg-bg-hover"
                        }`}
                        title={item.name}
                      >
                        <Image
                          src={item.previewUrl}
                          alt={item.name}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                        <button
                          type="button"
                          className="absolute right-1 top-1 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/65 text-white transition-all hover:bg-black/80"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleRemoveAttachment(item);
                          }}
                          title="删除图片"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ) : (
                      <span
                        key={item.id}
                        className={`max-w-[180px] truncate px-2 py-1 rounded-lg text-[10px] ${
                          isLightTheme
                            ? "bg-black/[0.04] text-black/55 border border-black/10"
                            : "bg-bg-hover text-text-secondary border border-border-primary"
                        }`}
                        title={item.name}
                      >
                        {item.name}
                      </span>
                    )
                  ))}
                  <button
                    type="button"
                    className={`inline-flex h-12 items-center gap-1.5 rounded-lg border border-dashed px-3 text-[10px] transition-all hover:border-accent/40 ${
                      isLightTheme
                        ? "border-black/12 bg-black/[0.04] text-black/55 hover:text-black/80"
                        : "border-border-primary bg-bg-hover text-text-secondary hover:text-text-primary"
                    }`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <Plus size={11} />
                    继续上传
                  </button>
                  {displayAttachments.length > 3 && (
                    <span className={`px-2 py-1 rounded-lg text-[10px] ${
                      isLightTheme
                        ? "bg-black/[0.04] text-black/45 border border-black/10"
                        : "bg-bg-hover text-text-tertiary border border-border-primary"
                    }`}>
                      +{displayAttachments.length - 3}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all ${
                    isLightTheme
                      ? "text-black/45 hover:bg-black/[0.05] hover:text-black/80"
                      : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                  title="添加文件"
                >
                  <Plus size={16} />
                </button>
                <textarea
                  value={prompt}
                  onChange={(event) => onPromptChange?.(event.target.value)}
                  rows={1}
                  placeholder={dragOver ? "松手添加文件或图片..." : placeholder}
                  className={`flex-1 min-h-[24px] max-h-28 py-1 bg-transparent text-sm outline-none resize-none leading-6 overflow-y-auto ${
                    isLightTheme
                      ? "text-[#111111] placeholder:text-black/35"
                      : "text-text-primary placeholder-text-tertiary"
                  }`}
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit || isSubmitting}
                  className={`flex-shrink-0 p-2 rounded-lg transition-all self-center ${
                    !canSubmit || isSubmitting
                      ? "text-text-tertiary cursor-not-allowed"
                      : "bg-accent hover:bg-accent-hover text-white"
                  }`}
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </div>

        </div>
      )}

      {!expanded && (
        <button
          type="button"
          className="pointer-events-auto fixed bg-transparent transition-all hover:scale-[1.03] active:scale-[0.98] flex items-center justify-center"
          style={{
            left: ballPosition.x,
            top: ballPosition.y,
            width: BALL_SIZE,
            height: BALL_SIZE,
          }}
          onPointerDown={(event) => startDragging(event, { toggleOnClick: true })}
          title="打开悬浮生成入口"
        >
          <Image
            src="/images/floating-greeting.svg"
            alt=""
            width={112}
            height={112}
            className="relative w-[112px] h-[112px] object-contain"
            aria-hidden="true"
          />
        </button>
      )}

      {previewSrc && <ImageLightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />}

      <style jsx>{`
        .floating-logo-wrap {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .floating-logo-image {
          display: block;
        }
      `}</style>
    </div>
  );
}
