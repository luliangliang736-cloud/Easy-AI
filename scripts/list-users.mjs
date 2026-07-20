import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: false, max: 2 });

const sessions = await pool.query(`
  SELECT user_email,
         COUNT(*) AS session_count,
         MIN(created_at) AS first_login,
         MAX(last_seen_at) AS last_seen
  FROM auth_sessions
  GROUP BY user_email
  ORDER BY MAX(last_seen_at) DESC
`);

const cloudState = await pool.query(`
  SELECT user_email, MAX(server_updated_at) AS last_state_update
  FROM user_cloud_state
  GROUP BY user_email
`);

const stateMap = new Map(cloudState.rows.map((r) => [r.user_email, r.last_state_update]));
const allEmails = new Set([...sessions.rows.map((r) => r.user_email), ...stateMap.keys()]);

console.log(JSON.stringify({
  totalUsers: allEmails.size,
  users: [...allEmails].map((email) => {
    const s = sessions.rows.find((r) => r.user_email === email);
    return {
      email,
      sessionCount: s ? Number(s.session_count) : 0,
      firstLogin: s?.first_login || null,
      lastSeen: s?.last_seen || null,
      lastStateUpdate: stateMap.get(email) || null,
    };
  }).sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0)),
}, null, 2));

await pool.end();
