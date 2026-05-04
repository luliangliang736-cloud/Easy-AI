"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import {
  Send,
  ImagePlus,
  ImageIcon,
  X,
  Plus,
  Sun,
  Moon,
  Clock,
  Settings2,
  ChevronDown,
  Search,
  MessageSquareText,
  Loader2,
  AlertCircle,
  RotateCw,
  Download,
  Play,
  PauseCircle,
  Pause,
  Crown,
  Rocket,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { compressImage } from "@/lib/imageUtils";
import { MAX_GEN_COUNT } from "@/lib/genLimits";
import TextEditBlocksPanel from "@/components/TextEditBlocksPanel";
import BrandLogo from "@/components/BrandLogo";

const CANVAS_IMAGE_MIME = "application/x-easy-ai-canvas-image";

const MODEL_TIERS = [
  {
    id: "flash2",
    name: "Nano Banana 2",
    icon: Rocket,
    desc: "推荐 · 高性价比",
    variants: [
      { model: "gemini-3.1-flash-image-preview", label: "默认", credits: { default: 0, priority: 0 } },
    ],
    maxInputImages: 10,
    extendedRatios: true,
    serviceTierOptions: false,
  },
  {
    id: "pro",
    name: "Nano Banana Pro",
    icon: Crown,
    desc: "专业画质 · Thinking",
    variants: [
      { model: "gemini-3-pro-image-preview", label: "默认", credits: { default: 0, priority: 0 } },
    ],
    maxInputImages: 14,
    extendedRatios: false,
    serviceTierOptions: false,
  },
  {
    id: "chatgpt-image2",
    name: "GPT Image 2",
    icon: Sparkles,
    desc: "GPT 生图 · 已接入",
    variants: [
      { model: "gpt-image-2", label: "1K", credits: { default: 0, priority: 0 } },
    ],
    maxInputImages: 10,
    extendedRatios: true,
    customSizes: true,
  },
  {
    id: "kling-video",
    name: "Kling 视频",
    icon: Video,
    desc: "文生/图生/首尾帧视频",
    variants: [
      { model: "kling-v2-6", label: "Kling-V2-6", credits: { default: 0, priority: 0 } },
      { model: "kling-v3", label: "Kling-V3", credits: { default: 0, priority: 0 } },
      { model: "kling-v3-omni", label: "Kling-V3-Omni", credits: { default: 0, priority: 0 } },
    ],
    maxInputImages: 2,
    extendedRatios: false,
    serviceTierOptions: false,
    mediaType: "video",
  },
];

const STANDARD_RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4"];
const EXTENDED_RATIOS = ["21:9", "1:4", "4:1", "8:1", "1:8"];
const GPT_IMAGE_2_PRESET_SIZES = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "1152x2048",
  "3840x2160",
  "2160x3840",
];
const GPT_IMAGE_2_QUALITY_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];
const GPT_IMAGE_2_FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];
const GPT_IMAGE_2_MODERATION_OPTIONS = [
  { value: "auto", label: "标准" },
  { value: "low", label: "较宽松" },
];
const RATIO_FALLBACK_CANDIDATES = [
  [1, 1], [16, 9], [9, 16], [4, 3], [3, 4],
  [3, 2], [2, 3], [4, 5], [5, 4],
  [21, 9], [1, 4], [4, 1], [8, 1], [1, 8],
];
const EXACT_SIZE_PATTERN = /^(\d{2,4})\s*[xX]\s*(\d{2,4})$/;
const GPT_IMAGE_2_SIZE_LIMITS = {
  maxEdge: 3840,
  minPixels: 655360,
  maxPixels: 8294400,
  maxAspectRatio: 3,
};
const SERVICE_TIERS = [
  { id: "default", label: "标准", desc: "更省积分" },
  { id: "priority", label: "高优先", desc: "更稳更快" },
];
const KLING_VIDEO_MIN_DURATION = 3;
const KLING_VIDEO_MAX_DURATION = 15;
const KLING_VIDEO_MODES = [
  { value: "std", label: "720p" },
  { value: "pro", label: "1080p" },
  { value: "4k", label: "4K" },
];
const KLING_V26_DURATIONS = ["5", "10"];
const KLING_SOUND_OPTIONS = [
  { value: "off", label: "无声", desc: "成本更低" },
  { value: "on", label: "有声", desc: "成本更高" },
];
const PARAM_ACTIVE_CLASS = "bg-green-500 text-white border border-green-500";
const PARAM_ACTIVE_MUTED_TEXT_CLASS = "text-white/75";
const PARAM_ACTIVE_ICON_CLASS = "text-white/80";
const MODEL_ICON_CLASS = "text-text-tertiary";

function parseExactSizeValue(value) {
  const match = String(value || "").trim().match(EXACT_SIZE_PATTERN);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function getClosestRatioForSize(value) {
  const parsed = parseExactSizeValue(value);
  if (!parsed) return "1:1";
  const target = parsed.width / parsed.height;
  let best = RATIO_FALLBACK_CANDIDATES[0];
  let diff = Math.abs(target - best[0] / best[1]);
  for (const candidate of RATIO_FALLBACK_CANDIDATES.slice(1)) {
    const nextDiff = Math.abs(target - candidate[0] / candidate[1]);
    if (nextDiff < diff) {
      best = candidate;
      diff = nextDiff;
    }
  }
  return `${best[0]}:${best[1]}`;
}

function validateGptImage2CustomSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return "请输入有效的宽高。";
  }
  if (width > GPT_IMAGE_2_SIZE_LIMITS.maxEdge || height > GPT_IMAGE_2_SIZE_LIMITS.maxEdge) {
    return `最长边不能超过 ${GPT_IMAGE_2_SIZE_LIMITS.maxEdge}px。`;
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    return "宽高都必须是 16 的倍数。";
  }
  const longEdge = Math.max(width, height);
  const shortEdge = Math.max(1, Math.min(width, height));
  if (longEdge / shortEdge > GPT_IMAGE_2_SIZE_LIMITS.maxAspectRatio) {
    return `长宽比不能超过 ${GPT_IMAGE_2_SIZE_LIMITS.maxAspectRatio}:1。`;
  }
  const totalPixels = width * height;
  if (totalPixels < GPT_IMAGE_2_SIZE_LIMITS.minPixels || totalPixels > GPT_IMAGE_2_SIZE_LIMITS.maxPixels) {
    return `总像素需介于 ${GPT_IMAGE_2_SIZE_LIMITS.minPixels} 和 ${GPT_IMAGE_2_SIZE_LIMITS.maxPixels} 之间。`;
  }
  return "";
}

function getVariantCredits(variant, serviceTier) {
  const tier = serviceTier === "default" ? "default" : "priority";
  return variant?.credits?.[tier] ?? variant?.credits?.priority ?? 0;
}

/**
 * 读取参考图真实像素尺寸，并匹配最接近的标准比例供 API 使用。
 */
function detectRefImageMeta(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const r = width / height;
      const candidates = [
        [1, 1], [16, 9], [9, 16], [4, 3], [3, 4],
        [3, 2], [2, 3], [4, 5], [5, 4],
        [21, 9], [1, 4], [4, 1], [8, 1], [1, 8],
      ];
      let ratio = "1:1";
      let minDiff = Infinity;
      for (const [w, h] of candidates) {
        const diff = Math.abs(r - w / h);
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
    img.onerror = () =>
      resolve({ ratio: "1:1", width: 0, height: 0, dimensionsLabel: "" });
    img.src = dataUrl;
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

function isVideoReferenceSource(src) {
  const value = String(src || "").trim().toLowerCase();
  return value.startsWith("data:video/")
    || /\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i.test(value);
}

function ReferenceThumb({ src, index, sizeClass = "h-14 w-14", onClick }) {
  const isVideo = isVideoReferenceSource(src);
  const commonClass = `${sizeClass} rounded-lg object-cover border border-border-primary`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative block overflow-hidden rounded-lg bg-bg-hover ${onClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
      title={isVideo ? `参考视频 ${index + 1}` : `参考图 ${index + 1}`}
    >
      {isVideo ? (
        <>
          <video
            src={src}
            className={commonClass}
            muted
            playsInline
            preload="metadata"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
            <Video size={14} />
          </span>
        </>
      ) : (
        <img src={src} alt={`参考图${index + 1}`} className={commonClass} />
      )}
    </button>
  );
}

function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-xl bg-bg-secondary/80 text-text-primary hover:bg-bg-hover transition-all z-10">
        <X size={20} />
      </button>
      <img
        src={src}
        alt="预览"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function MessageBubble({ message, onRetry, onDownload, onImageClick, onPreview, onPauseGenerate, onDelete }) {
  const isVideoMessage = message.mediaType === "video";
  const [playingVideoUrls, setPlayingVideoUrls] = useState([]);
  const handleGeneratedImageDragStart = useCallback((e, url, index) => {
    const payload = {
      url,
      prompt: message.text || `生成结果 ${index + 1}`,
      mediaType: message.mediaType || "image",
    };
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(CANVAS_IMAGE_MIME, JSON.stringify(payload));
    e.dataTransfer.setData("text/uri-list", url);
    e.dataTransfer.setData("text/plain", url);
  }, [message.mediaType, message.text]);

  if (message.role === "user") {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] group/message">
          <div className="flex justify-end mb-1">
            <button
              type="button"
              onClick={() => onDelete?.(message.id)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover/message:opacity-100"
              title="删除记录"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="bg-accent/15 border border-accent/20 rounded-2xl rounded-tr-md px-4 py-2.5">
          {message.refImages?.length > 0 && (
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {message.refImages.map((src, i) => (
                <ReferenceThumb
                  key={i}
                  src={src}
                  index={i}
                  sizeClass="w-12 h-12"
                  onClick={() => isVideoReferenceSource(src) ? window.open(src, "_blank") : onPreview?.(src)}
                />
              ))}
              <span className="text-[10px] text-text-tertiary self-end">{message.refImages.length}个参考素材</span>
            </div>
          )}
          <p className="text-sm text-text-primary leading-relaxed">{message.text}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[10px] text-text-tertiary">
              {message.modelLabel} · {message.params?.image_size}
              {message.params?.num > 1 && ` · ${message.params.num}张`}
            </span>
          </div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="max-w-[85%] w-full group/message">
        <div className="flex items-center gap-2 mb-2">
          <BrandLogo className="h-6 w-auto flex-shrink-0" />
          <button
            type="button"
            onClick={() => onDelete?.(message.id)}
            className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover/message:opacity-100"
            title="删除记录"
          >
            <Trash2 size={13} />
          </button>
        </div>

        {message.status === "generating" && message.tasks?.length > 0 && (
          <div className="bg-bg-tertiary border border-border-primary rounded-2xl rounded-tl-md px-4 py-4">
            <p className="text-sm text-text-primary mb-2">
              生成中{" "}
              {message.tasks.filter((t) => t.status === "completed").length}/
              {message.tasks.length}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {message.tasks.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-border-primary overflow-hidden bg-bg-secondary/50 min-h-[100px] flex flex-col"
                >
                  {t.status === "pending" && (
                    <div className="flex-1 flex items-center justify-center text-[10px] text-text-tertiary py-6">
                      等待中
                    </div>
                  )}
                  {t.status === "generating" && (
                    <div className="flex-1 flex items-center justify-center py-6">
                      <Loader2 size={20} className="text-accent animate-spin" />
                    </div>
                  )}
                  {t.status === "completed" && t.url && (
                    <button
                      type="button"
                      className="relative w-full cursor-pointer"
                      onClick={() => onPreview?.(t.url)}
                    >
                      {t.type === "video" || isVideoMessage ? (
                        <video src={t.url} className="w-full object-cover" muted playsInline />
                      ) : (
                        <img src={t.url} alt="" className="w-full object-cover" />
                      )}
                    </button>
                  )}
                  {t.status === "failed" && (
                    <div className="p-2 text-[10px] text-error leading-snug">
                      {t.error || "失败"}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {onPauseGenerate && (
              <button
                onClick={onPauseGenerate}
                className="mt-3 px-3 py-1.5 rounded-lg bg-bg-hover text-xs text-text-secondary hover:text-text-primary border border-border-primary transition-all flex items-center gap-1.5"
              >
                <PauseCircle size={12} /> 暂停全部
              </button>
            )}
          </div>
        )}

        {message.status === "generating" && !message.tasks?.length && (
          <div className="bg-bg-tertiary border border-border-primary rounded-2xl rounded-tl-md px-4 py-4">
            <div className="flex items-center gap-3">
              <Loader2 size={18} className="text-accent animate-spin" />
              <div>
                <p className="text-sm text-text-primary">正在生成{isVideoMessage ? "视频" : "图片"}...</p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {isVideoMessage
                    ? "预计 1-4 分钟"
                    : `${message.params?.num > 1 ? `共 ${message.params.num} 张，` : ""}预计 10-30 秒`}
                </p>
              </div>
            </div>
            <div className="mt-3 h-32 rounded-xl overflow-hidden" style={{
              background: "linear-gradient(90deg, #1a1a1a 25%, #262626 50%, #1a1a1a 75%)",
              backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite",
            }} />
            {onPauseGenerate && (
              <button
                onClick={onPauseGenerate}
                className="mt-3 px-3 py-1.5 rounded-lg bg-bg-hover text-xs text-text-secondary hover:text-text-primary border border-border-primary transition-all flex items-center gap-1.5"
              >
                <PauseCircle size={12} /> 暂停生成
              </button>
            )}
          </div>
        )}

        {message.status === "paused" && (
          <div className="bg-bg-tertiary border border-warning/20 rounded-2xl rounded-tl-md px-4 py-3">
            <div className="flex items-center gap-2 text-warning mb-1">
              <PauseCircle size={16} />
              <span className="text-sm font-medium">已暂停</span>
            </div>
            <p className="text-xs text-text-tertiary mb-3">
              当前生成已手动暂停，你可以修改提示词或参数后重新生成。
            </p>
            <button
              onClick={() => onRetry?.(message)}
              className="px-3 py-1.5 rounded-lg bg-bg-hover text-xs text-text-secondary hover:text-text-primary border border-border-primary transition-all flex items-center gap-1.5"
            >
              <RotateCw size={12} /> 重新生成
            </button>
          </div>
        )}

        {message.status === "completed" && message.urls?.length > 0 && (
          <div className="space-y-2">
            {message.urls.map((url, i) => (
              <div key={i} className="bg-bg-tertiary border border-border-primary rounded-2xl rounded-tl-md overflow-hidden">
                <div
                  className="relative block w-full cursor-grab active:cursor-grabbing"
                  draggable
                  onDragStart={(e) => handleGeneratedImageDragStart(e, url, i)}
                  onClick={() => {
                    if (!isVideoMessage) onPreview?.(url);
                  }}
                  title={isVideoMessage ? "可直接拖入左侧画布" : "可直接拖入左侧画布，点击预览"}
                >
                  {isVideoMessage ? (
                    <>
                      <video
                        src={url}
                        playsInline
                        className="w-full bg-black"
                        onPlay={() => {
                          setPlayingVideoUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));
                        }}
                        onPause={() => {
                          setPlayingVideoUrls((prev) => prev.filter((item) => item !== url));
                        }}
                        onEnded={() => {
                          setPlayingVideoUrls((prev) => prev.filter((item) => item !== url));
                        }}
                      />
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          const video = event.currentTarget.parentElement?.querySelector("video");
                          if (!video) return;
                          if (video.paused) {
                            void video.play();
                          } else {
                            video.pause();
                          }
                        }}
                        className="absolute left-2 bottom-2 inline-flex items-center gap-1.5 rounded-lg bg-black/62 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/78"
                        title={playingVideoUrls.includes(url) ? "暂停视频" : "播放视频"}
                      >
                        {playingVideoUrls.includes(url) ? <Pause size={12} /> : <Play size={12} />}
                        {playingVideoUrls.includes(url) ? "暂停" : "播放"}
                      </button>
                    </>
                  ) : (
                    <img src={url} alt={message.text} className="w-full hover:opacity-95 transition-opacity" />
                  )}
                </div>
                <div className="px-3 py-2 flex items-center justify-between">
                  <span className="text-[10px] text-text-tertiary">
                    {message.modelLabel} · {message.params?.image_size}
                    {message.mediaType === "video" && message.params?.duration && ` · ${message.params.duration}s`}
                    {message.urls.length > 1 && ` · ${i + 1}/${message.urls.length}`}
                  </span>
                  <button onClick={() => onDownload?.({ ...message, image_url: url })}
                    className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all" title="下载">
                    <Download size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {message.status === "failed" && (
          <div className="bg-bg-tertiary border border-error/20 rounded-2xl rounded-tl-md px-4 py-3">
            <div className="flex items-center gap-2 text-error mb-1">
              <AlertCircle size={16} />
              <span className="text-sm font-medium">生成失败</span>
            </div>
            <p className="text-xs text-text-tertiary mb-3">
              {typeof message.error === "string" ? message.error : message.error?.message || JSON.stringify(message.error) || "未知错误"}
            </p>
            <button onClick={() => onRetry?.(message)}
              className="px-3 py-1.5 rounded-lg bg-bg-hover text-xs text-text-secondary hover:text-text-primary border border-border-primary transition-all flex items-center gap-1.5">
              <RotateCw size={12} /> 重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CollapsibleParamSection({ title, summary, open, onToggle, children }) {
  return (
    <div className="rounded-xl border border-border-primary bg-bg-tertiary/55 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover/70 transition-all"
      >
        <div className="min-w-0 flex-1">
          <span className="block text-[11px] text-text-primary font-medium">{title}</span>
          {summary ? (
            <span className="block text-[10px] text-text-tertiary truncate mt-0.5">{summary}</span>
          ) : null}
        </div>
        <ChevronDown
          size={14}
          className={`text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="px-3 pb-3 border-t border-border-primary/70">{children}</div>}
    </div>
  );
}

export default function ChatPanel({
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onDeleteMessage,
  messages, prompt, onPromptChange, onSubmit, canSubmit = false, isGenerating,
  params, onParamsChange, showParams, onToggleParams,
  refImages, onRefImagesChange,
  textEditBlocks = [], onTextEditBlocksChange,
  showTextEditPanelInline = true,
  onRetry, onDownload, onImageClick,
  onPauseGenerate,
  entryMode = "agent",
  composerMode = "agent", onComposerModeChange,
  theme, onToggleTheme,
  width, onWidthChange,
  canvasHistoryMessages = [],
  onSelectCanvasHistory,
  onClearCanvasHistory,
  canvasHistorySearch = "",
  onCanvasHistorySearchChange,
}) {
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const conversationMenuRef = useRef(null);
  const canvasHistoryMenuRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewSrc, setPreviewSrc] = useState(null);
  const [showConversationMenu, setShowConversationMenu] = useState(false);
  const [showCanvasHistoryMenu, setShowCanvasHistoryMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [gptAdvancedOpen, setGptAdvancedOpen] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!showConversationMenu && !showCanvasHistoryMenu) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!conversationMenuRef.current?.contains(event.target)) {
        setShowConversationMenu(false);
      }
      if (!canvasHistoryMenuRef.current?.contains(event.target)) {
        setShowCanvasHistoryMenu(false);
      }
      if (!event.target.closest("[data-model-menu-root]")) {
        setShowModelMenu(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showConversationMenu, showCanvasHistoryMenu]);

  const currentTier = MODEL_TIERS.find((t) => t.variants.some((v) => v.model === params.model)) || MODEL_TIERS[0];
  const isKlingVideoTier = currentTier.id === "kling-video";
  const currentKlingModel = String(params.model || "").trim();
  const isKlingV26 = currentKlingModel === "kling-v2-6";
  const isKlingV3Family = currentKlingModel === "kling-v3" || currentKlingModel === "kling-v3-omni";
  const klingRefCount = refImages?.length || 0;
  const isKlingFirstLastFrame = klingRefCount >= 2;
  const availableKlingModes = isKlingV26
    ? KLING_VIDEO_MODES.filter((item) =>
        isKlingFirstLastFrame ? item.value === "pro" : item.value !== "4k"
      )
    : KLING_VIDEO_MODES;
  const canUseKlingSound = isKlingV26 && !isKlingFirstLastFrame;
  const klingDurationHint = isKlingV26
    ? "Kling-V2-6 支持 5s / 10s。"
    : "Kling-V3 / V3-Omni 支持 3s-15s。";
  const klingModeHint = isKlingV26
    ? isKlingFirstLastFrame
      ? "Kling-V2-6 首尾帧仅支持 1080p。"
      : "Kling-V2-6 支持 720p / 1080p；有声会自动使用 1080p。"
    : "Kling-V3 / V3-Omni 支持 720p / 1080p / 4K。";
  const klingSoundHint = isKlingV26
    ? isKlingFirstLastFrame
      ? "Kling-V2-6 首尾帧不支持声音控制。"
      : "Kling-V2-6 文生/图生可选有声；有声会自动使用 1080p。"
    : "Kling-V3 / V3-Omni 不支持声音控制。";
  const availableRatios = isKlingVideoTier
    ? ["16:9", "9:16", "1:1"]
    : currentTier.extendedRatios
      ? [...STANDARD_RATIOS, ...EXTENDED_RATIOS]
      : STANDARD_RATIOS;
  const maxImages = currentTier.maxInputImages;
  const currentServiceTier = params.service_tier === "default" ? "default" : "priority";
  const isGptImage2Tier = currentTier.id === "chatgpt-image2";
  const showServiceTierOptions = !isGptImage2Tier && currentTier.serviceTierOptions !== false;
  const exactSize = parseExactSizeValue(params.image_size);
  const currentGptQuality = isGptImage2Tier ? String(params.quality || "auto").trim().toLowerCase() : "auto";
  const currentGptFormat = isGptImage2Tier ? String(params.output_format || "png").trim().toLowerCase() : "png";
  const currentGptModeration = isGptImage2Tier ? String(params.moderation || "auto").trim().toLowerCase() : "auto";
  const currentGptCompression = Number.isFinite(Number(params.output_compression))
    ? Math.min(100, Math.max(0, Number(params.output_compression)))
    : 90;
  const currentGptQualityLabel =
    GPT_IMAGE_2_QUALITY_OPTIONS.find((item) => item.value === currentGptQuality)?.label || "Auto";
  const currentGptFormatLabel =
    GPT_IMAGE_2_FORMAT_OPTIONS.find((item) => item.value === currentGptFormat)?.label || "PNG";
  const currentGptModerationLabel =
    GPT_IMAGE_2_MODERATION_OPTIONS.find((item) => item.value === currentGptModeration)?.label || "标准";
  const currentKlingModeLabel =
    availableKlingModes.find((item) => item.value === (params.mode || "pro"))?.label || "1080p";
  const klingActiveClass = PARAM_ACTIVE_CLASS;
  const currentEntryMode = "agent";
  const currentEntryModeLabel = "Agent";
  const isQuickEntryMode = false;
  const filteredConversations = conversations
    .filter((conversation) => {
      const query = conversationSearch.trim().toLowerCase();
      if (!query) return true;
      const haystack = [
        conversation.title,
        ...(conversation.messages || []).slice(-4).map((message) => message.text || ""),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const canvasCompletedHistory = canvasHistoryMessages.filter(
    (message) => message.role === "assistant" && message.status === "completed" && message.urls?.length > 0
  );
  const filteredCanvasHistory = (canvasHistorySearch || "").trim()
    ? canvasCompletedHistory.filter((message) =>
        message.text?.toLowerCase().includes(canvasHistorySearch.toLowerCase()) ||
        message.modelLabel?.toLowerCase().includes(canvasHistorySearch.toLowerCase())
      )
    : canvasCompletedHistory;
  const reversedCanvasHistory = [...filteredCanvasHistory].reverse();

  const formatConversationTime = useCallback((timestamp) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);


  useEffect(() => {
    if (!isGptImage2Tier) return;
    if (params.quality && params.output_format && params.moderation) return;
    onParamsChange((p) => ({
      ...p,
      quality: p.quality || "auto",
      output_format: p.output_format || "png",
      moderation: p.moderation || "auto",
      output_compression:
        p.output_compression ?? (String(p.output_format || "png").toLowerCase() === "png" ? undefined : 90),
    }));
  }, [isGptImage2Tier, onParamsChange, params.quality, params.output_format, params.moderation, params.output_compression]);

  useEffect(() => {
    if (!isKlingVideoTier) return;

    const next = { ...params };
    let changed = false;
    if (isKlingV26) {
      if (!KLING_V26_DURATIONS.includes(String(next.duration || "5"))) {
        next.duration = "5";
        changed = true;
      }
      if (next.mode === "4k") {
        next.mode = "pro";
        changed = true;
      }
      if (isKlingFirstLastFrame) {
        if (next.mode !== "pro") {
          next.mode = "pro";
          changed = true;
        }
        if (next.sound !== "off") {
          next.sound = "off";
          changed = true;
        }
      } else if (next.sound === "on" && next.mode !== "pro") {
        next.mode = "pro";
        changed = true;
      }
    } else if (isKlingV3Family) {
      const duration = Math.min(
        KLING_VIDEO_MAX_DURATION,
        Math.max(KLING_VIDEO_MIN_DURATION, Math.round(Number(next.duration || 5)) || 5)
      );
      if (String(next.duration || "5") !== String(duration)) {
        next.duration = String(duration);
        changed = true;
      }
      if (next.sound !== "off") {
        next.sound = "off";
        changed = true;
      }
    }

    if (!next.sound) {
      next.sound = "off";
      changed = true;
    }

    if (changed) onParamsChange(next);
  }, [
    isKlingV26,
    isKlingFirstLastFrame,
    isKlingV3Family,
    isKlingVideoTier,
    onParamsChange,
    params,
  ]);

  /** 固定比例时清除 _autoRatio；选 Auto 时按首张参考图重新识别 */
  const applyRatio = useCallback(
    async (r) => {
      if (r === "auto") {
        if (refImages?.length > 0) {
          const meta = await detectRefImageMeta(refImages[0]);
          onParamsChange((p) => ({
            ...p,
            image_size: "auto",
            _autoRatio: meta.ratio,
            _autoDimensions: meta.dimensionsLabel || undefined,
            _autoWidth: meta.width || undefined,
            _autoHeight: meta.height || undefined,
          }));
        } else {
          onParamsChange((p) => ({
            ...p,
            image_size: "auto",
            _autoRatio: undefined,
            _autoDimensions: undefined,
            _autoWidth: undefined,
            _autoHeight: undefined,
          }));
        }
        return;
      }
      onParamsChange((p) => ({
        ...p,
        image_size: r,
        _autoRatio: undefined,
        _autoDimensions: undefined,
        _autoWidth: undefined,
        _autoHeight: undefined,
      }));
    },
    [refImages, onParamsChange]
  );

  const addImages = useCallback(async (files) => {
    const remaining = maxImages - (refImages?.length || 0);
    const toProcess = Array.from(files).slice(0, remaining);
    const firstBefore = refImages?.[0];
    const rawDataUrls = await Promise.all(
      toProcess.map((file) => readFileAsDataURL(file))
    );
    const results = await Promise.all(
      rawDataUrls.map(async (dataUrl) => {
        try {
          return await compressImage(dataUrl, 1280, 0.78);
        } catch {
          return dataUrl;
        }
      })
    );
    const newImages = [...(refImages || []), ...results];
    const firstAfter = newImages[0];
    onRefImagesChange(newImages);
    // 首张参考图变化时：Auto 下匹配 API 比例；尺寸优先用本次首张的原始文件像素（未压缩前）
    if (newImages.length > 0 && firstAfter !== firstBefore) {
      const srcForMeta =
        firstBefore === undefined && rawDataUrls.length > 0
          ? rawDataUrls[0]
          : firstAfter;
      const meta = await detectRefImageMeta(srcForMeta);
      onParamsChange((p) => ({
        ...p,
        image_size: "auto",
        _autoRatio: meta.ratio,
        _autoDimensions: meta.dimensionsLabel || undefined,
        _autoWidth: meta.width || undefined,
        _autoHeight: meta.height || undefined,
      }));
    }
  }, [refImages, maxImages, onRefImagesChange, onParamsChange]);

  const removeImage = useCallback(
    (index) => {
      const next = refImages.filter((_, i) => i !== index);
      onRefImagesChange(next);
      if (next.length === 0) {
        onParamsChange((p) =>
          p.image_size === "auto"
            ? { ...p, _autoRatio: undefined, _autoDimensions: undefined, _autoWidth: undefined, _autoHeight: undefined }
            : p
        );
        return;
      }
      if (index === 0) {
        void detectRefImageMeta(next[0]).then((meta) => {
          onParamsChange((p) =>
            p.image_size === "auto"
              ? {
                  ...p,
                  _autoRatio: meta.ratio,
                  _autoDimensions: meta.dimensionsLabel || undefined,
                  _autoWidth: meta.width || undefined,
                  _autoHeight: meta.height || undefined,
                }
              : p
          );
        });
      }
    },
    [refImages, onRefImagesChange, onParamsChange]
  );

  const handleFileSelect = (e) => {
    if (e.target.files?.length) addImages(e.target.files);
    e.target.value = "";
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (!canSubmit) return;
      e.preventDefault();
      onSubmit();
    }
  };

  // Drag & drop
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) addImages(files);
  };

  const setTier = (tier) => {
    const defaultVariant = tier.variants.find((v) => v.label === "1K") || tier.variants[0];
    let nextImageSize = params.image_size;
    if (tier.id === "kling-video" && !["16:9", "9:16", "1:1"].includes(nextImageSize)) {
      nextImageSize = "16:9";
    }
    if (!tier.extendedRatios && EXTENDED_RATIOS.includes(nextImageSize)) {
      nextImageSize = "1:1";
    }
    onParamsChange({
      ...params,
      model: defaultVariant.model,
      image_size: nextImageSize,
      ...(tier.id === "kling-video"
        ? { num: 1, duration: params.duration || "5", mode: params.mode || "pro", sound: params.sound || "off" }
        : {}),
    });
  };


  // Resize handle
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev) => {
      const delta = startX - ev.clientX;
      onWidthChange(Math.max(280, Math.min(600, startW + delta)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [width, onWidthChange]);

  return (
    <div className="flex h-full flex-shrink-0" style={{ width }}>
      {/* Resize handle */}
      <div
        className="w-1 hover:w-1.5 bg-transparent hover:bg-accent/30 cursor-col-resize transition-all flex-shrink-0 flex items-center justify-center group"
        onPointerDown={handleResizeStart}
      >
        <div className="w-0.5 h-8 rounded-full bg-border-secondary group-hover:bg-accent/60 transition-colors" />
      </div>

      {/* Panel content */}
      <div className="flex-1 bg-bg-secondary border-l border-border-primary flex flex-col h-full min-w-0">
        {/* Header */}
        <div className="h-12 px-4 flex items-center justify-between border-b border-border-primary flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo className="h-6 w-auto" showText={false} />
            <span className="px-1 py-1 text-sm font-medium text-text-primary">{currentEntryModeLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative" ref={canvasHistoryMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setShowCanvasHistoryMenu((prev) => !prev);
                  setShowConversationMenu(false);
                }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                  showCanvasHistoryMenu
                    ? "text-green-600 bg-green-500/10"
                    : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
                }`}
                title="历史结果"
                aria-label="历史结果"
              >
                <ImageIcon size={16} />
              </button>

              {showCanvasHistoryMenu && (
                <div className="absolute right-0 top-[calc(100%+8px)] flex h-[420px] w-[320px] flex-col overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary/95 shadow-2xl backdrop-blur-xl z-30 animate-fade-in">
                  <div className="flex items-center justify-between gap-2 border-b border-border-primary px-3 py-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Clock size={14} className="text-text-tertiary" />
                        <span className="text-sm font-medium text-text-primary">历史结果</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">点击缩略图可预览结果</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canvasCompletedHistory.length > 0 && (
                        <span className="rounded-md bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                          {canvasCompletedHistory.length}
                        </span>
                      )}
                      {canvasCompletedHistory.length > 0 && (
                        <button
                          type="button"
                          onClick={onClearCanvasHistory}
                          className="rounded-lg px-2 py-1 text-[11px] text-text-tertiary transition-all hover:bg-red-500/10 hover:text-red-400"
                        >
                          清空
                        </button>
                      )}
                    </div>
                  </div>

                  {canvasCompletedHistory.length > 3 && (
                    <div className="px-3 py-2">
                      <div className="flex items-center gap-1.5 rounded-lg border border-border-primary bg-bg-tertiary px-2 py-1.5">
                        <Search size={12} className="flex-shrink-0 text-text-tertiary" />
                        <input
                          type="text"
                          value={canvasHistorySearch}
                          onChange={(event) => onCanvasHistorySearchChange?.(event.target.value)}
                          placeholder="搜索历史..."
                          className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder-text-tertiary"
                        />
                        {canvasHistorySearch && (
                          <button
                            type="button"
                            onClick={() => onCanvasHistorySearchChange?.("")}
                            className="text-text-tertiary hover:text-text-primary"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2 scrollbar-thin">
                    {reversedCanvasHistory.length === 0 && (
                      <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                        <ImageIcon size={24} className="mb-2 text-text-tertiary opacity-30" />
                        <p className="text-[11px] text-text-tertiary opacity-60">
                          {canvasHistorySearch ? "没有匹配的记录" : "暂无生成记录"}
                        </p>
                      </div>
                    )}

                    {reversedCanvasHistory.map((message) => {
                      const time = message.id ? new Date(parseInt(message.id.replace("ai-", ""), 10)).toLocaleString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }) : "";

                      return (
                        <div
                          key={message.id}
                          className="mb-3 last:mb-0"
                        >
                          <div className="mb-1.5 truncate text-[11px] text-text-secondary">
                            {message.text}
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {(message.urls || []).slice(0, 4).map((url, i) => (
                              <button
                                key={`${message.id}-${i}`}
                                type="button"
                                onClick={() => {
                                  if (message.mediaType === "video") window.open(url, "_blank");
                                  else setPreviewSrc(url);
                                }}
                                className="group relative aspect-square overflow-hidden rounded-lg border border-border-primary bg-bg-hover"
                              >
                                {message.mediaType === "video" ? (
                                  <video
                                    src={url}
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                    muted
                                    playsInline
                                  />
                                ) : (
                                  <img
                                    src={url}
                                    alt={`历史图片 ${i + 1}`}
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                    loading="lazy"
                                  />
                                )}
                                {message.urls?.length > 4 && i === 3 && (
                                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] font-medium text-white">
                                    +{message.urls.length - 3}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-text-tertiary">
                            <span className="truncate">{message.modelLabel}</span>
                            {message.mediaType === "video"
                              ? <span className="text-accent">视频</span>
                              : message.urls?.length > 1 && <span className="text-accent">{message.urls.length}张</span>}
                            <span className="ml-auto flex-shrink-0">{time}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setShowCanvasHistoryMenu(false);
                              onSelectCanvasHistory?.(message);
                            }}
                            className="mt-2 w-full rounded-lg border border-border-primary bg-bg-tertiary px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-all hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary"
                          >
                            一键填入
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="relative" ref={conversationMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setShowConversationMenu((prev) => !prev);
                  setShowCanvasHistoryMenu(false);
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
                title={activeConversation?.title || "当前对话"}
              >
                <Plus size={16} />
                <ChevronDown size={12} className={`ml-0.5 transition-transform ${showConversationMenu ? "rotate-180" : ""}`} />
              </button>

              {showConversationMenu && (
                <div className="absolute right-0 top-[calc(100%+8px)] w-[280px] rounded-2xl border border-border-primary bg-bg-secondary/95 backdrop-blur-xl shadow-2xl p-3 space-y-3 z-30 animate-fade-in">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary">历史对话</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowConversationMenu(false);
                        onNewConversation?.();
                      }}
                      className="h-9 px-3 rounded-xl bg-accent text-white hover:bg-accent-hover transition-all flex items-center gap-1.5 text-xs font-medium"
                    >
                      <Plus size={14} />
                      新建对话
                    </button>
                  </div>

                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-tertiary border border-border-primary">
                    <Search size={14} className="text-text-tertiary flex-shrink-0" />
                    <input
                      type="text"
                      value={conversationSearch}
                      onChange={(e) => setConversationSearch(e.target.value)}
                      placeholder="请输入搜索关键词"
                      className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-tertiary outline-none"
                    />
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-1.5 scrollbar-thin pr-1">
                    {filteredConversations.length === 0 && (
                      <div className="px-3 py-6 text-center text-sm text-text-tertiary">
                        没有匹配的历史对话
                      </div>
                    )}
                    {filteredConversations.map((conversation) => {
                      const isActive = conversation.id === activeConversationId;
                      const lastMessage = [...(conversation.messages || [])].reverse().find((message) => message.text?.trim());
                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          onClick={() => {
                            setShowConversationMenu(false);
                            onSelectConversation?.(conversation.id);
                          }}
                          className={`w-full text-left px-3 py-2.5 rounded-xl transition-all border ${
                            isActive
                              ? "bg-green-500/10 border-green-500/30"
                              : "bg-bg-tertiary border-border-primary hover:bg-bg-hover"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <p className={`text-sm font-medium truncate flex-1 ${isActive ? "text-text-primary" : "text-text-secondary"}`}>
                              {conversation.title || "新建对话"}
                            </p>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-[10px] text-text-tertiary">
                                {formatConversationTime(conversation.updatedAt)}
                              </span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDeleteConversation?.(conversation.id);
                                }}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-all"
                                title="删除对话"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                          <p className="text-[11px] text-text-tertiary mt-1 line-clamp-2">
                            {lastMessage?.text || "暂无消息"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {onToggleTheme && (
              <button
                onClick={onToggleTheme}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
                title={theme === "dark" ? "切换到浅色" : "切换到深色"}
              >
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <h3 className="text-sm font-medium text-text-primary mb-2">快速制作好想法</h3>
              <p className="text-xs text-text-tertiary leading-relaxed mb-4">
                支持拖拽多张图片进行参考或编辑
              </p>
              {!isQuickEntryMode && (
                <div className="w-full space-y-1.5 text-left">
                  {MODEL_TIERS.map((t) => {
                    const Icon = t.icon;
                    return (
                      <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-tertiary border border-border-primary">
                        <Icon size={14} className={MODEL_ICON_CLASS} />
                        <div>
                          <p className="text-[11px] text-text-primary font-medium">{t.name}</p>
                          <p className="text-[10px] text-text-tertiary">{t.desc} · 最多{t.maxInputImages}张参考图</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onRetry={onRetry}
              onDownload={onDownload}
              onImageClick={onImageClick}
              onPreview={setPreviewSrc}
              onPauseGenerate={msg.status === "generating" ? onPauseGenerate : null}
              onDelete={onDeleteMessage}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border-primary p-3 flex-shrink-0 space-y-2">
          {!isQuickEntryMode && (
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-xl border border-border-primary bg-bg-tertiary p-1">
                <button
                  type="button"
                  onClick={() => onComposerModeChange?.("agent")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    composerMode === "agent"
                      ? PARAM_ACTIVE_CLASS
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  自动
                </button>
                <button
                  type="button"
                  onClick={() => onComposerModeChange?.("manual")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    composerMode === "manual"
                      ? PARAM_ACTIVE_CLASS
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  手动
                </button>
              </div>
              {composerMode === "manual" && (
                <button onClick={onToggleParams}
                  className="flex items-center gap-1.5 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors flex-1">
                  <Settings2 size={12} />
                  <span>生成参数</span>
                  <ChevronDown size={12} className={`ml-auto transition-transform ${showParams ? "rotate-180" : ""}`} />
                </button>
              )}
            </div>
          )}

          {!isQuickEntryMode && composerMode === "manual" && showParams && (
            <div className="space-y-3 py-2 animate-fade-in">
              <div>
                <span className="block text-[11px] text-text-tertiary mb-1.5">模型</span>
                <div className="relative" data-model-menu-root>
                  {(() => {
                    const Icon = currentTier.icon;
                    return (
                      <button
                        type="button"
                        onClick={() => setShowModelMenu((prev) => !prev)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${PARAM_ACTIVE_CLASS}`}
                      >
                        <Icon size={14} className={PARAM_ACTIVE_ICON_CLASS} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-white">{currentTier.name}</p>
                          <p className={`text-[10px] truncate ${PARAM_ACTIVE_MUTED_TEXT_CLASS}`}>{currentTier.desc}</p>
                        </div>
                        <ChevronDown size={14} className={`text-white/75 transition-transform ${showModelMenu ? "rotate-180" : ""}`} />
                      </button>
                    );
                  })()}
                  {showModelMenu && (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 space-y-1 rounded-xl border border-border-primary bg-bg-secondary/98 p-1.5 shadow-2xl backdrop-blur-xl">
                      {MODEL_TIERS.map((tier) => {
                        const Icon = tier.icon;
                        const active = currentTier.id === tier.id;
                        return (
                          <button
                            key={tier.id}
                            type="button"
                            disabled={tier.disabled}
                            onClick={() => {
                              if (tier.disabled) return;
                              setTier(tier);
                              setShowModelMenu(false);
                            }}
                            className={`w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${
                              tier.disabled
                                ? "border-border-primary bg-bg-tertiary/60 opacity-60 cursor-not-allowed"
                                : active
                                  ? PARAM_ACTIVE_CLASS
                                  : "border-transparent bg-transparent hover:bg-bg-hover"
                            }`}
                          >
                            <Icon size={14} className={active ? PARAM_ACTIVE_ICON_CLASS : MODEL_ICON_CLASS} />
                            <div className="min-w-0 flex-1">
                              <p className={`text-[11px] font-medium ${active ? "text-white" : "text-text-secondary"}`}>{tier.name}</p>
                              <p className={`text-[10px] truncate ${active ? PARAM_ACTIVE_MUTED_TEXT_CLASS : "text-text-tertiary"}`}>{tier.desc}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              {currentTier.variants.length > 1 && (
                <div>
                  <span className="block text-[11px] text-text-tertiary mb-1.5">模型规格</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {currentTier.variants.map((v) => (
                      <button key={v.model} onClick={() => onParamsChange({ ...params, model: v.model })}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${params.model === v.model ? PARAM_ACTIVE_CLASS : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"}`}>
                        {v.label}
                        {!isKlingVideoTier && (
                          <span className="block text-[9px] opacity-60">{getVariantCredits(v, currentServiceTier)} credits</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {showServiceTierOptions && (
                <div>
                  <span className="block text-[11px] text-text-tertiary mb-1.5">线路</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {SERVICE_TIERS.map((tier) => (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => onParamsChange({ ...params, service_tier: tier.id })}
                        className={`px-3 py-2 rounded-lg text-left border transition-all ${
                          params.service_tier === tier.id
                            ? PARAM_ACTIVE_CLASS
                            : "bg-bg-tertiary border-border-primary text-text-secondary hover:bg-bg-hover"
                        }`}
                      >
                        <span className="block text-[11px] font-medium">{tier.label}</span>
                        <span className={`block text-[10px] mt-0.5 ${params.service_tier === tier.id ? PARAM_ACTIVE_MUTED_TEXT_CLASS : "text-text-tertiary"}`}>{tier.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {isKlingVideoTier ? (
                <CollapsibleParamSection
                  title="Kling 视频参数"
                  summary={[
                    `比例 ${params.image_size || "参考图"}`,
                    `${params.duration || "5"}s`,
                    currentKlingModeLabel,
                    (params.sound || "off") === "on" ? "有声" : "无声",
                    isKlingFirstLastFrame ? "首尾帧" : klingRefCount === 1 ? "图生视频" : "文生视频",
                  ].join(" · ")}
                  open
                  onToggle={() => {}}
                >
                  <div className="pt-2 space-y-3">
                    <div>
                      <span className="block text-[11px] text-text-tertiary mb-1.5">视频比例</span>
                      <div className="flex gap-1 flex-wrap">
                        {availableRatios.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => onParamsChange({
                              ...params,
                              image_size: params.image_size === r ? "" : r,
                            })}
                            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                              params.image_size === r
                                ? PARAM_ACTIVE_CLASS
                                : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-text-tertiary mt-1.5">
                        再次点击已选比例可取消；有参考图时取消比例会优先按参考图比例生成。
                      </p>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="block text-[11px] text-text-tertiary">生成时长</span>
                        <span className="text-[11px] font-medium text-text-secondary">{params.duration || "5"}s</span>
                      </div>
                      {isKlingV26 ? (
                        <div className="flex gap-1.5">
                          {KLING_V26_DURATIONS.map((duration) => (
                            <button
                              key={duration}
                              type="button"
                              onClick={() => onParamsChange({ ...params, duration })}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                                String(params.duration || "5") === duration
                                  ? klingActiveClass
                                  : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"
                              }`}
                            >
                              {duration}s
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-[28px_1fr_32px] items-center gap-2">
                          <span className="text-[11px] text-text-tertiary">{KLING_VIDEO_MIN_DURATION}s</span>
                          <input
                            type="range"
                            min={KLING_VIDEO_MIN_DURATION}
                            max={KLING_VIDEO_MAX_DURATION}
                            step={1}
                            value={Number(params.duration || 5)}
                            onChange={(event) => onParamsChange({ ...params, duration: String(event.target.value) })}
                            className="w-full accent-green-500"
                          />
                          <span className="text-right text-[11px] text-text-tertiary">{KLING_VIDEO_MAX_DURATION}s</span>
                        </div>
                      )}
                      <p className="text-[10px] text-text-tertiary mt-1.5">
                        {klingDurationHint}
                      </p>
                    </div>
                    <div>
                      <span className="block text-[11px] text-text-tertiary mb-1.5">分辨率模式</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {availableKlingModes.map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => onParamsChange({ ...params, mode: item.value })}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                              String(params.mode || "pro") === item.value
                                ? klingActiveClass
                                : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-text-tertiary mt-1.5">
                        {klingModeHint}
                      </p>
                    </div>
                    <div>
                      <span className="block text-[11px] text-text-tertiary mb-1.5">声音</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {KLING_SOUND_OPTIONS.map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            disabled={item.value === "on" && !canUseKlingSound}
                            onClick={() => {
                              if (item.value === "on" && !canUseKlingSound) return;
                              onParamsChange({
                                ...params,
                                sound: item.value,
                                ...(item.value === "on" ? { mode: "pro" } : {}),
                              });
                            }}
                            className={`rounded-lg border px-3 py-2 text-left transition-all ${
                              String(params.sound || "off") === item.value
                                ? klingActiveClass
                                : item.value === "on" && !canUseKlingSound
                                  ? "border-border-primary bg-bg-tertiary/60 text-text-tertiary/50 cursor-not-allowed"
                                : "border-border-primary bg-bg-tertiary text-text-secondary hover:bg-bg-hover"
                            }`}
                          >
                            <span className="block text-[11px] font-medium">{item.label}</span>
                            <span className={`mt-0.5 block text-[10px] ${
                              String(params.sound || "off") === item.value
                                ? PARAM_ACTIVE_MUTED_TEXT_CLASS
                                : "text-text-tertiary"
                            }`}>
                              {item.value === "on" && !canUseKlingSound ? "当前模型/首尾帧不支持" : item.desc}
                            </span>
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-text-tertiary mt-1.5">
                        {klingSoundHint} 0 张参考图为文生视频，1 张为图生视频，2 张为首尾帧生视频。
                      </p>
                    </div>
                  </div>
                </CollapsibleParamSection>
              ) : isGptImage2Tier ? (
                <CollapsibleParamSection
                  title="GPT 高级参数"
                  summary={[
                    params.image_size === "auto"
                      ? `宽高比 Auto`
                      : `宽高比 ${params.image_size}`,
                    exactSize ? `精确 ${exactSize.width}x${exactSize.height}` : null,
                    `质量 ${currentGptQualityLabel}`,
                    `格式 ${currentGptFormatLabel}`,
                    `审核 ${currentGptModerationLabel}`,
                  ].filter(Boolean).join(" · ")}
                  open={gptAdvancedOpen}
                  onToggle={() => setGptAdvancedOpen((prev) => !prev)}
                >
                  <div className="pt-2 space-y-3">
                    <div>
                      <span className="block text-[11px] text-text-tertiary mb-1.5">
                        宽高比{currentTier.extendedRatios && <span className="text-text-tertiary ml-1">+ 扩展</span>}
                      </span>
                      <div className="flex gap-1 flex-wrap">
                        {availableRatios.map((r) => (
                          <button key={r} onClick={() => void applyRatio(r)}
                            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${params.image_size === r ? PARAM_ACTIVE_CLASS : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"}`}>
                            {r === "auto" ? "Auto" : r}
                          </button>
                        ))}
                      </div>
                      {params.image_size === "auto" && params._autoDimensions && (
                        <p className="text-[10px] text-emerald-400 mt-1.5">
                          已识别: {params._autoDimensions} px
                        </p>
                      )}
                      {params.image_size === "auto" && !params._autoDimensions && (
                        <p className="text-[10px] text-text-tertiary mt-1.5">
                          GPT Image 2 将交给 API 自动决定尺寸
                        </p>
                      )}
                    </div>
                    <div>
                      <span className="block text-[11px] text-text-tertiary mb-1.5">渲染质量</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {GPT_IMAGE_2_QUALITY_OPTIONS.map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => onParamsChange({ ...params, quality: item.value })}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                              currentGptQuality === item.value
                                ? PARAM_ACTIVE_CLASS
                                : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-text-tertiary mt-1.5">
                        `auto` 让 API 自动取舍速度和画质，`low` 更快，`high` 更适合最终成图。
                      </p>
                    </div>
                    <div>
                      <span className="block text-[11px] text-text-tertiary mb-1.5">输出格式</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {GPT_IMAGE_2_FORMAT_OPTIONS.map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() =>
                              onParamsChange({
                                ...params,
                                output_format: item.value,
                                ...(item.value === "png" ? { output_compression: undefined } : {}),
                              })
                            }
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                              currentGptFormat === item.value
                                ? PARAM_ACTIVE_CLASS
                                : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                      {currentGptFormat !== "png" && (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={currentGptCompression}
                            onChange={(e) =>
                              onParamsChange({
                                ...params,
                                output_format: currentGptFormat,
                                output_compression: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                              })
                            }
                            className="flex-1 accent-green-500"
                          />
                          <span className="w-10 text-right text-[10px] text-text-tertiary tabular-nums">
                            {currentGptCompression}
                          </span>
                        </div>
                      )}
                      <p className="text-[10px] text-text-tertiary mt-1.5">
                        PNG 画质最好；JPEG / WebP 支持压缩，通常下载更小、返回更快。
                      </p>
                    </div>
                    <div>
                      <span className="block text-[11px] text-text-tertiary mb-1.5">审核强度</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {GPT_IMAGE_2_MODERATION_OPTIONS.map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => onParamsChange({ ...params, moderation: item.value })}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                              currentGptModeration === item.value
                                ? PARAM_ACTIVE_CLASS
                                : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-text-tertiary mt-1.5">
                        `low` 会更宽松，但仍然会受到平台内容策略限制。
                      </p>
                    </div>
                  </div>
                </CollapsibleParamSection>
              ) : (
                <div>
                  <span className="block text-[11px] text-text-tertiary mb-1.5">
                    宽高比{currentTier.extendedRatios && <span className="text-text-tertiary ml-1">+ 扩展</span>}
                  </span>
                  <div className="flex gap-1 flex-wrap">
                    {availableRatios.map((r) => (
                      <button key={r} onClick={() => void applyRatio(r)}
                        className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${params.image_size === r ? PARAM_ACTIVE_CLASS : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"}`}>
                        {r === "auto" ? "Auto" : r}
                      </button>
                    ))}
                  </div>
                  {params.image_size === "auto" && params._autoDimensions && (
                    <p className="text-[10px] text-emerald-400 mt-1">
                      已识别: {params._autoDimensions} px
                    </p>
                  )}
                  {params.image_size === "auto" && !params._autoDimensions && (
                    <p className="text-[10px] text-text-tertiary mt-1">
                      上传参考图后显示具体宽高（像素）
                    </p>
                  )}
                </div>
              )}
              {!isKlingVideoTier && (
              <div>
                <span className="block text-[11px] text-text-tertiary mb-1.5">
                  生成数量（1–{MAX_GEN_COUNT}）
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={MAX_GEN_COUNT}
                    value={params.num ?? 1}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        onParamsChange({ ...params, num: 1 });
                        return;
                      }
                      const n = parseInt(raw, 10);
                      if (Number.isNaN(n)) return;
                      onParamsChange({
                        ...params,
                        num: Math.min(MAX_GEN_COUNT, Math.max(1, n)),
                      });
                    }}
                    className="w-20 px-2 py-1.5 rounded-lg text-[11px] font-medium bg-bg-tertiary border border-border-primary text-text-primary tabular-nums"
                  />
                  <span className="text-[10px] text-text-tertiary">张 · 提示词里写「3张」等会与该数取较大值</span>
                </div>
              </div>
              )}
            </div>
          )}

          {/* Reference images preview */}
          {refImages?.length > 0 && (
            <div className="flex gap-1.5 flex-wrap items-end">
              {refImages.map((src, i) => (
                <div key={i} className="relative group/img">
                  <ReferenceThumb src={src} index={i} />
                  <button onClick={() => removeImage(i)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-error flex items-center justify-center text-white opacity-0 group-hover/img:opacity-100 transition-opacity">
                    <X size={10} />
                  </button>
                  <span className="absolute bottom-0.5 left-0.5 text-[8px] bg-black/60 text-white px-1 rounded">{i + 1}</span>
                </div>
              ))}
              {refImages.length < maxImages && (
                <button onClick={() => fileInputRef.current?.click()}
                  className="h-14 w-14 rounded-lg border border-dashed border-border-secondary flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:border-accent/40 transition-all">
                  <ImagePlus size={16} />
                </button>
              )}
              <span className="text-[10px] text-text-tertiary self-end ml-1">
                {refImages.length}/{maxImages}
              </span>
            </div>
          )}

          {showTextEditPanelInline && textEditBlocks?.length > 0 && (
            <TextEditBlocksPanel
              blocks={textEditBlocks}
              onChange={onTextEditBlocksChange}
              className=""
            />
          )}

          {/* Input box with drag-and-drop */}
          <div
            className={`flex items-end gap-2 rounded-xl p-2.5 transition-all ${
              dragOver
                ? "bg-accent/10 border-2 border-dashed border-accent/50"
                : "bg-bg-tertiary border border-border-primary focus-within:border-accent/40"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <button onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
              title={`上传参考图 (最多${maxImages}张)`}>
              <ImagePlus size={18} />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />

            <textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                dragOver ? "松手添加图片..."
                : isQuickEntryMode
                  ? (refImages?.length > 0
                      ? "描述你想基于参考图生成什么，系统会自动帮你出图..."
                      : "一句话描述你想生成什么，也可以拖入参考图...")
                : composerMode === "agent"
                  ? (refImages?.length > 0
                      ? "直接描述目标效果，系统会自动保留参考图关键信息..."
                      : "直接描述你想要的结果，系统会自动处理参数...")
                  : refImages?.length > 0 ? "描述你想对图片做的处理..."
                  : "描述你想生成的图片，可拖入参考图..."
              }
              rows={1}
              className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary resize-none outline-none text-sm leading-5 max-h-24 overflow-y-auto"
              style={{ fieldSizing: "content" }}
            />

            {isGenerating ? (
              <button
                onClick={onPauseGenerate}
                className="flex-shrink-0 p-2 rounded-lg transition-all bg-warning/15 text-warning hover:bg-warning/25"
                title="暂停生成"
              >
                <PauseCircle size={16} />
              </button>
            ) : (
              <button onClick={onSubmit} disabled={!canSubmit}
                className={`flex-shrink-0 p-2 rounded-lg transition-all ${!canSubmit ? "text-text-tertiary cursor-not-allowed" : "bg-accent hover:bg-accent-hover text-white"}`}>
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {previewSrc && <ImageLightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />}
    </div>
  );
}
