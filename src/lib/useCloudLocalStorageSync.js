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
export const CLOUD_STATE_RESTORED_EVENT = "easyai-cloud-state-restored";
const KEEPALIVE_BODY_LIMIT = 60_000;
const MANAGED_KEYS_GLOBAL = "__easyaiCloudStateManagedKeys";
const STORAGE_PATCHED_GLOBAL = "__easyaiCloudStateStoragePatched";
const DEFAULT_CANVAS_BOARD_ID = "default-canvas-board";
const DEFAULT_CANVAS_BOARD_LABEL = "默认画布";

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

// 材质库偏好（收藏 / DIY 配色 / 组合预设 / DIY 材质）：新设备首次打开面板时本地是
// 空数组，绝不能拿空数组去覆盖云端已有数据，否则换设备登录会"丢收藏"。
const EMPTY_LIST_PROTECTED_KEYS = new Set([
  "lovart-material-favorites",
  "lovart-custom-palettes",
  "lovart-combo-presets",
  "lovart-custom-materials",
]);

function isEmptyProtectedListValue(key, value = "") {
  if (!EMPTY_LIST_PROTECTED_KEYS.has(key)) return false;
  const parsed = safeJsonParse(value, null);
  return Array.isArray(parsed) && parsed.length === 0;
}

function shouldSkipCloudStateItem(item) {
  // A valid canvas workspace always has at least one board. Never sync an
  // accidental empty board list, otherwise one stale tab can wipe every project.
  return isEmptyCanvasBoardsValue(item?.key, item?.value)
    || isEmptyProtectedListValue(item?.key, item?.value);
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
    return Array.isArray(parsed) ? JSON.stringify(collapseDefaultCanvasBoards(filterDeletedCanvasBoards(parsed, deletions))) : value;
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

function isDefaultCanvasBoard(board) {
  return board?.id === DEFAULT_CANVAS_BOARD_ID || String(board?.title || "").trim() === DEFAULT_CANVAS_BOARD_LABEL;
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

function mergeUniqueArrays(left = [], right = [], limit = 100) {
  return [...new Set([...(left || []), ...(right || [])].filter(Boolean))].slice(-limit);
}

function collapseDefaultCanvasBoards(boards = []) {
  if (!Array.isArray(boards) || boards.length === 0) return [];
  const result = [];
  let defaultBoard = null;

  for (const rawBoard of boards) {
    const defaultBoardCandidate = isDefaultCanvasBoard(rawBoard);
    const board = {
      ...rawBoard,
      id: defaultBoardCandidate ? DEFAULT_CANVAS_BOARD_ID : rawBoard?.id,
      title: defaultBoardCandidate ? DEFAULT_CANVAS_BOARD_LABEL : rawBoard?.title,
    };

    if (!defaultBoardCandidate) {
      result.push(board);
      continue;
    }

    if (!defaultBoard) {
      defaultBoard = board;
      result.push(defaultBoard);
      continue;
    }

    defaultBoard.images = mergeObjectsById(defaultBoard.images || [], board.images || []);
    defaultBoard.refImages = mergeUniqueArrays(defaultBoard.refImages || [], board.refImages || [], 14);
    defaultBoard.texts = mergeObjectsById(defaultBoard.texts || [], board.texts || []);
    defaultBoard.shapes = mergeObjectsById(defaultBoard.shapes || [], board.shapes || []);
    defaultBoard.createdAt = Math.min(getUpdatedAt(defaultBoard) || Date.now(), getUpdatedAt(board) || Date.now());
    defaultBoard.updatedAt = Math.max(getUpdatedAt(defaultBoard), getUpdatedAt(board), Date.now());
  }

  return result;
}

function mergeCanvasBoardsForRestore(localValue = "", incomingValue = "") {
  const localBoards = collapseDefaultCanvasBoards(safeJsonParse(localValue, []));
  const incomingBoards = collapseDefaultCanvasBoards(safeJsonParse(incomingValue, []));
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
    // ⚠️ 保护注释 - 禁止修改此合并策略：
    // 图片坐标（x/y）是用户在画布上手动排列的结果，必须以本地（newer）为准。
    // mergeObjectsById 循环顺序是 [...incomingItems, ...localItems]，
    // 若用默认展开（{ ...existing, ...item }），localItems（older/DB旧数据）最后展开
    // 会覆盖 newer/本地 的 x/y，导致刷新后图片位置回退到旧快照，视觉上乱序。
    // 使用 prefer 函数确保本地字段（existing）始终优先于 DB 旧字段（item）。
    const preferLocal = (existing, item) => {
      if (!existing) return item;
      return { ...item, ...existing }; // 本地字段覆盖DB旧字段，保留用户排列的 x/y
    };
    byId.set(id, {
      ...older,
      ...newer,
      images: mergeObjectsById(older.images || [], newer.images || [], preferLocal),
      texts: mergeObjectsById(older.texts || [], newer.texts || [], preferLocal),
      shapes: mergeObjectsById(older.shapes || [], newer.shapes || [], preferLocal),
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

function mergeMessagesForRestore(localMessages = [], incomingMessages = []) {
  return mergeObjectsById(localMessages, incomingMessages, (existing, incoming) => {
    if (!existing) return incoming;
    if (!incoming) return existing;
    const newer = getUpdatedAt(incoming) >= getUpdatedAt(existing) ? incoming : existing;
    const older = newer === incoming ? existing : incoming;
    return {
      ...older,
      ...newer,
      urls: mergeUniqueArrays(older.urls || [], newer.urls || [], 100),
      images: mergeUniqueArrays(older.images || [], newer.images || [], 100),
      refImages: mergeUniqueArrays(older.refImages || [], newer.refImages || [], 100),
      tasks: mergeObjectsById(older.tasks || [], newer.tasks || []),
    };
  });
}

function mergeConversationsForRestore(localValue = "", incomingValue = "") {
  const localConversations = safeJsonParse(localValue, []);
  const incomingConversations = safeJsonParse(incomingValue, []);
  if (!Array.isArray(localConversations) || !Array.isArray(incomingConversations)) return incomingValue;
  if (localConversations.length === 0) return incomingValue;
  if (incomingConversations.length === 0) return localValue;
  return JSON.stringify(mergeObjectsById(localConversations, incomingConversations, (existing, incoming) => {
    if (!existing) return incoming;
    if (!incoming) return existing;
    const newer = getUpdatedAt(incoming) >= getUpdatedAt(existing) ? incoming : existing;
    const older = newer === incoming ? existing : incoming;
    return {
      ...older,
      ...newer,
      messages: mergeMessagesForRestore(older.messages || [], newer.messages || []),
      updatedAt: Math.max(getUpdatedAt(older), getUpdatedAt(newer), Date.now()),
    };
  }).slice(-50));
}

function resolveIncomingStateValue(key, localValue, incomingValue) {
  if (!localValue) return incomingValue;
  if (key === "lovart-canvas-boards") return mergeCanvasBoardsForRestore(localValue, incomingValue);
  if (key === "lovart-canvas-images") return mergeCanvasImagesForRestore(localValue, incomingValue);
  if (key === "lovart-conversations") return mergeConversationsForRestore(localValue, incomingValue);
  return incomingValue;
}

function shouldWriteMergedRestoreValue(key, localValue, incomingValue) {
  return ["lovart-canvas-boards", "lovart-conversations"].includes(key)
    && typeof localValue === "string"
    && typeof incomingValue === "string"
    && localValue !== incomingValue;
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
  const wantKeepalive = Boolean(options.keepalive);
  const body = JSON.stringify({ items });

  // ⚠️ 保护注释 - 禁止修改此同步策略：
  // 浏览器的 keepalive fetch 有严格的 64KB body 上限。当用户刷新/关闭页面时
  // (beforeunload/pagehide)，只有 keepalive 请求能保证发送完成，普通请求会被
  // 浏览器立即取消导致数据丢失。
  // 若整包数据超过 KEEPALIVE_BODY_LIMIT，改为逐条 key 单独发送 keepalive 请求，
  // 每条单 key 的数据量远小于 64KB，确保每条都能用 keepalive 安全发出。
  // 绝对不能把 keepalive 降级为 false —— 那在页面卸载时等同于丢弃请求！
  if (wantKeepalive && body.length > KEEPALIVE_BODY_LIMIT) {
    // 逐条单独发送，每条都能满足 keepalive 的 64KB 限制
    const promises = items.map((item) => {
      const singleBody = JSON.stringify({ items: [item] });
      return fetch("/api/cloud-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: singleBody,
        keepalive: singleBody.length <= KEEPALIVE_BODY_LIMIT,
      }).catch(() => {});
    });
    await Promise.all(promises);
    return;
  }

  await fetch("/api/cloud-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: wantKeepalive && body.length <= KEEPALIVE_BODY_LIMIT,
  });
}

export function useCloudLocalStorageSync(keys = [], options = {}) {
  const enabled = options.enabled !== false;
  const intervalMs = Number(options.intervalMs || DEFAULT_INTERVAL_MS);
  const overwriteOnFirstRestore = options.overwriteOnFirstRestore === true;
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
    const initialLocalValues = keys.reduce((acc, key) => {
      const value = window.localStorage.getItem(key);
      if (value !== null) acc[key] = value;
      return acc;
    }, {});

    function hadInitialLocalValue(key) {
      return Object.prototype.hasOwnProperty.call(initialLocalValues, key);
    }

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
        const restoredKeys = [];

        for (const item of items) {
          if (!keys.includes(item.key) || typeof item.value !== "string") continue;
          let incomingValue = applyLocalDeletionsToStateValue(item.key, item.value, localDeletions);
          if (shouldSkipCloudStateItem({ key: item.key, value: incomingValue })) continue;
          const localValue = window.localStorage.getItem(item.key);
          const preferIncomingOnFirstRestore = overwriteOnFirstRestore && !hadInitialLocalValue(item.key);
          incomingValue = resolveIncomingStateValue(
            item.key,
            preferIncomingOnFirstRestore ? "" : localValue,
            incomingValue
          );
          const cloudUpdatedAt = Number(item.clientUpdatedAt || 0);
          let localValueUpdatedAt = Number(localUpdatedAt[item.key] || 0);
          if (localValue && !localValueUpdatedAt) {
            localValueUpdatedAt = Date.now();
            localUpdatedAt[item.key] = localValueUpdatedAt;
            localUpdatedAtChanged = true;
          }
          const cloudIsNewer = cloudUpdatedAt > localValueUpdatedAt
            || (cloudUpdatedAt === localValueUpdatedAt && localValue !== incomingValue);
          const shouldWriteMergedValue = shouldWriteMergedRestoreValue(item.key, localValue, incomingValue);
          if (incomingValue && (localValue === null || preferIncomingOnFirstRestore || shouldWriteMergedValue || (cloudIsNewer && localValue !== incomingValue))) {
            window.localStorage.setItem(item.key, incomingValue);
            localUpdatedAt[item.key] = cloudUpdatedAt || Date.now();
            localUpdatedAtChanged = true;
            restoredKeys.push(item.key);
          }
        }
        if (localUpdatedAtChanged) {
          writeLocalUpdatedAt(localUpdatedAt);
        }
        if (restoredKeys.length > 0) {
          window.dispatchEvent(new CustomEvent(CLOUD_STATE_RESTORED_EVENT, { detail: { keys: restoredKeys } }));
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
  }, [enabled, intervalMs, keys, overwriteOnFirstRestore]);
}
