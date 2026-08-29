export const AUTH_COOKIE_NAME = "easyai_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const AUTH_SESSION_MAX_AGE_MS = AUTH_SESSION_MAX_AGE_SECONDS * 1000;

function getAuthSecret() {
  if (process.env.NODE_ENV !== "production") return "easyai-local-dev-session-secret";
  const secret = process.env.AUTH_SESSION_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
  if (secret) return secret;
  return "";
}

export const COMPANY_EMAIL_DOMAIN = "fintopia.tech";

const BLOCKED_PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "qq.com",
  "163.com",
  "126.com",
  "yeah.net",
  "sina.com",
  "sina.cn",
  "foxmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "139.com",
  "sohu.com",
]);

export function normalizeAuthEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function splitCsv(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value = "") {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sign(value) {
  const secret = getAuthSecret();
  if (!secret) throw new Error("AUTH_SESSION_SECRET is required in production");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function normalizeEmailDomain(value = "") {
  return String(value || "").trim().toLowerCase().replace(/^@/, "");
}

function isBlockedPersonalEmailDomain(domain = "") {
  return BLOCKED_PERSONAL_EMAIL_DOMAINS.has(normalizeEmailDomain(domain));
}

function isSafeExtraCompanyDomain(domain = "") {
  const normalized = normalizeEmailDomain(domain);
  if (!normalized || normalized === COMPANY_EMAIL_DOMAIN) return false;
  if (isBlockedPersonalEmailDomain(normalized)) return false;
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(normalized);
}

export function getAllowedEmailDomains() {
  // 生产环境只允许公司域名，避免环境变量误把 gmail 等个人邮箱加进来。
  if (process.env.NODE_ENV === "production") {
    return [COMPANY_EMAIL_DOMAIN];
  }

  const extras = splitCsv(process.env.AUTH_ALLOWED_EMAIL_DOMAINS || process.env.AUTH_ALLOWED_EMAIL_DOMAIN)
    .map((domain) => normalizeEmailDomain(domain))
    .filter((domain) => isSafeExtraCompanyDomain(domain));
  return [COMPANY_EMAIL_DOMAIN, ...extras];
}

export function isCompanyEmailAllowed(rawEmail = "") {
  const email = normalizeAuthEmail(rawEmail);
  if (!email || !email.includes("@") || email.includes(" ")) return false;
  const domain = normalizeEmailDomain(email.split("@").pop());
  if (!domain || isBlockedPersonalEmailDomain(domain)) return false;
  return getAllowedEmailDomains().includes(domain);
}

export function isSharedPasswordValid(rawEmail = "", rawPassword = "") {
  const expectedPassword = String(process.env.AUTH_SHARED_PASSWORD || "lu782026");
  return isCompanyEmailAllowed(rawEmail) && String(rawPassword || "") === expectedPassword;
}

export function createSessionId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function createSessionValue(rawEmail = "", rawSessionId = "") {
  const email = normalizeAuthEmail(rawEmail);
  if (!isCompanyEmailAllowed(email)) {
    throw new Error("Only company email can create a session");
  }
  const sessionId = String(rawSessionId || createSessionId());
  const payload = {
    email,
    username: email,
    sid: sessionId,
    iat: Date.now(),
    exp: Date.now() + AUTH_SESSION_MAX_AGE_MS,
  };
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionValue(value = "") {
  const [encodedPayload, signature] = String(value || "").split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = await sign(encodedPayload);
  if (signature !== expectedSignature) return null;

  let payload = null;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload)));
  } catch {
    return null;
  }

  const email = normalizeAuthEmail(payload.email || payload.username);
  if (!email || !payload?.exp || payload.exp < Date.now()) return null;
  if (!isCompanyEmailAllowed(email)) return null;
  payload.email = email;
  payload.username = email;
  payload.sid = String(payload.sid || "");
  return payload;
}
