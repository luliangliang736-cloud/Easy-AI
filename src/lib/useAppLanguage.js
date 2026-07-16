"use client";

import { useCallback, useEffect, useState } from "react";

// 与首页共用同一个持久化键，中英切换在所有页面间互通。
export const APP_LANGUAGE_STORAGE_KEY = "easyai-home-language";
const APP_LANGUAGE_EVENT = "easyai-language-change";

export function useAppLanguage() {
  const [language, setLanguage] = useState("zh");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
      if (stored === "zh" || stored === "en") setLanguage(stored);
    } catch {}
    const handleChange = (event) => {
      const next = event?.detail;
      if (next === "zh" || next === "en") setLanguage(next);
    };
    window.addEventListener(APP_LANGUAGE_EVENT, handleChange);
    return () => window.removeEventListener(APP_LANGUAGE_EVENT, handleChange);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage((prev) => {
      const next = prev === "zh" ? "en" : "zh";
      queueMicrotask(() => {
        try {
          localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, next);
        } catch {}
        window.dispatchEvent(new CustomEvent(APP_LANGUAGE_EVENT, { detail: next }));
      });
      return next;
    });
  }, []);

  return { language, toggleLanguage };
}
