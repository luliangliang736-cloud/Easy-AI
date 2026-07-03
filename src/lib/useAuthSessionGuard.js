"use client";

import { useEffect } from "react";

// 兜底轮询间隔（页面一直在前台不切走时的检查频率）
const DEFAULT_CHECK_INTERVAL_MS = 5 * 60_000;
// 两次检查之间的最小间隔，避免频繁切换标签页时连续打请求
const MIN_CHECK_GAP_MS = 30_000;
const LOCAL_DEV_AUTH_BYPASS = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DISABLE_LOCAL_AUTH !== "0";

function redirectToLogin() {
  const next = `${window.location.pathname}${window.location.search}`;
  const url = new URL("/", window.location.origin);
  url.searchParams.set("login", "1");
  if (next !== "/") url.searchParams.set("next", next);
  window.location.assign(url.toString());
}

export function useAuthSessionGuard(options = {}) {
  const enabled = options.enabled !== false && !LOCAL_DEV_AUTH_BYPASS;
  const intervalMs = Number(options.intervalMs || DEFAULT_CHECK_INTERVAL_MS);
  const onUnauthorized = options.onUnauthorized;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    let cancelled = false;
    let lastCheckAt = 0;

    async function checkSession(force = false) {
      if (!force && Date.now() - lastCheckAt < MIN_CHECK_GAP_MS) return;
      lastCheckAt = Date.now();
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled || res.ok) return;
        if (res.status === 401) {
          if (typeof onUnauthorized === "function") {
            onUnauthorized();
          } else {
            redirectToLogin();
          }
        }
      } catch {
        // 网络短暂失败不强制退出，避免误伤正在创作的页面。
      }
    }

    // 页面切回前台时检查一次（正常网站的常见策略），加兜底轮询
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void checkSession();
    }

    void checkSession(true);
    const timer = window.setInterval(checkSession, intervalMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs, onUnauthorized]);
}
