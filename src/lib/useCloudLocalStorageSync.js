"use client";

import { useEffect, useRef } from "react";
import {
  CLOUD_STATE_DELETIONS_CHANGED_EVENT,
  CLOUD_STATE_DELETIONS_KEY,
  normalizeCloudStateDeletions,
} from "@/lib/cloudStateDeletions";
import {
  clearPersistentStore,
  getMemoryValue,
  hydratePersistentStore,
  removePersistentValue,
  setPersistentValue,
} from "@/lib/persistentLocalStore";

const DEFAULT_INTERVAL_MS = 6000;
const LOCAL_UPDATED_AT_KEY = "easyai-cloud-state-local-updated-at";
// 本地数据归属的账号邮箱：切换账号登录时据此清空上一账号残留的本地数据
const LOCAL_STATE_OWNER_KEY = "easyai-cloud-state-owner";
// 属于单个账号的所有本地数据键：云同步键 + 旧版存储、草稿、个人资料等。
// 切换账号时全部清空，防止上一账号的生成记录/会话/资料串到新账号。
const ACCOUNT_SCOPED_KEYS = [
  CLOUD_STATE_DELETIONS_KEY,
  "lovart-conversations",
  "lovart-active-conversation",
  "lovart-canvas-boards",
  "lovart-active-canvas-board",
  "lovart-canvas-images",
  "lovart-canvas-texts",
  "lovart-canvas-shapes",
  "lovart-messages",
  "lovart-floating-entry-draft",
  "lovart-canvas-ref-images",
  "lovart-chat-fullscreen-session",
  "lovart-chat-image-history",
  "lovart-material-favorites",
  "lovart-custom-palettes",
  "lovart-combo-presets",
  "lovart-custom-materials",
  "easyai-profile-display-name",
  "easyai-profile-avatar",
];

const WRITE_GUARD_GLOBAL = "__easyaiAccountScopedWriteGuard";

/**
 * 账号切换写入护栏：清空本地数据后到页面刷新完成前，页面上的卸载兜底逻辑
 * （如画布页 beforeunload/pagehide 里的 flushCanvasBoards）仍会把旧账号的
 * React 内存状态写回 localStorage，让刚清掉的数据「复活」并串进新账号。
 * 因此清空前先拦截所有账号相关键的写入，护栏持续到本页面生命周期结束。
 */
function installAccountScopedWriteGuard() {
  if (window[WRITE_GUARD_GLOBAL]) return;
  window[WRITE_GUARD_GLOBAL] = true;
  const guardedKeys = new Set([...ACCOUNT_SCOPED_KEYS, LOCAL_UPDATED_AT_KEY]);
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function guardedSetItem(key) {
    if (this === window.localStorage && guardedKeys.has(String(key))) return undefined;
    return originalSetItem.apply(this, arguments);
  };
}

/**
 * 声明当前本地数据归属于指定账号。
 * - 归属一致或首次记录：不动本地数据。
 * - 归属换人：清空所有账号相关的本地键，防止旧账号数据残留或被同步进新账号云端。
 * 返回 true 表示发生了清空（调用方必须立刻刷新页面；清空后本页面的
 * 账号相关写入已被护栏拦截，不刷新会导致后续正常保存全部失效）。
 */
export function claimLocalStateOwner(email) {
  if (typeof window === "undefined") return false;
  const normalized = String(email || "").toLowerCase();
  if (!normalized) return false;
  const owner = window.localStorage.getItem(LOCAL_STATE_OWNER_KEY) || "";
  if (owner === normalized) return false;
  try {
    window.localStorage.setItem(LOCAL_STATE_OWNER_KEY, normalized);
  } catch {
    return false; // localStorage 不可写时不清空，避免调用方陷入刷新死循环
  }
  if (!owner) return false; // 首次记录归属，本地数据视为当前账号的
  installAccountScopedWriteGuard();
  void clearPersistentStore(); // IndexedDB 主存储一并清空，防旧账号数据串号
  ACCOUNT_SCOPED_KEYS.forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  });
  try {
    window.localStorage.removeItem(LOCAL_UPDATED_AT_KEY);
  } catch {}
  return true;
}

const LOCAL_STATE_CHANGED_EVENT = "easyai-cloud-state-local-value-changed";
export const CLOUD_STATE_RESTORED_EVENT = "easyai-cloud-state-restored";
// 云端恢复开始/结束（无论成败）：页面可借此展示"正在同步云端数据"的提示，
// 避免用户在跨设备场景下把恢复完成前的本地旧状态误认为数据丢失/错乱
export const CLOUD_STATE_RESTORE_STARTED_EVENT = "easyai-cloud-state-restore-started";
export const CLOUD_STATE_RESTORE_FINISHED_EVENT = "easyai-cloud-state-restore-finished";
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
  const originalGetItem = Storage.prototype.getItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  // ⚠️ 云同步键的主存储是「内存缓存 + IndexedDB」（见 persistentLocalStore.js）。
  // localStorage 只有约 5MB 配额，画布记录撞顶后 setItem 会静默失败导致数据断更；
  // 现在 localStorage 降级为尽力而为的镜像：写不进去也不影响内存/IndexedDB/云同步。
  Storage.prototype.setItem = function patchedSetItem(key, value) {
    const stringKey = String(key);
    const isManaged = this === window.localStorage && getManagedCloudStateKeys().has(stringKey);
    if (!isManaged) return originalSetItem.apply(this, arguments);
    try {
      setPersistentValue(stringKey, String(value));
    } catch {}
    let result;
    try {
      result = originalSetItem.apply(this, arguments);
    } catch {
      // 镜像超配额可容忍：主存储已写入
    }
    try {
      markLocalUpdatedAt(stringKey);
      window.dispatchEvent(new CustomEvent(LOCAL_STATE_CHANGED_EVENT, { detail: { key: stringKey } }));
    } catch {}
    return result;
  };

  Storage.prototype.getItem = function patchedGetItem(key) {
    if (this === window.localStorage) {
      try {
        const memoryValue = getMemoryValue(String(key));
        if (memoryValue !== undefined) return memoryValue;
      } catch {}
    }
    return originalGetItem.apply(this, arguments);
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    if (this === window.localStorage) {
      try {
        removePersistentValue(String(key));
      } catch {}
    }
    return originalRemoveItem.apply(this, arguments);
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

// 材质收藏/自定义配色/组合预设：新设备打开面板时会先写入空数组，
// 若把空数组同步上云会覆盖掉账号已有的收藏。空列表一律不上传、恢复时视同无本地值。
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
  return isEmptyCanvasBoardsValue(item?.key, item?.value) || isEmptyProtectedListValue(item?.key, item?.value);
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
    // 不盖 Date.now()：合并只取两侧较新的真实编辑时间，
    // 避免"更新于"被同步/恢复动作顶成当天（与服务端 cloudStateStore 同规则）
    defaultBoard.updatedAt = Math.max(getUpdatedAt(defaultBoard), getUpdatedAt(board));
  }

  return result;
}

function mergeCanvasBoardsForRestore(localValue = "", incomingValue = "", options = {}) {
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
    // ⚠️ 保护注释 - 禁止改回默认展开合并：
    // 图片/形状坐标是用户手动排列的结果，绝不能被另一侧的旧快照覆盖。
    // 单条目谁新谁旧优先看条目级 updatedAt（画布在拖拽/缩放/编辑时会盖章）；
    // 两侧都没盖章（老数据）时保持 newer board 一侧的字段优先（即维持
    // "以更新的那个 board 里的条目为准"），防止 board 级时间戳误判时
    // 整版坐标被回退。mergeObjectsById 循环顺序是 [...incomingItems, ...localItems]，
    // 此处 incomingItems=newer 一侧，先入 map 成为 existing。
    const preferByItemTimestamp = (existing, item) => {
      if (!existing) return item;
      if (!item) return existing;
      const existingAt = Number(existing?.updatedAt || 0);
      const itemAt = Number(item?.updatedAt || 0);
      if (itemAt > existingAt) return { ...existing, ...item };
      return { ...item, ...existing }; // 平局或 existing 更新：newer board 一侧字段优先
    };
    byId.set(id, {
      ...older,
      ...newer,
      images: mergeObjectsById(older.images || [], newer.images || [], preferByItemTimestamp),
      texts: mergeObjectsById(older.texts || [], newer.texts || [], preferByItemTimestamp),
      shapes: mergeObjectsById(older.shapes || [], newer.shapes || [], preferByItemTimestamp),
    });
  }

  // 项目顺序是用户拖拽的结果。以"键级时间戳更新的一侧"为基准：
  // 云端时间戳更新说明另一台设备最近改过（含拖拽排序），采用云端顺序；
  // 否则保留本地顺序。另一侧独有的画布追加在后。
  // 之前无条件保留本地顺序，导致在其它设备上拖的顺序永远同步不过来。
  const baseBoards = options.preferIncomingOrder ? incomingBoards : localBoards;
  const otherBoards = options.preferIncomingOrder ? localBoards : incomingBoards;
  const baseOrder = baseBoards.map(getItemId).filter(Boolean);
  const otherOnlyOrder = otherBoards
    .map(getItemId)
    .filter((id) => id && !baseOrder.includes(id));
  return JSON.stringify([...baseOrder, ...otherOnlyOrder].map((id) => byId.get(id)).filter(Boolean));
}

function mergeCanvasImagesForRestore(localValue = "", incomingValue = "") {
  const localImages = safeJsonParse(localValue, []);
  const incomingImages = safeJsonParse(incomingValue, []);
  if (!Array.isArray(localImages) || !Array.isArray(incomingImages)) return incomingValue;
  if (localImages.length === 0) return incomingValue;
  if (incomingImages.length === 0) return localValue;
  return JSON.stringify(mergeObjectsById(localImages, incomingImages));
}

// 与服务端 cloudStateStore.js 的 messageSortKey 保持一致：
// 消息 id 内嵌 13 位毫秒时间戳，按时间升序、同时间用户消息在前
function messageSortKey(message) {
  const id = String(message?.id || "");
  const match = id.match(/(\d{10,})/);
  const ts = match ? Number(match[1]) : Number(message?.createdAt || message?.updatedAt || 0);
  const roleBias = message?.role === "user" ? 0 : 1;
  return `${String(ts || 0).padStart(16, "0")}-${roleBias}`;
}

function mergeMessagesForRestore(localMessages = [], incomingMessages = []) {
  // ⚠️ 合并后必须按时间重排。mergeObjectsById 的输出顺序是"先云端窗口、后本地独有"，
  // 本地独有的老消息会被追加到数组末尾——对话面板按数组顺序渲染且底部为最新，
  // 不排序会让"今天的新消息"看起来没同步过来（被老消息压在中间），
  // 且后续按条数裁剪时可能把真正的新消息裁掉。
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
  }).sort((a, b) => messageSortKey(a).localeCompare(messageSortKey(b)));
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
      // 不盖 Date.now()：恢复合并不算"编辑"，保留真实更新时间
      updatedAt: Math.max(getUpdatedAt(older), getUpdatedAt(newer)),
    };
  }).slice(-100));
}

function resolveIncomingStateValue(key, localValue, incomingValue, options = {}) {
  if (!localValue) return incomingValue;
  if (key === "lovart-canvas-boards") return mergeCanvasBoardsForRestore(localValue, incomingValue, options);
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
  // 携带本地数据归属账号，服务端校验与登录账号一致才落库，
  // 防止其他标签页切换账号后，本页把旧账号数据同步进新账号云端。
  let owner = "";
  try {
    owner = window.localStorage.getItem(LOCAL_STATE_OWNER_KEY) || "";
  } catch {}
  const body = JSON.stringify({ items, owner });

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
      const singleBody = JSON.stringify({ items: [item], owner });
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

    /**
     * 账号隔离：localStorage 是整个浏览器共享的，换账号登录后如果不清理，
     * 上一个账号的画布/会话数据会残留展示，甚至被同步进新账号的云端存档。
     * 恢复云端数据前先确认当前登录账号与本地数据归属一致；
     * 若归属换人，则清空所有云同步键并刷新页面，让页面用干净的本地状态
     * 重新加载新账号的云端数据。返回 false 表示已触发刷新，应中止本次恢复。
     */
    async function ensureLocalStateOwner() {
      let email = "";
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        email = data?.authenticated ? String(data?.user?.email || "") : "";
      } catch {
        return true; // 网络异常时保守处理：不清数据，也不改归属
      }
      if (!email) return true;
      // 清空与 reload 在同一个同步代码块内完成，避免页面上其他持久化
      // effect 在中间把旧账号的 React 状态写回 localStorage。
      if (claimLocalStateOwner(email)) {
        window.location.reload();
        return false;
      }
      return true;
    }

    /**
     * 云端状态拉取（带重试）。跨国链路下 GET 偶发失败/超时，若不重试就放弃恢复，
     * 会造成两个后果：本设备一直显示旧状态；且 restoredRef 置真后本设备开始
     * 把旧状态上传合并，穿新时间戳的旧数据可能压掉其他设备的新改动。
     * 因此失败后按退避重试，全部失败才放弃（此时才回落到旧行为）。
     */
    async function fetchCloudStateWithRetry() {
      const retryDelaysMs = [2000, 5000, 15000, 30000];
      for (let attempt = 0; ; attempt += 1) {
        try {
          const res = await fetch("/api/cloud-state", { method: "GET" });
          if (res.ok) return await res.json();
        } catch {}
        if (cancelled || attempt >= retryDelaysMs.length) return null;
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      }
    }

    async function restoreCloudState() {
      try {
        const shouldContinue = await ensureLocalStateOwner();
        // 已触发账号切换刷新：保持 restoredRef=false，阻止旧状态被同步上云
        if (!shouldContinue || cancelled) return;
        const data = await fetchCloudStateWithRetry();
        if (!data || cancelled) {
          restoredRef.current = true;
          return;
        }
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
          const cloudUpdatedAt = Number(item.clientUpdatedAt || 0);
          let localValueUpdatedAt = Number(localUpdatedAt[item.key] || 0);
          if (localValue && !localValueUpdatedAt) {
            localValueUpdatedAt = Date.now();
            localUpdatedAt[item.key] = localValueUpdatedAt;
            localUpdatedAtChanged = true;
          }
          const preferIncomingOnFirstRestore = overwriteOnFirstRestore && !hadInitialLocalValue(item.key);
          incomingValue = resolveIncomingStateValue(
            item.key,
            preferIncomingOnFirstRestore ? "" : localValue,
            incomingValue,
            // 云端键级时间戳严格更新 → 项目列表顺序以云端为准（另一台设备最近排过序）
            { preferIncomingOrder: cloudUpdatedAt > localValueUpdatedAt }
          );
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

    // 其他标签页切换了账号（owner 键被改成不同的非空值）：
    // 本页内存里还是旧账号的数据，立刻挂上写入护栏并刷新，防止串号。
    function handleOwnerChangedInOtherTab(event) {
      if (event.key !== LOCAL_STATE_OWNER_KEY) return;
      if (!event.oldValue || !event.newValue || event.oldValue === event.newValue) return;
      installAccountScopedWriteGuard();
      window.location.reload();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        handlePageLeaving();
        return;
      }
      scheduleSyncSoon();
    }

    void (async () => {
      // 先把 IndexedDB 主存储装进内存（含 localStorage → IndexedDB 首次迁移），
      // 再做云端恢复：恢复逻辑里的所有 localStorage 读写经补丁透明走内存/IndexedDB。
      try {
        let owner = "";
        try {
          owner = window.localStorage.getItem(LOCAL_STATE_OWNER_KEY) || "";
        } catch {}
        const changedKeys = await hydratePersistentStore(keys, (key) => readLocalUpdatedAt()[key], owner);
        if (!cancelled && changedKeys.length > 0) {
          window.dispatchEvent(new CustomEvent(CLOUD_STATE_RESTORED_EVENT, { detail: { keys: changedKeys } }));
        }
      } catch {}
      if (cancelled) return;
      try {
        window.dispatchEvent(new CustomEvent(CLOUD_STATE_RESTORE_STARTED_EVENT));
      } catch {}
      try {
        await restoreCloudState();
      } finally {
        try {
          window.dispatchEvent(new CustomEvent(CLOUD_STATE_RESTORE_FINISHED_EVENT));
        } catch {}
      }
      if (cancelled) return;
      syncNow();
    })();

    const timer = window.setInterval(syncNow, intervalMs);
    window.addEventListener("beforeunload", handlePageLeaving);
    window.addEventListener("pagehide", handlePageLeaving);
    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", scheduleSyncSoon);
    window.addEventListener("storage", handleOwnerChangedInOtherTab);
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
      window.removeEventListener("storage", handleOwnerChangedInOtherTab);
      window.removeEventListener(CLOUD_STATE_DELETIONS_CHANGED_EVENT, handleDeletionMarkerChanged);
      window.removeEventListener(LOCAL_STATE_CHANGED_EVENT, handleLocalManagedStateChanged);
    };
  }, [enabled, intervalMs, keys, overwriteOnFirstRestore]);
}
