"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import {
  Send,
  ImagePlus,
  X,
  Sun,
  Moon,
  Settings2,
  ChevronDown,
  Loader2,
  AlertCircle,
  RotateCw,
  Download,
  Sparkles,
  PauseCircle,
  Zap,
  Crown,
  Rocket,
} from "lucide-react";
import { compressImage } from "@/lib/imageUtils";

const MODEL_TIERS = [
  {
    id: "flash",
    name: "Nano Banana",
    icon: Zap,
    desc: "极速低价",
    color: "text-green-400",
    bg: "bg-green-500/15 border-green-500/30",
    variants: [
      { model: "gemini-2.5-flash-image", label: "1K", credits: 2 },
      { model: "gemini-2.5-flash-image-hd", label: "1K HD", credits: 5 },
    ],
    maxInputImages: 3,
    extendedRatios: false,
  },
  {
    id: "flash2",
    name: "Nano Banana 2",
    icon: Rocket,
    desc: "推荐 · 高性价比",
    color: "text-blue-400",
    bg: "bg-blue-500/15 border-blue-500/30",
    variants: [
      { model: "gemini-3.1-flash-image-preview-512", label: "512px", credits: 4 },
      { model: "gemini-3.1-flash-image-preview", label: "1K", credits: 4 },
      { model: "gemini-3.1-flash-image-preview-2k", label: "2K", credits: 6 },
      { model: "gemini-3.1-flash-image-preview-4k", label: "4K", credits: 8 },
    ],
    maxInputImages: 10,
    extendedRatios: true,
  },
  {
    id: "pro",
    name: "Nano Banana Pro",
    icon: Crown,
    desc: "专业画质 · Thinking",
    color: "text-amber-400",
    bg: "bg-amber-500/15 border-amber-500/30",
    variants: [
      { model: "gemini-3-pro-image-preview", label: "1K", credits: 8 },
      { model: "gemini-3-pro-image-preview-2k", label: "2K", credits: 8 },
      { model: "gemini-3-pro-image-preview-4k", label: "4K", credits: 16 },
    ],
    maxInputImages: 14,
    extendedRatios: false,
  },
];

const STANDARD_RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4"];
const EXTENDED_RATIOS = ["21:9", "1:4", "4:1", "8:1", "1:8"];

function detectImageRatio(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      const r = width / height;
      const candidates = [
        [1, 1], [16, 9], [9, 16], [4, 3], [3, 4],
        [3, 2], [2, 3], [4, 5], [5, 4],
        [21, 9], [1, 4], [4, 1], [8, 1], [1, 8],
      ];
      let best = "1:1";
      let minDiff = Infinity;
      for (const [w, h] of candidates) {
        const diff = Math.abs(r - w / h);
        if (diff < minDiff) { minDiff = diff; best = `${w}:${h}`; }
      }
      resolve(best);
    };
    img.onerror = () => resolve("1:1");
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

function MessageBubble({ message, onRetry, onDownload, onImageClick, onPreview, onPauseGenerate }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] bg-accent/15 border border-accent/20 rounded-2xl rounded-tr-md px-4 py-2.5">
          {message.refImages?.length > 0 && (
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {message.refImages.map((src, i) => (
                <img key={i} src={src} alt={`参考图${i + 1}`}
                  className="w-12 h-12 rounded-lg object-cover border border-border-primary cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => onPreview?.(src)}
                />
              ))}
              <span className="text-[10px] text-text-tertiary self-end">{message.refImages.length}张参考图</span>
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
    );
  }

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="max-w-[85%] w-full">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
            <Sparkles size={12} className="text-white" />
          </div>
          <span className="text-xs text-text-secondary font-medium">AI Agent</span>
        </div>

        {message.status === "generating" && (
          <div className="bg-bg-tertiary border border-border-primary rounded-2xl rounded-tl-md px-4 py-4">
            <div className="flex items-center gap-3">
              <Loader2 size={18} className="text-accent animate-spin" />
              <div>
                <p className="text-sm text-text-primary">正在生成图片...</p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {message.params?.num > 1 ? `共 ${message.params.num} 张，` : ""}预计 10-30 秒
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
                <div className="relative block w-full cursor-pointer" onClick={() => onPreview?.(url)}>
                  <img src={url} alt={message.text} className="w-full hover:opacity-95 transition-opacity" />
                </div>
                <div className="px-3 py-2 flex items-center justify-between">
                  <span className="text-[10px] text-text-tertiary">
                    {message.modelLabel} · {message.params?.image_size}
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

export default function ChatPanel({
  messages, prompt, onPromptChange, onSubmit, isGenerating,
  params, onParamsChange, showParams, onToggleParams,
  refImages, onRefImagesChange,
  onRetry, onDownload, onImageClick,
  onPauseGenerate,
  theme, onToggleTheme,
  width, onWidthChange,
}) {
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewSrc, setPreviewSrc] = useState(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const currentTier = MODEL_TIERS.find((t) => t.variants.some((v) => v.model === params.model)) || MODEL_TIERS[1];
  const currentVariant = currentTier.variants.find((v) => v.model === params.model) || currentTier.variants[1];
  const availableRatios = currentTier.extendedRatios ? [...STANDARD_RATIOS, ...EXTENDED_RATIOS] : STANDARD_RATIOS;
  const maxImages = currentTier.maxInputImages;

  const addImages = useCallback(async (files) => {
    const remaining = maxImages - (refImages?.length || 0);
    const toProcess = Array.from(files).slice(0, remaining);
    const results = await Promise.all(
      toProcess.map(async (file) => {
        const dataUrl = await readFileAsDataURL(file);
        try {
          return await compressImage(dataUrl, 1280, 0.78);
        } catch {
          return dataUrl;
        }
      })
    );
    const newImages = [...(refImages || []), ...results];
    onRefImagesChange(newImages);
    if (params.image_size === "auto" && results.length > 0) {
      const detected = await detectImageRatio(results[0]);
      onParamsChange({ ...params, image_size: "auto", _autoRatio: detected });
    }
  }, [refImages, maxImages, onRefImagesChange, params, onParamsChange]);

  const removeImage = useCallback((index) => {
    onRefImagesChange(refImages.filter((_, i) => i !== index));
  }, [refImages, onRefImagesChange]);

  const handleFileSelect = (e) => {
    if (e.target.files?.length) addImages(e.target.files);
    e.target.value = "";
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
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
    const newRatio = !tier.extendedRatios && EXTENDED_RATIOS.includes(params.image_size) ? "1:1" : params.image_size;
    onParamsChange({ ...params, model: defaultVariant.model, image_size: newRatio });
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
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center">
              <Sparkles size={12} className="text-white" />
            </div>
            <span className="text-sm font-medium text-text-primary">Agent</span>
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

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-14 h-14 rounded-2xl bg-bg-tertiary border border-border-primary flex items-center justify-center mb-4">
                <Sparkles size={24} className="text-accent" />
              </div>
              <h3 className="text-sm font-medium text-text-primary mb-2">AI 图片生成</h3>
              <p className="text-xs text-text-tertiary leading-relaxed mb-4">
                支持拖拽多张图片进行参考或编辑
              </p>
              <div className="w-full space-y-1.5 text-left">
                {MODEL_TIERS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-tertiary border border-border-primary">
                      <Icon size={14} className={t.color} />
                      <div>
                        <p className="text-[11px] text-text-primary font-medium">{t.name}</p>
                        <p className="text-[10px] text-text-tertiary">{t.desc} · 最多{t.maxInputImages}张参考图</p>
                      </div>
                    </div>
                  );
                })}
              </div>
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
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border-primary p-3 flex-shrink-0 space-y-2">
          {/* Params toggle */}
          <button onClick={onToggleParams}
            className="flex items-center gap-1.5 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors w-full">
            <Settings2 size={12} />
            <span>生成参数</span>
            <ChevronDown size={12} className={`transition-transform ${showParams ? "rotate-180" : ""}`} />
            <span className="ml-auto text-text-tertiary">
              {currentTier.name} · {currentVariant.label} · {params.image_size === "auto" ? `Auto${params._autoRatio ? `(${params._autoRatio})` : ""}` : params.image_size}
            </span>
          </button>

          {showParams && (
            <div className="space-y-3 py-2 animate-fade-in">
              <div>
                <span className="block text-[11px] text-text-tertiary mb-1.5">模型</span>
                <div className="space-y-1.5">
                  {MODEL_TIERS.map((tier) => {
                    const Icon = tier.icon;
                    const active = currentTier.id === tier.id;
                    return (
                      <button key={tier.id} onClick={() => setTier(tier)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all border ${active ? tier.bg : "bg-bg-tertiary border-border-primary hover:bg-bg-hover"}`}>
                        <Icon size={14} className={active ? tier.color : "text-text-tertiary"} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[11px] font-medium ${active ? "text-text-primary" : "text-text-secondary"}`}>{tier.name}</p>
                          <p className="text-[10px] text-text-tertiary">{tier.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <span className="block text-[11px] text-text-tertiary mb-1.5">分辨率</span>
                <div className="flex gap-1.5 flex-wrap">
                  {currentTier.variants.map((v) => (
                    <button key={v.model} onClick={() => onParamsChange({ ...params, model: v.model })}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${params.model === v.model ? "bg-accent text-white" : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"}`}>
                      {v.label}
                      <span className="block text-[9px] opacity-60">{v.credits} credits</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="block text-[11px] text-text-tertiary mb-1.5">
                  宽高比{currentTier.extendedRatios && <span className="text-blue-400 ml-1">+ 扩展</span>}
                </span>
                <div className="flex gap-1 flex-wrap">
                  {availableRatios.map((r) => (
                    <button key={r} onClick={() => onParamsChange({ ...params, image_size: r })}
                      className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${params.image_size === r ? "bg-accent text-white" : r === "auto" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20" : EXTENDED_RATIOS.includes(r) ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20" : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"}`}>
                      {r === "auto" ? "Auto" : r}
                    </button>
                  ))}
                </div>
                {params.image_size === "auto" && params._autoRatio && (
                  <p className="text-[10px] text-emerald-400 mt-1">已识别: {params._autoRatio}</p>
                )}
                {params.image_size === "auto" && !params._autoRatio && (
                  <p className="text-[10px] text-text-tertiary mt-1">上传图片后自动识别比例</p>
                )}
              </div>
              <div>
                <span className="block text-[11px] text-text-tertiary mb-1.5">生成数量</span>
                <div className="flex gap-1.5">
                  {[1, 2, 4, 9].map((n) => (
                    <button key={n} onClick={() => onParamsChange({ ...params, num: n })}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all ${params.num === n ? "bg-accent text-white" : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary"}`}>
                      {n}张
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Reference images preview */}
          {refImages?.length > 0 && (
            <div className="flex gap-1.5 flex-wrap items-end">
              {refImages.map((src, i) => (
                <div key={i} className="relative group/img">
                  <img src={src} alt={`参考图${i + 1}`} className="h-14 w-14 rounded-lg object-cover border border-border-primary" />
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
              <button onClick={onSubmit} disabled={!prompt.trim()}
                className={`flex-shrink-0 p-2 rounded-lg transition-all ${!prompt.trim() ? "text-text-tertiary cursor-not-allowed" : "bg-accent hover:bg-accent-hover text-white"}`}>
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
