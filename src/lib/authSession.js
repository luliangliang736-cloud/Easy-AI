export const AUTH_COOKIE_NAME = "easyai_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const AUTH_SESSION_MAX_AGE_MS = AUTH_SESSION_MAX_AGE_SECONDS * 1000;

function getAuthSecret() {
  const secret = process.env.AUTH_SESSION_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "easyai-local-dev-session-secret";
  return "";
}

function normalizeUsername(username = "") {
  return String(username).trim();
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

export function isCredentialValid(rawUsername = "", rawPassword = "") {
  const username = normalizeUsername(rawUsername);
  const expectedUsername = String(process.env.AUTH_USERNAME || "");
  const expectedPassword = String(process.env.AUTH_PASSWORD || "");

  if (!expectedUsername || !expectedPassword) {
    return process.env.NODE_ENV !== "production" && username === "easyai" && String(rawPassword || "") === "easyai";
  }

  return username === expectedUsername && String(rawPassword || "") === expectedPassword;
}

export async function createSessionValue(rawUsername = "") {
  const username = normalizeUsername(rawUsername);
  const payload = {
    username,
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

  if (!payload?.username || !payload?.exp || payload.exp < Date.now()) return null;
  if (payload.username !== normalizeUsername(process.env.AUTH_USERNAME || payload.username)) return null;
  return payload;
}
