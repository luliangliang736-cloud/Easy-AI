"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Star, X, GripHorizontal, Shuffle, Plus, Bookmark, Pencil, Check, ChevronsDownUp, ChevronsUpDown, SwatchBook, Palette, Paintbrush, Pipette, Maximize2, Minimize2, ImagePlus, Loader2 } from "lucide-react";
import { MATERIALS, MATERIAL_CATEGORIES, MATERIAL_PALETTES, isDiyMaterial } from "@/lib/materials";
import { CLOUD_STATE_RESTORED_EVENT } from "@/lib/useCloudLocalStorageSync";

const FAVORITES_KEY = "lovart-material-favorites";
const CUSTOM_PALETTES_KEY = "lovart-custom-palettes";
const COMBO_PRESETS_KEY = "lovart-combo-presets";
const CUSTOM_MATERIALS_KEY = "lovart-custom-materials";
const FAVORITES_TAB = "__favorites__";
const ALL_TAB = "__all__";
// DIY 材质：分类名 + 数量上限 + 新建草稿默认值
const DIY_CATEGORY = "我的材质";
const CUSTOM_MATERIALS_MAX = 50;
const DEFAULT_MATERIAL_DRAFT = { name: "", prompt: "", color: "#8ECFFF", thumb: "" };
const MIN_WIDTH = 340;
const MIN_HEIGHT = 240;
const MAX_WIDTH = 1100;
const MAX_HEIGHT = 960;
// 默认打开尺寸：大尺寸展示（材质区+配色库一屏可见），挂载时按画布可用空间收缩
const DEFAULT_SIZE = { w: 740, h: 940 };
// 一键放大的目标尺寸（会再按画布可用空间收缩）
const EXPANDED_SIZE = { w: 1024, h: 920 };
const COMBO_MAX = 7;
// DIY 配色的颜色总数上限（1 主色 + 最多 4 辅助色），数量由用户自由增删
const PALETTE_MAX_COLORS = 5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 两个 hex 颜色的 RGB 欧氏距离，用于取色时保证颜色有区分度 */
function colorDistance(hexA, hexB) {
  const parse = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(hexA);
  const [r2, g2, b2] = parse(hexB);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * 从图片提取主要颜色：缩到 64x64 采样，RGB 每通道量化到 16 级归桶计数，
 * 按占比取前 5 个且互相有区分度的颜色（第 1 个为主色）。纯前端完成。
 */
function extractPaletteFromImage(img) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, size, size);
  let data;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return [];
  }
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }
  const toHex = (value) => Math.round(value).toString(16).padStart(2, "0");
  const colors = [];
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  for (const bucket of sorted) {
    const hex = `#${toHex(bucket.r / bucket.count)}${toHex(bucket.g / bucket.count)}${toHex(bucket.b / bucket.count)}`.toUpperCase();
    if (colors.every((existing) => colorDistance(existing, hex) > 40)) colors.push(hex);
    if (colors.length >= PALETTE_MAX_COLORS) break;
  }
  return colors;
}

/** 把 hex 颜色向黑色方向压暗（ratio 0~1），用于 DIY 材质球的渐变暗部 */
function darkenColor(hex, ratio) {
  const value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#8ECFFF";
  const channel = (offset) =>
    Math.round(parseInt(value.slice(offset, offset + 2), 16) * (1 - ratio))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** DIY 材质没有贴图，用代表色生成一个 CSS 渐变材质球 */
function customMaterialBallStyle(color) {
  return {
    background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.88) 0%, ${color} 42%, ${darkenColor(color, 0.45)} 100%)`,
  };
}

/** 缩略图 URL 校验：只接受 http(s) 或站内路径，避免脏数据 */
function isValidThumbUrl(url) {
  return typeof url === "string" && (/^https?:\/\//i.test(url) || url.startsWith("/"));
}

/** localStorage 里的 DIY 材质数组过滤为合法条目 */
function sanitizeCustomMaterials(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m.id === "string" && typeof m.name === "string" && typeof m.prompt === "string")
    .map((m) => ({
      id: m.id,
      name: m.name,
      prompt: m.prompt,
      color: typeof m.color === "string" && /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : "#8ECFFF",
      thumb: isValidThumbUrl(m.thumb) ? m.thumb : "",
      category: DIY_CATEGORY,
    }))
    .slice(0, CUSTOM_MATERIALS_MAX);
}

/** AI 渲染 DIY 材质球的提示词：与官方材质球图库同一构图风格（浅灰棚拍 + 居中圆球） */
function buildMaterialBallPrompt(materialPrompt) {
  return `一颗完美的球体材质球，居中放置在浅灰色（#ECECEE）无缝摄影棚背景上，球体表面材质为：${materialPrompt}。3D商业产品渲染，柔光棚拍主光（大面积软箱），左上方向柔和高光，球体下方有柔和的接触投影，反射受控不过曝，背景干净无杂物，构图为正方形特写，球体占画面约65%。不要文字、不要水印、不要多余元素、不要复杂背景。`;
}

/**
 * 材质库浮窗：可拖拽、可调整大小，支持分类切换与收藏。
 * 点选材质球后不关闭，方便对同一批元素连续测试不同材质。
 */
export default function MaterialPanel({ selectedImage, onPick, onPickCombo, onClose, onSelectionChange, composerHasText = false, onComposerGenerate, composerText = "", onComposerTextChange }) {
  const panelRef = useRef(null);
  const extractImageInputRef = useRef(null);
  // pos 为 null 时使用默认停靠位置（工具栏上方居中），拖拽后切换为绝对坐标
  const [pos, setPos] = useState(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [isMaximized, setIsMaximized] = useState(false);
  // 最小化：收起成小胶囊条，不遮挡画布，点击即可展开
  const [isMinimized, setIsMinimized] = useState(false);
  // 放大前的位置和尺寸，用于点"还原"时恢复
  const restoreLayoutRef = useRef(null);
  const [activeTab, setActiveTab] = useState(ALL_TAB);
  const [favorites, setFavorites] = useState([]);
  const [favoritesReady, setFavoritesReady] = useState(false);
  // 统一选择模型：点材质球加入/移除选择列表,选 1 个走单材质生成,选 2 个及以上走组合生成,
  // 不再区分"单材质/组合探索"两种模式,用户选几个就是几个
  const [comboIds, setComboIds] = useState([]);
  const [paletteId, setPaletteId] = useState(null);
  // 自定义配色库：存独立 localStorage，与画布数据无关
  const [customPalettes, setCustomPalettes] = useState([]);
  const [customPalettesReady, setCustomPalettesReady] = useState(false);
  const [isPaletteEditorOpen, setIsPaletteEditorOpen] = useState(false);
  // 非空时表示正在编辑已保存的自定义配色（重命名/改色），否则为新建
  const [editingPaletteId, setEditingPaletteId] = useState(null);
  const [paletteDraft, setPaletteDraft] = useState({
    name: "",
    main: "#5338FF",
    aux: ["#C5FB00", "#1B1B23", "#FFFFFF"],
  });
  // DIY 材质库：用户自己写名称+材质描述（prompt），代表色用于生成 CSS 材质球
  const [customMaterials, setCustomMaterials] = useState([]);
  const [customMaterialsReady, setCustomMaterialsReady] = useState(false);
  const [isMaterialEditorOpen, setIsMaterialEditorOpen] = useState(false);
  // 非空表示正在编辑已保存的 DIY 材质，否则为新建
  const [editingMaterialId, setEditingMaterialId] = useState(null);
  const [materialDraft, setMaterialDraft] = useState(DEFAULT_MATERIAL_DRAFT);
  // AI 渲染材质球缩略图：生成中标记 + 错误提示
  const [isThumbGenerating, setIsThumbGenerating] = useState(false);
  const [thumbGenerateError, setThumbGenerateError] = useState("");
  // 组合预设库：材质 + 配色打包保存，可命名，独立 localStorage
  const [comboPresets, setComboPresets] = useState([]);
  const [comboPresetsReady, setComboPresetsReady] = useState(false);
  const [isPresetSaveOpen, setIsPresetSaveOpen] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  // 生成按钮旁的预设快捷浮层：点开直接选预设回填，缩短"选预设→生成"路径。
  // 浮层用 portal 挂在 body 上、弹在面板右侧（面板根节点 overflow-hidden，内部弹层会遮住面板内容）
  const [isPresetPickerOpen, setIsPresetPickerOpen] = useState(false);
  const [presetPickerPos, setPresetPickerPos] = useState(null);
  const presetPickerRef = useRef(null);
  const presetPopupRef = useRef(null);
  // 材质悬浮预览：hover 材质球稍作停留后在格子旁展示大图+名称+质感描述（portal 挂 body，避免被面板裁剪）
  const [materialPreview, setMaterialPreview] = useState(null);
  const materialPreviewTimerRef = useRef(null);
  // 预设编辑：铺满整个面板的覆盖层（小面板里嵌编辑器太局促），draft 为编辑中的副本（改名/增删材质/换配色）
  const [editingPresetId, setEditingPresetId] = useState(null);
  const [presetEditDraft, setPresetEditDraft] = useState({ name: "", materialIds: [], paletteId: null });

  // 打开时按画布可用空间收缩默认尺寸（默认停靠 bottom:80，顶部再留 16px 余量）
  useEffect(() => {
    const parent = panelRef.current?.offsetParent;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    setSize((prev) => ({
      w: clamp(Math.min(prev.w, Math.round(parentRect.width - 48)), MIN_WIDTH, MAX_WIDTH),
      h: clamp(Math.min(prev.h, Math.round(parentRect.height - 96)), MIN_HEIGHT, MAX_HEIGHT),
    }));
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      if (Array.isArray(saved)) setFavorites(saved.filter((id) => typeof id === "string"));
    } catch {}
    setFavoritesReady(true);
  }, []);

  useEffect(() => {
    if (!favoritesReady) return;
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch {}
  }, [favorites, favoritesReady]);

  const toggleFavorite = useCallback((materialId) => {
    setFavorites((prev) =>
      prev.includes(materialId) ? prev.filter((id) => id !== materialId) : [...prev, materialId],
    );
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_PALETTES_KEY) || "[]");
      if (Array.isArray(saved)) {
        setCustomPalettes(
          saved.filter((p) => p && typeof p.id === "string" && typeof p.main === "string" && Array.isArray(p.aux)),
        );
      }
    } catch {}
    setCustomPalettesReady(true);
  }, []);

  useEffect(() => {
    if (!customPalettesReady) return;
    try {
      localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(customPalettes));
    } catch {}
  }, [customPalettes, customPalettesReady]);

  const allPalettes = [...MATERIAL_PALETTES, ...customPalettes];

  useEffect(() => {
    try {
      setCustomMaterials(sanitizeCustomMaterials(JSON.parse(localStorage.getItem(CUSTOM_MATERIALS_KEY) || "[]")));
    } catch {}
    setCustomMaterialsReady(true);
  }, []);

  useEffect(() => {
    if (!customMaterialsReady) return;
    try {
      localStorage.setItem(CUSTOM_MATERIALS_KEY, JSON.stringify(customMaterials));
    } catch {}
  }, [customMaterials, customMaterialsReady]);

  // 官方材质 + DIY 材质的统一列表：单材质/组合/预设的查找都走这里
  const allMaterials = [...MATERIALS, ...customMaterials];

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COMBO_PRESETS_KEY) || "[]");
      if (Array.isArray(saved)) {
        setComboPresets(
          saved.filter((p) => p && typeof p.id === "string" && Array.isArray(p.materialIds)),
        );
      }
    } catch {}
    setComboPresetsReady(true);
  }, []);

  useEffect(() => {
    if (!comboPresetsReady) return;
    try {
      localStorage.setItem(COMBO_PRESETS_KEY, JSON.stringify(comboPresets));
    } catch {}
  }, [comboPresets, comboPresetsReady]);

  // 预设快捷浮层：点浮层外任意位置自动收起（预设编辑器是独立的全面板覆盖层，不受影响）
  useEffect(() => {
    if (!isPresetPickerOpen) return;
    function handlePointerDown(event) {
      const inTrigger = presetPickerRef.current?.contains(event.target);
      const inPopup = presetPopupRef.current?.contains(event.target);
      if (!inTrigger && !inPopup) setIsPresetPickerOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isPresetPickerOpen]);

  /** 打开预设浮层：优先弹在面板右侧，右侧放不下则弹左侧，底边与面板对齐 */
  const togglePresetPicker = useCallback(() => {
    setIsPresetPickerOpen((open) => {
      if (open) return false;
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!panelRect) return false;
      const POPUP_WIDTH = 288; // w-72
      const fitsRight = panelRect.right + 8 + POPUP_WIDTH <= window.innerWidth;
      setPresetPickerPos({
        left: fitsRight ? panelRect.right + 8 : Math.max(8, panelRect.left - POPUP_WIDTH - 8),
        bottom: Math.max(8, window.innerHeight - panelRect.bottom),
      });
      return true;
    });
  }, []);

  // 云端恢复完成后重新读取（面板已打开时也能拿到新设备同步下来的收藏/配色/预设）
  useEffect(() => {
    function handleCloudRestored(event) {
      const restoredKeys = Array.isArray(event?.detail?.keys) ? event.detail.keys : [];
      try {
        if (restoredKeys.includes(FAVORITES_KEY)) {
          const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
          if (Array.isArray(saved)) setFavorites(saved.filter((id) => typeof id === "string"));
        }
        if (restoredKeys.includes(CUSTOM_PALETTES_KEY)) {
          const saved = JSON.parse(localStorage.getItem(CUSTOM_PALETTES_KEY) || "[]");
          if (Array.isArray(saved)) {
            setCustomPalettes(saved.filter((p) => p && typeof p.id === "string" && typeof p.main === "string" && Array.isArray(p.aux)));
          }
        }
        if (restoredKeys.includes(COMBO_PRESETS_KEY)) {
          const saved = JSON.parse(localStorage.getItem(COMBO_PRESETS_KEY) || "[]");
          if (Array.isArray(saved)) {
            setComboPresets(saved.filter((p) => p && typeof p.id === "string" && Array.isArray(p.materialIds)));
          }
        }
        if (restoredKeys.includes(CUSTOM_MATERIALS_KEY)) {
          setCustomMaterials(sanitizeCustomMaterials(JSON.parse(localStorage.getItem(CUSTOM_MATERIALS_KEY) || "[]")));
        }
      } catch {}
    }
    window.addEventListener(CLOUD_STATE_RESTORED_EVENT, handleCloudRestored);
    return () => window.removeEventListener(CLOUD_STATE_RESTORED_EVENT, handleCloudRestored);
  }, []);

  /** 保存 DIY 材质：名称 + 材质描述必填；有 AI 材质球用图，否则用代表色渲染 */
  const handleSaveMaterialDraft = useCallback(() => {
    const name = materialDraft.name.trim();
    const prompt = materialDraft.prompt.trim();
    if (!name || !prompt) return;
    const thumb = isValidThumbUrl(materialDraft.thumb) ? materialDraft.thumb : "";
    if (editingMaterialId) {
      setCustomMaterials((prev) =>
        prev.map((m) => (m.id === editingMaterialId ? { ...m, name, prompt, color: materialDraft.color, thumb } : m)),
      );
    } else {
      if (customMaterials.length >= CUSTOM_MATERIALS_MAX) return;
      const newId = `diy-${Date.now()}`;
      setCustomMaterials((prev) => [
        ...prev,
        { id: newId, name, prompt, color: materialDraft.color, thumb, category: DIY_CATEGORY },
      ]);
      // 在预设编辑器里新建的材质，默认直接加进该预设（没超上限时）
      if (editingPresetId) {
        setPresetEditDraft((prev) =>
          prev.materialIds.length >= COMBO_MAX || prev.materialIds.includes(newId)
            ? prev
            : { ...prev, materialIds: [...prev.materialIds, newId] },
        );
      }
    }
    setIsMaterialEditorOpen(false);
    setEditingMaterialId(null);
    setMaterialDraft(DEFAULT_MATERIAL_DRAFT);
    setThumbGenerateError("");
  }, [customMaterials.length, editingMaterialId, editingPresetId, materialDraft]);

  /** 编辑已保存的 DIY 材质：预填草稿后打开编辑器 */
  const handleEditCustomMaterial = useCallback((material) => {
    setMaterialDraft({ name: material.name, prompt: material.prompt, color: material.color, thumb: material.thumb || "" });
    setEditingMaterialId(material.id);
    setIsMaterialEditorOpen(true);
    setThumbGenerateError("");
  }, []);

  /** AI 渲染材质球：按官方材质球同款棚拍构图生成一张 1:1 缩略图（走正常生图计费） */
  const handleGenerateMaterialThumb = useCallback(async () => {
    const prompt = materialDraft.prompt.trim();
    if (!prompt || isThumbGenerating) return;
    setIsThumbGenerating(true);
    setThumbGenerateError("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: buildMaterialBallPrompt(prompt),
          // 材质球缩略图用 Nano Banana 2 Lite：速度快、成本低，小图质量足够
          model: "gemini-3.1-flash-lite-image",
          image_size: "1:1",
          num: 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const url = Array.isArray(data?.data?.urls) ? data.data.urls.find(Boolean) : null;
      if (!res.ok || !url) {
        throw new Error(data?.error || "生成失败，请稍后重试");
      }
      // 生成完立即展示预览；云端转存放到后台做，完成后再把地址悄悄换成永久链接
      setMaterialDraft((prev) => ({ ...prev, thumb: url }));
      setIsThumbGenerating(false);
      void (async () => {
        try {
          const uploadRes = await fetch("/api/cloud-assets/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceUrl: url, filename: "diy-material-ball", scope: "material-thumb" }),
          });
          const uploadData = await uploadRes.json().catch(() => ({}));
          const stableUrl = uploadRes.ok && uploadData?.url ? uploadData.url : "";
          if (!stableUrl || stableUrl === url) return;
          // 草稿还没被改动/重新生成时才替换；已保存进材质列表的也一并替换
          setMaterialDraft((prev) => (prev.thumb === url ? { ...prev, thumb: stableUrl } : prev));
          setCustomMaterials((prev) =>
            prev.some((m) => m.thumb === url)
              ? prev.map((m) => (m.thumb === url ? { ...m, thumb: stableUrl } : m))
              : prev,
          );
        } catch {}
      })();
    } catch (error) {
      setThumbGenerateError(error?.message || "生成失败，请稍后重试");
      setIsThumbGenerating(false);
    }
  }, [isThumbGenerating, materialDraft.prompt]);

  /** 删除 DIY 材质：同时从收藏、当前勾选、单选里移除引用 */
  const handleDeleteCustomMaterial = useCallback((id) => {
    setCustomMaterials((prev) => prev.filter((m) => m.id !== id));
    setFavorites((prev) => prev.filter((fid) => fid !== id));
    setComboIds((prev) => prev.filter((cid) => cid !== id));
    setEditingMaterialId((current) => (current === id ? null : current));
  }, []);

  /** 把当前勾选的材质 + 配色存为命名预设（配色存快照，删除自定义配色也不影响预设）；单个材质也可以存 */
  const handleSaveComboPreset = useCallback(() => {
    if (comboIds.length < 1) return;
    const palette = allPalettes.find((p) => p.id === paletteId) || null;
    const name = presetNameDraft.trim() || `预设 ${comboPresets.length + 1}`;
    setComboPresets((prev) => [
      ...prev,
      {
        id: `preset-${Date.now()}`,
        name,
        materialIds: [...comboIds],
        palette: palette ? { id: palette.id, name: palette.name, main: palette.main, aux: [...palette.aux] } : null,
      },
    ]);
    setIsPresetSaveOpen(false);
    setPresetNameDraft("");
  }, [allPalettes, comboIds, comboPresets.length, paletteId, presetNameDraft]);

  /** 载入预设：回填材质勾选和配色；预设里的自定义配色被删过则自动恢复进配色库 */
  const handleLoadComboPreset = useCallback((preset) => {
    const knownMaterials = [...MATERIALS, ...customMaterials];
    setComboIds(preset.materialIds.filter((id) => knownMaterials.some((m) => m.id === id)));
    if (!preset.palette) {
      setPaletteId(null);
      return;
    }
    const exists = [...MATERIAL_PALETTES, ...customPalettes].some((p) => p.id === preset.palette.id);
    if (!exists) {
      setCustomPalettes((prev) => [...prev, { ...preset.palette, aux: [...preset.palette.aux] }]);
    }
    setPaletteId(preset.palette.id);
  }, [customMaterials, customPalettes]);

  const handleDeleteComboPreset = useCallback((id) => {
    setComboPresets((prev) => prev.filter((p) => p.id !== id));
    setEditingPresetId((current) => (current === id ? null : current));
  }, []);

  /** 打开预设编辑器（铺满面板的覆盖层），用预设内容初始化编辑副本 */
  const openPresetEditor = useCallback((preset) => {
    setPresetEditDraft({
      name: preset.name,
      materialIds: [...preset.materialIds],
      paletteId: preset.palette ? preset.palette.id : null,
    });
    setEditingPresetId(preset.id);
    setIsPresetPickerOpen(false);
    // 主面板里可能开着的 DIY 编辑器先收起，避免覆盖层里状态串台
    setIsMaterialEditorOpen(false);
    setEditingMaterialId(null);
    setIsPaletteEditorOpen(false);
    setEditingPaletteId(null);
  }, []);

  /** 关闭预设编辑器：连同覆盖层里开着的 DIY 材质/配色编辑器一起收起 */
  const closePresetEditor = useCallback(() => {
    setEditingPresetId(null);
    setIsMaterialEditorOpen(false);
    setEditingMaterialId(null);
    setIsPaletteEditorOpen(false);
    setEditingPaletteId(null);
  }, []);

  const togglePresetDraftMaterial = useCallback((materialId) => {
    setPresetEditDraft((prev) => {
      if (prev.materialIds.includes(materialId)) {
        return { ...prev, materialIds: prev.materialIds.filter((id) => id !== materialId) };
      }
      if (prev.materialIds.length >= COMBO_MAX) return prev;
      return { ...prev, materialIds: [...prev.materialIds, materialId] };
    });
  }, []);

  /** 保存预设修改：配色按编辑器当前选择重新取快照；没动配色则保留原快照 */
  const handleSavePresetEdit = useCallback((preset) => {
    if (presetEditDraft.materialIds.length < 1) return;
    const name = presetEditDraft.name.trim() || preset.name;
    let paletteSnapshot = null;
    if (presetEditDraft.paletteId) {
      if (preset.palette && presetEditDraft.paletteId === preset.palette.id) {
        paletteSnapshot = { ...preset.palette, aux: [...preset.palette.aux] };
      } else {
        const found = allPalettes.find((p) => p.id === presetEditDraft.paletteId);
        paletteSnapshot = found
          ? { id: found.id, name: found.name, main: found.main, aux: [...found.aux] }
          : null;
      }
    }
    setComboPresets((prev) =>
      prev.map((p) =>
        p.id === preset.id
          ? { ...p, name, materialIds: [...presetEditDraft.materialIds], palette: paletteSnapshot }
          : p,
      ),
    );
    closePresetEditor();
  }, [allPalettes, closePresetEditor, presetEditDraft]);

  const handleSavePaletteDraft = useCallback(() => {
    const name = paletteDraft.name.trim() || `自定义 ${customPalettes.length + 1}`;
    let savedId = editingPaletteId;
    if (editingPaletteId) {
      setCustomPalettes((prev) =>
        prev.map((p) =>
          p.id === editingPaletteId
            ? { ...p, name, main: paletteDraft.main, aux: [...paletteDraft.aux] }
            : p,
        ),
      );
    } else {
      savedId = `custom-${Date.now()}`;
      setCustomPalettes((prev) => [...prev, { id: savedId, name, main: paletteDraft.main, aux: [...paletteDraft.aux] }]);
    }
    // 在预设编辑器里保存的配色选进预设草稿，否则选进主面板的当前配色
    if (editingPresetId) {
      setPresetEditDraft((prev) => ({ ...prev, paletteId: savedId }));
    } else {
      setPaletteId(savedId);
    }
    setIsPaletteEditorOpen(false);
    setEditingPaletteId(null);
    setPaletteDraft((prev) => ({ ...prev, name: "" }));
  }, [customPalettes.length, editingPaletteId, editingPresetId, paletteDraft]);

  /** 上传图片自动提取配色：主色 = 占比最高，辅助色 = 其后各位（数量随提取结果 0~4 个），填入 DIY 编辑器供微调 */
  const handleExtractImageChange = useCallback((event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const colors = extractPaletteFromImage(img);
      if (colors.length === 0) return;
      const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 10);
      setPaletteDraft((prev) => ({
        ...prev,
        name: prev.name || baseName,
        main: colors[0],
        aux: colors.slice(1, PALETTE_MAX_COLORS),
      }));
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, []);

  /** DIY 编辑器：追加一个辅助色（总数上限 5 = 1 主色 + 4 辅助色） */
  const handleAddDraftAuxColor = useCallback(() => {
    setPaletteDraft((prev) => {
      if (prev.aux.length >= PALETTE_MAX_COLORS - 1) return prev;
      return { ...prev, aux: [...prev.aux, "#FFFFFF"] };
    });
  }, []);

  /** DIY 编辑器：删除指定辅助色（主色不可删，保证至少 1 种颜色） */
  const handleRemoveDraftAuxColor = useCallback((index) => {
    setPaletteDraft((prev) => ({ ...prev, aux: prev.aux.filter((_, i) => i !== index) }));
  }, []);

  /** 编辑已保存的自定义配色：预填名称和颜色后打开编辑器 */
  const handleEditCustomPalette = useCallback((palette) => {
    setPaletteDraft({ name: palette.name, main: palette.main, aux: [...palette.aux] });
    setEditingPaletteId(palette.id);
    setIsPaletteEditorOpen(true);
  }, []);

  const handleDeleteCustomPalette = useCallback((id) => {
    setCustomPalettes((prev) => prev.filter((p) => p.id !== id));
    setPaletteId((current) => (current === id ? null : current));
    setEditingPaletteId((current) => (current === id ? null : current));
  }, []);

  const toggleComboMaterial = useCallback((materialId) => {
    setComboIds((prev) => {
      if (prev.includes(materialId)) return prev.filter((id) => id !== materialId);
      // 组合生成不可用时退化为单选：点新材质直接替换当前选择
      if (!onPickCombo) return [materialId];
      if (prev.length >= COMBO_MAX) return prev;
      return [...prev, materialId];
    });
  }, [onPickCombo]);

  // 单选快捷手势的轻量反馈：双击/Ctrl+单击替换选择时短暂提示，避免用户没意识到组合被清空
  const [soloNotice, setSoloNotice] = useState(null);
  const soloNoticeTimerRef = useRef(null);
  useEffect(() => () => {
    if (soloNoticeTimerRef.current) clearTimeout(soloNoticeTimerRef.current);
  }, []);

  /** 仅使用某个材质（双击触发）：清空其它选择，只保留这一个 */
  const selectOnlyMaterial = useCallback((material) => {
    const alreadySolo = comboIds.length === 1 && comboIds[0] === material.id;
    setComboIds([material.id]);
    if (alreadySolo) return;
    if (soloNoticeTimerRef.current) clearTimeout(soloNoticeTimerRef.current);
    setSoloNotice(material.name);
    soloNoticeTimerRef.current = setTimeout(() => setSoloNotice(null), 1800);
  }, [comboIds]);

  /** 随机组合：从全部材质随机抽 3~5 个，配色从预设+自定义里随机（也可能保持原图配色） */
  const handleRandomCombo = useCallback(() => {
    const count = 3 + Math.floor(Math.random() * 3);
    const shuffled = [...MATERIALS].sort(() => Math.random() - 0.5);
    setComboIds(shuffled.slice(0, count).map((m) => m.id));
    const pool = [...MATERIAL_PALETTES, ...customPalettes];
    const paletteRoll = Math.floor(Math.random() * (pool.length + 1));
    setPaletteId(paletteRoll === pool.length ? null : pool[paletteRoll].id);
  }, [customPalettes]);

  const hasTarget = Boolean(selectedImage?.image_url);
  // 右侧输入框有文案时也可点选材质（发送时"文案 + 材质"直出），面板不再置灰
  const canUseComposerText = Boolean(composerHasText && onComposerGenerate);
  const canPick = hasTarget || canUseComposerText;

  // 面板内提示词输入框：超长文案折行溢出后亮出扩大按钮，点击加高方便编辑（与右侧输入框交互一致）
  const composerBoxRef = useRef(null);
  const [isComposerBoxExpanded, setIsComposerBoxExpanded] = useState(false);
  const [isComposerBoxMultiline, setIsComposerBoxMultiline] = useState(false);
  useEffect(() => {
    const el = composerBoxRef.current;
    if (!el) return;
    setIsComposerBoxMultiline(el.scrollHeight > el.clientHeight + 2);
  }, [composerText, isComposerBoxExpanded]);

  /** 统一生成入口：选 1 个材质走单材质改图,选 2 个及以上走组合分配生成；options 支持 { quality: "2k" } */
  const handleSubmit = useCallback((options = null) => {
    const materials = comboIds
      .map((id) => [...MATERIALS, ...customMaterials].find((m) => m.id === id))
      .filter(Boolean);
    if (materials.length === 0) return;
    // 没选画布图片但右侧有文案：走"文案 + 材质"直出（材质/配色由父级从选择上报里取）
    if (!hasTarget && composerHasText && onComposerGenerate) {
      onComposerGenerate(options);
      return;
    }
    const palette =
      [...MATERIAL_PALETTES, ...customPalettes].find((p) => p.id === paletteId) || null;
    if (materials.length === 1 || !onPickCombo) {
      onPick(materials[0], palette, options);
      return;
    }
    onPickCombo(materials, palette, options);
  }, [comboIds, composerHasText, customMaterials, customPalettes, hasTarget, onComposerGenerate, onPick, onPickCombo, paletteId]);

  /** 把面板当前位置固化为绝对坐标（拖拽/缩放前调用一次） */
  const capturePos = useCallback(() => {
    const panel = panelRef.current;
    const parent = panel?.offsetParent;
    if (!panel || !parent) return null;
    const rect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const captured = { x: rect.left - parentRect.left, y: rect.top - parentRect.top };
    setPos(captured);
    return { captured, parentRect, rect };
  }, []);

  const handleDragStart = useCallback((event) => {
    if (event.button !== 0) return;
    if (event.target.closest("[data-panel-nodrag]")) return;
    event.preventDefault();
    // 浮层位置跟随面板计算，面板一动就先收起，避免浮层悬在原地
    setIsPresetPickerOpen(false);
    const context = capturePos();
    if (!context) return;
    const { captured, parentRect, rect } = context;
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const handleMove = (moveEvent) => {
      setPos({
        x: clamp(moveEvent.clientX - parentRect.left - offsetX, 0, parentRect.width - rect.width),
        y: clamp(moveEvent.clientY - parentRect.top - offsetY, 0, parentRect.height - 40),
      });
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    void captured;
  }, [capturePos]);

  // 最小化胶囊的独立位置：默认顶部居中（一眼可见），拖拽只挪胶囊本身，
  // 不影响展开后大面板回到原来的位置
  const [minimizedPos, setMinimizedPos] = useState(null);

  const handleMinimizedDragStart = useCallback((event) => {
    if (event.button !== 0) return;
    if (event.target.closest("[data-panel-nodrag]")) return;
    event.preventDefault();
    const el = panelRef.current;
    const parent = el?.offsetParent;
    if (!el || !parent) return;
    const rect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    setMinimizedPos({ x: rect.left - parentRect.left, y: rect.top - parentRect.top });
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const handleMove = (moveEvent) => {
      setMinimizedPos({
        x: clamp(moveEvent.clientX - parentRect.left - offsetX, 0, parentRect.width - rect.width),
        y: clamp(moveEvent.clientY - parentRect.top - offsetY, 0, parentRect.height - rect.height),
      });
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, []);

  /** 一键放大到接近满画布（居中），再点一次还原到放大前的位置和尺寸 */
  const handleToggleMaximize = useCallback(() => {
    const parent = panelRef.current?.offsetParent;
    if (!parent) return;
    if (isMaximized && restoreLayoutRef.current) {
      const { pos: prevPos, size: prevSize } = restoreLayoutRef.current;
      setPos(prevPos);
      setSize(prevSize);
      setIsMaximized(false);
      return;
    }
    const parentRect = parent.getBoundingClientRect();
    restoreLayoutRef.current = { pos, size };
    const w = clamp(Math.round(parentRect.width - 48), MIN_WIDTH, EXPANDED_SIZE.w);
    const h = clamp(Math.round(parentRect.height - 48), MIN_HEIGHT, EXPANDED_SIZE.h);
    setSize({ w, h });
    setPos({
      x: Math.max(0, Math.round((parentRect.width - w) / 2)),
      y: Math.max(0, Math.round((parentRect.height - h) / 2)),
    });
    setIsMaximized(true);
  }, [isMaximized, pos, size]);

  /** 从最小化胶囊展开：位置钳回画布可视范围，避免胶囊贴边时展开后面板溢出 */
  const handleRestoreFromMinimized = useCallback(() => {
    setIsMinimized(false);
    const parent = panelRef.current?.offsetParent;
    if (parent && pos) {
      const parentRect = parent.getBoundingClientRect();
      setPos({
        x: clamp(pos.x, 0, Math.max(0, parentRect.width - size.w)),
        y: clamp(pos.y, 0, Math.max(0, parentRect.height - size.h)),
      });
    }
  }, [pos, size.h, size.w]);

  const handleResizeStart = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setIsPresetPickerOpen(false);
    setIsMaximized(false);
    capturePos();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = panelRef.current?.offsetWidth || size.w;
    const startH = panelRef.current?.offsetHeight || size.h;

    const handleMove = (moveEvent) => {
      setSize({
        w: clamp(startW + (moveEvent.clientX - startX), MIN_WIDTH, MAX_WIDTH),
        h: clamp(startH + (moveEvent.clientY - startY), MIN_HEIGHT, MAX_HEIGHT),
      });
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, [capturePos, size.h, size.w]);

  const tabs = [
    { id: ALL_TAB, label: "全部" },
    ...MATERIAL_CATEGORIES.map((category) => ({ id: category, label: category })),
    { id: FAVORITES_TAB, label: "材质收藏" },
  ];
  // 官方材质走分类 Tab；DIY 材质在下方独立板块展示（收藏 Tab 里两者都可出现）
  const visibleMaterials =
    activeTab === ALL_TAB
      ? MATERIALS
      : activeTab === FAVORITES_TAB
        ? allMaterials.filter((material) => favorites.includes(material.id))
        : MATERIALS.filter((material) => material.category === activeTab);
  // DIY 板块跟随官方材质列表展示（收藏 Tab 不显示）
  const showDiySection = activeTab !== FAVORITES_TAB;
  const selectedPalette = allPalettes.find((p) => p.id === paletteId) || null;
  const comboMaterials = comboIds
    .map((id) => allMaterials.find((m) => m.id === id))
    .filter(Boolean);
  // 只选 1 个材质时走单材质生成路径,底部按钮文案也按单材质展示
  const singleMaterial = comboMaterials.length === 1 ? comboMaterials[0] : null;

  // 把当前点选的材质/配色上报给父级：供右侧对话"文案 + 材质"直出使用（面板卸载时清空）
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    onSelectionChangeRef.current?.({
      materials: comboMaterials,
      palette: selectedPalette,
    });
    // comboIds/paletteId 是选择的最小来源，materials/palette 对象按需重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comboIds, paletteId, customMaterials, customPalettes]);
  useEffect(() => () => {
    onSelectionChangeRef.current?.(null);
  }, []);
  // 正在编辑的预设（编辑器铺满整个面板展示）
  const editingPreset = comboPresets.find((p) => p.id === editingPresetId) || null;

  /** 预设是否为"使用中"：当前勾选的材质（含顺序）和配色与预设完全一致；载入后一旦改动即自动取消高亮 */
  const isPresetActive = (preset) => {
    const ids = preset.materialIds.filter((id) => allMaterials.some((m) => m.id === id));
    if (ids.length === 0 || ids.length !== comboIds.length) return false;
    if (ids.some((id, index) => comboIds[index] !== id)) return false;
    return (preset.palette ? preset.palette.id : null) === paletteId;
  };

  /** hover 材质球 350ms 后弹出预览卡：优先出现在格子右侧，空间不够时换到左侧 */
  const showMaterialPreview = useCallback((material, element) => {
    if (materialPreviewTimerRef.current) clearTimeout(materialPreviewTimerRef.current);
    materialPreviewTimerRef.current = setTimeout(() => {
      if (!element?.isConnected) return;
      const rect = element.getBoundingClientRect();
      const CARD_W = 240;
      const CARD_H = 230;
      const left = rect.right + CARD_W + 12 > window.innerWidth
        ? Math.max(8, rect.left - CARD_W - 12)
        : rect.right + 12;
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - CARD_H - 8));
      setMaterialPreview({ material, left, top });
    }, 350);
  }, []);

  const hideMaterialPreview = useCallback(() => {
    if (materialPreviewTimerRef.current) clearTimeout(materialPreviewTimerRef.current);
    materialPreviewTimerRef.current = null;
    setMaterialPreview(null);
  }, []);

  useEffect(() => () => {
    if (materialPreviewTimerRef.current) clearTimeout(materialPreviewTimerRef.current);
  }, []);

  // 目标图悬浮预览：hover底部"目标图"胶囊稍作停留后放大展示选中的画布图，确认换材质的对象
  const [targetPreview, setTargetPreview] = useState(null);
  const targetPreviewTimerRef = useRef(null);

  const showTargetPreview = useCallback((element) => {
    if (targetPreviewTimerRef.current) clearTimeout(targetPreviewTimerRef.current);
    targetPreviewTimerRef.current = setTimeout(() => {
      if (!element?.isConnected) return;
      const rect = element.getBoundingClientRect();
      const CARD_W = 240;
      const CARD_H = 250;
      // 胶囊在面板底部，预览卡优先出现在胶囊上方，空间不够时放到下方
      const top = rect.top - CARD_H - 10 < 8 ? rect.bottom + 10 : rect.top - CARD_H - 10;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - CARD_W - 8));
      setTargetPreview({ left, top });
    }, 350);
  }, []);

  const hideTargetPreview = useCallback(() => {
    if (targetPreviewTimerRef.current) clearTimeout(targetPreviewTimerRef.current);
    targetPreviewTimerRef.current = null;
    setTargetPreview(null);
  }, []);

  useEffect(() => () => {
    if (targetPreviewTimerRef.current) clearTimeout(targetPreviewTimerRef.current);
  }, []);

  /** 材质缩略图：官方材质用贴图，DIY 材质渲染成"浅灰底 + 圆形材质球"，观感与官方一致 */
  const renderMaterialThumb = (material, className) =>
    material.thumb ? (
      <img
        src={material.thumb}
        alt={material.name}
        className={`${className} object-cover`}
        draggable={false}
      />
    ) : (
      <span
        aria-label={material.name}
        className={`${className} flex items-center justify-center`}
        style={{ backgroundColor: "#ECEDEF" }}
      >
        <span
          className="block h-[64%] w-[64%] rounded-full shadow-[0_0.35em_0.5em_-0.15em_rgba(0,0,0,0.3)]"
          style={customMaterialBallStyle(material.color)}
        />
      </span>
    );

  /** 材质格子：官方网格和 DIY 板块共用；DIY 材质带常显名称和编辑/删除按钮 */
  const renderMaterialTile = (material) => {
    const isCustomMaterial = isDiyMaterial(material);
    const isFavorite = favorites.includes(material.id);
    const comboIndex = comboIds.indexOf(material.id);
    const isComboSelected = comboIndex >= 0;
    return (
      <div
        key={material.id}
        className={`group/mat relative aspect-square overflow-hidden rounded-lg bg-bg-tertiary transition-all ${
          canPick ? "" : "opacity-45"
        } ${isComboSelected ? "ring-2 ring-accent" : ""}`}
        onMouseEnter={(e) => showMaterialPreview(material, e.currentTarget)}
        onMouseLeave={hideMaterialPreview}
      >
        <button
          type="button"
          onClick={() => toggleComboMaterial(material.id)}
          onDoubleClick={() => selectOnlyMaterial(material)}
          className="absolute inset-0 flex items-center justify-center"
        >
          {renderMaterialThumb(
            material,
            "h-full w-full transition-transform duration-150 group-hover/mat:scale-[1.06]",
          )}
        </button>
        {/* 底部名称：悬浮渐显（DIY 材质常显，方便区分） */}
        <span
          className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-3 text-center text-[10px] leading-none text-white transition-opacity ${
            isCustomMaterial ? "opacity-100" : "opacity-0 group-hover/mat:opacity-100"
          }`}
        >
          {material.name}
        </span>
        {/* 选中角标：只选 1 个显示对勾，多选显示序号 */}
        {isComboSelected && (
          <span className="pointer-events-none absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-white">
            {comboIds.length > 1 ? comboIndex + 1 : <Check size={12} strokeWidth={3} />}
          </span>
        )}
        {/* 收藏星标 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(material.id);
          }}
          className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md transition-all ${
            isFavorite
              ? "bg-black/45 text-[#FFD84D] opacity-100"
              : "bg-black/35 text-white/80 opacity-0 hover:text-white group-hover/mat:opacity-100"
          }`}
          title={isFavorite ? "取消收藏" : "收藏材质"}
          aria-label={isFavorite ? "取消收藏" : "收藏材质"}
        >
          <Star size={11} fill={isFavorite ? "currentColor" : "none"} />
        </button>
        {/* DIY 材质：悬浮显示编辑/删除 */}
        {isCustomMaterial && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleEditCustomMaterial(material);
              }}
              className="absolute right-1 top-7 flex h-5 w-5 items-center justify-center rounded-md bg-black/35 text-white/80 opacity-0 transition-all hover:text-white group-hover/mat:opacity-100"
              title="编辑该 DIY 材质"
              aria-label={`编辑材质 ${material.name}`}
            >
              <Pencil size={10} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteCustomMaterial(material.id);
              }}
              className="absolute right-1 top-[3.25rem] flex h-5 w-5 items-center justify-center rounded-md bg-black/35 text-white/80 opacity-0 transition-all hover:text-white group-hover/mat:opacity-100"
              title="删除该 DIY 材质"
              aria-label={`删除材质 ${material.name}`}
            >
              <X size={11} />
            </button>
          </>
        )}
      </div>
    );
  };

  /** 配色 chip：官方和 DIY 两行共用，自定义配色带编辑/删除按钮 */
  const renderPaletteChip = (palette) => {
    const isCustom = palette.id.startsWith("custom-");
    return (
      <div key={palette.id} className="group/palette relative">
        <button
          type="button"
          onClick={() => setPaletteId(palette.id)}
          title={`${palette.name}：${[palette.main, ...palette.aux].join(" ")}`}
          className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-colors ${
            paletteId === palette.id
              ? "bg-accent text-white"
              : "bg-bg-elevated text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
          }`}
        >
          <span className="flex items-center -space-x-1">
            <span
              className="h-3.5 w-3.5 rounded-full border border-black/10"
              style={{ backgroundColor: palette.main }}
            />
            {/* 色点数量跟随配色实际颜色数（1 主色 + 0~4 辅助色） */}
            {palette.aux.map((color, colorIndex) => (
              <span
                key={`${color}-${colorIndex}`}
                className="h-2.5 w-2.5 rounded-full border border-black/10"
                style={{ backgroundColor: color }}
              />
            ))}
          </span>
          {palette.name}
        </button>
        {isCustom && (
          <>
            <button
              type="button"
              onClick={() => handleEditCustomPalette(palette)}
              className="absolute -left-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover/palette:opacity-100"
              title="重命名 / 编辑该配色"
              aria-label={`编辑配色 ${palette.name}`}
            >
              <Pencil size={8} />
            </button>
            <button
              type="button"
              onClick={() => handleDeleteCustomPalette(palette.id)}
              className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover/palette:opacity-100"
              title="删除该自定义配色"
              aria-label={`删除配色 ${palette.name}`}
            >
              <X size={9} />
            </button>
          </>
        )}
      </div>
    );
  };

  /** DIY 材质编辑表单：主面板「我的材质」和预设编辑器里共用（同一时刻只渲染一处） */
  const renderMaterialEditorForm = () => (
    <div className="mb-2 rounded-xl border border-border-primary bg-bg-elevated/50 px-2.5 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="shrink-0 text-[10px] font-semibold text-text-secondary">
          {editingMaterialId ? "编辑材质" : "新建材质"}
        </span>
        <input
          type="text"
          value={materialDraft.name}
          onChange={(e) => setMaterialDraft((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="材质名称，如：磨砂玻璃"
          maxLength={10}
          autoFocus
          className="h-7 min-w-0 flex-1 rounded-lg bg-bg-secondary px-2 text-[11px] text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>
      <textarea
        value={materialDraft.prompt}
        onChange={(e) => setMaterialDraft((prev) => ({ ...prev, prompt: e.target.value }))}
        placeholder="只需描述材质本身，如：半透明磨砂玻璃质感，表面有细腻颗粒，边缘透光。光影、渲染风格和负面词会自动按官方预设补全"
        maxLength={300}
        rows={2}
        className="mb-1.5 w-full resize-none rounded-lg bg-bg-secondary px-2 py-1.5 text-[11px] leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary scrollbar-thin"
      />
      {/* AI 材质球预览：生成后替代代表色渐变球 */}
      {materialDraft.thumb && (
        <div className="mb-1.5 flex items-center gap-2">
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border-primary">
            <img src={materialDraft.thumb} alt="AI 材质球预览" className="h-full w-full object-cover" draggable={false} />
            <button
              type="button"
              onClick={() => setMaterialDraft((prev) => ({ ...prev, thumb: "" }))}
              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/80"
              title="移除 AI 材质球，改用代表色渐变球"
              aria-label="移除 AI 材质球"
            >
              <X size={9} />
            </button>
          </span>
          <span className="text-[10px] leading-relaxed text-text-tertiary">
            AI 材质球已生成，保存后即按此展示；不满意可点右侧按钮重新生成
          </span>
        </div>
      )}
      {thumbGenerateError && (
        <p className="mb-1.5 text-[10px] text-red-400">{thumbGenerateError}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={handleSaveMaterialDraft}
          disabled={!materialDraft.name.trim() || !materialDraft.prompt.trim() || isThumbGenerating}
          className="flex h-7 items-center rounded-lg bg-accent px-3 text-[11px] font-semibold text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-bg-tertiary disabled:text-text-tertiary"
        >
          {editingMaterialId ? "保存修改" : "保存材质"}
        </button>
        <button
          type="button"
          onClick={handleGenerateMaterialThumb}
          disabled={!materialDraft.prompt.trim() || isThumbGenerating}
          className="flex h-7 items-center gap-1 rounded-lg bg-bg-elevated px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
          title="按材质描述 AI 渲染一颗真实材质球做缩略图（消耗一次生图积分）"
        >
          {isThumbGenerating ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />}
          {isThumbGenerating ? "渲染中…" : materialDraft.thumb ? "重新生成缩略图" : "生成材质球缩略图"}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsMaterialEditorOpen(false);
            setEditingMaterialId(null);
            setMaterialDraft(DEFAULT_MATERIAL_DRAFT);
            setThumbGenerateError("");
          }}
          className="flex h-7 items-center rounded-lg px-2.5 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          取消
        </button>
      </div>
    </div>
  );

  /** DIY 配色编辑表单：主面板「配色库」和预设编辑器里共用（同一时刻只渲染一处） */
  const renderPaletteEditorForm = () => (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border-primary bg-bg-elevated/50 px-2.5 py-2">
      <span className="shrink-0 text-[10px] font-semibold text-text-secondary">
        {editingPaletteId ? "编辑配色" : "新建配色"}
      </span>
      <input
        type="text"
        value={paletteDraft.name}
        onChange={(e) => setPaletteDraft((prev) => ({ ...prev, name: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSavePaletteDraft();
        }}
        placeholder="起个名字，如：品牌色"
        maxLength={10}
        autoFocus
        className="h-7 w-32 min-w-0 flex-1 rounded-lg bg-bg-secondary px-2 text-[11px] text-text-primary outline-none placeholder:text-text-tertiary"
      />
      <label className="flex items-center gap-1 text-[10px] text-text-tertiary" title="主色">
        主
        <input
          type="color"
          value={paletteDraft.main}
          onChange={(e) => setPaletteDraft((prev) => ({ ...prev, main: e.target.value }))}
          className="palette-color-input h-6 w-7 cursor-pointer"
        />
      </label>
      {paletteDraft.aux.map((color, index) => (
        <span key={index} className="group/auxcolor relative flex items-center">
          <label className="flex items-center gap-1 text-[10px] text-text-tertiary" title={`辅助色 ${index + 1}`}>
            辅{index + 1}
            <input
              type="color"
              value={color}
              onChange={(e) =>
                setPaletteDraft((prev) => ({
                  ...prev,
                  aux: prev.aux.map((c, i) => (i === index ? e.target.value : c)),
                }))
              }
              className="palette-color-input h-6 w-7 cursor-pointer"
            />
          </label>
          <button
            type="button"
            onClick={() => handleRemoveDraftAuxColor(index)}
            className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover/auxcolor:opacity-100"
            title={`删除辅助色 ${index + 1}`}
            aria-label={`删除辅助色 ${index + 1}`}
          >
            <X size={8} />
          </button>
        </span>
      ))}
      {paletteDraft.aux.length < PALETTE_MAX_COLORS - 1 && (
        <button
          type="button"
          onClick={handleAddDraftAuxColor}
          className="flex h-6 w-6 items-center justify-center rounded-lg bg-bg-secondary text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          title={`添加辅助色（共 ${paletteDraft.aux.length + 1}/${PALETTE_MAX_COLORS} 种颜色）`}
          aria-label="添加辅助色"
        >
          <Plus size={11} />
        </button>
      )}
      <button
        type="button"
        onClick={() => extractImageInputRef.current?.click()}
        className="flex h-7 items-center gap-1 whitespace-nowrap rounded-lg bg-bg-elevated px-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        title="上传一张图片，按颜色占比自动提取主色和辅助色"
      >
        <Pipette size={11} />
        从图片提取
      </button>
      <input
        ref={extractImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleExtractImageChange}
      />
      <button
        type="button"
        onClick={handleSavePaletteDraft}
        className="ml-auto flex h-7 items-center rounded-lg bg-accent px-2.5 text-[11px] font-semibold text-white transition-all hover:bg-accent-hover"
      >
        {editingPaletteId ? "保存修改" : "保存到配色库"}
      </button>
    </div>
  );

  // 最小化状态：只留一个小胶囊条（可拖拽），点标题或展开按钮恢复
  if (isMinimized) {
    const selectionCount = comboIds.length;
    return (
      <div
        ref={panelRef}
        data-material-picker-root
        className="absolute z-30 flex cursor-grab items-center gap-1 rounded-full border border-black/10 bg-accent py-1 pl-2.5 pr-1 shadow-md shadow-black/10 active:cursor-grabbing"
        style={minimizedPos ? { left: minimizedPos.x, top: minimizedPos.y } : { top: 12, left: "50%", transform: "translateX(-50%)" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          handleMinimizedDragStart(e);
        }}
      >
        <GripHorizontal size={12} className="shrink-0 text-white/60" />
        <button
          type="button"
          data-panel-nodrag
          onClick={handleRestoreFromMinimized}
          className="flex items-center gap-1.5 rounded-full px-1 text-[12px] font-semibold text-white"
          title="展开材质库"
        >
          材质库
          {selectionCount > 0 && (
            <span className="rounded-full bg-white/25 px-1.5 py-px text-[10px] font-bold text-white">
              {selectionCount}
            </span>
          )}
        </button>
        <button
          type="button"
          data-panel-nodrag
          onClick={handleRestoreFromMinimized}
          className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          aria-label="展开材质库"
        >
          <ChevronsUpDown size={12} />
        </button>
        <button
          type="button"
          data-panel-nodrag
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          aria-label="关闭材质库"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      data-material-picker-root
      className="absolute z-30 flex flex-col overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
      style={{
        width: size.w,
        height: size.h,
        ...(pos
          ? { left: pos.x, top: pos.y }
          : { bottom: 80, left: "50%", transform: "translateX(-50%)" }),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 标题栏：拖拽把手，底部分隔线与内容区隔开 */}
      <div
        className="flex shrink-0 cursor-grab items-center justify-between gap-2 border-b border-border-primary px-3.5 py-1.5 active:cursor-grabbing"
        onPointerDown={handleDragStart}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <GripHorizontal size={13} className="shrink-0 text-text-tertiary" />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-panel-nodrag
            onClick={() => setIsMinimized(true)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title="收起为小胶囊，不遮挡画布"
            aria-label="收起材质库"
          >
            <ChevronsDownUp size={13} />
          </button>
          <button
            type="button"
            data-panel-nodrag
            onClick={handleToggleMaximize}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title={isMaximized ? "还原面板大小" : "放大面板，一次看全材质和配色"}
            aria-label={isMaximized ? "还原材质库大小" : "放大材质库"}
          >
            {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            type="button"
            data-panel-nodrag
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            aria-label="关闭材质库"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* 预设材质标题行：与下方「我的材质」板块同一格式（icon + 标题 + 提示） */}
      <div className="flex shrink-0 items-center gap-1.5 px-3.5 pb-2 pt-2.5" data-panel-nodrag>
        <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-text-primary">
          <SwatchBook size={12} className="shrink-0" />
          预设材质
        </span>
        <span className="truncate text-[11px] text-text-tertiary">
          {!hasTarget
            ? canUseComposerText
              ? "· 已输入文案，点选材质后即可按文案+材质生成"
              : "· 请先选中一张图片，或在下方输入文案"
            : onPickCombo
              ? "· 点选可多选分配到不同元素，双击仅选这一个"
              : "· 点选材质球，再点底部按钮生成"}
        </span>
      </div>

      {/* 分类 Tab */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-3.5 pb-2.5" data-panel-nodrag>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold transition-colors ${
              activeTab === tab.id
                ? "bg-accent text-white"
                : "font-medium text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
            }`}
          >
            {tab.id === FAVORITES_TAB && (
              <Star size={10} className="shrink-0" fill={activeTab === tab.id ? "currentColor" : "none"} />
            )}
            {tab.label}
            {tab.id === FAVORITES_TAB && favorites.length > 0 ? ` ${favorites.length}` : ""}
          </button>
        ))}
      </div>

      {/* 材质网格：参考材质库软件的紧凑方格布局 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3.5 scrollbar-thin" data-panel-nodrag>
        {visibleMaterials.length === 0 && activeTab === FAVORITES_TAB ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-text-tertiary">
            <Star size={22} strokeWidth={1.5} />
            <p className="text-[11px]">还没有收藏的材质，悬浮材质球点星标即可收藏</p>
          </div>
        ) : (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}
          >
            {visibleMaterials.map(renderMaterialTile)}
          </div>
        )}
      </div>

      {/* ===== 我的材质（DIY）：固定板块不随材质区滚动，小屏也始终可见 ===== */}
      {showDiySection && (
        <div className="shrink-0 border-t border-border-primary px-3.5 pb-2.5 pt-2.5" data-panel-nodrag>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-text-primary">
              <Paintbrush size={12} className="shrink-0" />
              我的材质
              {customMaterials.length > 0 ? ` ${customMaterials.length}` : ""}
            </span>
            <span className="truncate text-[10px] text-text-tertiary">
              · 只需描述材质本身，光影和渲染风格自动对齐官方预设
            </span>
          </div>

          {/* DIY 材质编辑器：名称 + 材质描述（prompt）+ 代表色（预设编辑器打开时改在覆盖层里渲染） */}
          {isMaterialEditorOpen && !editingPreset && renderMaterialEditorForm()}

          {/* DIY 材质列表：最多显示约两行，超出在板块内滚动，不挤占官方材质区 */}
          <div
            className="grid max-h-[170px] gap-1.5 overflow-y-auto scrollbar-thin"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}
          >
            {customMaterials.map(renderMaterialTile)}
            {/* 新建 DIY 材质入口 */}
            {customMaterials.length < CUSTOM_MATERIALS_MAX && (
              <button
                type="button"
                onClick={() => {
                  setEditingMaterialId(null);
                  setMaterialDraft(DEFAULT_MATERIAL_DRAFT);
                  setIsMaterialEditorOpen((open) => !open);
                }}
                className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed transition-colors ${
                  isMaterialEditorOpen
                    ? "border-accent text-text-primary"
                    : "border-border-primary text-text-tertiary hover:border-accent hover:text-text-primary"
                }`}
                title="DIY 一个自定义材质"
              >
                <Plus size={16} />
                <span className="text-[10px] font-medium">DIY 材质</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===== 配色区：与所选材质一起应用 ===== */}
      <div className="shrink-0 border-t border-border-primary px-3.5 pb-3 pt-2.5" data-panel-nodrag>
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-text-primary">配色库</span>
            <span className="truncate text-[11px] text-text-tertiary">
              · 可选：生成时同时应用所选配色，也可 DIY 保存
            </span>
          </div>
          {/* 第一层：原图配色 + 官方预设 */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="flex w-[70px] shrink-0 items-center gap-1 text-[11px] font-semibold text-text-secondary">
              <Palette size={12} className="shrink-0" />
              官方配色
            </span>
            <button
              type="button"
              onClick={() => setPaletteId(null)}
              className={`flex h-7 items-center rounded-lg px-2 text-[11px] font-medium transition-colors ${
                paletteId === null
                  ? "bg-accent text-white"
                  : "bg-bg-elevated text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              原图配色
            </button>
            {MATERIAL_PALETTES.map(renderPaletteChip)}
          </div>

          {/* 第二层：DIY 自定义配色 */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="flex w-[70px] shrink-0 items-center gap-1 text-[11px] font-semibold text-text-secondary">
              <Paintbrush size={12} className="shrink-0" />
              我的配色
            </span>
            {customPalettes.map(renderPaletteChip)}
            <button
              type="button"
              onClick={() => {
                setIsPaletteEditorOpen((open) => !open);
                setEditingPaletteId(null);
              }}
              className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors ${
                isPaletteEditorOpen
                  ? "bg-accent text-white"
                  : "bg-bg-elevated text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
              }`}
              title="DIY 一套配色并保存"
            >
              <Plus size={11} />
              DIY
            </button>
            {customPalettes.length === 0 && (
              <span className="text-[10px] text-text-tertiary">还没有自定义配色，点 DIY 创建</span>
            )}
          </div>

          {/* 自定义配色编辑器（预设编辑器打开时改在覆盖层里渲染） */}
          {isPaletteEditorOpen && !editingPreset && renderPaletteEditorForm()}
      </div>

      {/* ===== 生成区：当前选择总览 + 操作按钮（选 1 个走单材质生成，选多个走组合生成） ===== */}
      <div className="shrink-0 border-t border-border-primary px-3.5 pb-3 pt-2.5" data-panel-nodrag>
        {/* 选择总览：让用户随时看清选了哪些材质和配色 */}
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-[12px] font-semibold text-text-primary">当前选择</span>
          <span className="truncate text-[10px] text-text-tertiary">
            {comboMaterials.length > 0
              ? `${comboMaterials.length} 个材质 · ${selectedPalette ? selectedPalette.name : "原图配色"}`
              : "还未点选材质"}
          </span>
        </div>
        {comboMaterials.length === 0 ? (
          <div className="mb-2.5 flex items-start gap-1.5">
            {hasTarget && selectedImage?.media_type !== "video" && (
              <span
                className="flex shrink-0 items-center gap-1 rounded-lg bg-bg-elevated py-0.5 pl-0.5 pr-1.5 text-[10px] text-text-secondary"
                onMouseEnter={(e) => showTargetPreview(e.currentTarget)}
                onMouseLeave={hideTargetPreview}
              >
                <span className="block h-5 w-5 overflow-hidden rounded">
                  <img
                    src={selectedImage.image_url}
                    alt="选中的目标图"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </span>
                目标图
              </span>
            )}
            <span className="text-[10px] leading-relaxed text-text-tertiary">
              在上方材质库点击材质球选择（可多选，多个材质会分配到不同元素），配色在上方配色库选择（可选）
            </span>
          </div>
        ) : (
          <div className="mb-2.5 flex flex-wrap items-center gap-1">
            {/* 目标图放在最前：明确材质会应用到画布上的哪张图，hover 放大预览 */}
            {hasTarget && selectedImage?.media_type !== "video" && (
              <span
                className="flex shrink-0 items-center gap-1 rounded-lg bg-bg-elevated py-0.5 pl-0.5 pr-1.5 text-[10px] text-text-secondary"
                onMouseEnter={(e) => showTargetPreview(e.currentTarget)}
                onMouseLeave={hideTargetPreview}
              >
                <span className="block h-5 w-5 overflow-hidden rounded">
                  <img
                    src={selectedImage.image_url}
                    alt="选中的目标图"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </span>
                目标图
              </span>
            )}
            {comboMaterials.map((material, index) => (
              <span
                key={material.id}
                className="flex items-center gap-1 rounded-lg bg-bg-elevated py-0.5 pl-0.5 pr-1 text-[10px] text-text-secondary"
              >
                <span className="relative">
                  <span className="block h-5 w-5 overflow-hidden rounded">
                    {renderMaterialThumb(material, "h-full w-full")}
                  </span>
                  {comboMaterials.length > 1 && (
                    <span className="absolute -left-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-accent text-[8px] font-bold text-white">
                      {index + 1}
                    </span>
                  )}
                </span>
                {material.name}
                <button
                  type="button"
                  onClick={() => toggleComboMaterial(material.id)}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
                  title={`移除「${material.name}」`}
                  aria-label={`移除材质 ${material.name}`}
                >
                  <X size={8} />
                </button>
              </span>
            ))}
            <span className="flex items-center gap-1 rounded-lg bg-bg-elevated px-1.5 py-1 text-[10px] text-text-secondary">
              {selectedPalette ? (
                <>
                  <span className="flex items-center -space-x-0.5">
                    <span
                      className="h-3 w-3 rounded-full border border-black/10"
                      style={{ backgroundColor: selectedPalette.main }}
                    />
                    {selectedPalette.aux.map((color, colorIndex) => (
                      <span
                        key={`${color}-${colorIndex}`}
                        className="h-2.5 w-2.5 rounded-full border border-black/10"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                  {selectedPalette.name}
                </>
              ) : (
                "原图配色"
              )}
            </span>
          </div>
        )}

        {/* 面板内提示词输入：与右侧对话输入框共享同一份文案（双向同步），
            无选中图时「文案 + 材质」直出可全程在面板内完成 */}
        {typeof onComposerTextChange === "function" && (
          <div className="relative mb-2.5">
            <textarea
              ref={composerBoxRef}
              value={composerText}
              onChange={(e) => onComposerTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing) {
                  e.preventDefault();
                  if (comboMaterials.length > 0 && canPick) handleSubmit();
                }
              }}
              placeholder={hasTarget
                ? "提示词与右侧输入框实时同步（材质改图按选中图进行，不使用文案）"
                : "描述想生成的画面，点选材质后回车直接生成"}
              rows={2}
              className={`block w-full resize-none overflow-y-auto rounded-xl border border-border-primary bg-bg-secondary py-2 pl-2.5 pr-8 text-[12px] leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent/60 ${
                isComposerBoxExpanded ? "h-[28vh]" : "h-[56px]"
              }`}
            />
            {/* 长提示词编辑加高开关：内容溢出两行后才出现，与右侧输入框交互一致 */}
            {(isComposerBoxExpanded || isComposerBoxMultiline) && (
              <button
                type="button"
                onClick={() => setIsComposerBoxExpanded((v) => !v)}
                className="absolute right-1.5 top-1.5 rounded-lg p-1 text-text-tertiary transition-all hover:bg-bg-hover hover:text-text-primary"
                title={isComposerBoxExpanded ? "还原输入框高度" : "扩大输入框，方便编辑长提示词"}
              >
                {isComposerBoxExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
            )}
          </div>
        )}

        {/* 存为预设：命名后出现在生成按钮旁的「预设」浮层里，单个材质也可以存 */}
        {isPresetSaveOpen && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-border-primary bg-bg-elevated/50 px-2.5 py-2">
            <Bookmark size={13} className="shrink-0 text-text-tertiary" />
            <input
              type="text"
              value={presetNameDraft}
              onChange={(e) => setPresetNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveComboPreset();
              }}
              placeholder="预设名称（如：品牌主视觉）"
              maxLength={12}
              autoFocus
              className="h-7 min-w-0 flex-1 rounded-lg bg-bg-secondary px-2 text-[11px] text-text-primary outline-none placeholder:text-text-tertiary"
            />
            <button
              type="button"
              onClick={handleSaveComboPreset}
              className="flex h-7 shrink-0 items-center rounded-lg bg-accent px-2.5 text-[11px] font-semibold text-white transition-all hover:bg-accent-hover"
            >
              保存
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {onPickCombo && (
            <button
              type="button"
              onClick={handleRandomCombo}
              className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-bg-elevated px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              title="随机抽 3~5 个材质和一个配色方案"
            >
              <Shuffle size={13} />
              随机
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsPresetSaveOpen((open) => !open)}
            disabled={comboIds.length < 1}
            className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              isPresetSaveOpen
                ? "bg-accent text-white"
                : "bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
            title="把当前材质+配色保存为命名预设（单个材质也可以）"
          >
            <Bookmark size={13} />
            存为预设
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={!canPick || comboMaterials.length === 0}
            className="flex h-8 min-w-[110px] flex-1 items-center justify-center whitespace-nowrap rounded-xl bg-accent px-3 text-[12px] font-semibold text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-bg-tertiary disabled:text-text-tertiary"
            title={
              comboMaterials.length === 0
                ? "先在上方点选材质球"
                : !hasTarget && canUseComposerText
                  ? "按右侧输入的文案 + 所选材质生成"
                  : singleMaterial
                    ? selectedPalette
                      ? `按「${singleMaterial.name}」材质和「${selectedPalette.name}」配色生成`
                      : `按「${singleMaterial.name}」材质生成（保持原图配色）`
                    : paletteId
                      ? "按选中的材质和配色生成"
                      : "按选中的材质生成（保持原图配色）"
            }
          >
            {comboMaterials.length === 0
              ? "先点选材质"
              : !hasTarget && canUseComposerText
                ? `按文案生成（${comboMaterials.length} 材质）`
                : singleMaterial
                  ? `生成（${singleMaterial.name}）`
                  : `生成组合（${comboMaterials.length}）`}
          </button>
          {/* 2K 直出：走 Pro 2K 模型，不改全局模型选择，适合定稿出高清图 */}
          <button
            type="button"
            onClick={() => handleSubmit({ quality: "2k" })}
            disabled={!canPick || comboMaterials.length === 0}
            className="flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-accent/60 px-3 text-[12px] font-semibold text-accent transition-all hover:bg-accent/12 disabled:cursor-not-allowed disabled:border-border-primary disabled:text-text-tertiary [html[data-theme=light]_&]:text-[#111827] [html[data-theme=light]_&]:disabled:text-text-tertiary"
            title="用 Pro 2K 模型直出高清图（更清晰，生成稍慢）"
          >
            生成 2K
          </button>
          {/* 预设快捷入口：紧挨生成按钮，点开选预设→回填材质和配色→直接点生成 */}
          {comboPresets.length > 0 && (
            <div ref={presetPickerRef} className="relative shrink-0">
              <button
                type="button"
                onClick={togglePresetPicker}
                className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[12px] font-medium transition-colors ${
                  isPresetPickerOpen
                    ? "bg-accent text-white"
                    : "bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
                title="从已保存的预设中快速选择材质和配色"
              >
                <Bookmark size={13} fill={isPresetPickerOpen ? "currentColor" : "none"} />
                我的预设
              </button>
              {isPresetPickerOpen && presetPickerPos && createPortal(
                <div
                  ref={presetPopupRef}
                  className="fixed z-50 w-72 overflow-hidden rounded-xl border border-border-primary bg-bg-secondary shadow-2xl shadow-black/40"
                  style={{ left: presetPickerPos.left, bottom: presetPickerPos.bottom }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div className="max-h-80 overflow-y-auto py-1 scrollbar-thin">
                    {comboPresets.map((preset) => {
                      const presetMaterials = preset.materialIds
                        .map((id) => allMaterials.find((m) => m.id === id))
                        .filter(Boolean);
                      const isActive = isPresetActive(preset);
                      return (
                        <div
                          key={preset.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            handleLoadComboPreset(preset);
                            setIsPresetPickerOpen(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              handleLoadComboPreset(preset);
                              setIsPresetPickerOpen(false);
                            }
                          }}
                          className={`group/pitem flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-bg-hover ${
                            isActive ? "bg-bg-elevated" : ""
                          }`}
                          title={`载入预设「${preset.name}」`}
                        >
                          <span className="flex shrink-0 items-center -space-x-1.5">
                            {presetMaterials.slice(0, 3).map((material) => (
                              <span
                                key={material.id}
                                className="block h-5 w-5 overflow-hidden rounded-full border border-border-primary"
                              >
                                {renderMaterialThumb(material, "h-full w-full")}
                              </span>
                            ))}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-medium text-text-primary">{preset.name}</span>
                            <span className="block truncate text-[10px] text-text-tertiary">
                              {presetMaterials.length} 材质 · {preset.palette ? preset.palette.name : "原图配色"}
                            </span>
                          </span>
                          {preset.palette && (
                            <span className="flex shrink-0 items-center -space-x-0.5 group-hover/pitem:hidden">
                              <span
                                className="h-3 w-3 rounded-full border border-black/10"
                                style={{ backgroundColor: preset.palette.main }}
                              />
                              {preset.palette.aux.slice(0, 2).map((color, colorIndex) => (
                                <span
                                  key={`${color}-${colorIndex}`}
                                  className="h-2.5 w-2.5 rounded-full border border-black/10"
                                  style={{ backgroundColor: color }}
                                />
                              ))}
                            </span>
                          )}
                          {isActive && (
                            <Check size={12} className="shrink-0 text-accent group-hover/pitem:hidden" strokeWidth={3} />
                          )}
                          {/* 悬浮显示：编辑 / 删除 */}
                          <span className="hidden shrink-0 items-center gap-0.5 group-hover/pitem:flex">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openPresetEditor(preset);
                              }}
                              className="flex h-5 w-5 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                              title="编辑该预设（改名/增删材质/换配色）"
                              aria-label={`编辑预设 ${preset.name}`}
                            >
                              <Pencil size={10} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteComboPreset(preset.id);
                              }}
                              className="flex h-5 w-5 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                              title="删除该预设"
                              aria-label={`删除预设 ${preset.name}`}
                            >
                              <X size={11} />
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-border-primary py-1 text-center text-[9px] text-text-tertiary">
                    点选预设直接套用 · 悬浮可编辑或删除
                  </div>
                </div>,
                document.body,
              )}
            </div>
          )}
          {comboIds.length > 0 && (
            <button
              type="button"
              onClick={() => setComboIds([])}
              className="flex h-8 shrink-0 items-center whitespace-nowrap rounded-xl px-2.5 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              清空
            </button>
          )}
        </div>
      </div>

      {/* ===== 预设编辑覆盖层：铺满整个面板，小屏也有足够操作空间 ===== */}
      {editingPreset && (() => {
        // 预设里的配色可能是已删除的自定义配色，把它的快照也作为可选项
        const editorPalettes =
          editingPreset.palette && !allPalettes.some((p) => p.id === editingPreset.palette.id)
            ? [editingPreset.palette, ...allPalettes]
            : allPalettes;
        return (
          <div
            className="absolute inset-0 z-40 flex flex-col bg-bg-secondary"
            data-panel-nodrag
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-primary px-3.5 py-2.5">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-text-primary">
                <Bookmark size={13} className="shrink-0" />
                编辑预设
              </span>
              <button
                type="button"
                onClick={closePresetEditor}
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
                aria-label="关闭预设编辑"
              >
                <X size={13} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 scrollbar-thin">
              <div className="mb-3 flex items-center gap-2">
                <span className="shrink-0 text-[11px] font-semibold text-text-secondary">名称</span>
                <input
                  type="text"
                  value={presetEditDraft.name}
                  onChange={(e) => setPresetEditDraft((prev) => ({ ...prev, name: e.target.value }))}
                  maxLength={12}
                  className="h-8 min-w-0 flex-1 rounded-lg bg-bg-elevated px-2.5 text-[12px] text-text-primary outline-none placeholder:text-text-tertiary"
                />
              </div>
              <div className="mb-1.5 text-[11px] font-semibold text-text-secondary">
                材质（{presetEditDraft.materialIds.length}/{COMBO_MAX}，点击增删；DIY 材质悬浮可编辑）
              </div>
              {/* DIY 材质编辑器：在覆盖层里也能直接改材质描述或新建材质 */}
              {isMaterialEditorOpen && renderMaterialEditorForm()}
              <div
                className="mb-3 grid gap-1.5"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))" }}
              >
                {allMaterials.map((material) => {
                  const draftIndex = presetEditDraft.materialIds.indexOf(material.id);
                  const isDraftSelected = draftIndex >= 0;
                  const isCustomMaterial = isDiyMaterial(material);
                  return (
                    <div
                      key={material.id}
                      className={`group/ptile relative aspect-square overflow-hidden rounded-lg bg-bg-tertiary transition-all ${
                        isDraftSelected ? "ring-2 ring-accent" : "opacity-70 hover:opacity-100"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => togglePresetDraftMaterial(material.id)}
                        title={material.name}
                        className="absolute inset-0"
                      >
                        {renderMaterialThumb(material, "h-full w-full")}
                      </button>
                      {isDraftSelected && (
                        <span className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-accent text-[10px] font-bold text-white">
                          {draftIndex + 1}
                        </span>
                      )}
                      {isCustomMaterial && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditCustomMaterial(material);
                          }}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md bg-black/35 text-white/80 opacity-0 transition-all hover:text-white group-hover/ptile:opacity-100"
                          title="编辑该 DIY 材质"
                          aria-label={`编辑材质 ${material.name}`}
                        >
                          <Pencil size={10} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {/* 新建 DIY 材质入口 */}
                {customMaterials.length < CUSTOM_MATERIALS_MAX && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMaterialId(null);
                      setMaterialDraft(DEFAULT_MATERIAL_DRAFT);
                      setIsMaterialEditorOpen((open) => !open);
                    }}
                    className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed transition-colors ${
                      isMaterialEditorOpen
                        ? "border-accent text-text-primary"
                        : "border-border-primary text-text-tertiary hover:border-accent hover:text-text-primary"
                    }`}
                    title="DIY 一个自定义材质"
                  >
                    <Plus size={14} />
                    <span className="text-[9px] font-medium">DIY 材质</span>
                  </button>
                )}
              </div>
              <div className="mb-1.5 text-[11px] font-semibold text-text-secondary">
                配色（自定义配色悬浮可编辑）
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPresetEditDraft((prev) => ({ ...prev, paletteId: null }))}
                  className={`flex h-7 items-center rounded-lg px-2 text-[11px] font-medium transition-colors ${
                    presetEditDraft.paletteId === null
                      ? "bg-accent text-white"
                      : "bg-bg-elevated text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                >
                  原图配色
                </button>
                {editorPalettes.map((palette) => {
                  // 只有还存在于配色库里的自定义配色才可编辑（预设里的旧快照不行）
                  const isCustomPalette = customPalettes.some((p) => p.id === palette.id);
                  return (
                    <div key={palette.id} className="group/ppalette relative">
                      <button
                        type="button"
                        onClick={() => setPresetEditDraft((prev) => ({ ...prev, paletteId: palette.id }))}
                        title={`${palette.name}：${[palette.main, ...palette.aux].join(" ")}`}
                        className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-colors ${
                          presetEditDraft.paletteId === palette.id
                            ? "bg-accent text-white"
                            : "bg-bg-elevated text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                        }`}
                      >
                        <span className="flex items-center -space-x-0.5">
                          <span
                            className="h-3 w-3 rounded-full border border-black/10"
                            style={{ backgroundColor: palette.main }}
                          />
                          {palette.aux.map((color, colorIndex) => (
                            <span
                              key={`${color}-${colorIndex}`}
                              className="h-2.5 w-2.5 rounded-full border border-black/10"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </span>
                        {palette.name}
                      </button>
                      {isCustomPalette && (
                        <button
                          type="button"
                          onClick={() => handleEditCustomPalette(palette)}
                          className="absolute -left-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover/ppalette:opacity-100"
                          title="重命名 / 编辑该配色"
                          aria-label={`编辑配色 ${palette.name}`}
                        >
                          <Pencil size={8} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {/* 新建 DIY 配色入口 */}
                <button
                  type="button"
                  onClick={() => {
                    setIsPaletteEditorOpen((open) => !open);
                    setEditingPaletteId(null);
                  }}
                  className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors ${
                    isPaletteEditorOpen
                      ? "bg-accent text-white"
                      : "bg-bg-elevated text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                  title="DIY 一套配色并保存"
                >
                  <Plus size={11} />
                  DIY
                </button>
              </div>
              {/* DIY 配色编辑器：在覆盖层里也能直接调色 */}
              {isPaletteEditorOpen && (
                <div className="mt-2">{renderPaletteEditorForm()}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 border-t border-border-primary px-3.5 py-2.5">
              <button
                type="button"
                onClick={() => handleSavePresetEdit(editingPreset)}
                disabled={presetEditDraft.materialIds.length < 1}
                className="flex h-8 flex-1 items-center justify-center rounded-xl bg-accent px-3 text-[12px] font-semibold text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-bg-tertiary disabled:text-text-tertiary"
              >
                {presetEditDraft.materialIds.length < 1 ? "至少选 1 个材质" : "保存修改"}
              </button>
              <button
                type="button"
                onClick={closePresetEditor}
                className="flex h-8 items-center rounded-xl px-3 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                取消
              </button>
            </div>
          </div>
        );
      })()}

      {/* 右下角缩放把手 */}
      <div
        data-panel-nodrag
        onPointerDown={handleResizeStart}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16" className="h-full w-full text-text-tertiary/70">
          <path d="M14 8L8 14M14 12l-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </svg>
      </div>

      {/* 材质悬浮预览卡：大图 + 名称 + 质感描述，点选前先有预期 */}
      {materialPreview && createPortal(
        <div
          className="pointer-events-none fixed z-[60] w-60 overflow-hidden rounded-xl border border-border-primary bg-bg-secondary shadow-2xl shadow-black/40"
          style={{ left: materialPreview.left, top: materialPreview.top }}
        >
          {renderMaterialThumb(materialPreview.material, "h-36 w-full")}
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-semibold text-text-primary">{materialPreview.material.name}</span>
              <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-tertiary">
                {materialPreview.material.category || DIY_CATEGORY}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-text-tertiary line-clamp-3">
              {materialPreview.material.prompt}
            </p>
            <p className="mt-1.5 border-t border-border-primary pt-1.5 text-[10px] text-text-tertiary/80">
              单击加入组合 · 双击仅用这一个
            </p>
          </div>
        </div>,
        document.body,
      )}

      {/* 目标图悬浮预览卡：放大展示画布上选中的图，确认换材质的对象 */}
      {targetPreview && hasTarget && createPortal(
        <div
          className="pointer-events-none fixed z-[60] w-60 overflow-hidden rounded-xl border border-border-primary bg-bg-secondary shadow-2xl shadow-black/40"
          style={{ left: targetPreview.left, top: targetPreview.top }}
        >
          <div className="flex h-52 w-full items-center justify-center bg-bg-tertiary">
            <img
              src={selectedImage.image_url}
              alt="选中的目标图"
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          </div>
          <div className="px-3 py-2 text-[11px] text-text-secondary">
            目标图 · 材质将应用到这张选中的图
          </div>
        </div>,
        document.body,
      )}

      {/* 单选替换的即时反馈：告知组合已被替换为单个材质 */}
      {soloNotice && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black/78 px-3 py-1.5 text-[11px] text-white backdrop-blur-sm">
          已切换为仅使用「{soloNotice}」
        </div>
      )}
    </div>
  );
}
