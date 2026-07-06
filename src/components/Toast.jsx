"use client";

import { useState, useCallback, useEffect, createContext, useContext } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const COLORS = {
  success: "text-emerald-400",
  error: "text-red-400",
  info: "text-blue-400",
};

function ToastItem({ toast, onRemove }) {
  const [exiting, setExiting] = useState(false);
  const Icon = ICONS[toast.type] || ICONS.info;
  const color = COLORS[toast.type] || COLORS.info;

  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), toast.duration || 2000);
    return () => clearTimeout(timer);
  }, [toast.duration]);

  useEffect(() => {
    if (exiting) {
      const timer = setTimeout(() => onRemove(toast.id), 250);
      return () => clearTimeout(timer);
    }
  }, [exiting, toast.id, onRemove]);

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-bg-secondary border border-border-primary shadow-2xl shadow-black/50 min-w-[200px] max-w-[360px] transition-all duration-250 ${
        exiting ? "opacity-0 -translate-y-2" : "opacity-100 translate-y-0"
      }`}
    >
      <Icon size={16} className={color} />
      <span className="text-xs text-text-primary flex-1">{toast.message}</span>
      <button onClick={() => setExiting(true)} className="text-text-tertiary hover:text-text-primary">
        <X size={12} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = "info", duration = 2000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    return id;
  }, []);

  // 允许调用方撤销指定气泡（如“复制中…”完成后接力为“已复制”）
  addToast.dismiss = removeToast;

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
