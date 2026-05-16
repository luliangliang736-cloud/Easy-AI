"use client";

import { useEffect, useRef } from "react";
import {
  CLOUD_STATE_DELETIONS_CHANGED_EVENT,
  CLOUD_STATE_DELETIONS_KEY,
  normalizeCloudStateDeletions,
} from "@/lib/cloudStateDeletions";

const DEFAULT_INTERVAL_MS = 6000;
const LOCAL_UPDATED_AT_KEY = "easyai-cloud-state-local-updated-at";
const LOCAL_STATE_CHANGED_EVENT = "easyai-cloud-state-local-value-changed";
const KEEPALIVE_BODY_LIMIT = 60_000;
const MANAGED_KEYS_GLOBAL = "__easyaiCloudStateManagedKeys";
const STORAGE_PATCHED_GLOBAL = "__easyaiCloudStateStoragePatched";

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

function markLocalUpdatedAt(key, timestamp = Date.now()) {
  if (!key) return;
  const updatedAt = readLocalUpdatedAt();
  updatedAt[key] = timestamp;
  writeLocalUpdatedAt(updatedAt);
}

function getManagedCloudStateKeys() {
  window[MANAGED_KEYS_GLOBAL] = window[MANAGED_KEYS_GLOBAL] || new Set();
  return window[MANAGED_KEYS_GLOBAL];
}

function installCloudStateStoragePatch() {
  if (window[STORAGE_PATCHED_GLOBAL]) return;
  window[STORAGE_PATCHED_GLOBAL] = true;
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function patchedSetItem(key, value) {
    const result = originalSetItem.apply(this, arguments);
    try {
      if (this === window.localStorage && getManagedCloudStateKeys().has(String(key))) {
        markLocalUpdatedAt(String(key));
        window.dispatchEvent(new CustomEvent(LOCAL_STATE_CHANGED_EVENT, { detail: { key: String(key) } }));
      }
    } catch {}
    return result;
  };
}

function getValueSignature(value = "") {
  return `${value.length}:${value.slice(0, 64)}`;
}

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function isEmptyCanvasBoardsValue(key, value = "") {
  if (key !== "lovart-canvas-boards") return false;
  const parsed = safeJsonParse(value, null);
  return Array.isArray(parsed) && parsed.length === 0;
}

function shouldSkipCloudStateItem(item) {
  // A valid canvas workspace always has at least one board. Never sync an
  // accidental empty board list, otherwise one stale tab can wipe every project.
  return isEmptyCanvasBoardsValue(item?.key, item?.value);
}

function getItemId(item) {
  return item?.id ? String(item.id) : "";
}

function hasDeletedId(deletions = {}, scope = "", id = "") {
  return Boolean(scope && id && deletions?.[scope]?.[String(id)]);
}

function hasDeletedUrl(deletions = {}, url = "") {
  return Boolean(url && deletions?.imageUrls?.[String(url)]);
}

function filterDeletedMediaUrls(urls = [], deletions = {}) {
  if (!Array.isArray(urls)) return [];
  return urls.filter((url) => url && !hasDeletedUrl(deletions, url));
}

function filterDeletedCanvasItems(items = [], deletions = {}) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    const id = getItemId(item);
    const url = item?.image_url || item?.url || "";
    return !hasDeletedId(deletions, "canvasImageIds", id) && !hasDeletedUrl(deletions, url);
  });
}

function filterDeletedMessages(messages = [], deletions = {}) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => !hasDeletedId(deletions, "messageIds", getItemId(message)) && !hasDeletedId(deletions, "chatMessageIds", getItemId(message)))
    .map((message) => ({
      ...message,
      urls: filterDeletedMediaUrls(message.urls || [], deletions),
      images: filterDeletedMediaUrls(message.images || [], deletions),
      refImages: filterDeletedMediaUrls(message.refImages || [], deletions),
      tasks: Array.isArray(message.tasks)
        ? message.tasks.filter((task) => !hasDeletedId(deletions, "taskIds", getItemId(task)) && !hasDeletedUrl(deletions, task?.url))
        : message.tasks,
    }));
}

function filterDeletedConversations(conversations = [], deletions = {}) {
  if (!Array.isArray(conversations)) return [];
  return conversations
    .filter((conversation) => !hasDeletedId(deletions, "conversationIds", getItemId(conversation)))
    .map((conversation) => ({
      ...conversation,
      messages: filterDeletedMessages(conversation.messages || [], deletions),
    }));
}

function filterDeletedCanvasBoards(boards = [], deletions = {}) {
  if (!Array.isArray(boards)) return [];
  return boards
    .filter((board) => !hasDeletedId(deletions, "canvasBoardIds", getItemId(board)))
    .map((board) => ({
      ...board,
      images: filterDeletedCanvasItems(board.images || [], deletions),
      texts: Array.isArray(board.texts)
        ? board.texts.filter((item) => !hasDeletedId(deletions, "canvasTextIds", getItemId(item)))
        : board.texts,
      shapes: Array.isArray(board.shapes)
        ? board.shapes.filter((item) => !hasDeletedId(deletions, "canvasShapeIds", getItemId(item)))
        : board.shapes,
    }));
}

function applyLocalDeletionsToStateValue(key, value = "", deletions = {}) {
  if (!value || key === CLOUD_STATE_DELETIONS_KEY) return value;
  if (key === "lovart-canvas-boards") {
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed) ? JSON.stringify(filterDeletedCanvasBoards(parsed, deletions)) : value;
  }
  if (key === "lovart-canvas-images") {
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed) ? JSON.stringify(filterDeletedCanvasItems(parsed, deletions)) : value;
  }
  if (key === "lovart-conversations") {
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed) ? JSON.stringify(filterDeletedConversations(parsed, deletions)) : value;
  }
  if (key === "lovart-canvas-texts") {
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed) ? JSON.stringify(parsed.filter((item) => !hasDeletedId(deletions, "canvasTextIds", getItemId(item)))) : value;
  }
  if (key === "lovart-canvas-shapes") {
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed) ? JSON.stringify(parsed.filter((item) => !hasDeletedId(deletions, "canvasShapeIds", getItemId(item)))) : value;
  }
  if (key === "lovart-chat-fullscreen-session") {
    const parsed = safeJsonParse(value, null);
    return parsed && typeof parsed === "object"
      ? JSON.stringify({ ...parsed, messages: filterDeletedMessages(parsed.messages || [], deletions), refImages: filterDeletedMediaUrls(parsed.refImages || [], deletions) })
      : value;
  }
  if (key === "lovart-chat-image-history") {
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed)
      ? JSON.stringify(parsed.map((item) => ({ ...item, urls: filterDeletedMediaUrls(item.urls || [], deletions) })).filter((item) => item.urls?.length > 0))
      : value;
  }
  return value;
}

function getUpdatedAt(item) {
  return Number(item?.updatedAt || item?.createdAt || 0);
}

function mergeObjectsById(localItems = [], incomingItems = [], prefer = null) {
  const order = [];
  const byId = new Map();
  for (const item of [...incomingItems, ...localItems]) {
    const id = getItemId(item);
    if (!id) continue;
    if (!byId.has(id)) order.push(id);
    const existing = byId.get(id);
    byId.set(id, prefer ? prefer(existing, item) : { ...(existing || {}), ...item });
  }
  return order.map((id) => byId.get(id)).filter(Boolean);
}

function mergeCanvasBoardsForRestore(localValue = "", incomingValue = "") {
  const localBoards = safeJsonParse(localValue, []);
  const incomingBoards = safeJsonParse(incomingValue, []);
  if (!Array.isArray(localBoards) || !Array.isArray(incomingBoards)) return incomingValue;
  if (localBoards.length === 0) return incomingValue;
  if (incomingBoards.length === 0) return localValue;

  const byId = new Map();
  for (const board of incomingBoards) {
    const id = getItemId(board);
    if (id) byId.set(id, board);
  }
  for (const board of localBoards) {
    const id = getItemId(board);
    if (!id) continue;
    const incomingBoard = byId.get(id);
    if (!incomingBoard) {
      byId.set(id, board);
      continue;
    }
    const newer = getUpdatedAt(board) >= getUpdatedAt(incomingBoard) ? board : incomingBoard;
    const older = newer === board ? incomingBoard : board;
    byId.set(id, {
      ...older,
      ...newer,
      images: mergeObjectsById(older.images || [], newer.images || []),
      texts: mergeObjectsById(older.texts || [], newer.texts || []),
      shapes: mergeObjectsById(older.shapes || [], newer.shapes || []),
    });
  }

  // Board order is user intent. Preserve the browser's saved local order during
  // restore, and only append cloud boards that this browser has not seen yet.
  const localOrder = localBoards.map(getItemId).filter(Boolean);
  const incomingOnlyOrder = incomingBoards
    .map(getItemId)
    .filter((id) => id && !localOrder.includes(id));
  return JSON.stringify([...localOrder, ...incomingOnlyOrder].map((id) => byId.get(id)).filter(Boolean));
}

function mergeCanvasImagesForRestore(localValue = "", incomingValue = "") {
  const localImages = safeJsonParse(localValue, []);
  const incomingImages = safeJsonParse(incomingValue, []);
  if (!Array.isArray(localImages) || !Array.isArray(incomingImages)) return incomingValue;
  if (localImages.length === 0) return incomingValue;
  if (incomingImages.length === 0) return localValue;
  return JSON.stringify(mergeObjectsById(localImages, incomingImages));
}

function resolveIncomingStateValue(key, localValue, incomingValue) {
  if (!localValue) return incomingValue;
  if (key === "lovart-canvas-boards") return mergeCanvasBoardsForRestore(localValue, incomingValue);
  if (key === "lovart-canvas-images") return mergeCanvasImagesForRestore(localValue, incomingValue);
  return incomingValue;
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
    .filter((item) => !shouldSkipCloudStateItem(item))
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

async function saveSnapshot(items = [], options = {}) {
  if (items.length === 0) return;
  const body = JSON.stringify({ items });
  await fetch("/api/cloud-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: Boolean(options.keepalive) && body.length <= KEEPALIVE_BODY_LIMIT,
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
    installCloudStateStoragePatch();
    keys.forEach((key) => getManagedCloudStateKeys().add(key));

    function markLocalValueIfNeeded(key, value) {
      if (!keys.includes(key) || typeof value !== "string" || !value) return;
      const signature = getValueSignature(value);
      if (keySignaturesRef.current[key] === signature) return;
      keySignaturesRef.current[key] = signature;
      markLocalUpdatedAt(key);
    }

    function getDeletionItem() {
      if (!keys.includes(CLOUD_STATE_DELETIONS_KEY)) return null;
      const value = window.localStorage.getItem(CLOUD_STATE_DELETIONS_KEY);
      if (!value) return null;
      markLocalValueIfNeeded(CLOUD_STATE_DELETIONS_KEY, value);
      const updatedAt = readLocalUpdatedAt();
      return {
        key: CLOUD_STATE_DELETIONS_KEY,
        value,
        clientUpdatedAt: Number(updatedAt[CLOUD_STATE_DELETIONS_KEY] || Date.now()),
      };
    }

    function syncDeletionMarkerNow(keepalive = false) {
      const deletionItem = getDeletionItem();
      if (!deletionItem) return;
      void saveSnapshot([deletionItem], { keepalive }).catch(() => {});
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
        const localUpdatedAt = readLocalUpdatedAt();
        const localDeletions = normalizeCloudStateDeletions(window.localStorage.getItem(CLOUD_STATE_DELETIONS_KEY));
        let localUpdatedAtChanged = false;

        for (const item of items) {
          if (!keys.includes(item.key) || typeof item.value !== "string") continue;
          let incomingValue = applyLocalDeletionsToStateValue(item.key, item.value, localDeletions);
          if (shouldSkipCloudStateItem({ key: item.key, value: incomingValue })) continue;
          const localValue = window.localStorage.getItem(item.key);
          incomingValue = resolveIncomingStateValue(item.key, localValue, incomingValue);
          const cloudUpdatedAt = Number(item.clientUpdatedAt || 0);
          let localValueUpdatedAt = Number(localUpdatedAt[item.key] || 0);
          if (localValue && !localValueUpdatedAt) {
            localValueUpdatedAt = Date.now();
            localUpdatedAt[item.key] = localValueUpdatedAt;
            localUpdatedAtChanged = true;
          }
          const cloudIsNewer = cloudUpdatedAt > localValueUpdatedAt
            || (cloudUpdatedAt === localValueUpdatedAt && localValue !== incomingValue);
          if (incomingValue && (localValue === null || (cloudIsNewer && localValue !== incomingValue))) {
            window.localStorage.setItem(item.key, incomingValue);
            localUpdatedAt[item.key] = cloudUpdatedAt || Date.now();
            localUpdatedAtChanged = true;
          }
        }
        if (localUpdatedAtChanged) {
          writeLocalUpdatedAt(localUpdatedAt);
        }

        // Restore localStorage only. Do not reload the page from this hook:
        // creation screens keep active composer/reference state in React, and
        // forced reloads can override the user's current workflow.
        restoredRef.current = true;
      } catch {
        restoredRef.current = true;
      }
    }

    function syncNow(options = {}) {
      if (cancelled || !restoredRef.current) return;
      if (options.keepalive || options.includeDeletionFirst) {
        syncDeletionMarkerNow(Boolean(options.keepalive));
      }
      keys.forEach((key) => markLocalValueIfNeeded(key, window.localStorage.getItem(key)));
      const items = readSnapshot(keys);
      const signature = snapshotSignature(items);
      if (!signature || signature === lastSignatureRef.current) return;
      lastSignatureRef.current = signature;
      void saveSnapshot(items, { keepalive: Boolean(options.keepalive) }).catch(() => {});
    }

    function handleDeletionMarkerChanged() {
      if (!restoredRef.current) return;
      syncDeletionMarkerNow(false);
      scheduleSyncSoon();
    }

    function handleLocalManagedStateChanged(event) {
      if (!restoredRef.current) return;
      if (event?.detail?.key && !keys.includes(event.detail.key)) return;
      scheduleSyncSoon();
    }

    function handlePageLeaving() {
      syncNow({ keepalive: true, includeDeletionFirst: true });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        handlePageLeaving();
        return;
      }
      scheduleSyncSoon();
    }

    void restoreCloudState().then(() => {
      if (cancelled) return;
      syncNow();
    });

    const timer = window.setInterval(syncNow, intervalMs);
    window.addEventListener("beforeunload", handlePageLeaving);
    window.addEventListener("pagehide", handlePageLeaving);
    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", scheduleSyncSoon);
    window.addEventListener(CLOUD_STATE_DELETIONS_CHANGED_EVENT, handleDeletionMarkerChanged);
    window.addEventListener(LOCAL_STATE_CHANGED_EVENT, handleLocalManagedStateChanged);
    return () => {
      cancelled = true;
      if (syncTimer) window.clearTimeout(syncTimer);
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", handlePageLeaving);
      window.removeEventListener("pagehide", handlePageLeaving);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", scheduleSyncSoon);
      window.removeEventListener(CLOUD_STATE_DELETIONS_CHANGED_EVENT, handleDeletionMarkerChanged);
      window.removeEventListener(LOCAL_STATE_CHANGED_EVENT, handleLocalManagedStateChanged);
    };
  }, [enabled, intervalMs, keys]);
}
