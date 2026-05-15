import { ensureCloudDbSchema, getCloudDbPool, isCloudDbConfigured } from "@/lib/server/cloudDb";

const MAX_STATE_VALUE_CHARS = Number(process.env.CLOUD_STATE_MAX_VALUE_CHARS || 1_500_000);

export const CLOUD_STATE_KEYS = [
  "lovart-floating-entry-home-history",
  "lovart-floating-entry-home-session",
  "lovart-chat-fullscreen-session",
  "lovart-chat-image-history",
  "lovart-conversations",
  "lovart-active-conversation",
  "lovart-canvas-boards",
  "lovart-active-canvas-board",
  "lovart-canvas-images",
  "lovart-canvas-texts",
  "lovart-canvas-shapes",
  "lovart-canvas-ref-images",
];

const allowedStateKeys = new Set(CLOUD_STATE_KEYS);
const MERGEABLE_STATE_KEYS = new Set([
  "lovart-conversations",
  "lovart-canvas-boards",
  "lovart-canvas-images",
  "lovart-canvas-ref-images",
]);

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getItemId(item) {
  return item?.id ? String(item.id) : "";
}

function getUpdatedAt(item) {
  return Number(item?.updatedAt || item?.createdAt || 0);
}

function isCloudAssetUrl(url = "") {
  return /^\/api\/cloud-assets\//i.test(String(url || ""));
}

function preferCanvasItem(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const existingUrl = existing.image_url || existing.url || "";
  const incomingUrl = incoming.image_url || incoming.url || "";
  if (isCloudAssetUrl(incomingUrl) && !isCloudAssetUrl(existingUrl)) {
    return { ...existing, ...incoming };
  }
  if (isCloudAssetUrl(existingUrl) && !isCloudAssetUrl(incomingUrl)) {
    return { ...incoming, ...existing };
  }
  return getUpdatedAt(incoming) >= getUpdatedAt(existing)
    ? { ...existing, ...incoming }
    : { ...incoming, ...existing };
}

function mergeArrayById(existing = [], incoming = [], prefer = preferCanvasItem) {
  const order = [];
  const byId = new Map();

  for (const item of [...existing, ...incoming]) {
    const id = getItemId(item);
    if (!id) continue;
    if (!byId.has(id)) order.push(id);
    byId.set(id, prefer(byId.get(id), item));
  }

  return order.map((id) => byId.get(id)).filter(Boolean);
}

function getMessageStatusRank(status = "") {
  const value = String(status || "").toLowerCase();
  if (value === "completed") return 5;
  if (value === "paused") return 4;
  if (value === "generating") return 3;
  if (value === "pending") return 2;
  if (value === "failed") return 1;
  return 0;
}

function preferMessage(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const base = getMessageStatusRank(incoming.status) >= getMessageStatusRank(existing.status)
    ? { ...existing, ...incoming }
    : { ...incoming, ...existing };
  const urls = [...(existing.urls || []), ...(incoming.urls || [])].filter(Boolean);
  const uniqueUrls = [...new Set(urls)];
  const mergedTasks = mergeArrayById(existing.tasks || [], incoming.tasks || [], (oldTask, newTask) => {
    if (!oldTask) return newTask;
    if (!newTask) return oldTask;
    return getMessageStatusRank(newTask.status) >= getMessageStatusRank(oldTask.status)
      ? { ...oldTask, ...newTask }
      : { ...newTask, ...oldTask };
  });
  const seenTaskUrls = new Set();
  const tasks = mergedTasks.filter((task) => {
    if (!task?.url) return true;
    if (seenTaskUrls.has(task.url)) return false;
    seenTaskUrls.add(task.url);
    return true;
  });
  return {
    ...base,
    urls: uniqueUrls.length > 0 ? uniqueUrls : base.urls,
    tasks: tasks.length > 0 ? tasks : base.tasks,
  };
}

function messageSortKey(message) {
  const id = String(message?.id || "");
  const match = id.match(/(\d{10,})/);
  const ts = match ? Number(match[1]) : Number(message?.createdAt || message?.updatedAt || 0);
  const roleBias = message?.role === "user" ? 0 : 1;
  return `${String(ts || 0).padStart(16, "0")}-${roleBias}`;
}

function mergeMessages(existing = [], incoming = []) {
  return mergeArrayById(existing, incoming, preferMessage)
    .sort((a, b) => messageSortKey(a).localeCompare(messageSortKey(b)))
    .slice(-200);
}

function mergeConversations(existingValue = "", incomingValue = "") {
  const existing = safeJsonParse(existingValue, []);
  const incoming = safeJsonParse(incomingValue, []);
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return incomingValue;

  const merged = mergeArrayById(existing, incoming, (oldConversation, newConversation) => {
    if (!oldConversation) return newConversation;
    if (!newConversation) return oldConversation;
    const newer = getUpdatedAt(newConversation) >= getUpdatedAt(oldConversation) ? newConversation : oldConversation;
    const older = newer === newConversation ? oldConversation : newConversation;
    const messages = mergeMessages(oldConversation.messages || [], newConversation.messages || []);
    return {
      ...older,
      ...newer,
      messages,
      updatedAt: Math.max(getUpdatedAt(oldConversation), getUpdatedAt(newConversation), Date.now()),
    };
  });

  return JSON.stringify(merged.slice(-50));
}

function mergeCanvasBoards(existingValue = "", incomingValue = "") {
  const existing = safeJsonParse(existingValue, []);
  const incoming = safeJsonParse(incomingValue, []);
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return incomingValue;

  const merged = mergeArrayById(existing, incoming, (oldBoard, newBoard) => {
    if (!oldBoard) return newBoard;
    if (!newBoard) return oldBoard;
    const newer = getUpdatedAt(newBoard) >= getUpdatedAt(oldBoard) ? newBoard : oldBoard;
    const older = newer === newBoard ? oldBoard : newBoard;
    return {
      ...older,
      ...newer,
      images: mergeArrayById(oldBoard.images || [], newBoard.images || []).slice(-100),
      texts: mergeArrayById(oldBoard.texts || [], newBoard.texts || []).slice(-100),
      shapes: mergeArrayById(oldBoard.shapes || [], newBoard.shapes || []).slice(-200),
      updatedAt: Math.max(getUpdatedAt(oldBoard), getUpdatedAt(newBoard), Date.now()),
    };
  });

  return JSON.stringify(merged.slice(-30));
}

function mergeUniqueStringArrays(existingValue = "", incomingValue = "", limit = 100) {
  const existing = safeJsonParse(existingValue, []);
  const incoming = safeJsonParse(incomingValue, []);
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return incomingValue;
  return JSON.stringify([...new Set([...existing, ...incoming].filter(Boolean))].slice(-limit));
}

function mergeCloudStateValue(key, existingValue = "", incomingValue = "") {
  if (key === "lovart-conversations") return mergeConversations(existingValue, incomingValue);
  if (key === "lovart-canvas-boards") return mergeCanvasBoards(existingValue, incomingValue);
  if (key === "lovart-canvas-images") {
    const existing = safeJsonParse(existingValue, []);
    const incoming = safeJsonParse(incomingValue, []);
    if (!Array.isArray(existing) || !Array.isArray(incoming)) return incomingValue;
    return JSON.stringify(mergeArrayById(existing, incoming).slice(-100));
  }
  if (key === "lovart-canvas-ref-images") return mergeUniqueStringArrays(existingValue, incomingValue, 14);
  return incomingValue;
}

export function normalizeCloudStateItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      key: String(item?.key || "").trim(),
      value: typeof item?.value === "string" ? item.value : "",
      clientUpdatedAt: Number(item?.clientUpdatedAt || Date.now()),
    }))
    .filter((item) => allowedStateKeys.has(item.key) && item.value && item.value.length <= MAX_STATE_VALUE_CHARS);
}

export async function readUserCloudState(userEmail = "") {
  if (!isCloudDbConfigured()) return { configured: false, items: [] };
  await ensureCloudDbSchema();
  const result = await getCloudDbPool().query(
    `
      SELECT state_key, state_value, client_updated_at, server_updated_at
      FROM user_cloud_state
      WHERE user_email = $1
    `,
    [userEmail],
  );
  return {
    configured: true,
    items: result.rows.map((row) => ({
      key: row.state_key,
      value: row.state_value,
      clientUpdatedAt: Number(row.client_updated_at || 0),
      serverUpdatedAt: row.server_updated_at,
    })),
  };
}

export async function upsertUserCloudState(userEmail = "", rawItems = []) {
  if (!isCloudDbConfigured()) return { configured: false, saved: 0 };
  const items = normalizeCloudStateItems(rawItems);
  if (items.length === 0) return { configured: true, saved: 0 };

  await ensureCloudDbSchema();
  const pool = getCloudDbPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of items) {
      let stateValue = item.value;
      let clientUpdatedAt = item.clientUpdatedAt;

      if (MERGEABLE_STATE_KEYS.has(item.key)) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
          [userEmail, item.key],
        );
        const existingResult = await client.query(
          `
            SELECT state_value, client_updated_at
            FROM user_cloud_state
            WHERE user_email = $1 AND state_key = $2
            FOR UPDATE
          `,
          [userEmail, item.key],
        );
        const existing = existingResult.rows[0];
        if (existing?.state_value) {
          stateValue = mergeCloudStateValue(item.key, existing.state_value, item.value);
          // A merge can produce a value that is newer than either browser's local snapshot.
          // Bump the timestamp so both tabs/devices restore the merged server copy.
          clientUpdatedAt = Math.max(Number(existing.client_updated_at || 0), item.clientUpdatedAt, Date.now());
          if (!stateValue || stateValue.length > MAX_STATE_VALUE_CHARS) {
            stateValue = item.value;
            clientUpdatedAt = item.clientUpdatedAt;
          }
        }
      }

      await client.query(
        `
          INSERT INTO user_cloud_state (user_email, state_key, state_value, client_updated_at, server_updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (user_email, state_key)
          DO UPDATE SET
            state_value = EXCLUDED.state_value,
            client_updated_at = EXCLUDED.client_updated_at,
            server_updated_at = NOW()
          WHERE user_cloud_state.client_updated_at <= EXCLUDED.client_updated_at
        `,
        [userEmail, item.key, stateValue, clientUpdatedAt],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return { configured: true, saved: items.length };
}
