"use client";

// ============================================================
// IndexedDB 持久层：localStorage 只有约 5MB 配额，画布/会话记录持续增长
// 早晚撞顶（撞顶后 setItem 静默失败，症状是"改了东西刷新就没"）。
// 云同步管理的键改为「内存缓存 + IndexedDB（GB 级配额）」作主存储，
// localStorage 降级为尽力而为的镜像（保证回滚到旧版本时数据仍可见）。
// 任一环节失败都回退到 localStorage 原行为，不会比改造前更糟。
// ============================================================

const DB_NAME = "easyai-local-state";
const DB_STORE = "kv";

const memoryCache = new Map();
const hydratedKeys = new Set();
// 同 key 的 IDB 写入串行化：写入进行中收到新值时只保留最新值，落笔前一条完成后再写
const pendingWrites = new Map();
const inFlightKeys = new Set();

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DB_STORE)) {
          request.result.createObjectStore(DB_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // 打开失败后允许下次重试
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function idbRequest(mode, executor) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const store = tx.objectStore(DB_STORE);
    const request = executor(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

async function pumpWrites(key) {
  if (inFlightKeys.has(key)) return;
  inFlightKeys.add(key);
  try {
    while (pendingWrites.has(key)) {
      const record = pendingWrites.get(key);
      pendingWrites.delete(key);
      await idbRequest("readwrite", (store) => store.put(record));
    }
  } catch {
    pendingWrites.delete(key);
  } finally {
    inFlightKeys.delete(key);
  }
}

/** 内存缓存里的值；没有时返回 undefined（调用方应落回真实 localStorage） */
export function getMemoryValue(key) {
  return memoryCache.has(key) ? memoryCache.get(key) : undefined;
}

export function setPersistentValue(key, value, updatedAt = Date.now()) {
  memoryCache.set(key, value);
  pendingWrites.set(key, { key, value, updatedAt });
  void pumpWrites(key);
}

export function removePersistentValue(key) {
  memoryCache.delete(key);
  pendingWrites.delete(key);
  void idbRequest("readwrite", (store) => store.delete(key)).catch(() => {});
}

// 数据归属账号标记：换账号后哪怕清库事务被页面刷新打断，
// 下次启动装载时发现归属不一致也会整库清空，杜绝串号。
const OWNER_RECORD_KEY = "__easyai-owner";

/** 账号切换时清空整个本地持久层（内存 + IndexedDB） */
export function clearPersistentStore() {
  memoryCache.clear();
  pendingWrites.clear();
  hydratedKeys.clear();
  return idbRequest("readwrite", (store) => store.clear()).catch(() => {});
}

/**
 * 启动时把 IndexedDB 里的数据装进内存缓存，并做双向对齐：
 * - IDB 有、localStorage 没有/较旧 → 以 IDB 为准（localStorage 撞顶断更后的常态）；
 * - localStorage 较新（如期间回滚到过旧版本继续使用）→ 以 localStorage 为准并回写 IDB；
 * - IDB 没有、localStorage 有 → 首次迁移进 IDB。
 * 返回「内存值与 localStorage 当前值不一致」的键列表，调用方应广播恢复事件
 * 让页面重新加载状态（页面已有处理云端恢复事件的现成逻辑）。
 */
export async function hydratePersistentStore(keys = [], getLocalTimestamp = () => 0, owner = "") {
  const changedKeys = [];
  let records;
  try {
    const list = await idbRequest("readonly", (store) => store.getAll());
    records = new Map((list || []).map((item) => [item.key, item]));
  } catch {
    return changedKeys; // IndexedDB 不可用（隐私模式等）：维持 localStorage 原行为
  }

  // 归属校验：IndexedDB 里的数据属于别的账号时整库清空，不装载
  const idbOwner = String(records.get(OWNER_RECORD_KEY)?.value || "");
  if (owner && idbOwner && idbOwner !== owner) {
    try {
      await idbRequest("readwrite", (store) => store.clear());
    } catch {
      return changedKeys;
    }
    records = new Map();
  }
  if (owner && idbOwner !== owner) {
    void idbRequest("readwrite", (store) => store.put({ key: OWNER_RECORD_KEY, value: owner, updatedAt: Date.now() })).catch(() => {});
  }

  for (const key of keys) {
    if (hydratedKeys.has(key)) continue;
    hydratedKeys.add(key);
    if (memoryCache.has(key)) continue; // 启动后已被写入（云端恢复等），新值优先

    let localValue = null;
    try {
      localValue = window.localStorage.getItem(key);
    } catch {}

    const record = records.get(key);
    if (record && typeof record.value === "string") {
      const localTs = Number(getLocalTimestamp(key) || 0);
      const idbTs = Number(record.updatedAt || 0);
      if (localValue !== null && localTs > idbTs && localValue !== record.value) {
        setPersistentValue(key, localValue, localTs);
      } else {
        memoryCache.set(key, record.value);
        if (record.value !== localValue) changedKeys.push(key);
      }
    } else if (localValue !== null) {
      setPersistentValue(key, localValue, Number(getLocalTimestamp(key) || Date.now()));
    }
  }
  return changedKeys;
}
