import OSS from "ali-oss";

const client = new OSS({
  region: process.env.OSS_REGION || "oss-cn-beijing",
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET || "easyai-assets-lqb",
  endpoint: process.env.OSS_ENDPOINT || "oss-cn-beijing.aliyuncs.com",
  timeout: 120000,
});

const stats = new Map(); // email -> { scopes: Map, totalCount, totalBytes, firstDate, lastDate }

let continuationToken = null;
let scanned = 0;
do {
  const res = await client.listV2({
    prefix: "users/",
    "max-keys": 1000,
    "continuation-token": continuationToken || undefined,
  });
  for (const obj of res.objects || []) {
    // users/{email}/{scope}/{date}/{file}
    const parts = obj.name.split("/");
    if (parts.length < 4) continue;
    const email = decodeURIComponent(parts[1]);
    const scope = parts[2];
    const date = parts[3];
    if (!stats.has(email)) {
      stats.set(email, { scopes: new Map(), totalCount: 0, totalBytes: 0, firstDate: date, lastDate: date });
    }
    const s = stats.get(email);
    s.totalCount += 1;
    s.totalBytes += obj.size;
    s.scopes.set(scope, (s.scopes.get(scope) || 0) + 1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if (date < s.firstDate || !/^\d/.test(s.firstDate)) s.firstDate = date;
      if (date > s.lastDate || !/^\d/.test(s.lastDate)) s.lastDate = date;
    }
  }
  scanned += (res.objects || []).length;
  continuationToken = res.isTruncated ? res.nextContinuationToken : null;
} while (continuationToken);

const rows = [...stats.entries()].map(([email, s]) => ({
  email,
  files: s.totalCount,
  mb: Math.round(s.totalBytes / 1024 / 1024 * 10) / 10,
  firstDate: s.firstDate,
  lastDate: s.lastDate,
  scopes: Object.fromEntries([...s.scopes.entries()].sort((a, b) => b[1] - a[1])),
})).sort((a, b) => b.files - a.files);

console.log(JSON.stringify({ scannedObjects: scanned, users: rows }, null, 2));
