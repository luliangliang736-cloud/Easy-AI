import { ensureCloudDbSchema, getCloudDbPool, isCloudDbConfigured } from "@/lib/server/cloudDb";

const MAX_ACTIVE_SESSIONS_PER_USER = Number(process.env.AUTH_MAX_ACTIVE_SESSIONS_PER_USER || 2);

export async function registerAuthSession(userEmail = "", sessionId = "", userAgent = "") {
  if (!isCloudDbConfigured()) return { configured: false };
  await ensureCloudDbSchema();
  const pool = getCloudDbPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO auth_sessions (session_id, user_email, user_agent, created_at, last_seen_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (session_id)
        DO UPDATE SET user_email = EXCLUDED.user_email, user_agent = EXCLUDED.user_agent, revoked_at = NULL, last_seen_at = NOW()
      `,
      [sessionId, userEmail, String(userAgent || "").slice(0, 500)],
    );

    await client.query(
      `
        UPDATE auth_sessions
        SET revoked_at = NOW()
        WHERE session_id IN (
          SELECT session_id
          FROM auth_sessions
          WHERE user_email = $1 AND revoked_at IS NULL
          ORDER BY created_at DESC
          OFFSET $2
        )
      `,
      [userEmail, Math.max(1, MAX_ACTIVE_SESSIONS_PER_USER)],
    );
    await client.query("COMMIT");
    return { configured: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function isAuthSessionActive(userEmail = "", sessionId = "") {
  if (!isCloudDbConfigured()) return { configured: false, active: true };
  if (!userEmail || !sessionId) return { configured: true, active: false };
  await ensureCloudDbSchema();
  const result = await getCloudDbPool().query(
    `
      UPDATE auth_sessions
      SET last_seen_at = NOW()
      WHERE user_email = $1 AND session_id = $2 AND revoked_at IS NULL
      RETURNING session_id
    `,
    [userEmail, sessionId],
  );
  return { configured: true, active: result.rowCount > 0 };
}

export async function revokeAuthSession(userEmail = "", sessionId = "") {
  if (!isCloudDbConfigured() || !userEmail || !sessionId) return { configured: false };
  await ensureCloudDbSchema();
  await getCloudDbPool().query(
    `
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE user_email = $1 AND session_id = $2 AND revoked_at IS NULL
    `,
    [userEmail, sessionId],
  );
  return { configured: true };
}
