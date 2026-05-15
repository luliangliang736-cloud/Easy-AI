"use client";

import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 6000;

function readSnapshot(keys = []) {
  const now = Date.now();
  return keys
    .map((key) => {
      const value = window.localStorage.getItem(key);
      if (!value) return null;
      return { key, value, clientUpdatedAt: now };
    })
    .filter(Boolean);
}

function snapshotSignature(items = []) {
  return items.map((item) => `${item.key}:${item.value.length}:${item.value.slice(0, 64)}`).join("|");
}

async function saveSnapshot(items = []) {
  if (items.length === 0) return;
  await fetch("/api/cloud-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

export function useCloudLocalStorageSync(keys = [], options = {}) {
  const enabled = options.enabled !== false;
  const intervalMs = Number(options.intervalMs || DEFAULT_INTERVAL_MS);
  const lastSignatureRef = useRef("");
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || keys.length === 0) return undefined;
    let cancelled = false;
    const reloadMarker = `easyai-cloud-state-restored:${window.location.pathname}`;

    async function restoreCloudState() {
      try {
        const res = await fetch("/api/cloud-state", { method: "GET" });
        if (!res.ok) return;
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        let restoredCount = 0;

        for (const item of items) {
          if (!keys.includes(item.key) || typeof item.value !== "string") continue;
          const localValue = window.localStorage.getItem(item.key);
          if (localValue === null && item.value) {
            window.localStorage.setItem(item.key, item.value);
            restoredCount += 1;
          }
        }

        if (restoredCount > 0 && !window.sessionStorage.getItem(reloadMarker)) {
          window.sessionStorage.setItem(reloadMarker, "1");
          window.location.reload();
          return;
        }

        restoredRef.current = true;
      } catch {
        restoredRef.current = true;
      }
    }

    function syncNow() {
      if (cancelled || !restoredRef.current) return;
      const items = readSnapshot(keys);
      const signature = snapshotSignature(items);
      if (!signature || signature === lastSignatureRef.current) return;
      lastSignatureRef.current = signature;
      void saveSnapshot(items).catch(() => {});
    }

    void restoreCloudState().then(() => {
      if (cancelled) return;
      syncNow();
    });

    const timer = window.setInterval(syncNow, intervalMs);
    window.addEventListener("beforeunload", syncNow);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", syncNow);
    };
  }, [enabled, intervalMs, keys]);
}
