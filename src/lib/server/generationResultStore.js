import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const STORE_DIR = join(tmpdir(), "easyai-generation-results");
const MAX_RESULT_AGE_MS = 6 * 60 * 60 * 1000;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,120}$/;

function isSafeRequestId(requestId = "") {
  return SAFE_ID_PATTERN.test(String(requestId || ""));
}

function getResultPath(requestId = "") {
  if (!isSafeRequestId(requestId)) return null;
  return join(STORE_DIR, `${requestId}.json`);
}

async function cleanupOldResults() {
  try {
    const now = Date.now();
    const entries = await readdir(STORE_DIR);
    await Promise.all(entries.map(async (entry) => {
      if (!/^[a-zA-Z0-9_-]+\.json$/.test(entry)) return;
      const filePath = join(STORE_DIR, entry);
      const fileStat = await stat(filePath);
      if (now - fileStat.mtimeMs > MAX_RESULT_AGE_MS) {
        await unlink(filePath);
      }
    }));
  } catch {
    // Best-effort cleanup only.
  }
}

export async function saveGenerationResult(requestId, result) {
  const filePath = getResultPath(requestId);
  if (!filePath || !result) return;

  await mkdir(STORE_DIR, { recursive: true });
  void cleanupOldResults();

  await writeFile(filePath, JSON.stringify({
    ...result,
    savedAt: Date.now(),
  }));
}

export async function readGenerationResult(requestId) {
  const filePath = getResultPath(requestId);
  if (!filePath) return null;

  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
