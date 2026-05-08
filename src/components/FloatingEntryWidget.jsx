"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronUp,
  Copy,
  Download,
  Gauge,
  Loader2,
  Mic,
  MicOff,
  Minus,
  Minimize2,
  Maximize2,
  Moon,
  Send,
  Plus,
  RefreshCw,
  Square,
  Sun,
  Trash2,
  X,
} from "lucide-react";

const BALL_SIZE = 120;

/** 麦克风按钮：点击 = 手动单次对话 / 打断正在进行的对话 */
function MicButton({ voiceState, onClick }) {
  const isActive = voiceState === "listening" || voiceState === "thinking" || voiceState === "speaking";
  const bg = voiceState === "listening"
    ? "#ef4444"
    : voiceState === "thinking" || voiceState === "speaking"
      ? "#f59e0b"
      : "#16a34a"; // 深绿 = 唤醒常驻

  const title = isActive ? "点击停止" : "点击手动对话（唤醒词也可直接叫「小亿」）";

  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className="absolute flex items-center justify-center rounded-full shadow-lg transition-colors hover:scale-110 active:scale-95"
      style={{ bottom: 2, right: 2, width: 30, height: 30, background: bg, zIndex: 2 }}
    >
      {voiceState === "listening" ? (
        <Square size={11} className="text-white fill-white" />
      ) : isActive ? (
        <Loader2 size={13} className="text-white animate-spin" />
      ) : (
        <Mic size={13} className="text-white" />
      )}
    </button>
  );
}
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
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const imageSrc = appendImageRetryParam(src, retry);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 2500);
    return () => window.clearTimeout(timer);
  }, [src]);

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
      <div className="relative flex max-h-[90vh] max-w-[90vw] items-center justify-center" onClick={(event) => event.stopPropagation()}>
        {!loaded ? (
          <div className="absolute inset-0 flex min-h-[260px] min-w-[320px] items-center justify-center">
            <div className="rounded-2xl bg-black/45 px-5 py-4 text-center text-white shadow-2xl backdrop-blur-sm">
              {failed ? (
                <>
                  <p className="text-sm font-medium">本地预览加载失败</p>
                  <p className="mt-1 text-xs text-white/60">图片已生成，可先在飞书查看。</p>
                </>
              ) : (
                <>
                  <Loader2 size={24} className="mx-auto animate-spin text-accent" />
                  <p className="mt-3 text-sm font-medium">正在加载预览</p>
                  <p className="mt-1 text-xs text-white/60">{slow ? "本地图片较大，加载可能需要几秒。" : "请稍候..."}</p>
                </>
              )}
            </div>
          </div>
        ) : null}
        <img
          src={imageSrc}
          alt="预览"
          className={`max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => {
            setLoaded(true);
            setFailed(false);
          }}
          onError={() => {
            setLoaded(false);
            if (retry < 4) {
              window.setTimeout(() => setRetry((value) => value + 1), 450);
            } else {
              setFailed(true);
            }
          }}
        />
      </div>
    </div>
  );
}

function resolveImageSrc(src = "") {
  const value = String(src || "").trim();
  if (!value) return "";
  if (value.startsWith("data:") || value.startsWith("blob:") || /^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? value : `/${value}`;
}

function appendImageRetryParam(src = "", retry = 0) {
  const value = resolveImageSrc(src);
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return value;
  const separator = value.includes("?") ? "&" : "?";
  return `${value}${separator}retry=${retry}`;
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

function MarkdownRenderer({ text, isLightTheme }) {
  const textColor = isLightTheme ? "text-[#1f1f1f]" : "text-text-primary";
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
        p({ children }) {
          return (
            <p className={`text-[14px] leading-7 ${textColor} mb-3 last:mb-0`}>
              {children}
            </p>
          );
        },
        h1({ children }) {
          return (
            <h1 className={`text-[18px] font-bold leading-7 mb-3 mt-5 first:mt-0 ${isLightTheme ? "text-[#111]" : "text-white"}`}>
              {children}
            </h1>
          );
        },
        h2({ children }) {
          return (
            <h2 className={`text-[16px] font-semibold leading-7 mb-2 mt-5 first:mt-0 ${isLightTheme ? "text-[#111]" : "text-white"}`}>
              {children}
            </h2>
          );
        },
        h3({ children }) {
          return (
            <h3 className={`text-[15px] font-semibold leading-7 mb-2 mt-4 first:mt-0 ${isLightTheme ? "text-[#111]" : "text-white"}`}>
              {children}
            </h3>
          );
        },
        ul({ children }) {
          return (
            <ul className={`mb-3 last:mb-0 space-y-1 pl-4 ${isLightTheme ? "[&>li::marker]:text-black/40" : "[&>li::marker]:text-white/40"}`}
              style={{ listStyleType: "disc" }}
            >
              {children}
            </ul>
          );
        },
        ol({ children }) {
          return (
            <ol className={`mb-3 last:mb-0 space-y-1 pl-5 ${isLightTheme ? "[&>li::marker]:text-black/50" : "[&>li::marker]:text-white/50"}`}
              style={{ listStyleType: "decimal" }}
            >
              {children}
            </ol>
          );
        },
        li({ children }) {
          return (
            <li className={`text-[14px] leading-7 pl-1 ${textColor} [&>ul]:mt-1 [&>ol]:mt-1`}>
              {children}
            </li>
          );
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className={`underline underline-offset-2 break-all ${linkColor}`}
            >
              {children}
            </a>
          );
        },
        strong({ children }) {
          return (
            <strong className={`font-semibold ${isLightTheme ? "text-[#111]" : "text-white"}`}>
              {children}
            </strong>
          );
        },
        em({ children }) {
          return (
            <em className={`italic ${mutedColor}`}>
              {children}
            </em>
          );
        },
        code({ inline, children }) {
          if (inline) {
            return (
              <code className={`rounded px-1.5 py-0.5 text-[12.5px] font-mono ${codeBg}`}>
                {children}
              </code>
            );
          }
          return (
            <code className={`block w-full rounded-xl px-4 py-3 text-[12.5px] font-mono leading-6 overflow-x-auto whitespace-pre ${codeBlockBg} ${textColor} mb-3`}>
              {children}
            </code>
          );
        },
        pre({ children }) {
          return <pre className="mb-3 last:mb-0">{children}</pre>;
        },
        blockquote({ children }) {
          return (
            <blockquote className={`border-l-4 pl-4 my-3 ${blockquoteBorder}`}>
              {children}
            </blockquote>
          );
        },
        hr() {
          return <hr className={`my-5 border-t ${borderColor}`} />;
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto mb-3">
              <table className={`w-full text-[13px] border-collapse ${textColor}`}>
                {children}
              </table>
            </div>
          );
        },
        thead({ children }) {
          return (
            <thead className={`border-b ${borderColor}`}>
              {children}
            </thead>
          );
        },
        th({ children }) {
          return (
            <th className={`px-3 py-2 text-left font-semibold ${isLightTheme ? "text-[#111]" : "text-white"}`}>
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className={`px-3 py-2 border-b ${borderColor} ${textColor}`}>
              {children}
            </td>
          );
        },
      }}
    >
      {String(text || "")}
    </ReactMarkdown>
  );
}

function BatchWaImage({ src, alt, onPreview, onDownload }) {
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imageSrc = appendImageRetryParam(src, retry);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black/[0.04]">
      <button type="button" className="absolute inset-0" onClick={onPreview} title="放大查看">
        {!loaded ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/[0.06]">
            <div className="flex max-w-[170px] flex-col items-center gap-2 px-4 text-center">
              {failed ? (
                <>
                  <Maximize2 size={18} className="text-accent" />
                  <p className="text-[11px] leading-5 text-text-tertiary">预览加载失败，图片已回填飞书</p>
                </>
              ) : (
                <>
                  <Loader2 size={18} className="animate-spin text-accent" />
                  <p className="text-[11px] leading-5 text-text-tertiary">图片已生成，正在加载预览</p>
                </>
              )}
            </div>
          </div>
        ) : null}
        <img
          src={imageSrc}
          alt={alt}
          className={`h-full w-full object-cover transition-opacity hover:opacity-95 ${loaded ? "opacity-100" : "opacity-0"}`}
          loading="lazy"
          decoding="async"
          onLoad={() => {
            setLoaded(true);
            setFailed(false);
          }}
          onError={() => {
            setLoaded(false);
            if (retry < 5) {
              window.setTimeout(() => setRetry((value) => value + 1), 500);
            } else {
              setFailed(true);
            }
          }}
        />
      </button>
      <div className="absolute right-2 top-2 z-[1] flex items-center gap-1.5">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPreview?.();
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
            onDownload?.();
          }}
          className="rounded-lg bg-black/60 p-1.5 text-white backdrop-blur-sm transition-all hover:bg-black/80"
          title="下载图片"
        >
          <Download size={14} />
        </button>
      </div>
    </div>
  );
}

function BatchWaResultGrid({ message, isLightTheme, isSubmitting, onStopBatchWa, onPreview, onDownload }) {
  const items = Array.isArray(message.batchWaItems) ? message.batchWaItems : [];
  if (!items.length) return null;
  const successCount = items.filter((item) => item.status === "success").length;
  const isActive = isSubmitting && !message.batchWaStopped && items.some((item) => item.status === "queued" || item.status === "generating" || item.status === "retrying");

  return (
    <div className="mt-2 w-full">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className={`text-[12px] ${isLightTheme ? "text-black/50" : "text-text-tertiary"}`}>
          批量进度：{successCount}/{items.length}
        </div>
        {isActive ? (
          <button
            type="button"
            onClick={onStopBatchWa}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-accent transition-all hover:bg-accent/10"
          >
            <Square size={11} />
            停止全部
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item, index) => {
          const src = item.urls?.[0] || "";
          const statusText = item.status === "success"
            ? "已完成"
            : item.status === "queued"
              ? "排队中"
            : item.status === "retrying"
              ? "重试中"
              : item.status === "failed"
                ? "失败"
                : item.status === "stopped"
                  ? "已停止"
                  : "生成中";
          return (
            <div key={item.id || `${message.id}-${index}`} className={`rounded-xl p-2 ${
              isLightTheme ? "border border-black/8 bg-white" : "border border-white/8 bg-black/10"
            }`}>
              <div className={`mb-1 flex items-center justify-between gap-2 text-[11px] ${isLightTheme ? "text-black/55" : "text-text-tertiary"}`}>
                <span>{item.label || `第 ${index + 1} 张`}</span>
                <span>{statusText}</span>
              </div>
              {src ? (
                <>
                  <BatchWaImage
                    src={src}
                    alt={`${item.label || `第 ${index + 1} 张`} 生成结果`}
                    onPreview={() => onPreview(resolveImageSrc(src))}
                    onDownload={() => onDownload(src, index)}
                  />
                  {item.feishuStatus ? (
                    <div className={`mt-1 text-[10px] leading-4 ${
                      item.feishuStatus === "failed"
                        ? "text-amber-400"
                        : isLightTheme ? "text-black/42" : "text-text-tertiary"
                    }`}>
                      {item.feishuStatus === "uploading"
                        ? "正在回填飞书..."
                        : item.feishuStatus === "success"
                          ? "已回填飞书"
                          : `飞书回填失败：${item.feishuError || "请稍后重试"}`}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className={`relative aspect-square overflow-hidden rounded-xl ${
                  isLightTheme ? "bg-[#f1f1f1]" : "bg-white/[0.055]"
                }`}>
                  {item.status === "failed" || item.status === "stopped" ? (
                    <div className={`absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] leading-5 ${
                      isLightTheme ? "text-black/42" : "text-text-tertiary"
                    }`}>
                      {item.status === "failed" ? (item.error || "生成失败") : statusText}
                    </div>
                  ) : (
                    <>
                      <div className={`absolute inset-0 animate-pulse ${
                        isLightTheme
                          ? "bg-gradient-to-br from-black/[0.02] via-white/60 to-black/[0.04]"
                          : "bg-gradient-to-br from-white/[0.03] via-white/[0.10] to-white/[0.03]"
                      }`} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex max-w-[180px] flex-col items-center gap-2 px-4 text-center">
                          <Loader2 size={20} className="animate-spin text-accent" />
                          <div>
                            <p className={`text-[12px] font-medium ${isLightTheme ? "text-black/70" : "text-text-primary"}`}>
                              {item.status === "queued" ? "等待生成队列" : item.status === "retrying" ? "正在重试生成" : "正在生成图片"}
                            </p>
                            <p className={`mt-1 text-[11px] leading-5 ${isLightTheme ? "text-black/42" : "text-text-tertiary"}`}>
                              {item.status === "queued" ? "前面的图片完成后自动开始" : "生成完成后会自动显示"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
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
  generationStage = null,
  entryMode = "quick",
  submitLabel = "开始",
  outputError = "",
  outputIdleText = "结果输出区域",
  defaultExpanded = false,
  showLauncher = true,
  onNewChat,
  onSelectHistory,
  onDeleteHistory,
  onDeleteMessage,
  onRegenerateMessage,
  onStopBatchWa,
  onClose,
  onExpandFullscreen,
}) {
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);

  // 语音交互状态: idle | wake | listening | thinking | speaking
  const [voiceState, setVoiceState] = useState("idle");
  const [voiceBubbleText, setVoiceBubbleText] = useState("");
  const [showVoiceBubble, setShowVoiceBubble] = useState(false);
  // 唤醒词模式始终开启，wakeEnabled 仅用于指示麦克风权限是否已获取
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const recognitionRef = useRef(null);     // 指令识别
  const wakeRecognitionRef = useRef(null); // 唤醒词监听
  const voiceBubbleTimerRef = useRef(null);
  const wakeRestartTimerRef = useRef(null);
  const avatarClickTimerRef = useRef(null);
  const lastAvatarClickAtRef = useRef(0);
  const wakeEnabledRef = useRef(false);
  const voiceStateRef = useRef("idle");
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
  const [expandedQualityId, setExpandedQualityId] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelTheme, setPanelTheme] = useState("dark");
  const [isLogoMenuOpen, setIsLogoMenuOpen] = useState(false);

  // ── 随机问候气泡 ──────────────────────────────────────
  const GREET_MESSAGES = [
    "小亿随时为你工作 💼",
    "快来陪俺玩耍吧 🎮",
    "我一直在等你 👀",
    "帮您分忧是小亿的无上使命 🫡",
    "有什么想创作的，尽管说！ ✨",
    "今天也要元气满满哦 🌟",
    "让我来帮你搞定一切 🚀",
  ];
  const [greetText, setGreetText] = useState("");
  const [showGreet, setShowGreet] = useState(false);
  const greetTimerRef = useRef(null);

  useEffect(() => {
    function scheduleGreet(delay) {
      greetTimerRef.current = setTimeout(() => {
        if (expanded) { scheduleGreet(12000); return; }
        setGreetText(GREET_MESSAGES[Math.floor(Math.random() * GREET_MESSAGES.length)]);
        setShowGreet(true);
        greetTimerRef.current = setTimeout(() => {
          setShowGreet(false);
          scheduleGreet(8000 + Math.random() * 7000);
        }, 4000);
      }, delay);
    }
    scheduleGreet(3000);
    return () => clearTimeout(greetTimerRef.current);
  }, [expanded]);
  // ─────────────────────────────────────────────────────

  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const outputEndRef = useRef(null);
  const logoMenuRef = useRef(null);
  const currentEntryMode = entryMode === "agent" ? "agent" : "quick";
  const isLightTheme = panelTheme === "light";
  const activeGenerationStage = generationStage || {
    label: "正在生成图片",
    detail: "生成完成后会自动显示",
  };
  const hasActiveBatchWa = messages.some((message) => (
    Array.isArray(message.batchWaItems)
    && message.batchWaItems.some((item) => item.status === "queued" || item.status === "generating" || item.status === "retrying")
    && !message.batchWaStopped
  ));

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

  // ── 页面加载后自动开启唤醒词监听 ─────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return undefined;

    // 延迟 1.2s 启动，等页面渲染完成
    const timer = setTimeout(() => {
      wakeEnabledRef.current = true;
      setWakeEnabled(true);
      setVS("wake");
      startWakeListening();
    }, 1200);

    return () => {
      clearTimeout(timer);
      clearTimeout(wakeRestartTimerRef.current);
      clearTimeout(avatarClickTimerRef.current);
      wakeEnabledRef.current = false;
      try { wakeRecognitionRef.current?.abort(); } catch {}
      try { recognitionRef.current?.abort(); } catch {}
      try { window.speechSynthesis?.cancel(); } catch {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── 语音 / 唤醒词交互逻辑 ────────────────────────────────

  const WAKE_WORDS = ["小亿", "小亿同学", "小亿你好", "嗨小亿"];

  function setVS(state) {
    voiceStateRef.current = state;
    setVoiceState(state);
  }

  function showBubble(text) {
    clearTimeout(voiceBubbleTimerRef.current);
    setVoiceBubbleText(text);
    setShowVoiceBubble(true);
  }

  function hideBubbleAfter(ms = 4000) {
    clearTimeout(voiceBubbleTimerRef.current);
    voiceBubbleTimerRef.current = setTimeout(() => setShowVoiceBubble(false), ms);
  }

  function abortAllRecognition() {
    try { recognitionRef.current?.abort(); } catch {}
    try { wakeRecognitionRef.current?.abort(); } catch {}
    clearTimeout(wakeRestartTimerRef.current);
  }

  function stopVoice() {
    abortAllRecognition();
    try { window.speechSynthesis?.cancel(); } catch {}
    setVS("idle");
    setShowVoiceBubble(false);
    clearTimeout(voiceBubbleTimerRef.current);
  }

  async function callVoiceApi(text) {
    try {
      const res = await fetch("/api/voice-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      return data?.reply || "嗯，我在想～";
    } catch {
      return "网络有点卡，稍后再试吧～";
    }
  }

  function getCnVoice() {
    if (typeof window === "undefined" || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((v) =>
        (v.lang === "zh-CN" || v.lang === "zh-TW") &&
        /female|女|Ting|Xiaoxiao|Yaoyao|Xiaoyi/i.test(v.name)
      ) || voices.find((v) => v.lang === "zh-CN" || v.lang === "zh-TW") || null
    );
  }

  function speakReply(text, onDone) {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      hideBubbleAfter(5000);
      setVS("idle");
      onDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "zh-CN";
    utter.rate = 1.05;
    utter.pitch = 1.1;
    const voice = getCnVoice();
    if (voice) utter.voice = voice;

    const finish = () => {
      setVS("idle");
      hideBubbleAfter(3000);
      onDone?.();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  }

  // ── 指令监听（唤醒后 / 手动点击后）─────────────────────

  function startCommandListening(onFinish) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognitionRef.current = recognition;

    recognition.onresult = async (event) => {
      const transcript = event.results[0]?.[0]?.transcript || "";
      if (!transcript.trim()) {
        showBubble("没听清楚，再说一遍？");
        hideBubbleAfter(2000);
        setVS("idle");
        onFinish?.();
        return;
      }
      setVS("thinking");
      showBubble(`💬 "${transcript}"`);
      const reply = await callVoiceApi(transcript);
      setVS("speaking");
      showBubble(reply);
      speakReply(reply, onFinish);
    };

    recognition.onerror = (e) => {
      const msg = e.error === "no-speech" ? "没听到声音，靠近麦克风再试" : "识别出错，请重试";
      showBubble(msg);
      hideBubbleAfter(2000);
      setVS("idle");
      onFinish?.();
    };

    recognition.onend = () => {
      if (voiceStateRef.current === "listening") {
        setVS("idle");
        onFinish?.();
      }
    };

    setVS("listening");
    showBubble("👂 说吧，我在听...");
    recognition.start();
  }

  // ── 唤醒词持续监听 ────────────────────────────────────

  function scheduleWakeRestart(delay = 600) {
    clearTimeout(wakeRestartTimerRef.current);
    wakeRestartTimerRef.current = setTimeout(() => {
      if (wakeEnabledRef.current && voiceStateRef.current === "wake") {
        startWakeListening();
      }
    }, delay);
  }

  function startWakeListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !wakeEnabledRef.current) return;

    try { wakeRecognitionRef.current?.abort(); } catch {}

    const recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    wakeRecognitionRef.current = recognition;

    let wakeTriggered = false;

    recognition.onresult = (event) => {
      if (wakeTriggered) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        const hit = WAKE_WORDS.find((w) => text.includes(w));
        if (hit) {
          wakeTriggered = true;
          recognition.abort();

          // 截取唤醒词之后的命令
          const after = text.slice(text.indexOf(hit) + hit.length).replace(/[，。！？,!?]/g, "").trim();

          showBubble("✨ 诶！我在呢～");
          setVS("listening");

          if (after) {
            // 唤醒词和命令在同一句
            setTimeout(async () => {
              setVS("thinking");
              showBubble(`💬 "${after}"`);
              const reply = await callVoiceApi(after);
              setVS("speaking");
              showBubble(reply);
              speakReply(reply, () => {
                if (wakeEnabledRef.current) { setVS("wake"); scheduleWakeRestart(800); }
              });
            }, 500);
          } else {
            // 等待用户说命令
            setTimeout(() => {
              startCommandListening(() => {
                if (wakeEnabledRef.current) { setVS("wake"); scheduleWakeRestart(800); }
              });
            }, 600);
          }
          break;
        }
      }
    };

    recognition.onend = () => {
      if (!wakeTriggered) scheduleWakeRestart(400);
    };

    recognition.onerror = (e) => {
      if (e.error !== "aborted") scheduleWakeRestart(1000);
    };

    recognition.start();
  }

  // ── 麦克风按钮点击：正在进行中则停止，否则手动开始单次对话 ──

  function handleMicClick() {
    if (typeof window === "undefined") return;
    const state = voiceStateRef.current;

    // 正在进行中：中断并恢复唤醒待机
    if (state === "listening" || state === "thinking" || state === "speaking") {
      abortAllRecognition();
      try { window.speechSynthesis?.cancel(); } catch {}
      setVS("wake");
      setShowVoiceBubble(false);
      clearTimeout(voiceBubbleTimerRef.current);
      scheduleWakeRestart(500);
      return;
    }

    // 空闲 / 唤醒待机：手动触发单次对话
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showBubble("⚠️ 请使用 Chrome 或 Edge");
      hideBubbleAfter(3000);
      return;
    }
    try { wakeRecognitionRef.current?.abort(); } catch {}
    clearTimeout(wakeRestartTimerRef.current);
    startCommandListening(() => {
      // 对话结束后回到唤醒待机
      setVS("wake");
      scheduleWakeRestart(600);
    });
  }

  // ─────────────────────────────────────────────────────────

  const openPanelNearBall = () => {
    setPanelPosition((prev) => {
      const safePrev = clampPanelPosition(prev, panelSize, viewport);
      const nearBall = getPanelPositionFromBall(ballPosition, panelSize, viewport);
      if (safePrev.left === VIEWPORT_PADDING && safePrev.top === VIEWPORT_PADDING) {
        return nearBall;
      }
      return safePrev;
    });
    setExpanded((prev) => !prev);
  };

  const handleAvatarClick = () => {
    const now = Date.now();
    const isDoubleClick = now - lastAvatarClickAtRef.current < 280;
    lastAvatarClickAtRef.current = now;

    clearTimeout(avatarClickTimerRef.current);

    if (isDoubleClick) {
      openPanelNearBall();
      return;
    }

    avatarClickTimerRef.current = setTimeout(() => {
      handleMicClick();
    }, 120);
  };

  const startDragging = (event, { toggleOnClick = false, clickAction = "toggle" } = {}) => {
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
        if (clickAction === "voice") {
          handleAvatarClick();
        } else {
          openPanelNearBall();
        }
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
    const imageSrc = resolveImageSrc(src);
    if (!imageSrc) return;

    try {
      const response = await fetch(imageSrc);
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
      anchor.href = imageSrc;
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
    if (onExpandFullscreen) {
      onExpandFullscreen();
      return;
    }

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

  const placeholder = "释放创意，一键帮你完成重复且无聊的工作~";

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
                  <BrandLogo className="floating-logo-image h-6" showText={false} />
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
                                ? <MarkdownRenderer text={message.text} isLightTheme={isLightTheme} />
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

                        {message.role === "user" ? (
                          <div className="mt-2 flex items-center justify-end gap-2 px-1">
                            <button
                              type="button"
                              onClick={() => onDeleteMessage?.(message.id)}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-all ${
                                isLightTheme
                                  ? "text-black/45 hover:bg-red-500/10 hover:text-red-500"
                                  : "text-text-tertiary hover:bg-red-500/10 hover:text-red-300"
                              }`}
                              title="删除这条输入"
                            >
                              <Trash2 size={12} />
                              删除
                            </button>
                          </div>
                        ) : null}

                        {message.role === "assistant" && (message.text || message.modelLabel) && !message.images?.length ? (
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

                        {Array.isArray(message.batchWaItems) && message.batchWaItems.length > 0 ? (
                          <BatchWaResultGrid
                            message={message}
                            isLightTheme={isLightTheme}
                            isSubmitting={isSubmitting}
                            onStopBatchWa={onStopBatchWa}
                            onPreview={setPreviewSrc}
                            onDownload={handleDownloadImage}
                          />
                        ) : null}

                        {message.images?.length > 0 && (
                          <div className="mt-2">
                            <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${message.role === "user" ? "justify-items-end" : ""}`}>
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
                                  <div className="absolute right-2 top-2 z-[1] flex items-center gap-1.5">
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
                            {message.role === "assistant" ? (
                              <div className="mt-2 flex items-center justify-start gap-2 px-1">
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
                                    title="查看质检结果"
                                  >
                                    <Gauge size={12} />
                                    质检 {Number(message.qualityCheck.score || 0)}/100
                                    <ChevronUp size={11} className={`transition-transform ${expandedQualityId === message.id ? "" : "rotate-180"}`} />
                                  </button>
                                ) : null}
                                {message.qualityCheck ? (
                                  <button
                                    type="button"
                                    onClick={() => onRegenerateMessage?.(message.id)}
                                    disabled={isSubmitting}
                                    className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                                      isLightTheme
                                        ? "text-black/45 hover:bg-black/[0.04] hover:text-black/80"
                                        : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                                    }`}
                                    title="按质检建议重新生成"
                                  >
                                    <RefreshCw size={12} />
                                    按建议重生
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                            {message.qualityCheck && expandedQualityId === message.id ? (
                              <div className={`mt-2 rounded-xl px-3 py-2 text-[12px] leading-6 ${
                                isLightTheme
                                  ? "border border-black/8 bg-black/[0.035] text-black/65"
                                  : "border border-border-primary bg-bg-hover text-text-secondary"
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
                      </div>
                    </div>
                  ))}

                  {isSubmitting && !hasActiveBatchWa && (
                    <div className="flex justify-start">
                      <div className="w-full max-w-[260px]">
                        <div className={`relative aspect-square overflow-hidden rounded-2xl ${
                          isLightTheme ? "bg-[#f1f1f1]" : "bg-white/[0.055]"
                        }`}>
                          <div className={`absolute inset-0 animate-pulse ${
                            isLightTheme
                              ? "bg-gradient-to-br from-black/[0.02] via-white/60 to-black/[0.04]"
                              : "bg-gradient-to-br from-white/[0.03] via-white/[0.10] to-white/[0.03]"
                          }`} />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex max-w-[210px] flex-col items-center gap-3 px-5 text-center">
                              <Loader2 size={22} className="animate-spin text-accent" />
                              <div>
                                <p className={`text-xs font-medium ${isLightTheme ? "text-black/70" : "text-text-primary"}`}>
                                  {activeGenerationStage.label}
                                </p>
                                <p className={`mt-1 text-[11px] leading-5 ${isLightTheme ? "text-black/42" : "text-text-tertiary"}`}>
                                  {activeGenerationStage.detail}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-end px-1">
                          <span className={`text-[11px] ${isLightTheme ? "text-black/35" : "text-text-tertiary"}`}>
                            生成完成后会自动显示
                          </span>
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


          <div className={`relative z-[5] px-4 pb-4 ${isLightTheme ? "bg-white/95" : "bg-bg-secondary/95"}`}>
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
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSubmit();
                    }
                  }}
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
        <div
          className="pointer-events-auto fixed"
          style={{ left: ballPosition.x, top: ballPosition.y, width: BALL_SIZE, height: BALL_SIZE }}
        >

          {/* 聆听时的脉冲光环 */}
          {voiceState === "listening" && (
            <>
              <span className="absolute inset-0 rounded-full animate-ping"
                style={{ background: "rgba(34,197,94,0.20)", animationDuration: "1s", borderRadius: "50%", transform: "scale(1.35)" }} />
              <span className="absolute inset-0 rounded-full animate-ping"
                style={{ background: "rgba(34,197,94,0.12)", animationDuration: "1.7s", borderRadius: "50%", transform: "scale(1.7)" }} />
            </>
          )}

          {/* 思考/说话时的慢速光晕 */}
          {(voiceState === "thinking" || voiceState === "speaking") && (
            <span className="absolute inset-0 rounded-full"
              style={{
                background: voiceState === "speaking" ? "rgba(34,197,94,0.16)" : "rgba(250,204,21,0.20)",
                borderRadius: "50%",
                transform: "scale(1.35)",
                animation: "pulse 1.5s ease-in-out infinite",
              }} />
          )}

          {/* 问候气泡 */}
          {showGreet && !showVoiceBubble && (
            <div
              className="absolute"
              style={{ bottom: "calc(100% + 14px)", left: "50%", transform: "translateX(-50%)", zIndex: 10, minWidth: 160, maxWidth: 240,
                opacity: showGreet ? 1 : 0, transition: "opacity 0.35s ease" }}
            >
              <div
                className="text-[14px] font-semibold whitespace-nowrap text-center"
                style={{ color: "#fff" }}
              >
                {greetText}
              </div>
            </div>
          )}

          {/* 语音气泡 */}
          {showVoiceBubble && voiceBubbleText && (
            <div
              className="absolute"
              style={{ bottom: "calc(100% + 14px)", left: "50%", transform: "translateX(-50%)", zIndex: 10, minWidth: 160, maxWidth: 220 }}
            >
              <div
                className="rounded-2xl px-3 py-2 text-[13px] leading-snug shadow-xl"
                style={{
                  background: voiceState === "speaking" ? "linear-gradient(135deg,#f0fdf4,#dcfce7)" : "#fff",
                  color: "#1a2e1a",
                  border: voiceState === "listening" ? "1.5px solid #4ade80" : "1px solid #e5e7eb",
                  textAlign: "center",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {voiceState === "thinking" && (
                  <span className="inline-flex gap-0.5 mr-1 align-middle">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" style={{ animation: "bounce 0.8s 0s infinite" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" style={{ animation: "bounce 0.8s 0.15s infinite" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" style={{ animation: "bounce 0.8s 0.3s infinite" }} />
                  </span>
                )}
                {voiceBubbleText}
              </div>
              {/* 气泡小三角 */}
              <div className="absolute left-1/2 -translate-x-1/2"
                style={{ bottom: -7, width: 14, height: 14, background: voiceState === "speaking" ? "#dcfce7" : "#fff", borderRight: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb", transform: "translateX(-50%) rotate(45deg)" }} />
            </div>
          )}

          {/* 主球体按钮（拖拽 + 点击展开） */}
          <button
            type="button"
            className="absolute inset-0 bg-transparent transition-all hover:scale-[1.03] active:scale-[0.98] flex items-center justify-center"
            onPointerDown={(event) => startDragging(event, { toggleOnClick: true, clickAction: "voice" })}
            title="点击语音对话，双击打开输入面板"
          >
            <Image
              src="/images/floating-avatar-v2.png"
              alt=""
              width={132}
              height={132}
              className="relative w-[132px] h-[132px] object-contain"
              unoptimized
              aria-hidden="true"
            />
          </button>

          {/* 麦克风按钮（点击 = 单次对话 / 唤醒中点击 = 关闭；长按 = 开启/关闭唤醒词） */}
          {/* 只在有语音活动时才显示麦克风按钮 */}
          {voiceState !== "idle" && voiceState !== "wake" && (
            <MicButton
              voiceState={voiceState}
              onClick={handleMicClick}
            />
          )}
        </div>
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

        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-4px); opacity: 1; }
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
