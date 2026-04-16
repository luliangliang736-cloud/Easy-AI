"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export default function TextEditBlocksPanel({
  blocks = [],
  onChange,
  onApply,
  onCancel,
  title = "识别到的文字",
  subtitle = "直接填写“替换为”内容，发送时会自动带入编辑指令",
  applyLabel = "立即使用",
  isApplying = false,
  className = "",
}) {
  const [draftBlocks, setDraftBlocks] = useState(blocks);

  useEffect(() => {
    setDraftBlocks(blocks);
  }, [blocks]);

  const updateBlock = useCallback((id, patch) => {
    setDraftBlocks((prev) =>
      (Array.isArray(prev) ? prev : []).map((block) =>
        block.id === id ? { ...block, ...patch } : block
      )
    );
  }, []);

  const activeCount = useMemo(
    () => (draftBlocks || []).filter((block) => {
      const replacement = String(block.replacement || "").trim();
      return block.enabled !== false && replacement && replacement !== block.text;
    }).length,
    [draftBlocks]
  );

  if (!draftBlocks?.length) return null;

  return (
    <div className={`rounded-2xl border border-border-primary bg-bg-secondary/95 backdrop-blur-xl shadow-xl ${className}`}>
      <div className="p-3 border-b border-border-primary">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-text-primary">{title}</p>
            <p className="text-[10px] text-text-tertiary mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setDraftBlocks([])}
            disabled={isApplying}
            className="text-[10px] px-2 py-1 rounded-md border border-border-primary text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
          >
            清空
          </button>
        </div>
      </div>
      <div className="p-3 space-y-2 max-h-[min(56vh,520px)] overflow-y-auto">
        {draftBlocks.map((block, index) => (
          <div key={block.id} className="rounded-xl border border-border-primary bg-bg-tertiary/70 p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-tertiary shrink-0">{index + 1}</span>
              <input
                type="checkbox"
                checked={block.enabled !== false}
                onChange={(e) => updateBlock(block.id, { enabled: e.target.checked })}
                className="accent-accent"
              />
              <p className="text-xs text-text-secondary truncate">{block.text}</p>
            </div>
            <div className="grid grid-cols-[52px_1fr] gap-2 items-start">
              <span className="text-[10px] text-text-tertiary pt-1">替换为</span>
              <input
                value={block.replacement || ""}
                onChange={(e) => updateBlock(block.id, { replacement: e.target.value })}
                placeholder="输入新文案"
                className="w-full rounded-lg bg-bg-secondary border border-border-primary px-2.5 py-2 text-xs text-text-primary placeholder-text-tertiary outline-none focus:border-accent/40"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-border-primary flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setDraftBlocks(blocks);
            onCancel?.();
          }}
          disabled={isApplying}
          className="flex-1 rounded-xl border border-border-primary px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => {
            onChange?.(draftBlocks);
            onApply?.(draftBlocks);
          }}
          className="flex-1 rounded-xl bg-text-primary px-3 py-2 text-sm text-bg-primary hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={activeCount === 0 || isApplying}
        >
          {isApplying ? "处理中..." : applyLabel}
        </button>
      </div>
    </div>
  );
}
