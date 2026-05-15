export const AUTH_COOKIE_NAME = "easyai_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const AUTH_SESSION_MAX_AGE_MS = AUTH_SESSION_MAX_AGE_SECONDS * 1000;

function getAuthSecret() {
  if (process.env.NODE_ENV !== "production") return "easyai-local-dev-session-secret";
  const secret = process.env.AUTH_SESSION_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
  if (secret) return secret;
  return "";
}

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

export function getAllowedEmailDomains() {
  const configured = splitCsv(process.env.AUTH_ALLOWED_EMAIL_DOMAINS || process.env.AUTH_ALLOWED_EMAIL_DOMAIN);
  return configured.length > 0 ? configured.map((domain) => domain.replace(/^@/, "")) : ["fintopia.tech"];
}

export function isCompanyEmailAllowed(rawEmail = "") {
  const email = normalizeAuthEmail(rawEmail);
  if (!email || !email.includes("@")) return false;
  const domain = email.split("@").pop();
  return getAllowedEmailDomains().includes(domain);
}

export function isSharedPasswordValid(rawEmail = "", rawPassword = "") {
  const expectedPassword = String(process.env.AUTH_SHARED_PASSWORD || "lu782026");
  return isCompanyEmailAllowed(rawEmail) && String(rawPassword || "") === expectedPassword;
}

export async function createSessionValue(rawEmail = "") {
  const email = normalizeAuthEmail(rawEmail);
  const payload = {
    email,
    username: email,
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
  return payload;
}
