"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw, Sparkles, X } from "lucide-react";
import { useCanvasT } from "@/lib/canvasI18n";
import {
  CAMERA_DIRECTION_PRESETS,
  MULTI_ANGLE_H_RANGE,
  MULTI_ANGLE_V_RANGE,
  MULTI_ANGLE_ZOOM_OPTIONS,
  isDefaultAngle,
} from "@/lib/multiAngle";

function clampAngle(value, { min, max }) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 立体小相机（仿即梦）：CSS 3D 立方体机身，白色取景屏朝外、镜头面朝球心。
 * 机身姿态跟随球面角度实时变化：水平角转动机身朝向，垂直角带动俯仰。
 */
function CameraMarker3D({ h = 0, v = 0 }) {
  const size = 22;
  const half = size / 2;
  const bodyFace = "absolute inset-0 rounded-[3px] border border-white/12 bg-[#26282e]";
  return (
    <div style={{ perspective: "130px" }}>
      <div
        className="relative transition-transform duration-75"
        style={{
          width: size,
          height: size,
          transformStyle: "preserve-3d",
          // 基础偏角(-10/18)保证默认位也有立体感；h/v 直接映射球面方位，镜头始终指向球心
          transform: `rotateX(${-10 + v}deg) rotateY(${18 + h}deg)`,
        }}
      >
        {/* 机身五个暗面（rotateY 180 那面即朝向球心的镜头面） */}
        <div className={bodyFace} style={{ transform: `rotateY(180deg) translateZ(${half}px)` }} />
        <div className={bodyFace} style={{ transform: `rotateY(-90deg) translateZ(${half}px)` }} />
        <div className={bodyFace} style={{ transform: `rotateY(90deg) translateZ(${half}px)` }} />
        <div className={`${bodyFace} brightness-125`} style={{ transform: `rotateX(90deg) translateZ(${half}px)` }} />
        <div className={bodyFace} style={{ transform: `rotateX(-90deg) translateZ(${half}px)` }} />
        {/* 取景屏：朝外的白色面板（相机背屏，正对使用者） */}
        <div
          className="absolute inset-0 flex items-center justify-center rounded-[3px] border border-black/10 bg-white"
          style={{ transform: `translateZ(${half}px)`, backfaceVisibility: "hidden" }}
        >
          <Camera size={12} className="text-accent" />
        </div>
      </div>
    </div>
  );
}

/**
 * 线框球体可视化（仿即梦）：原图缩略图居中，相机标记按水平/垂直角度绕球面运动。
 * 支持直接在球面上拖拽调整角度，四周箭头按 15° 步进微调。
 */
function SpherePreview({ h, v, imageUrl, onChange }) {
  const dragRef = useRef(null);
  const R = 64;
  const hr = (h * Math.PI) / 180;
  const vr = (v * Math.PI) / 180;
  const markerX = R * Math.sin(hr) * Math.cos(vr);
  const markerY = -R * Math.sin(vr);
  const isBehind = Math.cos(hr) * Math.cos(vr) < 0;

  const nudge = (dh, dv) => {
    onChange(
      clampAngle(h + dh, MULTI_ANGLE_H_RANGE),
      clampAngle(v + dv, MULTI_ANGLE_V_RANGE),
    );
  };

  const handlePointerDown = (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, h, v };
  };
  const handlePointerMove = (e) => {
    const start = dragRef.current;
    if (!start) return;
    onChange(
      clampAngle(start.h + (e.clientX - start.x) * 0.6, MULTI_ANGLE_H_RANGE),
      clampAngle(start.v - (e.clientY - start.y) * 0.6, MULTI_ANGLE_V_RANGE),
    );
  };
  const handlePointerUp = () => { dragRef.current = null; };

  const arrowClass = "absolute z-30 flex h-5 w-5 items-center justify-center rounded-full text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors";

  return (
    <div
      className="relative h-[170px] cursor-grab touch-none select-none overflow-hidden rounded-xl bg-bg-tertiary/60 active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      title="拖拽调整角度"
    >
      {/* 线框球体（纯装饰，标记位置才代表相机方位） */}
      <svg viewBox="0 0 240 170" className="pointer-events-none absolute inset-0 h-full w-full text-text-tertiary/28">
        <circle cx="120" cy="85" r={R} fill="none" stroke="currentColor" strokeWidth="1" />
        <ellipse cx="120" cy="85" rx="24" ry={R} fill="none" stroke="currentColor" strokeWidth="0.8" />
        <ellipse cx="120" cy="85" rx="46" ry={R} fill="none" stroke="currentColor" strokeWidth="0.8" />
        <ellipse cx="120" cy="85" rx={R} ry="24" fill="none" stroke="currentColor" strokeWidth="0.8" />
        <ellipse cx="120" cy="85" rx={R} ry="46" fill="none" stroke="currentColor" strokeWidth="0.8" />
      </svg>

      {/* 中心：被拍摄的原图 */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-[64px] w-[64px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-primary object-cover shadow-md"
        />
      ) : null}

      {/* 立体相机标记：沿球面运动，转到背面时缩小减淡 */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 transition-opacity"
        style={{
          zIndex: isBehind ? 5 : 20,
          opacity: isBehind ? 0.4 : 1,
          transform: `translate(-50%, -50%) translate(${markerX}px, ${markerY}px) scale(${isBehind ? 0.78 : 1})`,
        }}
      >
        <CameraMarker3D h={h} v={v} />
      </div>

      {/* 15° 步进微调箭头 */}
      <button type="button" className={`${arrowClass} left-1/2 top-1 -translate-x-1/2`} onPointerDown={(e) => e.stopPropagation()} onClick={() => nudge(0, 15)}>
        <ChevronUp size={13} />
      </button>
      <button type="button" className={`${arrowClass} bottom-1 left-1/2 -translate-x-1/2`} onPointerDown={(e) => e.stopPropagation()} onClick={() => nudge(0, -15)}>
        <ChevronDown size={13} />
      </button>
      <button type="button" className={`${arrowClass} left-1 top-1/2 -translate-y-1/2`} onPointerDown={(e) => e.stopPropagation()} onClick={() => nudge(-15, 0)}>
        <ChevronLeft size={13} />
      </button>
      <button type="button" className={`${arrowClass} right-1 top-1/2 -translate-y-1/2`} onPointerDown={(e) => e.stopPropagation()} onClick={() => nudge(15, 0)}>
        <ChevronRight size={13} />
      </button>
    </div>
  );
}

/**
 * 多角度面板：球面拖拽 + 方位九宫格 + 水平/垂直滑杆 + 镜头推拉，点「立即生成」把参数交给父级生成。
 * 提示词模板在 lib/multiAngle.js，前端不展示后台关键词。
 */
export default function MultiAnglePanel({ imageUrl = "", onGenerate, onClose, isBusy = false }) {
  const { t } = useCanvasT();
  const [h, setH] = useState(0);
  const [v, setV] = useState(0);
  const [zoom, setZoom] = useState("none");
  const angle = { h, v, zoom };
  const isDefault = isDefaultAngle(angle);

  const handleSphereChange = useCallback((nextH, nextV) => {
    setH(nextH);
    setV(nextV);
  }, []);

  return (
    <div
      className="flex w-[264px] flex-col gap-3 p-3"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-text-primary">{t("多角度")}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => { setH(0); setV(0); setZoom("none"); }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
            title={t("重置参数")}
          >
            <RotateCcw size={10} />
            {t("重置")}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
              title={t("关闭")}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <SpherePreview h={h} v={v} imageUrl={imageUrl} onChange={handleSphereChange} />

      <div className="grid grid-cols-3 gap-1">
        {CAMERA_DIRECTION_PRESETS.map((preset) => {
          const isActive = preset.h === h && preset.v === v;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => { setH(preset.h); setV(preset.v); }}
              className={`rounded-lg px-1 py-1.5 text-[11px] transition-colors ${
                isActive
                  ? "bg-accent/15 text-accent font-medium"
                  : "bg-bg-tertiary/60 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              {t(preset.name)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-text-secondary">{t("水平")}</span>
            <span className="text-text-primary">{h}°</span>
          </div>
          <input
            type="range"
            min={MULTI_ANGLE_H_RANGE.min}
            max={MULTI_ANGLE_H_RANGE.max}
            step={1}
            value={h}
            onChange={(e) => setH(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-text-secondary">{t("垂直")}</span>
            <span className="text-text-primary">{v}°</span>
          </div>
          <input
            type="range"
            min={MULTI_ANGLE_V_RANGE.min}
            max={MULTI_ANGLE_V_RANGE.max}
            step={1}
            value={v}
            onChange={(e) => setV(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <span className="pr-1 text-[11px] text-text-secondary">{t("镜头")}</span>
        {MULTI_ANGLE_ZOOM_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setZoom(option.id)}
            className={`flex-1 rounded-lg px-1 py-1 text-[11px] transition-colors ${
              zoom === option.id
                ? "bg-accent/15 text-accent font-medium"
                : "bg-bg-tertiary/60 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
          >
            {t(option.name)}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={isDefault || isBusy}
        onClick={() => onGenerate?.(angle)}
        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium transition-colors ${
          isDefault || isBusy
            ? "cursor-not-allowed bg-bg-hover/50 text-text-tertiary/60"
            : "bg-accent text-white hover:bg-accent-hover"
        }`}
        title={isDefault ? t("先调整角度参数") : t("按当前角度生成新视角")}
      >
        <Sparkles size={12} />
        {isBusy ? t("生成中…") : t("立即生成")}
      </button>
    </div>
  );
}
