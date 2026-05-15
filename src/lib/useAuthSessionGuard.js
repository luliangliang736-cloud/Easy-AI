"use client";

import { useEffect } from "react";

const DEFAULT_CHECK_INTERVAL_MS = 30_000;

function redirectToLogin() {
  const next = `${window.location.pathname}${window.location.search}`;
  const url = new URL("/", window.location.origin);
  url.searchParams.set("login", "1");
  if (next !== "/") url.searchParams.set("next", next);
  window.location.assign(url.toString());
}

export function useAuthSessionGuard(options = {}) {
  const enabled = options.enabled !== false;
  const intervalMs = Number(options.intervalMs || DEFAULT_CHECK_INTERVAL_MS);
  const onUnauthorized = options.onUnauthorized;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    let cancelled = false;

    async function checkSession() {
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

    void checkSession();
    const timer = window.setInterval(checkSession, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, onUnauthorized]);
}
