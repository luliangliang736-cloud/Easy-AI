import { spawn } from "child_process";
import path from "path";

export const LARK_CLI = process.env.LARK_CLI_PATH
  || path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");

export const LARK_IDENTITY = process.env.FEISHU_LARK_AS || (process.env.FEISHU_APP_ID ? "bot" : "user");

let configurePromise = null;

function runProcess(args, { input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(LARK_CLI, args, {
      cwd: process.cwd(),
      shell: process.platform === "win32",
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (code === 0) {
        resolve(result);
        return;
      }
      const error = new Error(`lark-cli exited with code ${code}`);
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      reject(error);
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function getLarkCliErrorMessage(error, fallback = "飞书 CLI 执行失败") {
  const output = Buffer.from(error?.stdout || error?.stderr || "").toString("utf8").trim();
  let parsed = null;
  try {
    parsed = output ? JSON.parse(output) : null;
  } catch {
    parsed = null;
  }
  return parsed?.error?.message || parsed?.msg || output || error?.message || fallback;
}

async function ensureLarkCliConfigured() {
  const appId = String(process.env.FEISHU_APP_ID || "").trim();
  const appSecret = String(process.env.FEISHU_APP_SECRET || "").trim();
  if (!appId || !appSecret) return;
  if (!configurePromise) {
    configurePromise = runProcess([
      "config",
      "init",
      "--app-id",
      appId,
      "--app-secret-stdin",
      "--brand",
      "feishu",
      "--force-init",
    ], { input: `${appSecret}\n` });
  }
  try {
    await configurePromise;
  } catch (error) {
    configurePromise = null;
    throw new Error(getLarkCliErrorMessage(error, "飞书 CLI 初始化失败"));
  }
}

export async function runLarkCliJson(args) {
  await ensureLarkCliConfigured();
  try {
    const { stdout } = await runProcess(args);
    const text = Buffer.from(stdout || "").toString("utf8").trim();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(getLarkCliErrorMessage(error));
  }
}

export async function ensureLarkCliReady() {
  await ensureLarkCliConfigured();
}
