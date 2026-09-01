import { ensureCloudDbSchema, getCloudDbPool, isCloudDbConfigured } from "@/lib/server/cloudDb";

// ============================================================
// 云端状态每日快照（记录层的"后悔药"）
// user_cloud_state 每个账号每类数据只存最新一份，护栏能挡"空数据覆盖"，
// 挡不住"错误的非空数据覆盖"。这里每天把有变动的账号状态整行快照一份：
// - 只快照过去 ~25 小时内有更新的行（不活跃账号不重复占空间）；
// - 保留最近 7 天；更老的快照只要存在更新的同键快照就删除，
//   即每个 (账号, 键) 永远至少保底一份最新快照；
// - INSERT ... ON CONFLICT DO NOTHING 幂等，多容器并发触发无害。
// 回滚工具：scripts/restore-cloud-state-snapshot.mjs
// ============================================================

const SNAPSHOT_CHECK_INTERVAL_MS = Number(process.env.CLOUD_STATE_SNAPSHOT_CHECK_MS || 60 * 60 * 1000);
const RETENTION_DAYS = Number(process.env.CLOUD_STATE_SNAPSHOT_RETENTION_DAYS || 7);

let snapshotRunning = false;

export async function ensureDailyCloudStateSnapshot() {
  if (snapshotRunning || !isCloudDbConfigured()) return;
  snapshotRunning = true;
  try {
    await ensureCloudDbSchema();
    const pool = getCloudDbPool();
    const inserted = await pool.query(`
      INSERT INTO user_cloud_state_snapshots (snapshot_date, user_email, state_key, state_value, client_updated_at)
      SELECT CURRENT_DATE, user_email, state_key, state_value, client_updated_at
      FROM user_cloud_state
      WHERE server_updated_at >= NOW() - INTERVAL '25 hours'
      ON CONFLICT (snapshot_date, user_email, state_key) DO NOTHING
    `);
    const purged = await pool.query(`
      DELETE FROM user_cloud_state_snapshots s
      WHERE s.snapshot_date < CURRENT_DATE - INTERVAL '${RETENTION_DAYS} days'
        AND EXISTS (
          SELECT 1 FROM user_cloud_state_snapshots newer
          WHERE newer.user_email = s.user_email
            AND newer.state_key = s.state_key
            AND newer.snapshot_date > s.snapshot_date
        )
    `);
    if (inserted.rowCount > 0 || purged.rowCount > 0) {
      console.log(`[CloudStateSnapshots] snapshot=${inserted.rowCount} purged=${purged.rowCount}`);
    }
  } catch (error) {
    console.error("[CloudStateSnapshots] Daily snapshot failed:", error?.message || error);
  } finally {
    snapshotRunning = false;
  }
}

const timerKey = "__easyaiCloudStateSnapshotTimer";

/** 启动每小时自查一次的快照调度（幂等，随 cloud-state 路由加载） */
export function scheduleCloudStateSnapshots() {
  if (globalThis[timerKey]) return;
  globalThis[timerKey] = setInterval(() => {
    void ensureDailyCloudStateSnapshot();
  }, SNAPSHOT_CHECK_INTERVAL_MS);
  globalThis[timerKey].unref?.();
  // 启动后延迟一分钟做首次快照，避开容器冷启动高峰
  const bootTimer = setTimeout(() => {
    void ensureDailyCloudStateSnapshot();
  }, 60_000);
  bootTimer.unref?.();
}
