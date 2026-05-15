export const CLOUD_STATE_DELETIONS_KEY = "easyai-cloud-state-deletions";

const MAX_DELETION_RECORDS_PER_SCOPE = 1000;

function safeParseDeletions(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeScopeRecords(records) {
  if (!records || typeof records !== "object" || Array.isArray(records)) return {};
  return Object.fromEntries(
    Object.entries(records)
      .filter(([key]) => key)
      .map(([key, value]) => [String(key), Number(value || Date.now())])
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_DELETION_RECORDS_PER_SCOPE)
  );
}

export function normalizeCloudStateDeletions(value) {
  const parsed = typeof value === "string" ? safeParseDeletions(value) : (value || {});
  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([scope]) => scope)
      .map(([scope, records]) => [String(scope), normalizeScopeRecords(records)])
  );
}

export function mergeCloudStateDeletions(...values) {
  const merged = {};
  for (const value of values) {
    const deletions = normalizeCloudStateDeletions(value);
    for (const [scope, records] of Object.entries(deletions)) {
      merged[scope] = merged[scope] || {};
      for (const [id, deletedAt] of Object.entries(records)) {
        merged[scope][id] = Math.max(Number(merged[scope][id] || 0), Number(deletedAt || Date.now()));
      }
    }
  }
  return normalizeCloudStateDeletions(merged);
}

export function recordCloudDeletions(records = {}) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const current = normalizeCloudStateDeletions(window.localStorage.getItem(CLOUD_STATE_DELETIONS_KEY));
  for (const [scope, values] of Object.entries(records || {})) {
    const list = Array.isArray(values) ? values : [values];
    const cleanValues = list.map((value) => String(value || "").trim()).filter(Boolean);
    if (!cleanValues.length) continue;
    current[scope] = current[scope] || {};
    for (const value of cleanValues) {
      current[scope][value] = now;
    }
  }
  window.localStorage.setItem(CLOUD_STATE_DELETIONS_KEY, JSON.stringify(normalizeCloudStateDeletions(current)));
}
