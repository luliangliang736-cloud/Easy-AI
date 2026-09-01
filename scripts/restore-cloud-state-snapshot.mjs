// 云端状态快照回滚工具（记录层"后悔药"）
//
// 查看某账号有哪些快照:
//   node scripts/restore-cloud-state-snapshot.mjs <email>
// 回滚到某天(把 <= 该日期的每键最新快照写回 user_cloud_state):
//   node scripts/restore-cloud-state-snapshot.mjs <email> <YYYY-MM-DD> --apply
// 只回滚指定键:
//   node scripts/restore-cloud-state-snapshot.mjs <email> <YYYY-MM-DD> --apply --key=lovart-canvas-boards
//
// 需要 DATABASE_URL(公网地址)。回滚后用户刷新页面即可看到恢复的数据;
// 建议用户回滚前先关闭所有已打开的网站标签页,避免旧标签页把当前(坏)状态又同步上去。
import { readFileSync } from "node:fs";
import pg from "pg";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const [email, date] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const apply = process.argv.includes("--apply");
const keyArg = process.argv.find((arg) => arg.startsWith("--key="))?.slice(6) || "";

if (!email || !process.env.DATABASE_URL) {
  console.error("用法: node scripts/restore-cloud-state-snapshot.mjs <email> [YYYY-MM-DD] [--apply] [--key=xxx]");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

if (!date) {
  const { rows } = await client.query(
    `SELECT snapshot_date, state_key, LENGTH(state_value) AS bytes
     FROM user_cloud_state_snapshots WHERE user_email = $1
     ORDER BY snapshot_date DESC, state_key`,
    [email.toLowerCase()],
  );
  console.log(`账号 ${email} 的快照:`);
  for (const row of rows) {
    console.log(` ${String(row.snapshot_date).slice(0, 15)} ${row.state_key} (${Math.round(row.bytes / 1024)}KB)`);
  }
  await client.end();
  process.exit(0);
}

// 取 <= 指定日期的每键最新快照
const { rows } = await client.query(
  `SELECT DISTINCT ON (state_key) state_key, state_value, snapshot_date
   FROM user_cloud_state_snapshots
   WHERE user_email = $1 AND snapshot_date <= $2 ${keyArg ? "AND state_key = $3" : ""}
   ORDER BY state_key, snapshot_date DESC`,
  keyArg ? [email.toLowerCase(), date, keyArg] : [email.toLowerCase(), date],
);

if (rows.length === 0) {
  console.log("没有找到符合条件的快照");
  await client.end();
  process.exit(0);
}

console.log(`将回滚 ${rows.length} 个键到 <= ${date} 的快照:`);
rows.forEach((row) => console.log(` ${row.state_key} <- ${String(row.snapshot_date).slice(0, 15)} (${Math.round(row.state_value.length / 1024)}KB)`));

if (!apply) {
  console.log("\n(预览模式,加 --apply 才会真正写入)");
  await client.end();
  process.exit(0);
}

// client_updated_at 取当前时间,确保所有客户端在下次恢复时接受这份数据
const now = Date.now();
for (const row of rows) {
  await client.query(
    `INSERT INTO user_cloud_state (user_email, state_key, state_value, client_updated_at, server_updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_email, state_key)
     DO UPDATE SET state_value = EXCLUDED.state_value, client_updated_at = EXCLUDED.client_updated_at, server_updated_at = NOW()`,
    [email.toLowerCase(), row.state_key, row.state_value, now],
  );
  console.log("已回滚:", row.state_key);
}
console.log("\n完成。请让用户关闭所有网站标签页后重新打开(旧标签页可能把回滚前的状态又同步上去)。");
await client.end();
