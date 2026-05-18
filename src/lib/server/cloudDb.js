import pg from "pg";

const { Pool } = pg;

const globalKey = "__easyaiCloudDbPool";
const globalInitKey = "__easyaiCloudDbInitPromise";
let initialized = false;

function getDatabaseUrl() {
  return process.env.DATABASE_URL || "";
}

export function isCloudDbConfigured() {
  return Boolean(getDatabaseUrl());
}

export function getCloudDbPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!globalThis[globalKey]) {
    globalThis[globalKey] = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalThis[globalKey];
}

export async function ensureCloudDbSchema() {
  if (initialized) return;

  // Use a shared promise stored on globalThis so concurrent requests
  // (e.g. /api/auth/me and /api/cloud-state firing at the same time right
  // after login) all await the same single initialization run instead of
  // each independently running the full set of CREATE TABLE queries and
  // competing for DB connections.
  if (globalThis[globalInitKey]) {
    await globalThis[globalInitKey];
    return;
  }

  const pool = getCloudDbPool();
  const initPromise = Promise.all([
    pool.query(`
      CREATE TABLE IF NOT EXISTS user_cloud_state (
        user_email TEXT NOT NULL,
        state_key TEXT NOT NULL,
        state_value TEXT NOT NULL,
        client_updated_at BIGINT NOT NULL DEFAULT 0,
        server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_email, state_key)
      )
    `),
    pool.query(`
      CREATE INDEX IF NOT EXISTS user_cloud_state_user_updated_idx
      ON user_cloud_state (user_email, server_updated_at DESC)
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        session_id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      )
    `),
    pool.query(`
      CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
      ON auth_sessions (user_email, revoked_at, created_at DESC)
    `),
  ]).then(() => {
    initialized = true;
  }).catch((err) => {
    // Clear the cached promise on failure so the next request retries.
    globalThis[globalInitKey] = null;
    throw err;
  });

  globalThis[globalInitKey] = initPromise;
  await initPromise;
}
