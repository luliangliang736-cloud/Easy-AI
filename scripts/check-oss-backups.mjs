// 临时诊断脚本：验证含 %40 的 key 的 signatureUrl 行为与双重编码修复
import { readFileSync } from "fs";
import OSS from "ali-oss";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const client = new OSS({
  region: env.OSS_REGION,
  accessKeyId: env.OSS_ACCESS_KEY_ID,
  accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
  bucket: env.OSS_BUCKET,
  endpoint: env.OSS_ENDPOINT || undefined,
  secure: true,
});

const key = "users/local-dev%40easyai.local/generated-result/2026-07-21/1784633236500-mzicaubf-image-1784633236463.jpg";

const url1 = client.signatureUrl(key, { expires: 3600 });
console.log("原始签名URL:", url1.slice(0, 130));
const r1 = await fetch(url1);
console.log("原始URL状态:", r1.status);

const [path1, query1] = url1.split("?");
const url2 = `${path1.replace(/%40/g, "%2540")}?${query1}`;
const r2 = await fetch(url2);
console.log("双重编码URL状态:", r2.status);
if (r2.status !== 200) console.log((await r2.text()).slice(0, 400));
