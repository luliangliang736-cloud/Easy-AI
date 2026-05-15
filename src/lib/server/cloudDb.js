import pg from "pg";

const { Pool } = pg;

const globalKey = "__easyaiCloudDbPool";
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
  const pool = getCloudDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_cloud_state (
      user_email TEXT NOT NULL,
      state_key TEXT NOT NULL,
      state_value TEXT NOT NULL,
      client_updated_at BIGINT NOT NULL DEFAULT 0,
      server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_email, state_key)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_cloud_state_user_updated_idx
    ON user_cloud_state (user_email, server_updated_at DESC)
  `);
  initialized = true;
}
