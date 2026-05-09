import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const TASK_DIR = path.join(process.cwd(), ".easyai-tmp");
const TASK_FILE = path.join(TASK_DIR, "feishu-wa-tasks.json");
const QUEUED_TASK_TTL_MS = 6 * 60 * 60 * 1000;

async function withTaskLock(operation) {
  const previousLock = globalThis.__easyaiFeishuWaTaskLock || Promise.resolve();
  let releaseLock;
  globalThis.__easyaiFeishuWaTaskLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  await previousLock.catch(() => {});
  try {
    return await operation();
  } finally {
    releaseLock?.();
  }
}

async function readTasks() {
  try {
    const text = await readFile(TASK_FILE, "utf8");
    const tasks = JSON.parse(text);
    return Array.isArray(tasks) ? tasks : [];
  } catch {
    return [];
  }
}

async function writeTasks(tasks) {
  await mkdir(TASK_DIR, { recursive: true });
  await writeFile(TASK_FILE, JSON.stringify(tasks.slice(-100), null, 2), "utf8");
}

export async function createFeishuWaTask({ prompt, chatId = "", messageId = "" } = {}) {
  return withTaskLock(async () => {
    const text = String(prompt || "").trim();
    if (!text) throw new Error("任务指令为空");
    const tasks = await readTasks();
    const now = Date.now();
    const normalizedChatId = String(chatId || "");
    const normalizedMessageId = String(messageId || "");
    const duplicate = tasks.find((task) => (
      (task.prompt === text && task.chatId === normalizedChatId && task.messageId === normalizedMessageId)
      || (
        task.prompt === text
        && task.chatId === normalizedChatId
        && (task.status === "queued" || task.status === "claimed")
      )
    ));
    if (duplicate) return duplicate;

    const task = {
      id: `feishu-wa-${now}-${randomUUID()}`,
      prompt: text,
      chatId: normalizedChatId,
      messageId: normalizedMessageId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    tasks.push(task);
    await writeTasks(tasks);
    return task;
  });
}

export async function claimFeishuWaTask({ clientId = "easyai" } = {}) {
  return withTaskLock(async () => {
    const tasks = await readTasks();
    const now = Date.now();

    for (const item of tasks) {
      if (item.status === "queued" && now - Number(item.createdAt || 0) > QUEUED_TASK_TTL_MS) {
        item.status = "expired";
        item.error = "任务超过 6 小时未领取，已自动过期，避免隔天打开页面重复执行";
        item.updatedAt = now;
      }
    }

    const task = tasks.find((item) => item.status === "queued");
    if (!task) return null;

    task.status = "claimed";
    task.clientId = String(clientId || "easyai");
    task.claimedAt = now;
    task.updatedAt = now;
    await writeTasks(tasks);
    return task;
  });
}

export async function updateFeishuWaTask(taskId, patch = {}) {
  return withTaskLock(async () => {
    const tasks = await readTasks();
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: Date.now() });
    await writeTasks(tasks);
    return task;
  });
}
