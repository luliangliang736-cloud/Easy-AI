import { ensureCloudDbSchema, getCloudDbPool, isCloudDbConfigured } from "@/lib/server/cloudDb";
import {
  CLOUD_STATE_DELETIONS_KEY,
  mergeCloudStateDeletions,
  normalizeCloudStateDeletions,
} from "@/lib/cloudStateDeletions";

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
  CLOUD_STATE_DELETIONS_KEY,
];

const allowedStateKeys = new Set(CLOUD_STATE_KEYS);
const MERGEABLE_STATE_KEYS = new Set([
  "lovart-conversations",
  "lovart-canvas-boards",
  "lovart-canvas-images",
  "lovart-canvas-ref-images",
  CLOUD_STATE_DELETIONS_KEY,
]);

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

function getItemId(item) {
  return item?.id ? String(item.id) : "";
}

function getUpdatedAt(item) {
  return Number(item?.updatedAt || item?.createdAt || 0);
}

function isCloudAssetUrl(url = "") {
  return /^\/api\/cloud-assets\//i.test(String(url || ""));
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
    .map((message) => {
      const tasks = Array.isArray(message?.tasks)
        ? message.tasks.filter((task) => !hasDeletedId(deletions, "taskIds", getItemId(task)) && !hasDeletedUrl(deletions, task?.url))
        : message?.tasks;
      const urls = filterDeletedMediaUrls(message?.urls || [], deletions);
      const images = filterDeletedMediaUrls(message?.images || [], deletions);
      const refImages = filterDeletedMediaUrls(message?.refImages || [], deletions);
      return { ...message, tasks, urls, images, refImages };
    })
    .filter((message) => {
      const hasText = String(message?.text || "").trim();
      const hasTasks = Array.isArray(message?.tasks) && message.tasks.length > 0;
      const hasUrls = Array.isArray(message?.urls) && message.urls.length > 0;
      const hasImages = Array.isArray(message?.images) && message.images.length > 0;
      return hasText || hasTasks || hasUrls || hasImages || message?.role === "user";
    });
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

function filterDeletedChatSession(session = {}, deletions = {}) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return session;
  return {
    ...session,
    messages: filterDeletedMessages(session.messages || [], deletions),
    refImages: filterDeletedMediaUrls(session.refImages || [], deletions),
  };
}

function filterDeletedImageHistory(history = [], deletions = {}) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => !hasDeletedId(deletions, "imageHistoryIds", getItemId(item)))
    .map((item) => ({
      ...item,
      urls: filterDeletedMediaUrls(item.urls || [], deletions),
    }))
    .filter((item) => Array.isArray(item.urls) && item.urls.length > 0);
}

function applyDeletionsToStateValue(key, value = "", deletions = {}) {
  if (!value || key === CLOUD_STATE_DELETIONS_KEY) return value;
  if (key === "lovart-conversations") {
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed) ? JSON.stringify(filterDeletedConversations(parsed, deletions)) : value;
  }
  if (key === "lovart-canvas-boards") {
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed) ? JSON.stringify(filterDeletedCanvasBoards(parsed, deletions)) : value;
  }
  if (key === "lovart-canvas-images") {
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed) ? JSON.stringify(filterDeletedCanvasItems(parsed, deletions)) : value;
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
    return parsed && typeof parsed === "object" ? JSON.stringify(filterDeletedChatSession(parsed, deletions)) : value;
  }
  if (key === "lovart-chat-image-history") {
    const parsed = safeJsonParse(value, []);
    return Array.isArray(parsed) ? JSON.stringify(filterDeletedImageHistory(parsed, deletions)) : value;
  }
  return value;
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

function mergeConversations(existingValue = "", incomingValue = "", deletions = {}) {
  const existing = safeJsonParse(existingValue, []);
  const incoming = safeJsonParse(incomingValue, []);
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return incomingValue;

  const merged = mergeArrayById(
    filterDeletedConversations(existing, deletions),
    filterDeletedConversations(incoming, deletions),
    (oldConversation, newConversation) => {
    if (!oldConversation) return newConversation;
    if (!newConversation) return oldConversation;
    const newer = getUpdatedAt(newConversation) >= getUpdatedAt(oldConversation) ? newConversation : oldConversation;
    const older = newer === newConversation ? oldConversation : newConversation;
    const messages = filterDeletedMessages(mergeMessages(oldConversation.messages || [], newConversation.messages || []), deletions);
    return {
      ...older,
      ...newer,
      messages,
      updatedAt: Math.max(getUpdatedAt(oldConversation), getUpdatedAt(newConversation), Date.now()),
    };
  });

  return JSON.stringify(filterDeletedConversations(merged, deletions).slice(-50));
}

function mergeCanvasBoards(existingValue = "", incomingValue = "", deletions = {}) {
  const existing = safeJsonParse(existingValue, []);
  const incoming = safeJsonParse(incomingValue, []);
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return incomingValue;

  if (existing.length > 0 && incoming.length === 0) {
    const filteredExisting = filterDeletedCanvasBoards(existing, deletions);
    // The UI always creates a replacement board when the last board is deleted.
    // If an empty list arrives, treat it as a stale/broken snapshot instead of
    // letting it wipe every project in the cloud.
    return JSON.stringify(filteredExisting.length > 0 ? filteredExisting : existing);
  }

  const merged = mergeArrayById(
    filterDeletedCanvasBoards(existing, deletions),
    filterDeletedCanvasBoards(incoming, deletions),
    (oldBoard, newBoard) => {
    if (!oldBoard) return newBoard;
    if (!newBoard) return oldBoard;
    const newer = getUpdatedAt(newBoard) >= getUpdatedAt(oldBoard) ? newBoard : oldBoard;
    const older = newer === newBoard ? oldBoard : newBoard;
    return {
      ...older,
      ...newer,
      images: filterDeletedCanvasItems(mergeArrayById(oldBoard.images || [], newBoard.images || []), deletions).slice(-100),
      texts: mergeArrayById(oldBoard.texts || [], newBoard.texts || []).slice(-100),
      shapes: mergeArrayById(oldBoard.shapes || [], newBoard.shapes || []).slice(-200),
      updatedAt: Math.max(getUpdatedAt(oldBoard), getUpdatedAt(newBoard), Date.now()),
    };
  });

  return JSON.stringify(filterDeletedCanvasBoards(merged, deletions).slice(-30));
}

function mergeUniqueStringArrays(existingValue = "", incomingValue = "", limit = 100) {
  const existing = safeJsonParse(existingValue, []);
  const incoming = safeJsonParse(incomingValue, []);
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return incomingValue;
  return JSON.stringify([...new Set([...existing, ...incoming].filter(Boolean))].slice(-limit));
}

function mergeCloudStateValue(key, existingValue = "", incomingValue = "", deletions = {}) {
  if (key === CLOUD_STATE_DELETIONS_KEY) return JSON.stringify(mergeCloudStateDeletions(existingValue, incomingValue));
  if (key === "lovart-conversations") return mergeConversations(existingValue, incomingValue, deletions);
  if (key === "lovart-canvas-boards") return mergeCanvasBoards(existingValue, incomingValue, deletions);
  if (key === "lovart-canvas-images") {
    const existing = safeJsonParse(existingValue, []);
    const incoming = safeJsonParse(incomingValue, []);
    if (!Array.isArray(existing) || !Array.isArray(incoming)) return incomingValue;
    return JSON.stringify(filterDeletedCanvasItems(mergeArrayById(existing, incoming), deletions).slice(-100));
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
    .filter((item) => (
      allowedStateKeys.has(item.key)
      && item.value
      && item.value.length <= MAX_STATE_VALUE_CHARS
      && !isEmptyCanvasBoardsValue(item.key, item.value)
    ));
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
  const deletionRow = result.rows.find((row) => row.state_key === CLOUD_STATE_DELETIONS_KEY);
  const deletions = normalizeCloudStateDeletions(deletionRow?.state_value || "{}");
  return {
    configured: true,
    items: result.rows.map((row) => ({
      key: row.state_key,
      value: applyDeletionsToStateValue(row.state_key, row.state_value, deletions),
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
    const existingDeletionResult = await client.query(
      `
        SELECT state_value, client_updated_at
        FROM user_cloud_state
        WHERE user_email = $1 AND state_key = $2
        FOR UPDATE
      `,
      [userEmail, CLOUD_STATE_DELETIONS_KEY],
    );
    const incomingDeletionItem = items.find((item) => item.key === CLOUD_STATE_DELETIONS_KEY);
    const existingDeletionValue = existingDeletionResult.rows[0]?.state_value || "{}";
    const combinedDeletions = mergeCloudStateDeletions(existingDeletionValue, incomingDeletionItem?.value || "{}");
    for (const item of items) {
      let stateValue = applyDeletionsToStateValue(item.key, item.value, combinedDeletions);
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
          stateValue = mergeCloudStateValue(item.key, existing.state_value, stateValue, combinedDeletions);
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
