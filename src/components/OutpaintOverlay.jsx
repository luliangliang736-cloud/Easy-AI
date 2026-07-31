"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, X } from "lucide-react";
import { useCanvasT } from "@/lib/canvasI18n";
import {
  OUTPAINT_MAX_PAD_FACTOR,
  OUTPAINT_RATIO_PRESETS,
  OUTPAINT_SCALE_PRESETS,
  pickClosestRatioLabel,
} from "@/lib/outpaint";

// /api/cloud-assets/ 默认 302 到 OSS，浏览器 fetch 因 CORS 读不到字节；raw=1 让服务端同源吐字节
function toRawFetchUrl(url = "") {
  const value = String(url || "");
  if (!/^\/api\/cloud-assets\//i.test(value)) return value;
  return `${value}${value.includes("?") ? "&" : "?"}raw=1`;
}

const CHECKERBOARD_STYLE = {
  backgroundImage:
    "linear-gradient(45deg, rgba(127,127,127,0.22) 25%, transparent 25%, transparent 75%, rgba(127,127,127,0.22) 75%), linear-gradient(45deg, rgba(127,127,127,0.22) 25%, transparent 25%, transparent 75%, rgba(127,127,127,0.22) 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 8px 8px",
  backgroundColor: "rgba(127,127,127,0.08)",
};

const MAX_COMPOSITE_EDGE = 2048;

/**
 * 画布内扩图覆盖层（仿即梦）：挂在画布图片元素内部，扩展框直接套在图片四周，
 * 拖四边/四角自由决定扩展方向与大小；提示词与比例预设浮在框下方。
 * displayWidth 是图片当前在画布上的显示宽度（已含画布缩放），用它换算手柄拖拽距离。
 */
export default function OutpaintOverlay({ imageUrl = "", displayWidth = 1, onClose, onGenerate }) {
  const { t } = useCanvasT();
  const imageElRef = useRef(null);
  const dragRef = useRef(null);
  const [natural, setNatural] = useState(null);
  const [pads, setPads] = useState({ left: 0, right: 0, top: 0, bottom: 0 });
  const [userText, setUserText] = useState("");
  const [activeRatioId, setActiveRatioId] = useState("");
  const [activeScale, setActiveScale] = useState(1.5);
  const [loadError, setLoadError] = useState(false);

  // 同源拉取原图字节（可安全画进 canvas）并读取像素尺寸
  useEffect(() => {
    let cancelled = false;
    let createdUrl = "";
    (async () => {
      try {
        const res = await fetch(toRawFetchUrl(imageUrl));
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          imageElRef.current = img;
          setNatural({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
        };
        img.onerror = () => { if (!cancelled) setLoadError(true); };
        img.src = createdUrl;
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [imageUrl]);

  // ESC 关闭
  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // 图片像素 → 画布显示像素的换算系数（displayWidth 已含画布缩放）
  const dispScale = useMemo(() => {
    if (!natural?.w) return 1;
    return displayWidth / natural.w;
  }, [displayWidth, natural]);

  const clampPad = useCallback((value, base) => {
    return Math.min(Math.max(0, Math.round(value)), Math.round(base * OUTPAINT_MAX_PAD_FACTOR));
  }, []);

  /** 应用比例预设：只扩不裁，居中补齐到目标比例 */
  const applyRatioPreset = useCallback((preset, scaleFactor = activeScale) => {
    if (!natural) return;
    setActiveRatioId(preset.id);
    const { w, h } = natural;
    if (preset.id === "original") {
      const padX = clampPad((w * (scaleFactor - 1)) / 2, w);
      const padY = clampPad((h * (scaleFactor - 1)) / 2, h);
      setPads({ left: padX, right: padX, top: padY, bottom: padY });
      return;
    }
    const target = preset.ratio;
    const current = w / h;
    if (target > current) {
      const padX = clampPad((h * target - w) / 2, w);
      setPads({ left: padX, right: padX, top: 0, bottom: 0 });
    } else {
      const padY = clampPad((w / target - h) / 2, h);
      setPads({ left: 0, right: 0, top: padY, bottom: padY });
    }
  }, [activeScale, clampPad, natural]);

  /** 拖拽手柄：left/right/top/bottom 及四角组合；拖拽距离按显示比例换算成图片像素 */
  const startDrag = useCallback((e, handle) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { handle, x: e.clientX, y: e.clientY, pads: { ...pads } };
    setActiveRatioId("");
  }, [pads]);

  const moveDrag = useCallback((e) => {
    const start = dragRef.current;
    if (!start || !natural) return;
    e.stopPropagation();
    const dx = (e.clientX - start.x) / dispScale;
    const dy = (e.clientY - start.y) / dispScale;
    const { handle } = start;
    setPads(() => {
      const next = { ...start.pads };
      if (handle.includes("left")) next.left = clampPad(start.pads.left - dx, natural.w);
      if (handle.includes("right")) next.right = clampPad(start.pads.right + dx, natural.w);
      if (handle.includes("top")) next.top = clampPad(start.pads.top - dy, natural.h);
      if (handle.includes("bottom")) next.bottom = clampPad(start.pads.bottom + dy, natural.h);
      return next;
    });
  }, [clampPad, dispScale, natural]);

  const endDrag = useCallback(() => { dragRef.current = null; }, []);

  const hasExtension = pads.left + pads.right + pads.top + pads.bottom > 0;

  /** 合成白底画布（原图像素原样拷贝），交给父级发起生成 */
  const handleGenerate = useCallback(() => {
    const img = imageElRef.current;
    if (!img || !natural || !hasExtension) return;
    const outW = Math.round(natural.w + pads.left + pads.right);
    const outH = Math.round(natural.h + pads.top + pads.bottom);
    const factor = Math.min(1, MAX_COMPOSITE_EDGE / Math.max(outW, outH));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(outW * factor);
    canvas.height = Math.round(outH * factor);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      img,
      Math.round(pads.left * factor),
      Math.round(pads.top * factor),
      Math.round(natural.w * factor),
      Math.round(natural.h * factor),
    );
    onGenerate?.({
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
      pads: { ...pads },
      width: natural.w,
      height: natural.h,
      ratioLabel: pickClosestRatioLabel(outW, outH),
      dimensionsLabel: `${canvas.width} × ${canvas.height}`,
      userText,
    });
  }, [hasExtension, natural, onGenerate, pads, userText]);

  if (loadError) return null;
  if (!natural) return null;

  // 画布显示坐标（相对图片元素左上角）
  const padL = pads.left * dispScale;
  const padR = pads.right * dispScale;
  const padT = pads.top * dispScale;
  const padB = pads.bottom * dispScale;
  const imgW = natural.w * dispScale;
  const imgH = natural.h * dispScale;
  const frameW = imgW + padL + padR;
  const frameH = imgH + padT + padB;

  const handleDot = "rounded-full border-2 border-white bg-accent shadow-md";
  const stop = (e) => e.stopPropagation();

  return (
    <div data-outpaint-overlay className="absolute z-[24]" style={{ left: -padL, top: -padT, width: frameW, height: frameH }} onPointerDown={stop}>
      {/* 四条棋盘格扩展带（避开原图区域，不遮图） */}
      {padT > 0 && <div className="absolute left-0 top-0 w-full" style={{ ...CHECKERBOARD_STYLE, height: padT }} />}
      {padB > 0 && <div className="absolute bottom-0 left-0 w-full" style={{ ...CHECKERBOARD_STYLE, height: padB }} />}
      {padL > 0 && <div className="absolute left-0" style={{ ...CHECKERBOARD_STYLE, top: padT, width: padL, height: imgH }} />}
      {padR > 0 && <div className="absolute right-0" style={{ ...CHECKERBOARD_STYLE, top: padT, width: padR, height: imgH }} />}

      {/* 扩展框边界 */}
      <div className="pointer-events-none absolute inset-0 border border-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />

      {/* 输出尺寸角标 */}
      <div className="absolute -top-6 right-0 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90 whitespace-nowrap">
        {Math.round(natural.w + pads.left + pads.right)} × {Math.round(natural.h + pads.top + pads.bottom)} px
      </div>

      {/* 四边手柄 */}
      <div className="absolute -top-1.5 left-0 flex h-3 w-full cursor-ns-resize items-center justify-center" onPointerDown={(e) => startDrag(e, "top")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={`${handleDot} h-1.5 w-7`} />
      </div>
      <div className="absolute -bottom-1.5 left-0 flex h-3 w-full cursor-ns-resize items-center justify-center" onPointerDown={(e) => startDrag(e, "bottom")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={`${handleDot} h-1.5 w-7`} />
      </div>
      <div className="absolute -left-1.5 top-0 flex h-full w-3 cursor-ew-resize items-center justify-center" onPointerDown={(e) => startDrag(e, "left")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={`${handleDot} h-7 w-1.5`} />
      </div>
      <div className="absolute -right-1.5 top-0 flex h-full w-3 cursor-ew-resize items-center justify-center" onPointerDown={(e) => startDrag(e, "right")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={`${handleDot} h-7 w-1.5`} />
      </div>

      {/* 四角手柄 */}
      <div className="absolute -left-2 -top-2 h-4 w-4 cursor-nwse-resize" onPointerDown={(e) => startDrag(e, "top-left")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={`${handleDot} h-3 w-3`} />
      </div>
      <div className="absolute -right-2 -top-2 h-4 w-4 cursor-nesw-resize" onPointerDown={(e) => startDrag(e, "top-right")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={`${handleDot} h-3 w-3`} />
      </div>
      <div className="absolute -bottom-2 -left-2 h-4 w-4 cursor-nesw-resize" onPointerDown={(e) => startDrag(e, "bottom-left")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={`${handleDot} h-3 w-3`} />
      </div>
      <div className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize" onPointerDown={(e) => startDrag(e, "bottom-right")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={`${handleDot} h-3 w-3`} />
      </div>

      {/* 底部控制条：提示词 + 预设，浮在扩展框下方（不随框大小变形） */}
      <div
        className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5"
        style={{ top: frameH + 12 }}
        onPointerDown={stop}
      >
        <div className="flex w-[340px] items-center gap-1.5 rounded-xl border border-border-primary bg-bg-primary/95 px-2.5 py-1.5 shadow-lg backdrop-blur-xl">
          <input
            type="text"
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && hasExtension) handleGenerate();
            }}
            placeholder={t("描述扩展区域内容（可留空）")}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-text-primary placeholder:text-text-tertiary outline-none"
          />
          <button
            type="button"
            disabled={!hasExtension}
            onClick={handleGenerate}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
              hasExtension
                ? "bg-accent text-white hover:bg-accent-hover"
                : "cursor-not-allowed bg-bg-hover text-text-tertiary/50"
            }`}
            title={hasExtension ? t("开始扩图") : t("先拖动边框或选择比例")}
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
            title={t("关闭")}
          >
            <X size={13} />
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border-primary bg-bg-primary/95 px-1.5 py-1 shadow-lg backdrop-blur-xl">
          {OUTPAINT_SCALE_PRESETS.map((factor) => (
            <button
              key={factor}
              type="button"
              onClick={() => {
                setActiveScale(factor);
                applyRatioPreset(OUTPAINT_RATIO_PRESETS[0], factor);
              }}
              className={`rounded-lg px-1.5 py-1 text-[11px] transition-colors whitespace-nowrap ${
                activeRatioId === "original" && activeScale === factor
                  ? "bg-accent/15 text-accent font-medium"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              {factor}x
            </button>
          ))}
          <div className="h-4 w-px bg-border-primary" />
          {OUTPAINT_RATIO_PRESETS.filter((p) => p.id !== "original").map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyRatioPreset(preset)}
              className={`rounded-lg px-1.5 py-1 text-[11px] transition-colors whitespace-nowrap ${
                activeRatioId === preset.id
                  ? "bg-accent/15 text-accent font-medium"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
