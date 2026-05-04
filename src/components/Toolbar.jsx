"use client";

import {
  MousePointer2,
  Hand,
  Square,
  Circle,
  Type,
  Minus,
  Plus,
  Palette,
} from "lucide-react";

const TOOLS = [
  { id: "select", icon: MousePointer2, label: "选择：框选多图/文案 · 拖拽 · 图片缩放角 · 双击编辑文案" },
  { id: "hand", icon: Hand, label: "手型：平移画布 (H)" },
  { id: "shape", icon: Square, label: "形状：拖拽绘制矩形/圆形（先选圆或方）" },
  { id: "text", icon: Type, label: "文字：点击空白画布直接输入" },
];

export default function Toolbar({
  activeTool,
  onToolChange,
  zoom,
  onZoomChange,
  shapeMode = "rect",
  onShapeModeChange,
  canvasColor,
  onToggleCanvasColorPicker,
}) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-1.5 rounded-2xl bg-bg-secondary/90 backdrop-blur-xl border border-border-primary shadow-2xl shadow-black/40">
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        const isActive = activeTool === tool.id;
        return (
          <button
            type="button"
            key={tool.id}
            onClick={() => onToolChange(tool.id)}
            title={tool.label}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
              isActive
                ? "bg-accent text-white shadow-lg shadow-accent/30"
                : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
            }`}
          >
            <Icon size={16} strokeWidth={isActive ? 2 : 1.5} />
          </button>
        );
      })}

      {activeTool === "shape" && onShapeModeChange && (
        <div className="flex items-center gap-0.5 pl-1 ml-0.5 border-l border-border-primary">
          <button
            type="button"
            title="矩形"
            onClick={() => onShapeModeChange("rect")}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              shapeMode === "rect"
                ? "bg-emerald-500/25 text-emerald-400 border border-emerald-500/40"
                : "text-text-tertiary hover:bg-bg-hover border border-transparent"
            }`}
          >
            <Square size={15} strokeWidth={shapeMode === "rect" ? 2 : 1.5} />
          </button>
          <button
            type="button"
            title="圆形（椭圆）"
            onClick={() => onShapeModeChange("ellipse")}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              shapeMode === "ellipse"
                ? "bg-emerald-500/25 text-emerald-400 border border-emerald-500/40"
                : "text-text-tertiary hover:bg-bg-hover border border-transparent"
            }`}
          >
            <Circle size={15} strokeWidth={shapeMode === "ellipse" ? 2 : 1.5} />
          </button>
        </div>
      )}

      <button
        type="button"
        data-color-picker-trigger
        onClick={onToggleCanvasColorPicker}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
        title="画布颜色"
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          <Palette size={16} />
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-bg-secondary"
            style={{ backgroundColor: canvasColor || "var(--bg-primary)" }}
          />
        </span>
      </button>

      <div className="w-px h-6 bg-border-primary mx-1" />

      <button
            type="button"
        onClick={() => onZoomChange((z) => Math.max(z - 10, 1))}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
        title="缩小"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        onClick={() => onZoomChange(100)}
        className="px-1.5 h-8 rounded-lg flex items-center justify-center text-[11px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover font-mono transition-all min-w-[42px]"
        title="重置缩放"
      >
        {Math.round(zoom)}%
      </button>
      <button
        type="button"
        onClick={() => onZoomChange((z) => Math.min(z + 10, 800))}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
        title="放大"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
