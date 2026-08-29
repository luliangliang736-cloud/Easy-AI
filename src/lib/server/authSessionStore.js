import { isCompanyEmailAllowed, normalizeAuthEmail } from "@/lib/authSession";
import { ensureCloudDbSchema, getCloudDbPool, isCloudDbConfigured } from "@/lib/server/cloudDb";

const MAX_ACTIVE_SESSIONS_PER_USER = Number(process.env.AUTH_MAX_ACTIVE_SESSIONS_PER_USER || 2);
const LAST_SEEN_UPDATE_INTERVAL_MS = 60_000;

// "session 是否活跃" 的内存缓存：签名 cookie 本身已防伪造，查库只是为了踢下线，
// 容忍 30 秒延迟。避免画布图片加载、auth/me 轮询等场景每个请求都打一次 Postgres。
// 只缓存"活跃"结果；失效/被踢的结果不缓存，保证重新登录立即生效。
const ACTIVE_SESSION_CACHE_TTL_MS = 30_000;
const activeSessionCache = new Map();

function getCachedActive(cacheKey) {
  const entry = activeSessionCache.get(cacheKey);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    activeSessionCache.delete(cacheKey);
    return false;
  }
  return true;
}

function setCachedActive(cacheKey) {
  // 简单容量保护，防止长期运行无限增长
  if (activeSessionCache.size > 5000) activeSessionCache.clear();
  activeSessionCache.set(cacheKey, { expiresAt: Date.now() + ACTIVE_SESSION_CACHE_TTL_MS });
}

function clearCachedSessionsForUser(userEmail) {
  const prefix = `${userEmail}|`;
  for (const key of activeSessionCache.keys()) {
    if (key.startsWith(prefix)) activeSessionCache.delete(key);
  }
}

export async function registerAuthSession(userEmail = "", sessionId = "", userAgent = "") {
  const email = normalizeAuthEmail(userEmail);
  if (!isCompanyEmailAllowed(email)) {
    throw new Error("Only company email can register a session");
  }
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
      [sessionId, email, String(userAgent || "").slice(0, 500)],
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
      [email, Math.max(1, MAX_ACTIVE_SESSIONS_PER_USER)],
    );
    await client.query("COMMIT");
    // 新登录可能踢掉了该用户最早的 session，清掉缓存让踢下线尽快生效
    clearCachedSessionsForUser(email);
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

  const cacheKey = `${userEmail}|${sessionId}`;
  if (getCachedActive(cacheKey)) return { configured: true, active: true };

  await ensureCloudDbSchema();
  const pool = getCloudDbPool();
  const result = await pool.query(
    `
      SELECT session_id, last_seen_at
      FROM auth_sessions
      WHERE user_email = $1 AND session_id = $2 AND revoked_at IS NULL
    `,
    [userEmail, sessionId],
  );
  const session = result.rows[0];
  if (!session?.session_id) return { configured: true, active: false };

  setCachedActive(cacheKey);

  const lastSeenAt = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
  if (!lastSeenAt || Date.now() - lastSeenAt > LAST_SEEN_UPDATE_INTERVAL_MS) {
    void pool.query(
      `
        UPDATE auth_sessions
        SET last_seen_at = NOW()
        WHERE user_email = $1 AND session_id = $2 AND revoked_at IS NULL
      `,
      [userEmail, sessionId],
    ).catch((error) => {
      console.error("[Auth] Session last_seen update failed:", error);
    });
  }

  return { configured: true, active: true };
}

export async function revokeAuthSession(userEmail = "", sessionId = "") {
  if (!isCloudDbConfigured() || !userEmail || !sessionId) return { configured: false };
  activeSessionCache.delete(`${userEmail}|${sessionId}`);
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
