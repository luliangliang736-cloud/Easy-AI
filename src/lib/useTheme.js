"use client";

import { useCallback, useEffect, useState } from "react";

const THEME_KEY = "easy-ai-theme";

/**
 * storageKey 支持给不同页面各自独立的主题偏好：
 * 工作台沿用默认的 easy-ai-theme，首页传入自己的键，互不影响。
 */
export function useTheme(defaultTheme = "dark", storageKey = THEME_KEY) {
  const [theme, setTheme] = useState(defaultTheme);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(storageKey);
      if (savedTheme === "light" || savedTheme === "dark") {
        setTheme(savedTheme);
      }
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(storageKey, theme);
    } catch {}
  }, [theme, storageKey]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, setTheme, toggleTheme };
}
