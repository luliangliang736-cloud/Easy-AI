"use client";

import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 6000;
const LOCAL_UPDATED_AT_KEY = "easyai-cloud-state-local-updated-at";

function readLocalUpdatedAt() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_UPDATED_AT_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalUpdatedAt(value) {
  try {
    window.localStorage.setItem(LOCAL_UPDATED_AT_KEY, JSON.stringify(value || {}));
  } catch {}
}

function getValueSignature(value = "") {
  return `${value.length}:${value.slice(0, 64)}`;
}

function readSnapshot(keys = []) {
  const now = Date.now();
  const updatedAt = readLocalUpdatedAt();
  let changed = false;
  return keys
    .map((key) => {
      const value = window.localStorage.getItem(key);
      if (!value) return null;
      if (!updatedAt[key]) {
        updatedAt[key] = now;
        changed = true;
      }
      return { key, value, clientUpdatedAt: Number(updatedAt[key] || now) };
    })
    .filter(Boolean)
    .map((item, index, items) => {
      if (index === items.length - 1 && changed) {
        writeLocalUpdatedAt(updatedAt);
      }
      return item;
    });
}

function snapshotSignature(items = []) {
  return items.map((item) => `${item.key}:${getValueSignature(item.value)}`).join("|");
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
  const keySignaturesRef = useRef({});

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || keys.length === 0) return undefined;
    let cancelled = false;
    const syncDelayMs = Math.min(1000, intervalMs);
    let syncTimer = 0;

    function markLocalValueIfNeeded(key, value) {
      if (!keys.includes(key) || typeof value !== "string" || !value) return;
      const signature = getValueSignature(value);
      if (keySignaturesRef.current[key] === signature) return;
      keySignaturesRef.current[key] = signature;
      const updatedAt = readLocalUpdatedAt();
      updatedAt[key] = Date.now();
      writeLocalUpdatedAt(updatedAt);
    }

    function scheduleSyncSoon() {
      if (syncTimer) window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        syncTimer = 0;
        syncNow();
      }, syncDelayMs);
    }

    async function restoreCloudState() {
      try {
        const res = await fetch("/api/cloud-state", { method: "GET" });
        if (!res.ok) {
          restoredRef.current = true;
          return;
        }
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        let restoredCount = 0;
        const localUpdatedAt = readLocalUpdatedAt();
        let localUpdatedAtChanged = false;

        for (const item of items) {
          if (!keys.includes(item.key) || typeof item.value !== "string") continue;
          const localValue = window.localStorage.getItem(item.key);
          const cloudUpdatedAt = Number(item.clientUpdatedAt || 0);
          let localValueUpdatedAt = Number(localUpdatedAt[item.key] || 0);
          if (localValue && !localValueUpdatedAt) {
            localValueUpdatedAt = Date.now();
            localUpdatedAt[item.key] = localValueUpdatedAt;
            localUpdatedAtChanged = true;
          }
          const cloudIsNewer = cloudUpdatedAt > localValueUpdatedAt
            || (cloudUpdatedAt === localValueUpdatedAt && localValue !== item.value);
          if (item.value && (localValue === null || (cloudIsNewer && localValue !== item.value))) {
            window.localStorage.setItem(item.key, item.value);
            localUpdatedAt[item.key] = cloudUpdatedAt || Date.now();
            localUpdatedAtChanged = true;
            restoredCount += 1;
          }
        }
        if (localUpdatedAtChanged) {
          writeLocalUpdatedAt(localUpdatedAt);
        }

        if (restoredCount > 0) {
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
      keys.forEach((key) => markLocalValueIfNeeded(key, window.localStorage.getItem(key)));
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
    window.addEventListener("visibilitychange", syncNow);
    window.addEventListener("focus", scheduleSyncSoon);
    return () => {
      cancelled = true;
      if (syncTimer) window.clearTimeout(syncTimer);
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", syncNow);
      window.removeEventListener("visibilitychange", syncNow);
      window.removeEventListener("focus", scheduleSyncSoon);
    };
  }, [enabled, intervalMs, keys]);
}
