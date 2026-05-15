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
];

const allowedStateKeys = new Set(CLOUD_STATE_KEYS);

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
        [userEmail, item.key, item.value, item.clientUpdatedAt],
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
