"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MousePointer2,
  Hand,
  Square,
  Circle,
  Type,
  Minus,
  Plus,
  Palette,
  Grip,
  LayoutGrid,
  Scan,
  SwatchBook,
} from "lucide-react";
import { useCanvasT } from "@/lib/canvasI18n";

/* 创意工具箱的一次性新手引导，点掉后不再出现 */
const TOOLBOX_HINT_KEY = "lovart-creative-toolbox-hint-dismissed";

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
  onToggleMaterialPicker,
  isMaterialPickerOpen = false,
  onToggleCreativeTools,
  isCreativeToolsOpen = false,
  onAutoAlign,
  onFitView,
}) {
  const { t } = useCanvasT();
  const hasToolbox = Boolean(onToggleMaterialPicker || onToggleCreativeTools);
  const [showToolboxHint, setShowToolboxHint] = useState(false);

  useEffect(() => {
    if (!hasToolbox) return;
    try {
      if (!localStorage.getItem(TOOLBOX_HINT_KEY)) setShowToolboxHint(true);
    } catch {}
  }, [hasToolbox]);

  const dismissToolboxHint = useCallback(() => {
    setShowToolboxHint(false);
    try {
      localStorage.setItem(TOOLBOX_HINT_KEY, "1");
    } catch {}
  }, []);

  const capsuleClassName =
    "flex items-center gap-1 px-2 py-1.5 rounded-2xl bg-bg-secondary/90 backdrop-blur-xl border border-border-primary shadow-2xl shadow-black/40";

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-stretch gap-2">
      {/* 胶囊 1：画布工具 + 视图控制（原工具栏） */}
      <div className={capsuleClassName}>
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        const isActive = activeTool === tool.id;
        return (
          <button
            type="button"
            key={tool.id}
            onClick={() => onToolChange(tool.id)}
            title={t(tool.label)}
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
            title={t("矩形")}
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
            title={t("圆形（椭圆）")}
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
        title={t("画布颜色")}
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          <Palette size={16} />
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-bg-secondary"
            style={{ backgroundColor: canvasColor || "var(--bg-primary)" }}
          />
        </span>
      </button>

      {onAutoAlign && (
        <>
          <div className="w-px h-6 bg-border-primary mx-1" />
          <button
            type="button"
            onClick={onAutoAlign}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
            title={t("一键整理图片（重新网格对齐）")}
          >
            <LayoutGrid size={15} />
          </button>
        </>
      )}

      <div className="w-px h-6 bg-border-primary mx-1" />

      {onFitView && (
        <button
          type="button"
          onClick={onFitView}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
          title={t("适应画布 (Shift+1)：缩放至能看到全部内容")}
        >
          <Scan size={15} />
        </button>
      )}
      <button
            type="button"
        onClick={() => onZoomChange((z) => Math.max(z - 10, 1))}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
        title={t("缩小")}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        onClick={() => onZoomChange(100)}
        className="px-1.5 h-8 rounded-lg flex items-center justify-center text-[11px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover font-mono transition-all min-w-[42px]"
        title={t("重置缩放")}
      >
        {Math.round(zoom)}%
      </button>
      <button
        type="button"
        onClick={() => onZoomChange((z) => Math.min(z + 10, 800))}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
        title={t("放大")}
      >
        <Plus size={14} />
      </button>
      </div>

      {/* 胶囊 2：创意工具箱（一键换材质常驻 + 其它创意工具入口） */}
      {hasToolbox && (
        <div className={`relative ${capsuleClassName}`}>
          {showToolboxHint && (
            <div className="absolute bottom-[calc(100%+12px)] left-1/2 z-30 -translate-x-1/2 animate-fade-in">
              <div className="relative flex w-max max-w-[260px] items-center gap-2 rounded-xl bg-bg-secondary/95 py-2 pl-3 pr-2 text-xs text-text-primary shadow-md shadow-black/10 backdrop-blur-xl">
                {/* 提示文案：深色模式用品牌绿，浅色模式保持黑色 */}
                <span className="text-accent [html[data-theme=light]_&]:text-[#111827]">
                  {t("创意工具箱：一键换材质/风格等创意玩法都在这里")}
                </span>
                <button
                  type="button"
                  onClick={dismissToolboxHint}
                  className="shrink-0 rounded-lg bg-bg-hover px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary"
                >
                  {t("知道了")}
                </button>
                <span
                  aria-hidden="true"
                  className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-bg-secondary"
                />
              </div>
            </div>
          )}
          {isCreativeToolsOpen && (
            <div
              data-creative-tools-root
              className="absolute bottom-[calc(100%+10px)] right-0 z-30 w-56 rounded-2xl border border-border-primary bg-bg-secondary/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl animate-fade-in"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="mb-2 text-xs font-semibold text-text-primary">{t("创意工具")}</div>
              <div className="rounded-xl bg-bg-tertiary/60 px-3 py-4 text-center text-[11px] leading-relaxed text-text-tertiary">
                {t("更多创意玩法即将上线，敬请期待")}
              </div>
            </div>
          )}
          {onToggleMaterialPicker && (
            <button
              type="button"
              data-material-picker-trigger
              title={t("一键替换选中图片的材质或风格")}
              onClick={() => {
                dismissToolboxHint();
                onToggleMaterialPicker();
              }}
              className={`h-9 px-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
                isMaterialPickerOpen
                  ? "bg-accent text-white shadow-lg shadow-accent/30"
                  : `text-accent hover:bg-accent/12 [html[data-theme=light]_&]:text-[#111827] ${showToolboxHint ? "material-swap-attention" : ""}`
              }`}
            >
              <SwatchBook size={16} strokeWidth={isMaterialPickerOpen ? 2 : 1.75} />
              <span className="text-[11px] font-medium whitespace-nowrap">{t("风格迁移")}</span>
            </button>
          )}
          {onToggleCreativeTools && (
            <button
              type="button"
              data-creative-tools-trigger
              title={t("更多创意玩法")}
              onClick={() => {
                dismissToolboxHint();
                onToggleCreativeTools();
              }}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                isCreativeToolsOpen
                  ? "bg-accent text-white shadow-lg shadow-accent/30"
                  : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              <Grip size={16} strokeWidth={isCreativeToolsOpen ? 2 : 1.5} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
