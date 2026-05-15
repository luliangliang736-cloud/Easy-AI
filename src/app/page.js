"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles, ArrowRight, Wand2, Image as ImageIcon,
  Layers, Zap, Crown, Rocket, PenTool, Factory, Library, Megaphone, PanelTop, ShieldCheck, Coins,
  Palette, RefreshCw, Download, MousePointer2, Sun, Moon, Bot, LayoutGrid, Clock3, Palette as PaletteIcon, Users,
  Mail, LockKeyhole, LogIn, LogOut,
} from "lucide-react";
import { useTheme } from "@/lib/useTheme";
import { compressImage } from "@/lib/imageUtils";
import { useAuthSessionGuard } from "@/lib/useAuthSessionGuard";
import { useCloudLocalStorageSync } from "@/lib/useCloudLocalStorageSync";
import { getGenerationStageCopy } from "@/lib/generationStages";
import {
  buildEzFamilyTriggerPrompt,
  buildWaTemplatePrompt,
  chooseWaTemplateIpRole,
  detectEzFamilyTrigger,
  detectOneClickEntryMode,
  getLatestGeneratedImages,
  isObviousOneClickGenerateRequest,
  parseBatchWaTemplatePrompts,
  parseWaTemplateRequest,
  shouldReusePreviousGeneratedImages,
} from "@/lib/oneClickCreationRules";
import {
  buildIpSceneExtensionPrompt,
  detectIpSceneExtension,
} from "@/lib/ipSceneExtensionRules";
import BrandLogo from "@/components/BrandLogo";
import FloatingEntryWidget from "@/components/FloatingEntryWidget";

const FLOATING_DEFAULT_MODEL = "gemini-3.1-flash-image-preview-512";
const FLOATING_DEFAULT_SERVICE_TIER = "priority";
const FLOATING_AGENT_DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const FLOATING_AGENT_DEFAULT_SERVICE_TIER = "priority";
const FLOATING_EDIT_MODEL = "gpt-image-2";
const FLOATING_HISTORY_STORAGE_KEY = "lovart-floating-entry-home-history";
const FLOATING_SESSION_STORAGE_KEY = "lovart-floating-entry-home-session";
const HOME_CLOUD_STATE_KEYS = [
  FLOATING_HISTORY_STORAGE_KEY,
  FLOATING_SESSION_STORAGE_KEY,
  "lovart-chat-fullscreen-session",
];
const EZFAMILY_ASSET_URL = "/api/ezfamily";
const EZLOGO_ASSET_URL = "/ip-assets/EZlogo/EZlogo.jpg";
const WA_TEMPLATE_ASSET_URL = "/api/wa-templates";
const WA_LOCKUP_ASSET_URL = "/api/wa-lockup";
const WA_SMILE_LOGO_ASSET_URL = "/api/wa-smile-logo";
const FLOATING_MAX_STORED_DATA_IMAGE_CHARS = 900_000;
const GENERATION_STAGE_MIN_MS = 650;
const GENERATION_SAVING_STAGE_MS = 350;
const ONE_CLICK_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
const GPT_IMAGE_2_CLIENT_TIMEOUT_MS = 10 * 60 * 1000;
const WA_QUALITY_CLIENT_TIMEOUT_MS = 18 * 1000;
const GENERATION_RECOVERY_POLL_MS = 2000;
const GENERATION_RECOVERY_MAX_ATTEMPTS = Math.ceil((12 * 60 * 1000) / GENERATION_RECOVERY_POLL_MS);
const BATCH_WA_CONCURRENCY = 10;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithConcurrency(items = [], limit = 5, worker) {
  let cursor = 0;
  const workerCount = Math.min(Math.max(Number(limit) || 1, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  }));
}

function restoreInterruptedBatchMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    if (!Array.isArray(message?.batchWaItems)) return message;
    const hadActiveItems = message.batchWaItems.some((item) => (
      item.status === "queued"
      || item.status === "generating"
      || item.status === "retrying"
      || item.feishuStatus === "uploading"
    ));
    if (!hadActiveItems) return message;
    const nextItems = message.batchWaItems.map((item) => {
      if (item.status === "success") {
        return item.feishuStatus === "uploading"
          ? { ...item, feishuStatus: "failed", feishuError: "页面刷新/热更新中断，飞书回填状态未知" }
          : item;
      }
      if (item.status === "queued" || item.status === "generating" || item.status === "retrying") {
        return { ...item, status: "stopped", error: "页面刷新/热更新中断，可重新发起批量任务" };
      }
      return item;
    });
    const completed = nextItems.filter((item) => item.status === "success").length;
    return {
      ...message,
      text: `批量 WA 海报已中断：已完成 ${completed}/${nextItems.length}。`,
      batchWaStopped: true,
      batchWaItems: nextItems,
    };
  });
}

function chineseNumberToInt(value) {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) return Number(text);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return 10;
  if (text.includes("十")) {
    const [tenPart, onePart] = text.split("十");
    return (digits[tenPart] || 1) * 10 + (digits[onePart] || 0);
  }
  return digits[text] || 0;
}

function parseFeishuWaBatchRequest(text = "") {
  const source = String(text || "").replace(/\s+/g, "");
  if (!/(飞书|表格|多维表|base|文档)/i.test(source) || !/(WA|wa|海报)/i.test(source)) return null;
  if (!/(生成|制作|生图|批量生成|批量制作)/.test(source)) return null;
  const rangeMatch = source.match(/第([0-9一二两三四五六七八九十]+)(?:张|条|个)?(?:到|至|-|—)(?:第)?([0-9一二两三四五六七八九十]+)(?:张|条|个)?/);
  if (rangeMatch) {
    const start = chineseNumberToInt(rangeMatch[1]);
    const end = chineseNumberToInt(rangeMatch[2]);
    if (start > 0 && end >= start) return { start, end, limit: Math.min(end - start + 1, 50) };
  }
  const singleMatch = source.match(/第([0-9一二两三四五六七八九十]+)(?:张|条|个)/);
  if (singleMatch) {
    const start = chineseNumberToInt(singleMatch[1]);
    if (start > 0) return { start, end: start, limit: 1 };
  }
  const tailMatch = source.match(/(?:后|最后)([0-9一二两三四五六七八九十]+)(?:张|条|个)/);
  if (tailMatch) {
    const limit = chineseNumberToInt(tailMatch[1]);
    if (limit > 0) return { limit: Math.min(limit, 50), tail: true };
  }
  const headMatch = source.match(/前([0-9一二两三四五六七八九十]+)(?:张|条|个)/);
  if (headMatch) {
    const limit = chineseNumberToInt(headMatch[1]);
    if (limit > 0) return { limit: Math.min(limit, 50) };
  }
  return null;
}

async function fetchFeishuWaBatchPrompts(request) {
  const payload = typeof request === "number" ? { limit: request } : request;
  const res = await fetch("/api/feishu-wa-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare", ...(payload || {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "读取飞书 WA 表格失败");
  return Array.isArray(data?.data?.items) ? data.data.items : [];
}

async function uploadFeishuWaImage({ recordId, imageUrl, name, tableId, tableName }) {
  if (!recordId || !imageUrl) return;
  const res = await fetch("/api/feishu-wa-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "upload", recordId, imageUrl, name, tableId, tableName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "飞书回填失败");
  return data;
}

function detectFeishuWaCommand(text = "") {
  const source = String(text || "").replace(/\s+/g, "");
  if (!source) return false;
  if (/生成前[0-9一二两三四五六七八九十]+张.*?(WA|wa|海报)/i.test(source)) return false;
  const hasTableTarget = /(飞书|表格|文档|AI设计图|ai设计图|Boy|Girl|Robot|robot|机器人|真人版|人物|角色|服装|服饰|风格|前[0-9一二两三四五六七八九十]+张|第[0-9一二两三四五六七八九十]+张)/i.test(source);
  const hasAction = /(修改|改成|改为|设为|设置为|清空|删除|移除|减少|降低|增加|提高|只要|保留|控制在|少一些|少一点|不要太多|统计|查看|多少|创建|新建|建立|复制|添加|加入|重新|重写|改写|重填|重新填充|刷新|变化|换一版|换一批|平衡|均衡)/.test(source);
  return hasTableTarget && hasAction;
}

async function runFeishuWaCommand(text) {
  const res = await fetch("/api/feishu-wa-command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "飞书表格指令处理失败");
  return {
    reply: data?.data?.reply || "飞书表格指令已处理。",
    images: Array.isArray(data?.data?.images) ? data.data.images : [],
  };
}

function createTimeoutError(message = "请求等待时间过长，请稍后重试。") {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

function createNonRecoverableError(message, status = null) {
  const error = new Error(message);
  error.status = status;
  error.noRecovery = true;
  return error;
}

function shouldAttemptGenerationRecovery(error) {
  if (!error || error.noRecovery) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("fetch")
    || message.includes("network")
    || message.includes("connection")
    || message.includes("timeout")
    || message.includes("请求等待时间过长")
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = ONE_CLICK_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(createTimeoutError()), timeoutMs);
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && error?.name === "AbortError" && !externalSignal?.aborted) {
      throw createTimeoutError();
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abortFromExternal);
    }
  }
}

async function withTimeout(promise, timeoutMs, fallbackValue = null) {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = window.setTimeout(() => resolve(fallbackValue), timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

function createClientRequestId(prefix = "oneclick") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function recoverGenerationResult(clientRequestId) {
  if (!clientRequestId) return null;
  for (let attempt = 0; attempt < GENERATION_RECOVERY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`/api/generation-results/${encodeURIComponent(clientRequestId)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.success && Array.isArray(data?.data?.urls) && data.data.urls.length > 0) {
          return data;
        }
      }
      if (res.status !== 202) return null;
    } catch {}
    await wait(GENERATION_RECOVERY_POLL_MS);
  }
  return null;
}

async function waitForRecoveredGenerationResult(clientRequestId) {
  const recovered = await recoverGenerationResult(clientRequestId);
  if (recovered) return { data: recovered, recovered: true };
  return new Promise(() => {});
}

const HERO_LAYOUT_PRESETS = {
  desktop: {
    container: "pb-10 lg:pb-14",
    title: "text-4xl lg:text-6xl leading-tight mb-5",
    description: "text-base lg:text-lg max-w-2xl mb-10",
    actions: "gap-4",
    primaryButton: "h-12 px-8",
    secondaryButton: "h-12 px-8",
  },
  mac13: {
    container: "pb-8 sm:pb-9 lg:pb-10",
    title: "text-3xl sm:text-[34px] lg:text-[44px] leading-[1.06] mb-3.5",
    description: "text-sm sm:text-[15px] lg:text-base max-w-lg mb-7",
    actions: "gap-3",
    primaryButton: "h-10 px-6 text-sm",
    secondaryButton: "h-10 px-6 text-sm",
  },
  mac14: {
    container: "pb-8 sm:pb-10 lg:pb-12",
    title: "text-3xl sm:text-4xl lg:text-5xl leading-[1.08] mb-4",
    description: "text-sm sm:text-base lg:text-[17px] max-w-xl mb-8",
    actions: "gap-3 sm:gap-4",
    primaryButton: "h-11 px-7 text-sm",
    secondaryButton: "h-11 px-7 text-sm",
  },
  mac16: {
    container: "pb-10 sm:pb-12 lg:pb-14",
    title: "text-[34px] sm:text-[40px] lg:text-[54px] leading-[1.08] mb-[18px]",
    description: "text-base lg:text-lg max-w-xl mb-9",
    actions: "gap-4",
    primaryButton: "h-11 px-[30px] text-sm",
    secondaryButton: "h-11 px-[30px] text-sm",
  },
};

function createFloatingMessage(role, text = "", extra = {}) {
  return {
    id: `floating-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    ...extra,
  };
}

function safeParseStorageObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeParseStorageArray(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRestorableImageUrl(value) {
  return typeof value === "string" && (
    /^https?:\/\//i.test(value)
    || value.startsWith("/")
    || (/^data:image\//i.test(value) && value.length <= FLOATING_MAX_STORED_DATA_IMAGE_CHARS)
  );
}

function sanitizeFloatingImageList(images, limit = 6) {
  if (!Array.isArray(images)) return [];
  return images.filter(isRestorableImageUrl).slice(0, limit);
}

function sanitizeFloatingAttachments(attachments, limit = 8) {
  if (!Array.isArray(attachments)) return [];
  return attachments.slice(0, limit).map((attachment) => ({
    id: attachment?.id || `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(attachment?.name || "附件"),
    mimeType: String(attachment?.mimeType || ""),
    size: Number(attachment?.size || 0),
    excerpt: String(attachment?.excerpt || "").slice(0, 1200),
  }));
}

function sanitizeFloatingMessages(messages, limit = 20) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-limit).map((message) => ({
    ...message,
    images: sanitizeFloatingImageList(message?.images, 6),
    refImages: sanitizeFloatingImageList(message?.refImages, 6),
    attachments: sanitizeFloatingAttachments(message?.attachments, 4),
  }));
}

function sanitizeFloatingSessionForStorage({ prompt = "", refImages = [], attachments = [], messages = [], runtimeMode = "quick" } = {}) {
  return {
    prompt: String(prompt || ""),
    refImages: sanitizeFloatingImageList(refImages, 6),
    attachments: sanitizeFloatingAttachments(attachments, 8),
    messages: sanitizeFloatingMessages(messages, 20),
    runtimeMode: runtimeMode === "agent" ? "agent" : "quick",
    updatedAt: Date.now(),
  };
}

function sanitizeFloatingHistoryEntry(entry) {
  return {
    id: entry?.id || `floating-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(entry?.title || buildFloatingHistoryTitle(entry || {})),
    updatedAt: Number(entry?.updatedAt || Date.now()),
    prompt: String(entry?.prompt || ""),
    refImages: sanitizeFloatingImageList(entry?.refImages, 6),
    attachments: sanitizeFloatingAttachments(entry?.attachments, 8),
    messages: sanitizeFloatingMessages(entry?.messages, 20),
  };
}

function formatFloatingGenerationError(error) {
  const message = String(error?.message || "").trim();
  if (error?.name === "TimeoutError" || /failed to fetch|请求等待时间过长/i.test(message)) {
    return "生成请求连接中断或超时，请稍后重试。";
  }
  return message || "处理失败，请稍后重试。";
}

function hasFloatingSessionContent({ prompt = "", refImages = [], attachments = [], messages = [] } = {}) {
  return Boolean(
    String(prompt || "").trim()
    || (Array.isArray(refImages) && refImages.length > 0)
    || (Array.isArray(attachments) && attachments.length > 0)
    || (Array.isArray(messages) && messages.length > 0)
  );
}

function buildFloatingHistoryTitle({ prompt = "", messages = [] } = {}) {
  const firstUserText = (Array.isArray(messages) ? messages : [])
    .find((item) => item?.role === "user" && String(item?.text || "").trim())?.text;
  const baseText = String(firstUserText || prompt || "").replace(/\s+/g, " ").trim();
  if (baseText) {
    return baseText.slice(0, 24);
  }
  return "未命名对话";
}

function createFloatingHistoryEntry({ prompt = "", refImages = [], attachments = [], messages = [] } = {}) {
  return {
    id: `floating-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: buildFloatingHistoryTitle({ prompt, messages }),
    updatedAt: Date.now(),
    prompt: String(prompt || ""),
    refImages: sanitizeFloatingImageList(refImages, 6),
    attachments: sanitizeFloatingAttachments(attachments, 8),
    messages: sanitizeFloatingMessages(messages, 20),
  };
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function isTextLikeFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return (
    type.startsWith("text/")
    || type.includes("json")
    || type.includes("xml")
    || type.includes("javascript")
    || type.includes("typescript")
    || type.includes("markdown")
    || /\.(txt|md|markdown|csv|json|xml|html|htm|js|ts|jsx|tsx|css|scss|sass|less|rtf)$/i.test(name)
  );
}

function isServerExtractableFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return (
    type === "application/pdf"
    || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || /\.pdf$/i.test(name)
    || /\.docx$/i.test(name)
  );
}

function buildAttachmentSummary(file, textContent = "") {
  const excerpt = String(textContent || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  return {
    id: `attachment-${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    mimeType: file.type || "",
    size: file.size || 0,
    excerpt,
    content: String(textContent || ""),
  };
}

async function extractDocumentAttachments(files) {
  if (!files.length) return [];

  const payload = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mimeType: file.type || "",
      size: file.size || 0,
      dataUrl: await readFileAsDataURL(file),
    }))
  );

  const res = await fetch("/api/floating-attachments/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: payload }),
  });
  const data = await parseApiResponse(res);
  if (!res.ok || data.error) {
    throw new Error(data.error || `附件解析失败（${res.status}）`);
  }
  return Array.isArray(data.data?.attachments) ? data.data.attachments : [];
}

async function parseApiResponse(res) {
  const rawText = await res.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return {
      error: `接口返回了非 JSON 内容：${rawText.slice(0, 120)}`,
    };
  }
}

async function fetchImageAsDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

const lastEzFamilyReferenceByRole = new Map();

async function fetchEzFamilyReferenceImages(role) {
  const roleText = String(role || "");
  const singleImageUrl = `${EZFAMILY_ASSET_URL}?role=${encodeURIComponent(roleText)}`;
  if (!roleText.includes("真人版")) {
    try {
      const res = await fetch(`${singleImageUrl}&all=1`, { cache: "no-store" });
      const data = await parseApiResponse(res);
      const items = Array.isArray(data.items) ? data.items.filter((item) => item?.src) : [];
      if (items.length > 0) {
        const roleKey = roleText.toLowerCase();
        if (roleKey === "robot") {
          const standardItem = items.find((item) => String(item?.name || "").includes("Robot标准形态"));
          const standardImage = standardItem ? await fetchImageAsDataUrl(standardItem.src) : null;
          if (standardImage) return [standardImage];
        }
        const previousName = lastEzFamilyReferenceByRole.get(roleKey);
        const candidateItems = items.length > 1
          ? items.filter((item) => String(item?.name || item?.src || "") !== previousName)
          : items;
        const pickPool = candidateItems.length > 0 ? candidateItems : items;
        const picked = pickPool[Math.floor(Math.random() * pickPool.length)];
        const image = await fetchImageAsDataUrl(picked.src);
        if (image) {
          lastEzFamilyReferenceByRole.set(roleKey, String(picked.name || picked.src || ""));
          return [image];
        }
      }
    } catch {
      // Fall back to the original random endpoint if listing fails.
    }

    const image = await fetchImageAsDataUrl(singleImageUrl);
    return image ? [image] : [];
  }

  try {
    const res = await fetch(`${singleImageUrl}&all=1`, { cache: "no-store" });
    const data = await parseApiResponse(res);
    const items = Array.isArray(data.items) ? data.items : [];
    const orderedItems = [
      ...items.filter((item) => String(item?.name || "").includes("正视图")),
      ...items.filter((item) => !String(item?.name || "").includes("正视图")),
    ];
    const images = (await Promise.all(
      orderedItems
        .slice(0, 1)
        .map((item) => item?.src)
        .filter(Boolean)
        .map((src) => fetchImageAsDataUrl(src))
    )).filter(Boolean);
    if (images.length > 0) return images;
  } catch {
    // Fallback to a single identity reference.
  }

  const image = await fetchImageAsDataUrl(singleImageUrl);
  return image ? [image] : [];
}

async function runWaQualityCheck(imageUrl) {
  if (!imageUrl) return null;
  try {
    const res = await fetch("/api/wa-quality-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
    });
    const data = await parseApiResponse(res);
    if (!res.ok || data.error) return null;
    return data.data || null;
  } catch {
    return null;
  }
}

function buildWaQualityFixPrompt(qualityCheck) {
  if (!qualityCheck) return "";
  const issues = Array.isArray(qualityCheck.issues)
    ? qualityCheck.issues
      .map((issue) => String(issue?.message || "").trim())
      .filter(Boolean)
      .slice(0, 4)
    : [];
  const suggestedFix = String(qualityCheck.suggestedFix || "").trim();
  if (!issues.length && !suggestedFix) return "";
  return [
    "",
    "本次是基于上一版 WA 海报质检结果的修复重生，请明确修正以下问题，但仍保持原始用户需求、2:1 WA 模板结构、品牌规范和主副标题内容不变。",
    issues.length ? `上一版问题：${issues.join("；")}` : "",
    suggestedFix ? `上一版建议：${suggestedFix}` : "",
    "修复优先级：先保证画面完整不裁切、主副标题清晰且层级正确、Logo/OJK/EASYCASH 清晰可读、人物和右侧元素不要挤压左侧文案；背景保持低干扰，不新增无关行业符号。",
  ].filter(Boolean).join("\n");
}

function buildWaQualityImprovement(previousQualityCheck, nextQualityCheck) {
  if (!previousQualityCheck || !nextQualityCheck) return null;
  const previousScore = Number(previousQualityCheck.score || 0);
  const nextScore = Number(nextQualityCheck.score || 0);
  const previousIssues = Array.isArray(previousQualityCheck.issues)
    ? previousQualityCheck.issues.filter((issue) => issue?.message)
    : [];
  const nextIssues = Array.isArray(nextQualityCheck.issues)
    ? nextQualityCheck.issues.filter((issue) => issue?.message)
    : [];
  const nextIssueTypes = new Set(nextIssues.map((issue) => issue.type).filter(Boolean));
  const resolvedIssues = previousIssues
    .filter((issue) => issue.type && !nextIssueTypes.has(issue.type))
    .map((issue) => issue.message)
    .slice(0, 3);
  const improvements = [];
  if (nextScore > previousScore) {
    improvements.push(`质检分数从 ${previousScore}/100 提升到 ${nextScore}/100`);
  } else if (nextScore === previousScore) {
    improvements.push(`质检分数保持在 ${nextScore}/100，主要变化体现在画面细节`);
  }
  if (resolvedIssues.length) {
    improvements.push(`上一版部分问题已减弱或未再被识别：${resolvedIssues.join("；")}`);
  }
  if (previousIssues.length > nextIssues.length) {
    improvements.push(`质检问题数量从 ${previousIssues.length} 项减少到 ${nextIssues.length} 项`);
  }
  if (!improvements.length) {
    improvements.push("已按上一版质检建议重新生成，可重点对比文字区、Logo/OJK 可读性、人物位置和背景干扰度");
  }
  return {
    previousScore,
    nextScore,
    delta: nextScore - previousScore,
    improvements: improvements.slice(0, 3),
    remainingIssues: nextIssues.map((issue) => issue.message).slice(0, 3),
  };
}

/** 根据参考图真实像素尺寸，计算 GPT Image 2 edit 合法的精确输出尺寸 */
function computeGptImage2EditSize(width, height) {
  if (!width || !height || width <= 0 || height <= 0) return "auto";
  const MAX_EDGE = 3840;
  const MAX_RATIO = 3;
  const MIN_PIXELS = 655360;
  const MAX_PIXELS = 8294400;
  const TARGET_PIXELS = 1050000;
  const MULTIPLE = 16;

  let w = width;
  let h = height;

  const longEdge = Math.max(w, h);
  const shortEdge = Math.min(w, h);
  if (shortEdge === 0 || longEdge / shortEdge > MAX_RATIO) return "auto";

  if (w * h < MIN_PIXELS) {
    const scale = Math.sqrt(MIN_PIXELS / (w * h));
    w = Math.ceil(w * scale);
    h = Math.ceil(h * scale);
  }

  const maxEdge = Math.max(w, h);
  if (maxEdge > MAX_EDGE) {
    const scale = MAX_EDGE / maxEdge;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  if (w * h > TARGET_PIXELS) {
    const scale = Math.sqrt(TARGET_PIXELS / (w * h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  w = Math.round(w / MULTIPLE) * MULTIPLE || MULTIPLE;
  h = Math.round(h / MULTIPLE) * MULTIPLE || MULTIPLE;

  if (Math.max(w, h) > MAX_EDGE || w * h > MAX_PIXELS || w * h < MIN_PIXELS) return "auto";

  return `${w}x${h}`;
}

function findClosestAspectRatio(width, height) {
  const candidates = [
    ["1:1", 1],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
    ["2:1", 2 / 1],
    ["1:2", 1 / 2],
    ["4:5", 4 / 5],
    ["5:4", 5 / 4],
    ["21:9", 21 / 9],
  ];

  const target = width / height;
  let best = candidates[0];
  let bestDiff = Math.abs(best[1] - target);
  for (const candidate of candidates.slice(1)) {
    const diff = Math.abs(candidate[1] - target);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best[0];
}

function inferAspectRatioFromPrompt(text) {
  if (!text || typeof text !== "string") return "1:1";
  const compact = text.toLowerCase().replace(/\s+/g, "");

  const explicitRatioMatch = compact.match(/(21|16|9|8|5|4|3|2|1)\s*[:：/xX]\s*(9|16|8|5|4|3|2|1)/);
  if (explicitRatioMatch) {
    return findClosestAspectRatio(Number(explicitRatioMatch[1]), Number(explicitRatioMatch[2]));
  }

  const explicitBiMatch = compact.match(/(21|16|9|8|5|4|3|2|1)\s*比\s*(9|16|8|5|4|3|2|1)/);
  if (explicitBiMatch) {
    return findClosestAspectRatio(Number(explicitBiMatch[1]), Number(explicitBiMatch[2]));
  }

  const dimensionMatch = compact.match(/(\d{3,5})\s*[xX*＊]\s*(\d{3,5})/);
  if (dimensionMatch) {
    return findClosestAspectRatio(Number(dimensionMatch[1]), Number(dimensionMatch[2]));
  }

  if (compact.includes("小红书") || compact.includes("笔记封面")) return "4:5";
  if (compact.includes("抖音") || compact.includes("快手") || compact.includes("竖屏")) return "9:16";
  if (compact.includes("公众号") || compact.includes("横版") || compact.includes("头图")) return "16:9";
  if (compact.includes("海报")) return "3:4";
  if (compact.includes("主图") || compact.includes("方图") || compact.includes("正方形")) return "1:1";

  return "1:1";
}

function buildEzLogoReferenceInstructions(hasUserReferenceImages = false) {
  if (hasUserReferenceImages) {
    return `- 用户上传的参考图排在前面，是主要的风格、版式、构图、主体数量、材质和画面类型参考；请优先贴近第一张用户参考图的表达方式。
- 后面的 EZlogo 系统参考图只用于说明要替换/生成的品牌符号结构：笑脸弧线、点状元素、整体几何关系和品牌识别必须来自 EZlogo。
- 不要直接复刻用户参考图里的原 logo、字母或符号；应把用户参考图中的视觉语言自然迁移到 EZlogo 上。`;
  }

  return "- 第一张参考图是 EZlogo 的品牌标志结构锚点，必须以它的笑脸弧线、点状元素、整体几何关系和品牌识别为主体。";
}

function detectRefImageMeta(dataUrl) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      resolve({
        ratio: width > 0 && height > 0 ? findClosestAspectRatio(width, height) : "1:1",
        width,
        height,
      });
    };
    img.onerror = () => resolve({ ratio: "1:1", width: 0, height: 0 });
    img.src = dataUrl;
  });
}

function buildAgentPrompt(text, refImages = []) {
  const basePrompt = String(text || "").trim();
  if (!refImages.length) {
    return basePrompt;
  }

  return `${basePrompt}

Agent mode hidden instructions:
- Treat the provided reference image(s) as the primary grounding.
- keep composition
- keep lighting
- keep aspect ratio
- keep camera angle, framing, perspective, and scene layout
- keep subject identity, key shapes, proportions, and object relationships
- do not crop, zoom, rotate, or rearrange the scene unless the user explicitly asks for it
- only change the parts that are explicitly requested by the user
- if multiple reference images are provided, use the first image as the main composition and aspect-ratio anchor`;
}

function resolveAgentParams(baseParams, promptText, refImages = []) {
  const compactText = String(promptText || "").replace(/\s+/g, "");
  const needsHighFidelity = /海报|poster|品牌|branding|logo|字体|排版|版式|产品图|电商|包装|KV|banner|高清|高细节|细节/.test(compactText);

  return {
    ...baseParams,
    model: needsHighFidelity ? "gemini-3-pro-image-preview" : FLOATING_AGENT_DEFAULT_MODEL,
    image_size: refImages.length > 0 ? "auto" : "1:1",
    num: 1,
    service_tier: FLOATING_AGENT_DEFAULT_SERVICE_TIER,
  };
}

function resolveFloatingGenerationModel({ hasImages = false, isAgentMode = false, agentParams = {} } = {}) {
  // 有参考图走 edit，无参考图走 generate，两条路都用 gpt-image-2
  return FLOATING_EDIT_MODEL;
}

const FEATURES = [
  { icon: Factory, title: "AI 设计生产线", desc: "一句话完成之前耗费时间的重复设计", iconColor: "text-violet-400" },
  { icon: Library, title: "品牌资产控制台", desc: "统一管理 Logo、品牌色、IP 角色与出图规范", iconColor: "text-blue-400" },
  { icon: Megaphone, title: "营销内容生成引擎", desc: "批量生成海报、活动图与业务宣传等高频物料", iconColor: "text-emerald-400" },
  { icon: PanelTop, title: "可编辑交付画布", desc: "生成结果可继续精修、排版、组合并沉淀复用", iconColor: "text-amber-400" },
  { icon: ShieldCheck, title: "智能出图质检", desc: "一键利用AI评分和建议系统检测出图质量", iconColor: "text-rose-400" },
  { icon: Coins, title: "低成本规模化供给", desc: "Easy AI单图平均成本低于市面平台十倍以上", iconColor: "text-sky-400" },
];

const PAIN_POINTS = [
  { icon: Clock3, title: "高频物料消耗时间", desc: "活动、海报、社媒图等都要快速迭代", iconColor: "text-amber-400" },
  { icon: PaletteIcon, title: "品牌一致性难维护", desc: "多人协作时 Logo、色彩、IP、版式容易跑偏", iconColor: "text-emerald-400" },
  { icon: Users, title: "重复设计占用人力", desc: "大量时间花在改尺寸、换文案、套模板上", iconColor: "text-sky-400" },
];

const VALUE_METRICS = [
  { value: "10x+", title: "成本优势", desc: "单图平均成本低于市面平台十倍以上" },
  { value: "分钟级", title: "设计启动", desc: "从需求到首版设计图，大幅缩短启动时间" },
  { value: "稳定", title: "品牌输出", desc: "品牌资产、IP 角色与模板规范可持续复用" },
  { value: "闭环", title: "可交付流程", desc: "生成、编辑、质检、再优化形成完整工作流" },
];

const VALUE_COMPARISON = [
  {
    label: "传统设计流程",
    title: "沟通、修改、质检、交付反复消耗",
    points: ["多人沟通", "反复改稿", "人工质检", "手动交付"],
    tone: "muted",
  },
  {
    label: "Easy AI 自动化流程",
    title: "一句需求驱动完整设计生产闭环",
    points: ["AI 生成", "品牌约束", "专业画布", "质检优化"],
    tone: "active",
  },
];

const MODELS = [
  { icon: Rocket, name: "Nano Banana 2", desc: "推荐 · 高性价比 · 最高4K", cost: "平均一张图 0.12-0.15元", color: "text-blue-400" },
  { icon: Crown, name: "Nano Banana Pro", desc: "专业画质 · Thinking · 最高4K", cost: "平均一张图 0.25-0.30元", color: "text-amber-400" },
  { icon: Sparkles, name: "GPT Image 2", desc: "灵活尺寸 · 高保真输入 · 图像编辑", cost: "平均一张图 0.08-0.10元", color: "text-fuchsia-400" },
];

const HOME_ASSET_PUBLIC_BASE_URL = String(process.env.NEXT_PUBLIC_HOME_ASSET_BASE_URL || "").replace(/\/+$/g, "");
const HOME_ASSET_PUBLIC_VERSION = String(process.env.NEXT_PUBLIC_HOME_ASSET_VERSION || "");

function getHomeAssetSrc(relativePath) {
  const safePath = String(relativePath || "").replace(/^\/+/, "");
  const src = HOME_ASSET_PUBLIC_BASE_URL
    ? `${HOME_ASSET_PUBLIC_BASE_URL}/${safePath.split("/").map(encodeURIComponent).join("/")}`
    : `/images/${safePath}`;
  return HOME_ASSET_PUBLIC_VERSION
    ? `${src}${src.includes("?") ? "&" : "?"}v=${encodeURIComponent(HOME_ASSET_PUBLIC_VERSION)}`
    : src;
}

const BUSINESS_SHOWCASE_COVERS = [
  { src: getHomeAssetSrc("business-showcase/cover-1.jpg"), alt: "业务展示封面 1" },
  { src: getHomeAssetSrc("business-showcase/cover-2.jpg"), alt: "业务展示封面 2" },
];

const EFFECT_SHOWCASE_CARDS = [
  {
    src: getHomeAssetSrc("effect-showcase-card-3.jpg"),
    alt: "效果展示卡片 3",
    left: 10,
    top: 63,
    width: 24,
    rotation: -17,
    fanLeft: 0,
    fanTop: 70,
    fanRotation: -11,
    originX: 100,
    originY: 100,
    zIndex: 1,
  },
  {
    src: getHomeAssetSrc("effect-showcase-card-2.jpg"),
    alt: "效果展示卡片 2",
    left: 27,
    top: 52,
    width: 29,
    rotation: -10,
    fanLeft: 21,
    fanTop: 62,
    fanRotation: -6,
    zIndex: 2,
  },
  {
    src: getHomeAssetSrc("effect-showcase-card-4.jpg"),
    alt: "效果展示卡片 4",
    left: 50,
    top: 45,
    width: 34,
    rotation: 0,
    fanLeft: 50,
    fanTop: 45,
    fanRotation: 0,
    zIndex: 5,
  },
  {
    src: getHomeAssetSrc("effect-showcase-card-1.jpg"),
    alt: "效果展示卡片 1",
    left: 73,
    top: 52,
    width: 29,
    rotation: 10,
    fanLeft: 79,
    fanTop: 62,
    fanRotation: 6,
    zIndex: 2,
  },
  {
    src: getHomeAssetSrc("effect-showcase-card-5.jpg"),
    alt: "效果展示卡片 5",
    left: 90,
    top: 63,
    width: 24,
    rotation: 17,
    fanLeft: 100,
    fanTop: 70,
    fanRotation: 11,
    originX: 0,
    originY: 100,
    zIndex: 1,
  },
];

const HERO_CAROUSEL_FILES = ["1.mp4", "2.jpg", "3.mp4", "4.mp4", "5.jpg", "6.mp4", "7.jpg"];
const HERO_CAROUSEL_PUBLIC_BASE_URL = String(
  process.env.NEXT_PUBLIC_HOME_HERO_ASSET_BASE_URL
    || (HOME_ASSET_PUBLIC_BASE_URL ? `${HOME_ASSET_PUBLIC_BASE_URL}/home-hero-carousel` : ""),
).replace(/\/+$/g, "");
const HERO_CAROUSEL_PUBLIC_VERSION = String(process.env.NEXT_PUBLIC_HOME_HERO_ASSET_VERSION || "");

function getHeroCarouselSrc(filename) {
  if (!HERO_CAROUSEL_PUBLIC_BASE_URL) {
    return `/api/home-hero-assets?file=${encodeURIComponent(filename)}`;
  }
  const src = `${HERO_CAROUSEL_PUBLIC_BASE_URL}/${encodeURIComponent(filename)}`;
  return HERO_CAROUSEL_PUBLIC_VERSION
    ? `${src}?v=${encodeURIComponent(HERO_CAROUSEL_PUBLIC_VERSION)}`
    : src;
}

const HERO_CAROUSEL_FALLBACK_ITEMS = HERO_CAROUSEL_FILES.map((filename, index) => ({
  type: filename.endsWith(".mp4") ? "video" : "image",
  src: getHeroCarouselSrc(filename),
  label: `EasyAI 创作首页封面 ${index + 1}`,
  name: filename,
}));
const DEFAULT_PROFILE_AVATAR_SRC = getHomeAssetSrc("internal-user-avatar.png");
const HOME_SCROLL_PERSON_SRC = getHomeAssetSrc("home-scroll-person-3.jpg");
const HOME_BOTTOM_SUMMARY_SRC = getHomeAssetSrc("home-bottom-summary.mp4");
const FOOTER_BOTTOM_SRC = getHomeAssetSrc("footer-bottom.jpg");
const HERO_CAROUSEL_INTERVAL_MS = 3000;

export default function HomePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [heroLayoutPreset, setHeroLayoutPreset] = useState("desktop");
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [heroCarouselItems, setHeroCarouselItems] = useState(HERO_CAROUSEL_FALLBACK_ITEMS);
  const heroVideoRefs = useRef([]);
  const [effectCardSpread, setEffectCardSpread] = useState(0);
  const [businessCardSpread, setBusinessCardSpread] = useState(0);
  const [bottomSummaryParallax, setBottomSummaryParallax] = useState(0);
  const [floatingPrompt, setFloatingPrompt] = useState("");
  const [floatingRefImages, setFloatingRefImages] = useState([]);
  const [floatingAttachments, setFloatingAttachments] = useState([]);
  const [floatingIsGenerating, setFloatingIsGenerating] = useState(false);
  const [floatingGenerationStage, setFloatingGenerationStage] = useState("understanding");
  const [floatingOutputError, setFloatingOutputError] = useState("");
  const [floatingMessages, setFloatingMessages] = useState([]);
  const [floatingHistory, setFloatingHistory] = useState([]);
  const [floatingRuntimeMode, setFloatingRuntimeMode] = useState("quick");
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [pendingAuthNext, setPendingAuthNext] = useState("/");
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isProfileAccountOpen, setIsProfileAccountOpen] = useState(false);
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("");
  const floatingStorageReadyRef = useRef(false);
  const batchWaStoppedRef = useRef(false);
  const batchWaAbortControllersRef = useRef(new Set());
  const feishuWaTaskPollingRef = useRef(false);
  const handleFloatingSubmitRef = useRef(null);
  const effectShowcaseRef = useRef(null);
  const businessShowcaseRef = useRef(null);
  const bottomSummaryRef = useRef(null);
  const profileMenuRef = useRef(null);
  const profileAvatarInputRef = useRef(null);
  const { theme, toggleTheme } = useTheme("dark");
  const floatingEntryMode = floatingIsGenerating
    ? floatingRuntimeMode
    : detectOneClickEntryMode(floatingPrompt, floatingRefImages);
  const profileAvatarSrc = profileAvatar || DEFAULT_PROFILE_AVATAR_SRC;
  const handleAuthSessionUnauthorized = useCallback(() => {
    setAuthUser(null);
    setIsProfileMenuOpen(false);
    setIsProfileAccountOpen(false);
    setIsLoginModalOpen(true);
  }, []);
  useAuthSessionGuard({
    enabled: Boolean(authUser?.email),
    onUnauthorized: handleAuthSessionUnauthorized,
  });
  useCloudLocalStorageSync(HOME_CLOUD_STATE_KEYS, {
    enabled: Boolean(authUser?.email),
    overwriteOnFirstRestore: true,
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setAuthUser(data?.user || null);
      })
      .catch(() => {
        if (!cancelled) setAuthUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("login") === "1") {
      const next = params.get("next");
      setPendingAuthNext(next?.startsWith("/") ? next : "/");
      setIsLoginModalOpen(true);
    }
  }, []);

  useEffect(() => {
    try {
      setProfileDisplayName(localStorage.getItem("easyai-profile-display-name") || "");
      setProfileAvatar(localStorage.getItem("easyai-profile-avatar") || "");
    } catch {}
  }, []);

  useEffect(() => {
    if (!isProfileMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isProfileMenuOpen]);

  const handleLoginSubmit = useCallback(async (event) => {
    event.preventDefault();
    setLoginError("");
    setLoginSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "登录失败");

      setAuthUser(data?.user || { email: loginEmail, username: loginEmail });
      setLoginPassword("");
      setIsLoginModalOpen(false);
      const next = pendingAuthNext?.startsWith("/") ? pendingAuthNext : "/";
      window.history.replaceState(null, "", next === "/" ? "/" : window.location.pathname);
      if (next !== "/" && next !== window.location.pathname) {
        router.push(next);
      }
    } catch (error) {
      setLoginError(error?.message || "登录失败");
    } finally {
      setLoginSubmitting(false);
    }
  }, [loginEmail, loginPassword, pendingAuthNext, router]);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAuthUser(null);
    setLoginPassword("");
    setPendingAuthNext("/");
    setIsProfileMenuOpen(false);
    setIsProfileAccountOpen(false);
  }, []);

  const handleProfileNameChange = useCallback((value) => {
    setProfileDisplayName(value);
    try {
      localStorage.setItem("easyai-profile-display-name", value);
    } catch {}
  }, []);

  const handleProfileAvatarChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type?.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result || "");
        const compressed = await compressImage(dataUrl, 512, 0.82);
        setProfileAvatar(compressed);
        localStorage.setItem("easyai-profile-avatar", compressed);
      } catch {
        const dataUrl = String(reader.result || "");
        setProfileAvatar(dataUrl);
        try {
          localStorage.setItem("easyai-profile-avatar", dataUrl);
        } catch {}
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }, []);

  const handleResetProfileAvatar = useCallback(() => {
    setProfileAvatar("");
    try {
      localStorage.removeItem("easyai-profile-avatar");
    } catch {}
  }, []);

  const updateEffectCardSpread = useCallback(() => {
    const showcaseElement = effectShowcaseRef.current;
    if (!showcaseElement) return;

    const rect = showcaseElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const start = viewportHeight * 0.86;
    const end = viewportHeight * 0.06;
    const progress = (start - rect.top) / (start - end);
    const acceleratedProgress = progress * 1.25;

    setEffectCardSpread(Math.min(1, Math.max(0, acceleratedProgress)));
  }, []);

  const updateBusinessCardSpread = useCallback(() => {
    const showcaseElement = businessShowcaseRef.current;
    if (!showcaseElement) return;

    const rect = showcaseElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const start = viewportHeight * 0.86;
    const end = viewportHeight * 0.18;
    const progress = (start - rect.top) / (start - end);
    const acceleratedProgress = progress * 1.2;

    setBusinessCardSpread(Math.min(1, Math.max(0, acceleratedProgress)));
  }, []);

  const updateBottomSummaryParallax = useCallback(() => {
    const showcaseElement = bottomSummaryRef.current;
    if (!showcaseElement) return;

    const rect = showcaseElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const progress = (viewportHeight - rect.top) / (viewportHeight + rect.height);

    setBottomSummaryParallax(Math.min(1, Math.max(0, progress)));
  }, []);

  useEffect(() => {
    let frameId = 0;
    const scheduleSpreadUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        updateEffectCardSpread();
        updateBusinessCardSpread();
        updateBottomSummaryParallax();
      });
    };

    scheduleSpreadUpdate();
    window.addEventListener("scroll", scheduleSpreadUpdate, { passive: true });
    window.addEventListener("resize", scheduleSpreadUpdate);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", scheduleSpreadUpdate);
      window.removeEventListener("resize", scheduleSpreadUpdate);
    };
  }, [updateBottomSummaryParallax, updateBusinessCardSpread, updateEffectCardSpread]);
  const showFloatingGenerationStage = useCallback(async (stage, duration = GENERATION_STAGE_MIN_MS, signal = null) => {
    setFloatingGenerationStage(stage);
    if (duration > 0) await wait(duration);
    if (signal?.aborted) {
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    }
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHeroCarouselItems() {
      try {
        const res = await fetch("/api/home-hero-assets");
        const data = await res.json();
        if (!cancelled && Array.isArray(data.items) && data.items.length > 0) {
          setHeroCarouselItems(data.items);
          setHeroSlideIndex(0);
        }
      } catch {
        if (!cancelled) setHeroCarouselItems(HERO_CAROUSEL_FALLBACK_ITEMS);
      }
    }

    void loadHeroCarouselItems();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (heroCarouselItems.length <= 1) return undefined;

    const timer = window.setInterval(() => {
      setHeroSlideIndex((index) => (index + 1) % heroCarouselItems.length);
    }, HERO_CAROUSEL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [heroCarouselItems.length]);

  useEffect(() => {
    heroVideoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index === heroSlideIndex) {
        const playPromise = video.play();
        if (playPromise?.catch) playPromise.catch(() => {});
      } else {
        video.pause();
      }
    });
  }, [heroSlideIndex, heroCarouselItems]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateMacHeroLayout = () => {
      const platform = String(window.navigator.platform || "").toLowerCase();
      const userAgent = String(window.navigator.userAgent || "").toLowerCase();
      const isMac = platform.includes("mac") || userAgent.includes("macintosh");

      if (!isMac) {
        setHeroLayoutPreset("desktop");
        return;
      }

      const { innerWidth: width, innerHeight: height } = window;
      if (width <= 1512 || height <= 900) {
        setHeroLayoutPreset("mac13");
        return;
      }
      if (width <= 1728 || height <= 1040) {
        setHeroLayoutPreset("mac14");
        return;
      }
      if (width <= 2056 || height <= 1180) {
        setHeroLayoutPreset("mac16");
        return;
      }

      setHeroLayoutPreset("desktop");
    };

    updateMacHeroLayout();
    window.addEventListener("resize", updateMacHeroLayout);
    return () => window.removeEventListener("resize", updateMacHeroLayout);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const parsedHistory = safeParseStorageArray(window.localStorage.getItem(FLOATING_HISTORY_STORAGE_KEY));
      if (parsedHistory) {
        setFloatingHistory(parsedHistory.map(sanitizeFloatingHistoryEntry).slice(0, 12));
      }

      const session = safeParseStorageObject(window.localStorage.getItem(FLOATING_SESSION_STORAGE_KEY));
      if (hasFloatingSessionContent(session || {})) {
        setFloatingPrompt(String(session.prompt || ""));
        setFloatingRefImages(sanitizeFloatingImageList(session.refImages, 6));
        setFloatingAttachments(sanitizeFloatingAttachments(session.attachments, 8));
        setFloatingMessages(sanitizeFloatingMessages(restoreInterruptedBatchMessages(session.messages), 20));
        setFloatingRuntimeMode(session.runtimeMode === "agent" ? "agent" : "quick");
      }
    } catch {
      // 保留旧数据，避免一次读取异常把一键创作历史清空。
    } finally {
      floatingStorageReadyRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!floatingStorageReadyRef.current) return;
    try {
      window.localStorage.setItem(
        FLOATING_HISTORY_STORAGE_KEY,
        JSON.stringify(floatingHistory.map(sanitizeFloatingHistoryEntry).slice(0, 12))
      );
    } catch {
      // 容量超限时保留上一次可用历史。
    }
  }, [floatingHistory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!floatingStorageReadyRef.current) return;
    const session = {
      prompt: floatingPrompt,
      refImages: floatingRefImages,
      attachments: floatingAttachments,
      messages: floatingMessages,
      runtimeMode: floatingRuntimeMode,
    };
    try {
      if (!hasFloatingSessionContent(session)) {
        window.localStorage.removeItem(FLOATING_SESSION_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(
        FLOATING_SESSION_STORAGE_KEY,
        JSON.stringify(sanitizeFloatingSessionForStorage(session))
      );
    } catch {
      // 保存失败时不删除旧 session，刷新后至少能恢复上一次状态。
    }
  }, [floatingAttachments, floatingMessages, floatingPrompt, floatingRefImages, floatingRuntimeMode]);

  const heroPreset = HERO_LAYOUT_PRESETS[heroLayoutPreset] || HERO_LAYOUT_PRESETS.desktop;

  const resetFloatingConversation = () => {
    setFloatingPrompt("");
    setFloatingRefImages([]);
    setFloatingAttachments([]);
    setFloatingMessages([]);
    setFloatingOutputError("");
    setFloatingRuntimeMode("quick");
    setFloatingGenerationStage("understanding");
  };

  const archiveFloatingConversation = () => {
    const snapshot = {
      prompt: floatingPrompt,
      refImages: floatingRefImages,
      attachments: floatingAttachments,
      messages: floatingMessages,
    };
    if (!hasFloatingSessionContent(snapshot)) {
      return false;
    }
    setFloatingHistory((prev) => [createFloatingHistoryEntry(snapshot), ...prev].slice(0, 12));
    return true;
  };

  const handleFloatingNewChat = () => {
    if (floatingIsGenerating) return;
    archiveFloatingConversation();
    resetFloatingConversation();
  };

  const handleSelectFloatingHistory = (historyId) => {
    if (floatingIsGenerating) return;
    const item = floatingHistory.find((entry) => entry.id === historyId);
    if (!item) return;
    setFloatingPrompt(String(item.prompt || ""));
    setFloatingRefImages(Array.isArray(item.refImages) ? item.refImages : []);
    setFloatingAttachments(Array.isArray(item.attachments) ? item.attachments : []);
    setFloatingMessages(Array.isArray(item.messages) ? item.messages : []);
    setFloatingOutputError("");
    setFloatingRuntimeMode("quick");
  };

  const handleDeleteFloatingHistory = (historyId) => {
    if (floatingIsGenerating) return;
    setFloatingHistory((prev) => prev.filter((entry) => entry.id !== historyId));
  };

  const handleExpandFullscreen = useCallback(() => {
    try {
      const session = {
        messages: floatingMessages,
        prompt: floatingPrompt,
        refImages: floatingRefImages,
        attachments: floatingAttachments,
        runtimeMode: floatingRuntimeMode,
        history: floatingHistory,
      };
      window.localStorage.setItem("lovart-chat-fullscreen-session", JSON.stringify(session));
    } catch {}
    router.push("/chat");
  }, [floatingMessages, floatingPrompt, floatingRefImages, floatingAttachments, floatingRuntimeMode, floatingHistory, router]);

  const handleFloatingFilesAdd = async (files) => {
    const imageFiles = files.filter((file) => file.type?.startsWith("image/"));
    const otherFiles = files.filter((file) => !file.type?.startsWith("image/"));

    if (imageFiles.length) {
      const rawDataUrls = await Promise.all(imageFiles.map((file) => readFileAsDataURL(file)));
      const compressed = await Promise.all(
        rawDataUrls.map(async (dataUrl) => {
          try {
            return await compressImage(dataUrl, 1280, 0.78);
          } catch {
            return dataUrl;
          }
        })
      );
      setFloatingRefImages((prev) => [...prev, ...compressed]);
    }

    if (otherFiles.length) {
      const textFiles = otherFiles.filter((file) => isTextLikeFile(file));
      const extractableFiles = otherFiles.filter((file) => !isTextLikeFile(file) && isServerExtractableFile(file));
      const passthroughFiles = otherFiles.filter((file) => !isTextLikeFile(file) && !isServerExtractableFile(file));

      const textSummaries = await Promise.all(
        textFiles.map(async (file) => {
          let textContent = "";
          try {
            textContent = await readFileAsText(file);
          } catch {}
          return buildAttachmentSummary(file, textContent);
        })
      );

      let extractedSummaries = [];
      if (extractableFiles.length) {
        try {
          extractedSummaries = await extractDocumentAttachments(extractableFiles);
        } catch {
          extractedSummaries = extractableFiles.map((file) => buildAttachmentSummary(file));
        }
      }

      const passthroughSummaries = passthroughFiles.map((file) => buildAttachmentSummary(file));
      const summaries = [...textSummaries, ...extractedSummaries, ...passthroughSummaries];
      setFloatingAttachments((prev) => [...prev, ...summaries]);
    }
  };

  const handleFloatingImageRemove = (indexToRemove) => {
    setFloatingRefImages((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const handleFloatingAttachmentRemove = (attachmentId) => {
    setFloatingAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const handleFloatingDeleteMessage = (messageId) => {
    setFloatingMessages((prev) => prev.filter((message) => message.id !== messageId));
  };

  const handleFloatingDeleteMessageImage = (messageId, imageIndex) => {
    setFloatingMessages((prev) => prev.flatMap((message) => {
      if (message.id !== messageId || !Array.isArray(message.images)) return [message];
      const nextImages = message.images.filter((_, index) => index !== imageIndex);
      return nextImages.length > 0 ? [{ ...message, images: nextImages }] : [];
    }));
  };

  const handleFloatingStopBatchWa = () => {
    batchWaStoppedRef.current = true;
    batchWaAbortControllersRef.current.forEach((controller) => controller.abort());
    batchWaAbortControllersRef.current.clear();
    setFloatingIsGenerating(false);
    setFloatingGenerationStage("understanding");
    setFloatingMessages((prev) => prev.map((message) => {
      if (!Array.isArray(message.batchWaItems)) return message;
      const hasActiveItems = message.batchWaItems.some((item) => item.status === "queued" || item.status === "generating" || item.status === "retrying");
      if (!hasActiveItems) return message;
      return {
        ...message,
        text: "批量 WA 海报已停止。",
        batchWaStopped: true,
        batchWaItems: message.batchWaItems.map((item) => (
          item.status === "success" ? item : { ...item, status: "stopped", error: "已停止" }
        )),
      };
    }));
  };

  const handleFloatingSubmit = async (override = null) => {
    const activePrompt = override?.prompt ?? floatingPrompt;
    const activeRefImages = Array.isArray(override?.refImages) ? override.refImages : floatingRefImages;
    const activeAttachments = Array.isArray(override?.attachments) ? override.attachments : floatingAttachments;
    const allowConcurrent = Boolean(override?.allowConcurrent);
    const collectResult = Boolean(override?.collectResult);
    const suppressUserMessage = Boolean(override?.suppressUserMessage);
    const hideGenerationCard = Boolean(override?.hideGenerationCard);
    const prompt = String(activePrompt || "").trim();
    const combinedPromptText = [
      prompt,
      ...activeAttachments.map((item) => String(item?.content || item?.excerpt || "").trim()).filter(Boolean),
    ].filter(Boolean).join("\n\n");
    if (!override?.skipBatch && !collectResult && detectFeishuWaCommand(combinedPromptText)) {
      if (!combinedPromptText) return undefined;
      if (!allowConcurrent && floatingIsGenerating) return { aborted: true };
      const userMessage = createFloatingMessage("user", prompt || combinedPromptText, {
        attachments: activeAttachments,
      });
      setFloatingMessages((prev) => [...prev, userMessage]);
      setFloatingPrompt("");
      setFloatingRefImages([]);
      setFloatingAttachments([]);
      setFloatingRuntimeMode("agent");
      setFloatingGenerationStage("understanding");
      setFloatingIsGenerating(true);
      setFloatingOutputError("");
      try {
        const result = await runFeishuWaCommand(combinedPromptText);
        setFloatingMessages((prev) => [...prev, createFloatingMessage("assistant", result.reply, {
          images: result.images,
          modelLabel: "飞书表格助手",
        })]);
      } catch (error) {
        setFloatingMessages((prev) => [...prev, createFloatingMessage("assistant", error?.message || "飞书表格指令处理失败", { modelLabel: "飞书表格助手" })]);
      } finally {
        setFloatingIsGenerating(false);
        setFloatingGenerationStage("understanding");
      }
      return undefined;
    }
    let batchWaPrompts = [];
    let feishuBatchRequest = null;
    let pendingBatchUserMessage = null;
    if (!override?.skipBatch) {
      feishuBatchRequest = parseFeishuWaBatchRequest(combinedPromptText);
      if (feishuBatchRequest && !collectResult) {
        pendingBatchUserMessage = createFloatingMessage("user", prompt || combinedPromptText, {
          attachments: activeAttachments,
        });
        setFloatingMessages((prev) => [...prev, pendingBatchUserMessage]);
        setFloatingPrompt("");
        setFloatingRefImages([]);
        setFloatingAttachments([]);
        setFloatingRuntimeMode("agent");
        setFloatingGenerationStage("preparing");
        setFloatingIsGenerating(true);
        setFloatingOutputError("");
      }
      try {
        batchWaPrompts = feishuBatchRequest
          ? await fetchFeishuWaBatchPrompts(feishuBatchRequest)
          : parseBatchWaTemplatePrompts(combinedPromptText);
      } catch (error) {
        if (!collectResult) {
          if (!pendingBatchUserMessage) {
            setFloatingMessages((prev) => [...prev, createFloatingMessage("user", prompt || combinedPromptText, {
              attachments: activeAttachments,
            })]);
          }
          setFloatingMessages((prev) => [...prev, createFloatingMessage("assistant", error?.message || "读取飞书 WA 表格失败", {
            modelLabel: "飞书 WA",
          })]);
          setFloatingPrompt("");
          setFloatingRefImages([]);
          setFloatingAttachments([]);
          setFloatingIsGenerating(false);
          setFloatingGenerationStage("understanding");
        }
        return collectResult ? { urls: [], error: error?.message || "读取飞书 WA 表格失败" } : undefined;
      }
    }
    if (batchWaPrompts.length > 1 || (feishuBatchRequest && batchWaPrompts.length > 0)) {
      const total = batchWaPrompts.length;
      const userMessage = createFloatingMessage("user", prompt || `批量生成 WA 海报（${total} 张）`, {
        attachments: activeAttachments,
      });
      const batchMessage = createFloatingMessage("assistant", `批量 WA 海报生成中：已完成 0/${total}。`, {
        modelLabel: "批量 WA",
        batchWaTotal: total,
        batchWaSource: feishuBatchRequest ? "feishu" : "local",
        batchWaStopped: false,
        batchWaItems: batchWaPrompts.map((item) => ({
          id: `wa-${item.index}`,
          label: item.label || `第 ${item.index + 1} 张`,
          status: "queued",
          attempts: 0,
          urls: [],
          error: "",
        })),
      });
      batchWaStoppedRef.current = false;
      setFloatingMessages((prev) => pendingBatchUserMessage
        ? [...prev, batchMessage]
        : [...prev, userMessage, batchMessage]);
      if (!pendingBatchUserMessage) {
        setFloatingPrompt("");
        setFloatingRefImages([]);
        setFloatingAttachments([]);
      }
      setFloatingRuntimeMode("agent");
      setFloatingGenerationStage("generating");
      setFloatingIsGenerating(true);
      setFloatingOutputError("");

      const updateBatchMessage = (updater) => {
        setFloatingMessages((prev) => prev.map((message) => {
          if (message.id !== batchMessage.id) return message;
          const nextItems = updater(Array.isArray(message.batchWaItems) ? message.batchWaItems : []);
          const completed = nextItems.filter((item) => item.status === "success").length;
          const failed = nextItems.filter((item) => item.status === "failed").length;
          const stopped = nextItems.filter((item) => item.status === "stopped").length;
          const done = completed + failed + stopped;
          const text = batchWaStoppedRef.current
            ? `批量 WA 海报已停止：已完成 ${completed}/${total}。`
            : done >= total
              ? `批量 WA 海报生成完成：已完成 ${completed}/${total}。`
              : `批量 WA 海报生成中：已完成 ${completed}/${total}。`;
          return { ...message, text, batchWaItems: nextItems, batchWaStopped: batchWaStoppedRef.current };
        }));
      };

      await runWithConcurrency(batchWaPrompts, BATCH_WA_CONCURRENCY, async (item) => {
        let attempt = 0;
        while (!batchWaStoppedRef.current) {
          attempt += 1;
          updateBatchMessage((items) => items.map((current) => (
            current.id === `wa-${item.index}`
              ? { ...current, status: attempt > 1 ? "retrying" : "generating", attempts: attempt, error: "" }
              : current
          )));
          const result = await handleFloatingSubmit({
            prompt: item.prompt,
            refImages: activeRefImages,
            attachments: [],
            skipBatch: true,
            allowConcurrent: true,
            suppressUserMessage: true,
            collectResult: true,
            hideGenerationCard: true,
            generationLabel: item.label,
          });
          if (result?.aborted || batchWaStoppedRef.current) return;
          if (Array.isArray(result?.urls) && result.urls.length > 0) {
            updateBatchMessage((items) => items.map((current) => (
              current.id === `wa-${item.index}`
                ? { ...current, status: "success", urls: result.urls, attempts: attempt, error: "", feishuStatus: item.recordId ? "uploading" : "" }
                : current
            )));
            if (item.recordId) {
              try {
                await uploadFeishuWaImage({
                  recordId: item.recordId,
                  tableId: item.tableId,
                  tableName: item.tableName,
                  imageUrl: result.urls[0],
                  name: `wa-${item.index + 1}-${Date.now()}.png`,
                });
                updateBatchMessage((items) => items.map((current) => (
                  current.id === `wa-${item.index}`
                    ? { ...current, feishuStatus: "success", feishuError: "" }
                    : current
                )));
              } catch (error) {
                updateBatchMessage((items) => items.map((current) => (
                  current.id === `wa-${item.index}`
                    ? { ...current, feishuStatus: "failed", feishuError: error?.message || "飞书回填失败" }
                    : current
                )));
              }
            }
            return;
          }
          updateBatchMessage((items) => items.map((current) => (
            current.id === `wa-${item.index}`
              ? { ...current, status: "retrying", attempts: attempt, error: result?.error || "生成失败，正在重试" }
              : current
          )));
          await wait(Math.min(1500 + attempt * 500, 8000));
        }
      });

      updateBatchMessage((items) => items.map((item) => (
        item.status === "queued" || item.status === "generating" || item.status === "retrying"
          ? { ...item, status: "stopped", error: "已停止" }
          : item
      )));
      setFloatingIsGenerating(false);
      setFloatingGenerationStage("understanding");
      return;
    }
    if (!allowConcurrent && floatingIsGenerating) return { aborted: true };
    if (!prompt && activeRefImages.length === 0) return collectResult ? { urls: [] } : undefined;
    const qualityFixPrompt = buildWaQualityFixPrompt(override?.qualityCheck);

    // ── WA 模板 / EZfamily / EZlogo 关键词自动触发参考图 ─────────────
    let autoRefImages = [];
    let apiPromptText = prompt; // 对 API 使用的 prompt（场景二会被增强）
    const waTemplateRequest = parseWaTemplateRequest(prompt);
    const ezFamilyRole = detectEzFamilyTrigger(prompt);
    const hasEzLogoTrigger = /ezlogo/i.test(prompt);
    const ipSceneRequest = detectIpSceneExtension(prompt, {
      hasUserReferenceImages: activeRefImages.length > 0,
      isWaTemplate: Boolean(waTemplateRequest),
    });
    const inheritedImages = shouldReusePreviousGeneratedImages(prompt, activeRefImages)
      ? getLatestGeneratedImages(floatingMessages)
      : [];
    const submittedAttachments = [...activeAttachments];
    const hasAutoReferenceIntent = Boolean(waTemplateRequest || ipSceneRequest || ezFamilyRole || hasEzLogoTrigger);
    const displayRefImages = hasAutoReferenceIntent ? activeRefImages : [...activeRefImages, ...inheritedImages];
    const nextUserMessage = createFloatingMessage("user", prompt, {
      refImages: displayRefImages,
      attachments: submittedAttachments,
    });
    const historyForAssistant = [...floatingMessages, nextUserMessage].map((message) => ({
      role: message.role,
      text: message.text || "",
      images: Array.isArray(message.images) ? message.images.slice(0, 3) : [],
      refImages: Array.isArray(message.refImages) ? message.refImages.slice(0, 3) : [],
      attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, 4) : [],
    }));

    if (!suppressUserMessage) {
      setFloatingMessages((prev) => [...prev, nextUserMessage]);
      setFloatingPrompt("");
      setFloatingRefImages([]);
      setFloatingAttachments([]);
    }
    if (!hideGenerationCard) {
      setFloatingGenerationStage("understanding");
      setFloatingIsGenerating(true);
    }
    setFloatingOutputError("");

    if (waTemplateRequest) {
      try {
        const templateImage = await fetchImageAsDataUrl(`${WA_TEMPLATE_ASSET_URL}?random=1`);
        if (templateImage) autoRefImages.push(templateImage);
        const role = ezFamilyRole || chooseWaTemplateIpRole(waTemplateRequest);
        const roleReferenceImages = await fetchEzFamilyReferenceImages(role);
        autoRefImages.push(...roleReferenceImages);
        const lockupImage = await fetchImageAsDataUrl(WA_LOCKUP_ASSET_URL);
        if (lockupImage) autoRefImages.push(lockupImage);
        if (String(role || "").toLowerCase() === "robot") {
          autoRefImages.push(...roleReferenceImages);
        }
        if (Math.random() < 0.28) {
          const smileLogoImage = await fetchImageAsDataUrl(WA_SMILE_LOGO_ASSET_URL);
          if (smileLogoImage) autoRefImages.push(smileLogoImage);
        }
        apiPromptText = buildWaTemplatePrompt(waTemplateRequest, role);
      } catch { /* 静默跳过 */ }
    } else if (ipSceneRequest) {
      try {
        const sceneImage = await fetchImageAsDataUrl(ipSceneRequest.sceneImageUrl);
        if (sceneImage) autoRefImages.push(sceneImage);
        autoRefImages.push(...await fetchEzFamilyReferenceImages(ipSceneRequest.role));
        for (const logoUrl of ipSceneRequest.logoImageUrls || []) {
          const logoImage = await fetchImageAsDataUrl(logoUrl);
          if (logoImage) autoRefImages.push(logoImage);
        }
        apiPromptText = buildIpSceneExtensionPrompt(ipSceneRequest);
      } catch { /* 静默跳过 */ }
    } else if (ezFamilyRole) {
      try {
        autoRefImages.push(...await fetchEzFamilyReferenceImages(ezFamilyRole));
        apiPromptText = buildEzFamilyTriggerPrompt(prompt, ezFamilyRole, {
          hasUserReferenceImages: activeRefImages.length > 0,
        });
      } catch { /* 静默跳过 */ }
    } else if (hasEzLogoTrigger) {
      try {
        const logoImage = await fetchImageAsDataUrl(EZLOGO_ASSET_URL);
        if (logoImage) autoRefImages.push(logoImage);
        apiPromptText = prompt.replace(/\bezlogo\b/gi, "").replace(/\s+/g, " ").trim();
        apiPromptText = `${apiPromptText || "参考图中的图形标志进行设计。"}

EZlogo trigger instructions:
${buildEzLogoReferenceInstructions(activeRefImages.length > 0)}
- “EZlogo”只是系统触发词，不要在画面中生成“EZlogo”文字，也不要把它理解成要生成英文字母“EZ”。`;
      } catch { /* 静默跳过 */ }
    }
    if (qualityFixPrompt) {
      apiPromptText = `${apiPromptText}\n${qualityFixPrompt}`;
    }
    // ─────────────────────────────────────────────────────

    // WA 模板：系统资产必须作为第一参考图；EZlogo 有用户参考图时让用户图优先引导风格/版式
    // 无触发：正常使用 floatingRefImages
    const submittedImages = autoRefImages.length > 0
      ? (waTemplateRequest
        ? [...autoRefImages, ...activeRefImages, ...inheritedImages]
        : hasEzLogoTrigger
          ? (activeRefImages.length > 0
            ? [...activeRefImages, ...autoRefImages, ...inheritedImages]
            : [...autoRefImages, ...inheritedImages])
        : (activeRefImages.length > 0 ? [...activeRefImages, ...autoRefImages] : [...autoRefImages, ...inheritedImages]))
      : [...activeRefImages, ...inheritedImages];
    const predictedMode = detectOneClickEntryMode(apiPromptText, submittedImages);
    const bypassPlannerForDirectGenerate = autoRefImages.length > 0 || isObviousOneClickGenerateRequest(
      apiPromptText,
      submittedImages,
      submittedAttachments
    );
    setFloatingRuntimeMode(predictedMode);
    let activeClientRequestId = "";
    let generationAbortController = null;

    try {
      if (!hideGenerationCard) {
        await showFloatingGenerationStage("understanding");
      }
      const plan = bypassPlannerForDirectGenerate
        ? {
            action: "generate",
            mode: predictedMode,
            assistantText: submittedImages.length > 0
              ? "我直接按你的要求开始改图。"
              : "我直接按你的要求开始生图。",
            assistantModel: submittedImages.length > 0 ? "直连 GPT Image 2" : "直连 Nano",
          }
        : await (async () => {
            const plannerRes = await fetchWithTimeout("/api/floating-assistant", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: historyForAssistant,
                currentInput: apiPromptText,
                refImages: submittedImages,
                attachments: submittedAttachments,
              }),
            }, 60 * 1000);
            const plannerData = await parseApiResponse(plannerRes);
            if (!plannerRes.ok || plannerData.error) {
              throw new Error(plannerData.error || `对话判断失败（${plannerRes.status}）`);
            }
            return plannerData.data || {};
          })();
      const resolvedMode = plan.mode === "agent" ? "agent" : "quick";
      const assistantText = String(plan.assistantText || "").trim();
      setFloatingRuntimeMode(resolvedMode);

      if (plan.action === "reply") {
        if (!suppressUserMessage) {
          setFloatingMessages((prev) => [
            ...prev,
            createFloatingMessage("assistant", assistantText || "我先给你一些建议，你也可以继续补充需求。", {
              modelLabel: plan.assistantModel || "gpt-5.4",
            }),
          ]);
        }
        return collectResult ? { urls: [], reply: true } : undefined;
      }

      if (!hideGenerationCard) {
        await showFloatingGenerationStage("preparing");
      }
      const hasImages = submittedImages.length > 0;
      const isAgentMode = resolvedMode === "agent";
      const generationPrompt = apiPromptText; // 场景二已增强，含人物替换指令
      const firstRefMeta = hasImages ? await detectRefImageMeta(submittedImages[0]) : null;
      const quickImageSize = hasImages
        ? (firstRefMeta?.ratio || "1:1")
        : inferAspectRatioFromPrompt(generationPrompt);
      const agentParams = resolveAgentParams(
        {
          model: FLOATING_AGENT_DEFAULT_MODEL,
          image_size: "1:1",
          num: 1,
          service_tier: FLOATING_AGENT_DEFAULT_SERVICE_TIER,
        },
        generationPrompt,
        submittedImages
      );
      const generationModel = resolveFloatingGenerationModel({ hasImages, isAgentMode, agentParams });
      // GPT Image 2 传精确像素尺寸以保持原图比例；其他模型传比例字符串
      const isGpt2 = generationModel === "gpt-image-2";
      const imageSize = hasImages
        ? (isGpt2 ? computeGptImage2EditSize(firstRefMeta?.width, firstRefMeta?.height) : (firstRefMeta?.ratio || "1:1"))
        : isAgentMode
          ? (agentParams.image_size === "auto" ? (firstRefMeta?.ratio || "1:1") : agentParams.image_size)
          : quickImageSize;
      const endpoint = hasImages ? "/api/edit" : "/api/generate";
      const finalPrompt = isAgentMode ? buildAgentPrompt(generationPrompt, submittedImages) : generationPrompt;
      activeClientRequestId = createClientRequestId("floating");
      const payload = hasImages
        ? {
            prompt: finalPrompt,
            image: submittedImages.length === 1 ? submittedImages[0] : submittedImages,
            model: generationModel,
            image_size: imageSize,
            num: 1,
            service_tier: isAgentMode ? agentParams.service_tier : FLOATING_DEFAULT_SERVICE_TIER,
            clientRequestId: activeClientRequestId,
          }
        : {
            prompt: finalPrompt,
            model: generationModel,
            image_size: imageSize,
            num: 1,
            ref_images: submittedImages,
            service_tier: isAgentMode ? agentParams.service_tier : FLOATING_DEFAULT_SERVICE_TIER,
            clientRequestId: activeClientRequestId,
          };

      if (!hideGenerationCard) {
        setFloatingGenerationStage("generating");
      }
      generationAbortController = new AbortController();
      if (collectResult) {
        batchWaAbortControllersRef.current.add(generationAbortController);
      }
      const requestPromise = (async () => {
        const res = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: generationAbortController.signal,
        }, generationModel === "gpt-image-2" ? GPT_IMAGE_2_CLIENT_TIMEOUT_MS : ONE_CLICK_REQUEST_TIMEOUT_MS);
        const responseData = await parseApiResponse(res);
        if (!res.ok || responseData.error) {
          throw createNonRecoverableError(responseData.error || `生成失败（${res.status}）`, res.status);
        }
        return { data: responseData, recovered: false };
      })();
      const { data, recovered } = await Promise.race([
        requestPromise,
        waitForRecoveredGenerationResult(activeClientRequestId),
      ]);
      if (recovered) {
        generationAbortController.abort(createTimeoutError("已恢复生成结果，停止等待原始连接。"));
        await requestPromise.catch(() => null);
      }

      const urls = Array.isArray(data.data?.urls) ? data.data.urls.filter(Boolean) : [];
      if (urls.length === 0) {
        throw new Error("未返回结果图片");
      }

      if (!hideGenerationCard) {
        await showFloatingGenerationStage("saving", GENERATION_SAVING_STAGE_MS);
      }
      const assistantMessage = createFloatingMessage(
        "assistant",
        assistantText || (resolvedMode === "agent" ? "我已经按你的要求整理并生成了一版结果。" : "我已经帮你快速生成了一版结果。"),
        {
          images: urls,
          qualityCheck: null,
          qualityImprovement: null,
          modelLabel: `${plan.assistantModel || "gpt-5.4"} · ${generationModel}`,
        }
      );
      if (!suppressUserMessage) {
        setFloatingMessages((prev) => [...prev, assistantMessage]);
      }

      if (waTemplateRequest && !suppressUserMessage) {
        void withTimeout(runWaQualityCheck(urls[0]), WA_QUALITY_CLIENT_TIMEOUT_MS, null)
          .then((qualityCheck) => {
            if (!qualityCheck) return;
            const qualityImprovement = buildWaQualityImprovement(override?.qualityCheck, qualityCheck);
            setFloatingMessages((prev) => prev.map((message) => (
              message.id === assistantMessage.id
                ? { ...message, qualityCheck, qualityImprovement }
                : message
            )));
          });
      }
      return collectResult ? { urls, modelLabel: `${plan.assistantModel || "gpt-5.4"} · ${generationModel}` } : undefined;
    } catch (err) {
      if (collectResult && err?.name === "AbortError") {
        return { aborted: true, urls: [] };
      }
      if (shouldAttemptGenerationRecovery(err)) {
        const recovered = await recoverGenerationResult(activeClientRequestId);
        const recoveredUrls = Array.isArray(recovered?.data?.urls) ? recovered.data.urls.filter(Boolean) : [];
        if (recoveredUrls.length > 0) {
          if (!suppressUserMessage) {
            setFloatingMessages((prev) => [
              ...prev,
              createFloatingMessage("assistant", "刚刚连接中断，但我已经恢复到生成结果。", {
                images: recoveredUrls,
                modelLabel: "已恢复的生成结果",
              }),
            ]);
          }
          setFloatingOutputError("");
          return collectResult ? { urls: recoveredUrls, recovered: true } : undefined;
        }
      }
      if (!suppressUserMessage) {
        setFloatingMessages((prev) => [
          ...prev,
          createFloatingMessage("assistant", formatFloatingGenerationError(err)),
        ]);
        setFloatingOutputError("");
      }
      return collectResult ? { urls: [], error: err?.message || "生成失败" } : undefined;
    } finally {
      if (collectResult && generationAbortController) {
        batchWaAbortControllersRef.current.delete(generationAbortController);
      }
      if (!hideGenerationCard) {
        setFloatingIsGenerating(false);
        setFloatingGenerationStage("understanding");
      }
    }
  };
  handleFloatingSubmitRef.current = handleFloatingSubmit;

  useEffect(() => {
    let stopped = false;

    const markTask = async (taskId, action, error = "") => {
      if (!taskId) return;
      await fetch("/api/feishu-wa-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, taskId, error }),
      }).catch(() => {});
    };

    const pollFeishuTask = async () => {
      if (stopped || floatingIsGenerating || feishuWaTaskPollingRef.current) return;
      feishuWaTaskPollingRef.current = true;
      try {
        const res = await fetch("/api/feishu-wa-tasks?action=claim&clientId=floating", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const task = data?.data?.task;
        if (!res.ok || !task?.id || !task?.prompt || stopped) return;
        setFloatingMessages((prev) => [...prev, createFloatingMessage("assistant", `已接收飞书指令，开始同步到一键创作：${task.prompt}`, {
          modelLabel: "飞书同步",
        })]);
        try {
          await handleFloatingSubmitRef.current?.({ prompt: task.prompt });
          await markTask(task.id, "complete");
        } catch (error) {
          await markTask(task.id, "fail", error?.message || "一键创作任务执行失败");
        }
      } finally {
        feishuWaTaskPollingRef.current = false;
      }
    };

    void pollFeishuTask();
    const timer = window.setInterval(() => void pollFeishuTask(), 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [floatingIsGenerating]);

  const handleFloatingRegenerateMessage = (messageId) => {
    if (floatingIsGenerating) return;
    const messageIndex = floatingMessages.findIndex((item) => item.id === messageId);
    if (messageIndex <= 0) return;
    const targetMessage = floatingMessages[messageIndex];
    const sourceMessage = [...floatingMessages.slice(0, messageIndex)].reverse().find((item) => item.role === "user");
    if (!sourceMessage) return;
    void handleFloatingSubmit({
      prompt: sourceMessage.text || "",
      refImages: Array.isArray(sourceMessage.refImages) ? sourceMessage.refImages : [],
      attachments: Array.isArray(sourceMessage.attachments) ? sourceMessage.attachments : [],
      qualityCheck: targetMessage?.qualityCheck,
    });
  };

  return (
    <div className="min-h-screen bg-bg-primary overflow-x-hidden overflow-y-auto">
      {/* Nav */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 lg:px-12 py-4"
      >
        <div className="flex items-center">
          <BrandLogo
            className="h-9"
            wordmarkOffsetClassName={`translate-y-[2px] ${theme === "light" ? "invert" : ""}`}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsModeMenuOpen((prev) => !prev)}
              className={`w-9 h-9 rounded-xl backdrop-blur-md transition-all flex items-center justify-center ${
                theme === "light"
                  ? "bg-black/[0.14] text-black/70 hover:bg-black/[0.20] hover:text-[#3FCA58]"
                  : "bg-white/[0.32] text-white/85 hover:bg-white/[0.40] hover:text-[#3FCA58]"
              }`}
              title="选择模式"
              aria-label="选择模式"
            >
              <LayoutGrid size={16} />
            </button>
            {isModeMenuOpen && (
              <div
                className="absolute right-0 top-[calc(100%+16px)] z-50 w-44 overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary/95 p-1.5 shadow-2xl backdrop-blur-xl"
                onMouseLeave={() => setIsModeMenuOpen(false)}
              >
                <Link
                  href="/chat"
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-text-secondary transition-all hover:text-[#3FCA58]"
                >
                  一键创作模式
                  <ArrowRight size={14} />
                </Link>
                <Link
                  href="/canvas"
                  className="mt-1 flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-text-secondary transition-all hover:text-[#3FCA58]"
                >
                  专业创作模式
                  <ArrowRight size={14} />
                </Link>
              </div>
            )}
          </div>
          <button
            onClick={toggleTheme}
            className={`w-9 h-9 rounded-xl backdrop-blur-md transition-all flex items-center justify-center ${
              theme === "light"
                ? "bg-black/[0.14] text-black/70 hover:bg-black/[0.20] hover:text-[#3FCA58]"
                : "bg-white/[0.32] text-white/85 hover:bg-white/[0.40] hover:text-[#3FCA58]"
            }`}
            title={theme === "dark" ? "切换到浅色" : "切换到深色"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {authUser ? (
            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setIsProfileMenuOpen((prev) => !prev);
                  setIsProfileAccountOpen(false);
                }}
                className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl backdrop-blur-md transition-all hover:scale-105 ${
                  theme === "light" ? "bg-black/[0.14]" : "bg-white/[0.32]"
                }`}
                title="个人信息"
                aria-label="个人信息"
              >
                <img
                  src={profileAvatarSrc}
                  alt=""
                  className="h-full w-full object-cover"
                  aria-hidden="true"
                />
              </button>

              {isProfileMenuOpen && (
                <div className={`absolute right-0 top-[calc(100%+12px)] z-50 w-[300px] rounded-2xl border p-3 shadow-2xl backdrop-blur-xl ${
                  theme === "light"
                    ? "border-black/10 bg-white text-black shadow-black/12"
                    : "border-white/12 bg-[#111713]/95 text-white shadow-black/45"
                }`}>
                  {isProfileAccountOpen ? (
                    <>
                      <div className="mb-4 flex items-center gap-3">
                        <img
                          src={profileAvatarSrc}
                          alt=""
                          className="h-11 w-11 rounded-xl object-cover"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">
                            {profileDisplayName.trim() || "EasyAI 内测用户"}
                          </div>
                          <div className={`mt-0.5 truncate text-xs ${theme === "light" ? "text-black/45" : "text-white/45"}`}>
                            {authUser.username}
                          </div>
                        </div>
                      </div>

                      <label className={`mb-1.5 block text-xs font-medium ${theme === "light" ? "text-black/60" : "text-white/55"}`}>
                        显示名称
                      </label>
                      <input
                        value={profileDisplayName}
                        onChange={(event) => handleProfileNameChange(event.target.value)}
                        placeholder="填写你的显示名称"
                        className={`mb-3 w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors focus:border-[#3FCA58]/70 ${
                          theme === "light"
                            ? "border-black/10 bg-black/[0.035] placeholder:text-black/30"
                            : "border-white/10 bg-black/25 placeholder:text-white/30"
                        }`}
                      />

                      <label className={`mb-1.5 block text-xs font-medium ${theme === "light" ? "text-black/60" : "text-white/55"}`}>
                        头像
                      </label>
                      <div className={`mb-3 rounded-xl border p-3 ${theme === "light" ? "border-black/10 bg-black/[0.025]" : "border-white/10 bg-black/20"}`}>
                        <div className="flex items-center gap-3">
                          <img
                            src={profileAvatarSrc}
                            alt=""
                            className="h-12 w-12 rounded-xl object-cover"
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <div className={`text-xs ${theme === "light" ? "text-black/55" : "text-white/50"}`}>
                              支持上传 JPG / PNG 图片，仅保存在当前浏览器。
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => profileAvatarInputRef.current?.click()}
                                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                                  theme === "light"
                                    ? "bg-black/[0.06] text-black/75 hover:bg-black/10"
                                    : "bg-white/[0.08] text-white/75 hover:bg-white/[0.12]"
                                }`}
                              >
                                上传头像
                              </button>
                              {profileAvatar ? (
                                <button
                                  type="button"
                                  onClick={handleResetProfileAvatar}
                                  className="rounded-lg px-2.5 py-1.5 text-xs text-red-400 transition-all hover:bg-red-500/10"
                                >
                                  恢复默认
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <input
                          ref={profileAvatarInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleProfileAvatarChange}
                        />
                      </div>

                      <div className={`mb-3 rounded-xl px-3 py-2 text-xs ${theme === "light" ? "bg-black/[0.035] text-black/55" : "bg-white/[0.06] text-white/55"}`}>
                        登录状态保留 30 天，仅用于团队内测访问控制。
                      </div>

                      <button
                        type="button"
                        onClick={() => setIsProfileAccountOpen(false)}
                        className={`w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                          theme === "light"
                            ? "bg-black/[0.06] text-black/75 hover:bg-black/10"
                            : "bg-white/[0.08] text-white/75 hover:bg-white/[0.12]"
                        }`}
                      >
                        返回
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsProfileAccountOpen(true)}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                          theme === "light"
                            ? "text-black/75 hover:bg-black/[0.06]"
                            : "text-white/75 hover:bg-white/[0.08]"
                        }`}
                      >
                        账户管理
                        <ArrowRight size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className={`mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                          theme === "light"
                            ? "text-black/75 hover:bg-red-500/10 hover:text-red-500"
                            : "text-white/75 hover:bg-red-500/12 hover:text-red-300"
                        }`}
                      >
                        退出登录
                        <LogOut size={15} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              disabled={isAuthLoading}
              onClick={() => {
                setPendingAuthNext("/");
                setIsLoginModalOpen(true);
              }}
              className={`h-9 rounded-xl px-3 text-xs font-semibold backdrop-blur-md transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                theme === "light"
                  ? "bg-[#3FCA58] text-white hover:bg-[#35b54d]"
                  : "bg-[#3FCA58] text-white hover:bg-[#35b54d]"
              }`}
            >
              <span className="hidden sm:inline">登录</span>
              <LogIn size={15} className="sm:hidden" />
            </button>
          )}
        </div>
      </nav>

      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-5 backdrop-blur-sm">
          <form
            onSubmit={handleLoginSubmit}
            className={`w-full max-w-[420px] rounded-[28px] border p-7 shadow-2xl ${
              theme === "light"
                ? "border-black/10 bg-white text-black shadow-black/15"
                : "border-white/12 bg-[#111713]/95 text-white shadow-black/45"
            }`}
          >
            <div className="mb-7 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <BrandLogo className="h-12" showText={false} />
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">内测登录</h2>
                  <p className={`mt-1 text-sm ${theme === "light" ? "text-black/50" : "text-white/50"}`}>
                    登录后可使用创作功能
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsLoginModalOpen(false);
                  setLoginError("");
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-xl text-xl leading-none transition-all ${
                  theme === "light"
                    ? "text-black/45 hover:bg-black/5 hover:text-black"
                    : "text-white/45 hover:bg-white/8 hover:text-white"
                }`}
                aria-label="关闭登录"
              >
                ×
              </button>
            </div>

            <label className={`mb-2 block text-sm font-medium ${theme === "light" ? "text-black/75" : "text-white/80"}`}>公司邮箱</label>
            <div className={`mb-5 flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors focus-within:border-[#3FCA58]/70 ${
              theme === "light" ? "border-black/10 bg-black/[0.035]" : "border-white/10 bg-black/25"
            }`}>
              <Mail size={18} className={theme === "light" ? "text-black/35" : "text-white/45"} />
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="请输入公司邮箱"
                required
                className={`login-input w-full bg-transparent text-sm outline-none ${
                  theme === "light" ? "placeholder:text-black/30" : "placeholder:text-white/30"
                }`}
              />
            </div>

            <label className={`mb-2 block text-sm font-medium ${theme === "light" ? "text-black/75" : "text-white/80"}`}>内测密码</label>
            <div className={`mb-5 flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors focus-within:border-[#3FCA58]/70 ${
              theme === "light" ? "border-black/10 bg-black/[0.035]" : "border-white/10 bg-black/25"
            }`}>
              <LockKeyhole size={18} className={theme === "light" ? "text-black/35" : "text-white/45"} />
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="请输入统一内测密码"
                required
                className={`login-input w-full bg-transparent text-sm outline-none ${
                  theme === "light" ? "placeholder:text-black/30" : "placeholder:text-white/30"
                }`}
              />
            </div>

            {loginError ? (
              <div className="mb-5 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                {loginError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loginSubmitting}
              className="flex w-full items-center justify-center rounded-2xl bg-[#3FCA58] px-4 py-3 text-sm font-semibold text-black transition hover:bg-[#35b54d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loginSubmitting ? "登录中..." : "登录并进入"}
            </button>
          </form>
        </div>
      )}

      {/* Hero */}
      <section className="relative w-full h-screen min-h-[600px] overflow-hidden">
        {heroCarouselItems.map((item, index) => {
          const isActive = index === heroSlideIndex;
          const nextSlideIndex = heroCarouselItems.length > 1
            ? (heroSlideIndex + 1) % heroCarouselItems.length
            : heroSlideIndex;
          const shouldWarmNextVideo = index === nextSlideIndex;
          const sharedClassName = `absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ease-out ${
            isActive ? "opacity-100" : "opacity-0"
          }`;

          return item.type === "video" ? (
            <video
              key={item.src}
              ref={(node) => {
                heroVideoRefs.current[index] = node;
              }}
              src={item.src}
              aria-label={item.label}
              className={sharedClassName}
              autoPlay={isActive}
              muted
              loop
              playsInline
              preload={isActive ? "auto" : shouldWarmNextVideo ? "metadata" : "none"}
            />
          ) : (
            <img
              key={item.src}
              src={item.src}
              alt={item.label}
              className={sharedClassName}
              loading={index === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          );
        })}
        <div className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
          {heroCarouselItems.map((item, index) => (
            <button
              key={item.src}
              type="button"
              onClick={() => setHeroSlideIndex(index)}
              aria-label={`切换到首页轮播 ${index + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                index === heroSlideIndex ? "w-7 bg-[#3FCA58]" : "w-1.5 bg-white/45 hover:bg-white/75"
              }`}
            />
          ))}
        </div>
      </section>

      {/* Hero copy */}
      <section className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto pt-32 lg:pt-40 pb-24 lg:pb-32 text-center transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <h1 className={`font-bold text-text-primary tracking-tight ${heroPreset.title}`}>
            Easy <span style={{ color: "#3FCA58" }}>AI</span>
            <br />让设计迈入自动化时代
        </h1>
        <p className={`text-text-secondary mx-auto leading-relaxed ${heroPreset.description}`}>
          Easy AI 将海报生成、品牌资产、IP 角色、专业画布和出图质检整合成一套高质量出图设计工作流，帮助团队高效产出稳定、可交付、低成本的设计内容
        </p>
        <div className={`flex items-center justify-center ${heroPreset.actions}`}>
          <Link
            href="/chat"
            className={`rounded-full bg-[#3FCA58] text-white font-medium flex items-center gap-2.5 transition-all animate-[hero-button-breathe_2.4s_ease-in-out_infinite] hover:bg-[#3FCA58]/90 hover:scale-[1.04] hover:[animation-play-state:paused] active:scale-[0.98] ${heroPreset.primaryButton}`}
          >
            开启一键创作模式
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Pain points */}
      <section className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto pt-4 lg:pt-8 pb-20 transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="text-center mb-14">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-3">商业设计市场核心痛点</h2>
          <p className="text-sm text-text-secondary">高频、分散、反复修改的设计需求，正在吞噬团队的创意时间</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PAIN_POINTS.map((item, index) => {
            const Icon = item.icon;
            return (
              <div
                key={index}
                className={`home-card rounded-2xl border p-7 text-center ${
                  theme === "light"
                    ? "border-black/[0.04] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.035)]"
                    : "border-white/0 bg-bg-secondary"
                }`}
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mx-auto mb-5 ${theme === "light" ? "bg-slate-50" : "bg-bg-tertiary"} ${item.iconColor}`}>
                  <Icon size={21} />
                </div>
                <h3 className="text-sm font-semibold text-text-primary mb-2">{item.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Features */}
      <section id="features" className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto pt-24 lg:pt-32 pb-20 transition-all duration-700 delay-300 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="text-center mb-14">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-3">Easy AI 核心产品能力</h2>
          <p className="text-sm text-text-secondary">围绕设计生产、品牌一致性和低成本交付构建完整工作流</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={i}
                className={`home-card rounded-2xl border p-6 text-center ${
                  theme === "light"
                    ? "border-black/[0.04] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.035)] hover:shadow-[0_16px_36px_rgba(15,23,42,0.055)]"
                    : "border-white/0 bg-bg-secondary hover:bg-bg-hover hover:shadow-lg hover:shadow-black/20"
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4 ${theme === "light" ? "bg-slate-50" : "bg-bg-tertiary"} ${f.iconColor}`}>
                  <Icon size={20} />
                </div>
                <h3 className="text-sm font-semibold text-text-primary mb-2">{f.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Parallax showcase */}
      <section className="relative z-10 bg-bg-primary py-20 lg:py-28 overflow-hidden">
        <div className="mx-auto max-w-3xl px-6 text-center mb-10 lg:mb-14">
          <h2 className="mb-5 text-2xl lg:text-3xl font-semibold tracking-tight text-text-primary">
            一站式创作
          </h2>
          <p className="text-xs lg:text-sm text-text-secondary leading-relaxed">
            一句话就是一张可交付的设计图，一键/专业两种模式任你选择，把更多时间留给创意和判断
          </p>
        </div>
        <div className="h-[24vh] min-h-[160px] overflow-hidden lg:h-[30vh]">
          <div
            className="h-full w-full bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage: `url('${HOME_SCROLL_PERSON_SRC}')`,
              backgroundAttachment: "fixed",
            }}
          />
        </div>
      </section>

      {/* Value metrics */}
      <section className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto mt-20 lg:mt-24 pt-4 lg:pt-8 pb-24 lg:pb-32 transition-all duration-700 delay-500 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="text-center mb-14">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-3">从出图工具，到企业设计生产系统</h2>
          <p className="text-sm text-text-secondary">成本、效率、品牌一致性和交付在Easy AI形成闭环</p>
        </div>
        <div className="mb-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {VALUE_METRICS.map((item) => (
            <div
              key={item.title}
              className={`home-card rounded-2xl border p-7 text-center ${
                theme === "light"
                  ? "border-black/[0.04] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.035)]"
                  : "border-white/0 bg-bg-secondary"
              }`}
            >
              <div className="text-3xl font-bold text-[#3FCA58]">{item.value}</div>
              <h3 className="mt-4 text-sm font-semibold text-text-primary">{item.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">{item.desc}</p>
            </div>
          ))}
        </div>
        <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
          {[VALUE_COMPARISON[0]].map((group) => (
            <div
              key={group.label}
              className="p-6 text-center"
            >
              <div className={`mb-3 text-xs font-semibold ${
                group.tone === "active" ? "text-[#3FCA58]" : "text-text-secondary"
              }`}>
                {group.label}
              </div>
              <h3 className="text-lg font-bold leading-snug text-text-primary">{group.title}</h3>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {group.points.map((point) => (
                  <div
                    key={point}
                    className={`rounded-full px-5 py-4 text-center text-xs font-semibold ${
                      group.tone === "active"
                        ? "bg-[#3FCA58]/15 text-[#3FCA58]"
                        : theme === "light"
                          ? "bg-black/[0.035] text-black/55"
                          : "bg-white/[0.045] text-white/55"
                    }`}
                  >
                    {point}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-center">
            <div className="rounded-full border border-transparent bg-[#3FCA58]/10 px-5 py-3 text-xs font-bold text-[#3FCA58] lg:mt-16">
              VS
            </div>
          </div>
          {[VALUE_COMPARISON[1]].map((group) => (
            <div
              key={group.label}
              className="p-6 text-center"
            >
              <div className={`mb-3 text-xs font-semibold ${
                group.tone === "active"
                  ? theme === "light" ? "text-[#1F8F35]" : "text-white"
                  : "text-text-secondary"
              }`}>
                {group.label}
              </div>
              <h3 className="text-lg font-bold leading-snug text-text-primary">{group.title}</h3>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {group.points.map((point) => (
                  <div
                    key={point}
                    className={`rounded-full px-5 py-4 text-center text-xs font-semibold ${
                      group.tone === "active"
                        ? theme === "light" ? "bg-black/[0.035] text-[#1F8F35]" : "bg-white/[0.045] text-[#3FCA58]"
                        : theme === "light"
                          ? "bg-black/[0.035] text-black/55"
                          : "bg-white/[0.045] text-white/55"
                    }`}
                  >
                    {point}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Effect showcase */}
      <section className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto mt-12 pt-4 lg:pt-8 pb-36 lg:pb-48 transition-all duration-700 delay-500 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="text-center mb-14">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-3">艺术效果展示</h2>
          <p className="text-sm text-text-secondary">覆盖品牌、角色、产品等多种创作场景</p>
        </div>
        <Link
          ref={effectShowcaseRef}
          href="/gallery"
          aria-label="进入效果展示无线画布"
          className="group relative block aspect-video overflow-visible bg-transparent transition-all duration-300 ease-out hover:scale-[1.015]"
        >
          <div className={`absolute inset-0 flex flex-col items-center justify-center overflow-visible px-8 text-center ${theme === "light" ? "text-[#111]" : "text-white"}`}>
            <div className="relative h-[56%] w-full max-w-[980px]">
              {EFFECT_SHOWCASE_CARDS.map((card) => {
                const fanLeft = card.left + (card.fanLeft - card.left) * effectCardSpread;
                const fanTop = card.top + (card.fanTop - card.top) * effectCardSpread;
                const fanRotation = card.rotation + card.fanRotation * effectCardSpread;
                const originX = 50 + ((card.originX ?? 50) - 50) * effectCardSpread;
                const originY = 50 + ((card.originY ?? 50) - 50) * effectCardSpread;
                const cardScale = 1 + effectCardSpread * 0.06;

                return (
                  <div
                    key={card.src}
                    className="absolute aspect-square transition-[left,top,transform,transform-origin] duration-350 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{
                      left: `${fanLeft}%`,
                      top: `${fanTop}%`,
                      width: `${card.width}%`,
                      zIndex: card.zIndex,
                      transformOrigin: `${originX}% ${originY}%`,
                      transform: `translate(-50%, -50%) rotate(${fanRotation}deg)`,
                    }}
                  >
                    <div
                      className="h-full w-full transition-transform duration-350 ease-[cubic-bezier(0.16,1,0.3,1)]"
                      style={{ transform: `scale(${cardScale})` }}
                    >
                      <div className="h-full w-full overflow-hidden rounded-[24px] border border-white/15 bg-white/10 transition-transform duration-350 ease-out group-hover:scale-[1.035]">
                        <img
                          src={card.src}
                          alt={card.alt}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <h3 className="mt-2 text-3xl font-medium tracking-tight opacity-0 lg:text-5xl" aria-hidden="true">EasyFamily</h3>
            <p className={`mt-3 text-sm lg:text-lg ${theme === "light" ? "text-black/60" : "text-white/70"}`}>Make Work Easier</p>
            <div className={`mt-5 inline-flex items-center gap-3 rounded-full px-5 py-2 text-xs font-semibold shadow-xl ${
              theme === "light"
                ? "bg-black text-white shadow-black/10"
                : "bg-white text-black shadow-black/20"
            }`}>
              Enter
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${theme === "light" ? "bg-white text-black" : "bg-black text-white"}`}>
                <span className={`ml-0.5 h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent ${theme === "light" ? "border-l-black" : "border-l-white"}`} />
              </span>
            </div>
          </div>
        </Link>
      </section>

      {/* Business showcase */}
      <section className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto -mt-[70px] pt-4 lg:pt-8 pb-36 lg:pb-48 transition-all duration-700 delay-500 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="text-center mb-14">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-3">业务效果展示</h2>
          <p className="text-sm text-text-secondary">向活动营销、业务宣传和品牌物料的批量设计输出</p>
        </div>
        <div ref={businessShowcaseRef} className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {BUSINESS_SHOWCASE_COVERS.map((cover, index) => (
            <Link
              href="/business-gallery"
              key={cover.src}
              className="transition-transform duration-300"
              aria-label={`进入${cover.alt}`}
              style={{
                transform: `translateX(${(index === 0 ? -1 : 1) * businessCardSpread * 22}px) rotate(${(index === 0 ? -1 : 1) * businessCardSpread * 6}deg) scale(${1 + businessCardSpread * 0.055})`,
                transformOrigin: index === 0 ? "right center" : "left center",
              }}
            >
              <div className={`group relative aspect-video overflow-hidden rounded-[32px] border transition-all duration-300 hover:-translate-y-1 hover:scale-[1.02] ${
                theme === "light"
                  ? "border-black/[0.06] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.055)] hover:shadow-[0_24px_60px_rgba(15,23,42,0.08)]"
                  : "border-white/10 bg-white/[0.035] hover:bg-white/[0.055] hover:shadow-2xl hover:shadow-black/30"
              }`}>
                <img
                  src={cover.src}
                  alt={cover.alt}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-16 flex justify-center">
          <Link
            href="/business-gallery"
            className="inline-flex items-center gap-3 rounded-full bg-white px-5 py-2 text-xs font-semibold text-black shadow-xl shadow-black/10 transition-all hover:scale-[1.03] hover:bg-white/90 active:scale-[0.98]"
          >
            Enter
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black text-white">
              <span className="ml-0.5 h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-white" />
            </span>
          </Link>
        </div>
      </section>

      {/* Models */}
      <section className={`relative z-10 px-6 lg:px-12 max-w-5xl mx-auto pt-4 lg:pt-8 pb-32 lg:pb-40 transition-all duration-700 delay-400 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <div className="text-center mb-14">
          <h2 className="text-2xl lg:text-3xl font-bold text-text-primary mb-3">模型选择</h2>
          <p className="text-sm text-text-secondary">超低价格，三档算力，灵活匹配你的创作需求</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {MODELS.map((m, i) => {
            const Icon = m.icon;
            return (
              <div
                key={i}
                className={`home-card rounded-2xl border p-8 text-center ${
                  theme === "light"
                    ? "border-black/[0.04] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.035)] hover:shadow-[0_16px_36px_rgba(15,23,42,0.055)]"
                    : "border-white/0 bg-bg-secondary hover:bg-bg-hover hover:shadow-lg hover:shadow-black/20"
                }`}
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 ${theme === "light" ? "bg-slate-50" : "bg-bg-tertiary"} ${m.color}`}>
                  <Icon size={26} />
                </div>
                <p className={`mb-5 text-xs leading-relaxed ${m.color}`}>{m.cost}</p>
                <h3 className="text-base font-semibold text-text-primary mb-2">{m.name}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{m.desc}</p>
              </div>
            );
          })}
        </div>
        <div
          ref={bottomSummaryRef}
          className="mx-auto mt-48 h-[15vh] min-h-[128px] max-w-5xl overflow-hidden rounded-2xl lg:mt-60 lg:h-[20vh]"
        >
          <video
            className="h-full w-full object-cover will-change-[object-position]"
            style={{ objectPosition: `center ${-20 + bottomSummaryParallax * 140}%` }}
            src={HOME_BOTTOM_SUMMARY_SRC}
            aria-label="Easy AI 企业级视觉生产基础设施总结视频"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          />
        </div>
        <div className="mx-auto mt-24 lg:mt-32 max-w-6xl text-center">
          <p className="text-xl font-semibold leading-relaxed tracking-tight text-text-primary lg:text-3xl">
            Easy AI 致力于成为企业级 AI 视觉生产基础设施，
            <br />
            <span className="whitespace-nowrap">帮助品牌以更低成本、更高效率，持续规模化地完成商业视觉内容交付</span>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 mt-24 text-white">
        <div className="relative overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-[center_78%] bg-no-repeat bg-fixed"
            style={{ backgroundImage: `url('${FOOTER_BOTTOM_SRC}')` }}
          />
          <div className="relative mx-auto max-w-5xl px-6 py-12 lg:px-0">
            <div className="grid min-h-56 grid-cols-1 items-center gap-10 md:grid-cols-[1fr_1fr]">
              <div>
                <div className="mb-4 flex items-center">
                  <BrandLogo className="h-7" />
                </div>
                <p className="max-w-[220px] text-xs leading-relaxed text-white/55">
                  Easy AI产品持续优化中
                </p>
              </div>

              <div className="md:justify-self-end">
                <h3 className="mb-4 text-xs font-medium text-white/85">联系我</h3>
                <ul className="space-y-2 text-xs text-white/45">
                  <li>邮箱：15638439536@163.com</li>
                  <li>微信：15638439536</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-24 text-[11px] text-text-tertiary md:flex-row md:items-center md:justify-between lg:px-0">
          <span>© 2026 Easy AI. All rights reserved.</span>
          <div className="flex items-center gap-5">
            <span>HOME</span>
            <span>CANVAS</span>
            <span>DESIGN</span>
          </div>
        </div>
      </footer>

      <FloatingEntryWidget
        storageKey="lovart-floating-entry-home-position"
        prompt={floatingPrompt}
        onPromptChange={setFloatingPrompt}
        onFilesAdd={handleFloatingFilesAdd}
        onPreviewImageRemove={handleFloatingImageRemove}
        onAttachmentRemove={handleFloatingAttachmentRemove}
        onSubmit={handleFloatingSubmit}
        canSubmit={Boolean(String(floatingPrompt || "").trim() || floatingAttachments.length)}
        isSubmitting={floatingIsGenerating}
        generationStage={getGenerationStageCopy(floatingGenerationStage)}
        entryMode={floatingEntryMode}
        messages={floatingMessages}
        historyItems={floatingHistory}
        previewImages={floatingRefImages}
        attachmentItems={floatingAttachments}
        onNewChat={handleFloatingNewChat}
        onSelectHistory={handleSelectFloatingHistory}
        onDeleteHistory={handleDeleteFloatingHistory}
        onDeleteMessage={handleFloatingDeleteMessage}
        onDeleteMessageImage={handleFloatingDeleteMessageImage}
        onRegenerateMessage={handleFloatingRegenerateMessage}
        onStopBatchWa={handleFloatingStopBatchWa}
        onExpandFullscreen={handleExpandFullscreen}
        outputError={floatingOutputError}
        outputIdleText={
          floatingEntryMode === "agent"
            ? "你可以直接提需求、问建议，或让它帮你生成图片。"
            : "一句话说出想法，它会自动判断是给建议还是直接出图。"
        }
        submitLabel="去生成"
      />

    </div>
  );
}
