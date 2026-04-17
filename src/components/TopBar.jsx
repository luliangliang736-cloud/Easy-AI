"use client";

import Link from "next/link";
import {
  Undo2,
  Redo2,
  Download,
  Share2,
  Moon,
  Sun,
} from "lucide-react";
import BrandLogo from "@/components/BrandLogo";

export default function TopBar({
  projectName,
  onExport,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  theme,
  onToggleTheme,
}) {
  return (
    <div className="h-12 bg-bg-secondary border-b border-border-primary flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-3">
        <Link href="/" className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center hover:bg-accent-hover transition-all" title="返回首页">
          <BrandLogo className="w-3.5 h-3.5 text-white" />
        </Link>
        <span className="text-sm font-medium text-text-primary">
          {projectName || "未命名项目"}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
            canUndo
              ? "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
              : "text-text-tertiary/30 cursor-not-allowed"
          }`}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
            canRedo
              ? "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
              : "text-text-tertiary/30 cursor-not-allowed"
          }`}
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo2 size={16} />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onToggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
          title={theme === "dark" ? "切换到浅色" : "切换到深色"}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-all"
          title="分享"
        >
          <Share2 size={16} />
        </button>
        <button
          onClick={onExport}
          className="h-8 px-3 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium flex items-center gap-1.5 transition-all"
        >
          <Download size={14} />
          导出
        </button>
      </div>
    </div>
  );
}
