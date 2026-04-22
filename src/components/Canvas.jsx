"use client";

import {
  useState, useRef, useCallback, useEffect, useMemo,
  useReducer, useImperativeHandle,
} from "react";
import {
  Maximize2, Download, Trash2, Copy,
  MessageSquare, Lock, Unlock, FileDown, Image as ImageIcon,
  Minus, Plus, Scissors, Type,
} from "lucide-react";
import { flushSync } from "react-dom";
import { useToast } from "@/components/Toast";
import Toolbar from "@/components/Toolbar";

const INITIAL_IMG_WIDTH = 280;
const DEFAULT_TEXT_FONT = 16;
const MIN_TEXT_FONT = 10;
const MAX_TEXT_FONT = 96;
const MIN_SHAPE_PIXELS = 4;
const CANVAS_IMAGE_MIME = "application/x-easy-ai-canvas-image";

/** 缩放：1%–800%，指数曲线（Figma 风格） */
const MIN_ZOOM_PCT = 1;
const MAX_ZOOM_PCT = 800;
/** deltaY 越大缩放越快；与 trackpad/滚轮配合 */
const ZOOM_EXP_SENSITIVITY = 0.0018;

/** 以屏幕点 (sx,sy) 为锚点应用新 zoom（世界坐标不变）；zoom 始终为整数 % */
function applyZoomAtScreenPoint(cam, sx, sy, newZoomPct) {
  const clamped = Math.min(MAX_ZOOM_PCT, Math.max(MIN_ZOOM_PCT, newZoomPct));
  const z = Math.round(clamped);
  const oldS = cam.zoom / 100;
  const newS = z / 100;
  const wx = (sx - cam.x) / oldS;
  const wy = (sy - cam.y) / oldS;
  cam.x = sx - wx * newS;
  cam.y = sy - wy * newS;
  cam.zoom = z;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** 世界坐标 AABB 相交（含贴边） */
function worldRectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return !(ax + aw < bx || bx + bw < ax || ay + ah < by || by + bh < ay);
}

function getCanvasImageHeight(img, pos, meta) {
  if (!img || !pos) return 0;
  if (img.isGeneratingPlaceholder) {
    const ratio = img.placeholderAspectRatio || 1;
    return Math.max(160, Math.round(pos.w / ratio));
  }
  return meta ? (pos.w * meta.height) / meta.width : pos.w;
}

function getUpscalePreviewSize(meta, targetLongSide) {
  if (!meta?.width || !meta?.height || !targetLongSide) return "";
  const aspect = meta.width / meta.height;
  if (aspect >= 1) {
    return `${targetLongSide}×${Math.round(targetLongSide / aspect)}`;
  }
  return `${Math.round(targetLongSide * aspect)}×${targetLongSide}`;
}

function ContextMenu({ x, y, img, isLocked, onClose, onAction }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handle = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    window.addEventListener("pointerdown", handle);
    return () => window.removeEventListener("pointerdown", handle);
  }, [onClose]);

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) menuRef.current.style.left = `${x - rect.width}px`;
    if (rect.bottom > vh) menuRef.current.style.top = `${y - rect.height}px`;
  }, [x, y]);

  const items = [
    { id: "copy", label: "复制", icon: Copy },
    { id: "sendToChat", label: "发送到对话", icon: MessageSquare },
    { id: "export", label: "导出", icon: FileDown },
    { id: "divider" },
    { id: "lock", label: isLocked ? "解锁" : "锁定", icon: isLocked ? Unlock : Lock },
    { id: "divider2" },
    { id: "delete", label: "删除", icon: Trash2, danger: true },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-bg-secondary border border-border-primary rounded-xl shadow-2xl shadow-black/60 py-1.5 min-w-[160px] animate-fade-in"
      style={{ left: x, top: y }}
    >
      {items.map((item) =>
        item.id.startsWith("divider") ? (
          <div key={item.id} className="my-1 border-t border-border-primary" />
        ) : (
          <button
            key={item.id}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors ${
              item.danger
                ? "text-red-400 hover:bg-red-500/10"
                : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
            onClick={() => { onAction(item.id, img); onClose(); }}
          >
            <item.icon size={14} />
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

export default function Canvas({
  images, selectedImage, onSelectImage, onDeleteImage,
  onUpdateImage, onSendToChat, onQuickEditImage, onQuickUpscaleImage, onDropImages, onDropGeneratedImage, onPasteImages,
  activeTool, onToolChange, zoom, onZoomChange,
  ref,
  generatingItems = [],
  textItems = [],
  onAddText,
  onUpdateText,
  onDeleteText,
  shapeItems = [],
  onAddShape,
  onUpdateShape,
  onDeleteShape,
  shapeMode = "rect",
  onShapeModeChange,
  onSyncCanvasRefImages,
  onSelectedImageRectChange,
  onSemanticSelectionChange,
  semanticEditEnabled = true,
}) {
  const toast = useToast();
  const containerRef = useRef(null);
  /** 相机：同步可变对象（非 React state），平移/缩放后需 forceRender */
  const cameraRef = useRef({
    x: 0,
    y: 0,
    zoom: Math.round(typeof zoom === "number" ? zoom : 100),
  });
  const [action, setAction] = useState(null);
  const actionRef = useRef(null);
  const [, forceRender] = useReducer((c) => c + 1, 0);
  const [contextMenu, setContextMenu] = useState(null);
  const [upscaleMenuFor, setUpscaleMenuFor] = useState(null);
  const lockedRef = useRef(new Set());
  const [fileDragOver, setFileDragOver] = useState(false);
  const [selectedTextId, setSelectedTextId] = useState(null);
  const [editingTextId, setEditingTextId] = useState(null);
  const [multiSelectedImageIds, setMultiSelectedImageIds] = useState([]);
  const [multiSelectedTextIds, setMultiSelectedTextIds] = useState([]);
  const [selectedShapeId, setSelectedShapeId] = useState(null);
  const [semanticSelection, setSemanticSelection] = useState(null);
  const [semanticSelectingImageId, setSemanticSelectingImageId] = useState(null);
  const [semanticPickModifierHeld, setSemanticPickModifierHeld] = useState(false);
  const [semanticPickCursorPos, setSemanticPickCursorPos] = useState(null);
  /** 按住空格临时平移（与 Figma 类似）；与 handlePointerDown 同步读取 */
  const spacePanHeldRef = useRef(false);
  /** 画布内 Ctrl/Cmd+C 复制后的数据（系统剪贴板失败时仍可粘贴） */
  const canvasClipboardRef = useRef(null);

  actionRef.current = action;

  const renderImages = useMemo(() => [
    ...images,
    ...generatingItems.filter((item) => !images.some((img) => img.id === item.id)),
  ], [images, generatingItems]);

  const positionsRef = useRef({});
  const imageMetaRef = useRef({});
  renderImages.forEach((img, i) => {
    if (!positionsRef.current[img.id]) {
      if (img.isGeneratingPlaceholder) {
        const gapX = 40;
        const gapY = 50;
        const cols = Math.min(2, Math.max(1, img.totalCount || 2));
        const slotIndex = img.slotIndex || 0;
        const maxImageBottom = images.reduce((acc, image) => {
          const p = positionsRef.current[image.id];
          if (!p) return acc;
          const meta = imageMetaRef.current[image.id];
          const h = meta ? (p.w * meta.height) / meta.width : p.w;
          return Math.max(acc, p.y + h);
        }, 80);
        positionsRef.current[img.id] = {
          x: 100 + (slotIndex % cols) * (INITIAL_IMG_WIDTH + gapX),
          y: maxImageBottom + 60 + Math.floor(slotIndex / cols) * (INITIAL_IMG_WIDTH + gapY),
          w: INITIAL_IMG_WIDTH,
        };
      } else {
        const col = i % 4;
        const row = Math.floor(i / 4);
        positionsRef.current[img.id] = {
          x: col * (INITIAL_IMG_WIDTH + 40) + 100,
          y: row * (INITIAL_IMG_WIDTH + 60) + 100,
          w: INITIAL_IMG_WIDTH,
        };
      }
    }
  });

  useImperativeHandle(ref, () => ({
    exportCanvas: () => {
      if (images.length === 0) {
        toast("画布为空", "info", 1500);
        return;
      }
      const positions = positionsRef.current;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const loaded = [];
      let pending = images.length;

      images.forEach((img) => {
        const pos = positions[img.id];
        if (!pos) { pending--; return; }
        const el = new Image();
        el.crossOrigin = "anonymous";
        el.onload = () => {
          const aspect = el.naturalHeight / el.naturalWidth;
          const h = pos.w * aspect;
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x + pos.w);
          maxY = Math.max(maxY, pos.y + h);
          loaded.push({ el, x: pos.x, y: pos.y, w: pos.w, h });
          if (--pending === 0) draw();
        };
        el.onerror = () => { if (--pending === 0) draw(); };
        el.src = img.image_url;
      });

      function draw() {
        const pad = 40;
        const cw = maxX - minX + pad * 2;
        const ch = maxY - minY + pad * 2;
        const cvs = document.createElement("canvas");
        cvs.width = cw;
        cvs.height = ch;
        const ctx = cvs.getContext("2d");
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, cw, ch);
        loaded.forEach(({ el, x, y, w, h }) => {
          ctx.drawImage(el, x - minX + pad, y - minY + pad, w, h);
        });
        cvs.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `canvas-${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(url);
          toast("画布已导出", "success");
        });
      }
    },
  }), [images, toast]);

  useEffect(() => {
    if (activeTool !== "select") {
      setMultiSelectedImageIds([]);
      setMultiSelectedTextIds([]);
      setSelectedShapeId(null);
    }
  }, [activeTool]);

  useEffect(() => {
    const handleKey = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "Escape") {
        setContextMenu(null);
        if (typing) {
          setEditingTextId(null);
          return;
        }
        setEditingTextId(null);
        setMultiSelectedImageIds([]);
        setMultiSelectedTextIds([]);
        setSelectedShapeId(null);
        setSelectedTextId(null);
        onSelectImage?.(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (typing) return;
        const isSel = activeTool === "select";
        if (isSel && selectedShapeId) {
          e.preventDefault();
          onDeleteShape?.(selectedShapeId);
          setSelectedShapeId(null);
          return;
        }
        if (isSel) {
          const multiImg = multiSelectedImageIds.length;
          const multiTx = multiSelectedTextIds.length;
          if (multiImg + multiTx > 0) {
            e.preventDefault();
            multiSelectedTextIds.forEach((tid) => onDeleteText?.(tid));
            multiSelectedImageIds.forEach((iid) => {
              if (!lockedRef.current.has(iid)) onDeleteImage?.(iid);
            });
            setMultiSelectedImageIds([]);
            setMultiSelectedTextIds([]);
            setSelectedTextId(null);
            onSelectImage?.(null);
            return;
          }
          if (selectedTextId) {
            e.preventDefault();
            onDeleteText?.(selectedTextId);
            setSelectedTextId(null);
            setEditingTextId(null);
            return;
          }
          if (selectedImage) {
            if (lockedRef.current.has(selectedImage.id)) return;
            e.preventDefault();
            onDeleteImage?.(selectedImage.id);
          }
          return;
        }
        if (selectedTextId) {
          e.preventDefault();
          onDeleteText?.(selectedTextId);
          setSelectedTextId(null);
          setEditingTextId(null);
          return;
        }
        if (selectedImage) {
          if (lockedRef.current.has(selectedImage.id)) return;
          e.preventDefault();
          onDeleteImage?.(selectedImage.id);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeTool, selectedImage, selectedTextId, selectedShapeId, multiSelectedImageIds, multiSelectedTextIds, onDeleteImage, onDeleteText, onDeleteShape, onSelectImage]);

  useEffect(() => {
    if (!onSelectedImageRectChange) return;
    if (!selectedImage?.id) {
      onSelectedImageRectChange(null);
      return;
    }

    const selector = `[data-canvas-item="${String(selectedImage.id).replace(/"/g, '\\"')}"]`;
    const el = containerRef.current?.querySelector(selector);
    if (!el) {
      onSelectedImageRectChange(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    onSelectedImageRectChange({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  });

  useEffect(() => {
    if (!upscaleMenuFor) return undefined;
    const handlePointerDown = (event) => {
      const target = event.target;
      if (target?.closest?.("[data-upscale-menu]") || target?.closest?.("[data-upscale-trigger]")) {
        return;
      }
      setUpscaleMenuFor(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [upscaleMenuFor]);

  /** 空格按住：可左键拖拽平移画布（输入框内不抢占空格） */
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      return Boolean(el.isContentEditable);
    };
    const onKeyDown = (e) => {
      if (e.code !== "Space") return;
      if (typing()) return;
      if (e.repeat) return;
      e.preventDefault();
      spacePanHeldRef.current = true;
      forceRender();
    };
    const onKeyUp = (e) => {
      if (e.code !== "Space") return;
      spacePanHeldRef.current = false;
      forceRender();
    };
    const onBlur = () => {
      if (!spacePanHeldRef.current) return;
      spacePanHeldRef.current = false;
      forceRender();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!semanticEditEnabled) {
      setSemanticPickModifierHeld(false);
      return undefined;
    }
    const syncModifierState = (event) => {
      setSemanticPickModifierHeld(Boolean(event.ctrlKey || event.metaKey));
    };
    const clearModifierState = () => setSemanticPickModifierHeld(false);
    window.addEventListener("keydown", syncModifierState);
    window.addEventListener("keyup", syncModifierState);
    window.addEventListener("blur", clearModifierState);
    return () => {
      window.removeEventListener("keydown", syncModifierState);
      window.removeEventListener("keyup", syncModifierState);
      window.removeEventListener("blur", clearModifierState);
    };
  }, [semanticEditEnabled]);

  /** 工具栏：以视口中心为锚点缩放（线性步进保持与按钮一致） */
  const handleToolbarZoomChange = useCallback(
    (updater) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const cam = cameraRef.current;
      const prevZ = cam.zoom;
      const nextZ =
        typeof updater === "function" ? updater(prevZ) : updater;
      if (rect) {
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        applyZoomAtScreenPoint(cam, cx, cy, nextZ);
      } else {
        cam.zoom = Math.round(
          Math.min(MAX_ZOOM_PCT, Math.max(MIN_ZOOM_PCT, nextZ))
        );
      }
      onZoomChange?.(cam.zoom);
      forceRender();
    },
    [onZoomChange]
  );

  /** 滚轮：指数缩放 + 光标锚点（世界坐标不变） */
  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const cam = cameraRef.current;
      const oldS = cam.zoom / 100;
      const sens = e.ctrlKey ? ZOOM_EXP_SENSITIVITY * 1.75 : ZOOM_EXP_SENSITIVITY;
      const factor = Math.exp(-e.deltaY * sens);
      const minS = MIN_ZOOM_PCT / 100;
      const maxS = MAX_ZOOM_PCT / 100;
      const newS = Math.min(maxS, Math.max(minS, oldS * factor));
      applyZoomAtScreenPoint(cam, sx, sy, newS * 100);
      onZoomChange?.(cam.zoom);
      forceRender();
    },
    [onZoomChange]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  /** 新建文案后父级 select-none 会导致 textarea 无法选字/输入，需强制 select-text 并拉焦点 */
  useEffect(() => {
    if (!editingTextId) return;
    const id = String(editingTextId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const el = document.querySelector(`textarea[data-text-editor="${id}"]`);
    if (el instanceof HTMLTextAreaElement) {
      el.focus();
    }
  }, [editingTextId, textItems]);

  const isHandTool = activeTool === "hand";
  const isTextTool = activeTool === "text";
  const isSelectTool = activeTool === "select";
  const isShapeTool = activeTool === "shape";
  const quickEditActions = [
    { id: "cutout", label: "抠图", icon: Scissors },
    { id: "upscale", label: "高清放大", icon: Maximize2 },
    { id: "editText", label: "编辑文字", icon: Type, disabled: true },
  ];
  const upscaleOptions = [
    { id: "1K", edge: 1024 },
    { id: "2K", edge: 2048 },
    { id: "4K", edge: 4096 },
  ];

  const copyCanvasImages = useCallback(async () => {
    const ids =
      multiSelectedImageIds.length > 0
        ? [...multiSelectedImageIds]
        : selectedImage
          ? [selectedImage.id]
          : [];
    if (ids.length === 0) return;
    const items = ids
      .map((iid) => images.find((im) => im.id === iid))
      .filter(Boolean)
      .map((im) => ({ image_url: im.image_url, prompt: im.prompt || "" }));
    if (items.length === 0) return;
    canvasClipboardRef.current = { items };
    try {
      const first = items[0];
      const res = await fetch(first.image_url);
      const blob = await res.blob();
      const type =
        blob.type && blob.type.startsWith("image/") ? blob.type : "image/png";
      await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
      toast("已复制", "success", 1200);
    } catch {
      toast("已复制（可在画布内粘贴）", "info", 1500);
    }
  }, [images, multiSelectedImageIds, selectedImage, toast]);

  const pasteCanvasImages = useCallback(async () => {
    if (!onPasteImages) return;
    const tryClipboard = async () => {
      try {
        const clipItems = await navigator.clipboard.read();
        for (const clipItem of clipItems) {
          const types = clipItem.types.filter((t) => t.startsWith("image/"));
          for (const t of types) {
            const blob = await clipItem.getType(t);
            const dataUrl = await blobToDataUrl(blob);
            return [{ image_url: dataUrl, prompt: "粘贴" }];
          }
        }
      } catch {
        /* ignore */
      }
      return null;
    };
    const fromClip = await tryClipboard();
    if (fromClip?.length) {
      onPasteImages(fromClip);
      return;
    }
    if (canvasClipboardRef.current?.items?.length) {
      onPasteImages(
        canvasClipboardRef.current.items.map((it) => ({
          image_url: it.image_url,
          prompt: (it.prompt && String(it.prompt).trim())
            ? `${it.prompt} (副本)`
            : "副本",
        }))
      );
    } else {
      toast("剪贴板无图片", "info", 1200);
    }
  }, [onPasteImages, toast]);

  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      return Boolean(el.isContentEditable);
    };
    const hasTextSelection = () => {
      const sel = window.getSelection?.();
      if (!sel) return false;
      return !sel.isCollapsed && sel.toString().trim().length > 0;
    };
    const onKeyDown = (e) => {
      if (typing()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "c") {
        if (hasTextSelection()) return;
        const ids =
          multiSelectedImageIds.length > 0
            ? multiSelectedImageIds
            : selectedImage
              ? [selectedImage.id]
              : [];
        if (ids.length === 0) return;
        e.preventDefault();
        copyCanvasImages();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteCanvasImages();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    copyCanvasImages,
    pasteCanvasImages,
    multiSelectedImageIds,
    selectedImage,
  ]);

  /**
   * 文案块在子层拦截事件。文字工具：单击进入编辑。
   * 选择工具：单击选中、框选多选、成组拖拽、双击编辑、字号条。
   */
  const handleTextItemPointerDown = useCallback(
    (e, t) => {
      if (isHandTool) return;
      if (isShapeTool) return;
      e.stopPropagation();
      const totalMulti = multiSelectedImageIds.length + multiSelectedTextIds.length;
      const inMulti =
        multiSelectedImageIds.includes(t.id) || multiSelectedTextIds.includes(t.id);
      if (
        isSelectTool &&
        totalMulti > 1 &&
        inMulti &&
        multiSelectedTextIds.includes(t.id)
      ) {
        const origImages = {};
        multiSelectedImageIds.forEach((iid) => {
          const p = positionsRef.current[iid];
          if (p) origImages[iid] = { ...p };
        });
        const origTexts = {};
        multiSelectedTextIds.forEach((tid) => {
          const tt = textItems.find((x) => x.id === tid);
          if (tt) origTexts[tid] = { x: tt.x, y: tt.y };
        });
        setAction({
          type: "group_drag",
          startX: e.clientX,
          startY: e.clientY,
          imageIds: [...multiSelectedImageIds],
          textIds: [...multiSelectedTextIds],
          origImages,
          origTexts,
        });
        try {
          containerRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }
      setMultiSelectedImageIds([]);
      setMultiSelectedTextIds([]);
      setSelectedShapeId(null);
      setSemanticSelection(null);
      onSelectImage(null);
      setSelectedTextId(t.id);
      if (isTextTool) {
        setEditingTextId(t.id);
        return;
      }
      const startX = e.clientX;
      const startY = e.clientY;
      let dragged = false;
      const pid = e.pointerId;
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      const onMove = (ev) => {
        if (dragged) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        dragged = true;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setAction({
          type: "textdrag",
          id: t.id,
          startX,
          startY,
          origX: t.x,
          origY: t.y,
        });
        try {
          containerRef.current?.setPointerCapture(pid);
        } catch {
          /* ignore */
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [
      isHandTool, isShapeTool, isTextTool, isSelectTool, onSelectImage,
      multiSelectedImageIds, multiSelectedTextIds, textItems,
    ]
  );

  /** 中键（滚轮按下）：任意工具/编辑状态下均平移画布，需在捕获阶段优先于子元素 */
  const handleMiddleButtonPanCapture = useCallback((e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu(null);
    setAction("pan");
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (e.button === 1) return;
    if (e.target.closest("[data-toolbar]")) return;
    setContextMenu(null);
    setUpscaleMenuFor(null);
    const target = e.target;
    if (target.closest?.("[data-text-editor]")) return;

    if (spacePanHeldRef.current && e.button === 0) {
      e.preventDefault();
      setContextMenu(null);
      setAction("pan");
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const imgEl = target.closest("[data-canvas-item]");
    const cam = cameraRef.current;
    const scale = cam.zoom / 100;

    if (isHandTool) {
      setAction("pan");
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (isShapeTool && onAddShape) {
      setEditingTextId(null);
      setSelectedShapeId(null);
      onSelectImage(null);
      setSelectedTextId(null);
      setMultiSelectedImageIds([]);
      setMultiSelectedTextIds([]);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const worldX = (e.clientX - rect.left - cam.x) / scale;
      const worldY = (e.clientY - rect.top - cam.y) / scale;
      setAction({
        type: "shape_draw",
        kind: shapeMode === "ellipse" ? "ellipse" : "rect",
        sx: worldX,
        sy: worldY,
        cx: worldX,
        cy: worldY,
      });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const shapeHit = target.closest("[data-shape-item]");
    if (shapeHit && isSelectTool) {
      setEditingTextId(null);
      setSemanticSelection(null);
      const sid = shapeHit.dataset.shapeItem;
      const sh = shapeItems.find((s) => s.id === sid);
      if (!sh) return;
      setSelectedShapeId(sid);
      onSelectImage(null);
      setSelectedTextId(null);
      setMultiSelectedImageIds([]);
      setMultiSelectedTextIds([]);
      setAction({
        type: "shape_drag",
        id: sid,
        startX: e.clientX,
        startY: e.clientY,
        origX: sh.x,
        origY: sh.y,
      });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (imgEl) {
      setEditingTextId(null);
      setSelectedShapeId(null);
      const id = imgEl.dataset.canvasItem;
      const pos = positionsRef.current[id];
      if (!pos) return;
      const img = images.find((i) => i.id === id);
      if (semanticEditEnabled && isSelectTool && (e.ctrlKey || e.metaKey) && img && !target.closest?.("button")) {
        const imageNode = imgEl.querySelector("img");
        setMultiSelectedImageIds([]);
        setMultiSelectedTextIds([]);
        setSelectedTextId(null);
        onSelectImage(img);
        void selectSemanticObject(img, imageNode, e.clientX, e.clientY);
        return;
      }
      if (isSelectTool && e.shiftKey) {
        setSemanticSelection(null);
        const baseIds = multiSelectedImageIds.length > 0
          ? multiSelectedImageIds
          : selectedImage?.id
            ? [selectedImage.id]
            : [];
        const nextIds = baseIds.includes(id) ? baseIds : [...baseIds, id];
        const nextUrls = nextIds
          .map((iid) => images.find((item) => item.id === iid)?.image_url)
          .filter(Boolean);
        setSelectedTextId(null);
        setMultiSelectedTextIds([]);
        if (nextIds.length <= 1 && img) {
          setMultiSelectedImageIds([]);
          onSelectImage(img);
        } else {
          setMultiSelectedImageIds(nextIds);
          onSelectImage(null);
          onSyncCanvasRefImages?.(nextUrls);
        }
        return;
      }
      const totalMulti = multiSelectedImageIds.length + multiSelectedTextIds.length;
      const inMulti =
        multiSelectedImageIds.includes(id) || multiSelectedTextIds.includes(id);
      if (
        isSelectTool &&
        totalMulti > 1 &&
        inMulti &&
        multiSelectedImageIds.includes(id)
      ) {
        const origImages = {};
        multiSelectedImageIds.forEach((iid) => {
          const p = positionsRef.current[iid];
          if (p) origImages[iid] = { ...p };
        });
        const origTexts = {};
        multiSelectedTextIds.forEach((tid) => {
          const tt = textItems.find((x) => x.id === tid);
          if (tt) origTexts[tid] = { x: tt.x, y: tt.y };
        });
        setAction({
          type: "group_drag",
          startX: e.clientX,
          startY: e.clientY,
          imageIds: [...multiSelectedImageIds],
          textIds: [...multiSelectedTextIds],
          origImages,
          origTexts,
        });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      setMultiSelectedImageIds([]);
      setMultiSelectedTextIds([]);
      setSelectedTextId(null);
      setSemanticSelection(null);
      if (img) onSelectImage(img);
      if (lockedRef.current.has(id)) return;
      setAction({
        type: "drag", id,
        startX: e.clientX, startY: e.clientY,
        origX: pos.x, origY: pos.y,
      });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (isTextTool && onAddText) {
      onSelectImage(null);
      setSelectedShapeId(null);
      setSemanticSelection(null);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const worldX = (e.clientX - rect.left - cam.x) / scale;
      const worldY = (e.clientY - rect.top - cam.y) / scale;
      const nid = `text-${Date.now()}`;
      // 同步写入父级文案列表，再进入编辑，否则首帧 textItems 尚未含 nid，无法立刻出现输入框
      flushSync(() => {
        onAddText({ id: nid, text: "", x: worldX, y: worldY, fontSize: DEFAULT_TEXT_FONT });
      });
      setSelectedTextId(nid);
      setEditingTextId(nid);
      return;
    }

    if (isSelectTool) {
      onSelectImage(null);
      setSelectedTextId(null);
      setEditingTextId(null);
      setSelectedShapeId(null);
      setMultiSelectedImageIds([]);
      setMultiSelectedTextIds([]);
      setSemanticSelection(null);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const worldX = (e.clientX - rect.left - cam.x) / scale;
      const worldY = (e.clientY - rect.top - cam.y) / scale;
      setAction({
        type: "marquee",
        sx: worldX,
        sy: worldY,
        cx: worldX,
        cy: worldY,
      });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    onSelectImage(null);
    setSelectedTextId(null);
    setEditingTextId(null);
    setSemanticSelection(null);
    setAction("pan");
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [
    images, selectedImage, onSelectImage, isHandTool, isTextTool, isSelectTool, isShapeTool, onAddText,
    multiSelectedImageIds, multiSelectedTextIds, textItems,
    shapeItems, shapeMode,
  ]);

  const handlePointerMove = useCallback((e) => {
    const act = actionRef.current;
    if (!act) return;
    const cam = cameraRef.current;
    const scale = cam.zoom / 100;
    if (act === "pan") {
      cam.x += e.movementX;
      cam.y += e.movementY;
      forceRender();
    } else if (act.type === "shape_draw") {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const worldX = (e.clientX - rect.left - cam.x) / scale;
      const worldY = (e.clientY - rect.top - cam.y) / scale;
      setAction({ ...act, cx: worldX, cy: worldY });
    } else if (act.type === "shape_drag" && onUpdateShape) {
      const dx = (e.clientX - act.startX) / scale;
      const dy = (e.clientY - act.startY) / scale;
      onUpdateShape(act.id, { x: act.origX + dx, y: act.origY + dy });
    } else if (act.type === "marquee") {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const worldX = (e.clientX - rect.left - cam.x) / scale;
      const worldY = (e.clientY - rect.top - cam.y) / scale;
      setAction({ ...act, cx: worldX, cy: worldY });
    } else if (act.type === "drag") {
      const dx = (e.clientX - act.startX) / scale;
      const dy = (e.clientY - act.startY) / scale;
      positionsRef.current[act.id] = {
        ...positionsRef.current[act.id],
        x: act.origX + dx, y: act.origY + dy,
      };
      forceRender();
    } else if (act.type === "group_drag" && onUpdateText) {
      const dx = (e.clientX - act.startX) / scale;
      const dy = (e.clientY - act.startY) / scale;
      act.imageIds.forEach((iid) => {
        if (lockedRef.current.has(iid)) return;
        const o = act.origImages[iid];
        if (o && positionsRef.current[iid]) {
          positionsRef.current[iid] = {
            ...positionsRef.current[iid],
            x: o.x + dx,
            y: o.y + dy,
          };
        }
      });
      act.textIds.forEach((tid) => {
        const o = act.origTexts[tid];
        if (o) onUpdateText(tid, { x: o.x + dx, y: o.y + dy });
      });
      forceRender();
    } else if (act.type === "textdrag" && onUpdateText) {
      const dx = (e.clientX - act.startX) / scale;
      const dy = (e.clientY - act.startY) / scale;
      onUpdateText(act.id, { x: act.origX + dx, y: act.origY + dy });
    }
  }, [onUpdateText, onUpdateShape]);

  const handlePointerUp = useCallback((e) => {
    const act = actionRef.current;
    if (act && act.type === "shape_draw" && onAddShape) {
      const x1 = Math.min(act.sx, act.cx);
      const y1 = Math.min(act.sy, act.cy);
      const w = Math.abs(act.cx - act.sx);
      const h = Math.abs(act.cy - act.sy);
      if (w >= MIN_SHAPE_PIXELS && h >= MIN_SHAPE_PIXELS) {
        onAddShape({
          id: `shape-${Date.now()}`,
          kind: act.kind,
          x: x1,
          y: y1,
          w,
          h,
        });
      }
      setAction(null);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      return;
    }
    if (act && act.type === "marquee") {
      const mx1 = Math.min(act.sx, act.cx);
      const my1 = Math.min(act.sy, act.cy);
      const mx2 = Math.max(act.sx, act.cx);
      const my2 = Math.max(act.sy, act.cy);
      const mw = mx2 - mx1;
      const mh = my2 - my1;
      if (mw < 1 && mh < 1) {
        onSelectImage?.(null);
        setMultiSelectedImageIds([]);
        setMultiSelectedTextIds([]);
        setSelectedShapeId(null);
      } else {
        setSelectedShapeId(null);
        const hitsImg = [];
        renderImages.forEach((im) => {
          const p = positionsRef.current[im.id];
          if (!p) return;
          const meta = imageMetaRef.current[im.id];
          const ih = getCanvasImageHeight(im, p, meta);
          if (worldRectsOverlap(p.x, p.y, p.w, ih, mx1, my1, mw, mh)) {
            hitsImg.push(im.id);
          }
        });
        const hitsTx = [];
        const crect = containerRef.current?.getBoundingClientRect();
        const camMarquee = cameraRef.current;
        const zf = camMarquee.zoom / 100;
        if (crect && containerRef.current) {
          containerRef.current.querySelectorAll("[data-text-item]").forEach((el) => {
            const id = el.dataset.textItem;
            if (!id) return;
            const r = el.getBoundingClientRect();
            const left = (r.left - crect.left - camMarquee.x) / zf;
            const top = (r.top - crect.top - camMarquee.y) / zf;
            const tw = r.width / zf;
            const th = r.height / zf;
            if (worldRectsOverlap(left, top, tw, th, mx1, my1, mw, mh)) {
              hitsTx.push(id);
            }
          });
        }
        setMultiSelectedImageIds(hitsImg);
        setMultiSelectedTextIds(hitsTx);
        if (hitsImg.length === 0) {
          onSelectImage?.(null);
        }
        if (hitsImg.length >= 2) {
          const urls = hitsImg
            .map((id) => images.find((im) => im.id === id)?.image_url)
            .filter(Boolean);
          if (urls.length >= 2) {
            onSyncCanvasRefImages?.(urls);
          }
        }
        const totalHits = hitsImg.length + hitsTx.length;
        if (totalHits === 1) {
          if (hitsImg.length === 1) {
            const one = renderImages.find((im) => im.id === hitsImg[0]);
            if (one?.isGeneratingPlaceholder) {
              onSelectImage?.(null);
              setMultiSelectedImageIds([one.id]);
              setMultiSelectedTextIds([]);
            } else if (one) {
              onSelectImage?.(one);
              setMultiSelectedImageIds([]);
              setMultiSelectedTextIds([]);
            }
            setSelectedTextId(null);
          } else if (hitsTx.length === 1) {
            onSelectImage?.(null);
            setSelectedTextId(hitsTx[0]);
            setMultiSelectedImageIds([]);
            setMultiSelectedTextIds([]);
          }
        }
      }
      setAction(null);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      return;
    }
    if (act && act.type === "group_drag") {
      act.imageIds.forEach((iid) => {
        if (lockedRef.current.has(iid)) return;
        const pos = positionsRef.current[iid];
        if (pos) onUpdateImage?.(iid, pos);
      });
    }
    if (act && act.type === "drag") {
      const pos = positionsRef.current[act.id];
      if (pos) onUpdateImage?.(act.id, pos);
    }
    setAction(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, [onUpdateImage, onSelectImage, onAddShape, onSyncCanvasRefImages, images, renderImages]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    const imgEl = e.target.closest("[data-canvas-item]");
    if (!imgEl) return;
    const id = imgEl.dataset.canvasItem;
    const img = images.find((i) => i.id === id);
    if (!img) return;
    onSelectImage(img);
    setContextMenu({ x: e.clientX, y: e.clientY, img });
  }, [images, onSelectImage]);

  const handleContextAction = useCallback(async (actionId, img) => {
    switch (actionId) {
      case "copy":
        try {
          const res = await fetch(img.image_url);
          const blob = await res.blob();
          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
          toast("已复制到剪贴板", "success", 1500);
        } catch {
          try {
            await navigator.clipboard.writeText(img.image_url);
            toast("已复制链接", "success", 1500);
          } catch { toast("复制失败", "error", 1500); }
        }
        break;
      case "sendToChat":
        onSendToChat?.(img);
        break;
      case "export": {
        try {
          const res = await fetch(img.image_url);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `image-${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(url);
          toast("已导出", "success", 1200);
        } catch { window.open(img.image_url, "_blank"); }
        break;
      }
      case "lock":
        if (lockedRef.current.has(img.id)) {
          lockedRef.current.delete(img.id);
          toast("已解锁", "info", 1200);
        } else {
          lockedRef.current.add(img.id);
          toast("已锁定", "info", 1200);
        }
        forceRender();
        break;
      case "delete":
        if (!lockedRef.current.has(img.id)) onDeleteImage?.(img.id);
        else toast("该图片已锁定", "error", 1500);
        break;
    }
  }, [onDeleteImage, onSendToChat, toast]);

  useEffect(() => {
    if (!semanticSelection?.imageId) return;
    if (renderImages.some((img) => img.id === semanticSelection.imageId)) return;
    setSemanticSelection(null);
  }, [renderImages, semanticSelection]);

  useEffect(() => {
    onSemanticSelectionChange?.(semanticSelection);
  }, [onSemanticSelectionChange, semanticSelection]);

  async function selectSemanticObject(img, imageNode, clientX, clientY) {
    if (!img?.image_url || !imageNode) return;
    const naturalWidth = imageNode.naturalWidth || imageMetaRef.current[img.id]?.width || 0;
    const naturalHeight = imageNode.naturalHeight || imageMetaRef.current[img.id]?.height || 0;
    if (!naturalWidth || !naturalHeight) {
      toast("图片尚未加载完成，请稍后再试", "info", 1500);
      return;
    }

    const rect = imageNode.getBoundingClientRect();
    const localX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const localY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const x = Math.max(0, Math.min(naturalWidth - 1, Math.round((localX / rect.width) * naturalWidth)));
    const y = Math.max(0, Math.min(naturalHeight - 1, Math.round((localY / rect.height) * naturalHeight)));

    setSemanticSelectingImageId(img.id);
    try {
      const res = await fetch("/api/select-object", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: img.image_url,
          x,
          y,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `对象选择失败（${res.status}）`);
      }
      const result = data.data || {};
      if (!result.mask_data_url) {
        throw new Error("未返回对象选区遮罩");
      }
      setSemanticSelection({
        imageId: img.id,
        imageUrl: img.image_url,
        prompt: img.prompt || "",
        maskDataUrl: result.mask_data_url,
        bbox: result.bbox || null,
        method: result.method || "unknown",
        point: result.point || { x, y },
        imageSize: result.image_size || { width: naturalWidth, height: naturalHeight },
        label: result.label || "",
      });
      toast(result.label ? `已选中：${result.label}` : `已选中对象（${result.method || "auto"}）`, "success", 1500);
    } catch (err) {
      setSemanticSelection(null);
      toast(err?.message || "对象选择失败", "info", 2200);
    } finally {
      setSemanticSelectingImageId(null);
    }
  }

  // External file drag-and-drop onto canvas
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      e.dataTransfer.types.includes("Files") ||
      e.dataTransfer.types.includes(CANVAS_IMAGE_MIME)
    ) {
      setFileDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setFileDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setFileDragOver(false);
    const cam = cameraRef.current;
    const sc = cam.zoom / 100;
    const rect = containerRef.current?.getBoundingClientRect();
    const dropX = rect ? (e.clientX - rect.left - cam.x) / sc : 100;
    const dropY = rect ? (e.clientY - rect.top - cam.y) / sc : 100;
    const draggedCanvasImage = e.dataTransfer.getData(CANVAS_IMAGE_MIME);
    if (draggedCanvasImage && onDropGeneratedImage) {
      try {
        const payload = JSON.parse(draggedCanvasImage);
        if (payload?.url) {
          onDropGeneratedImage(payload, dropX, dropY);
          return;
        }
      } catch {
        /* ignore invalid drag payload */
      }
    }
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0 && onDropImages) {
      onDropImages(files, dropX, dropY);
    }
  }, [onDropGeneratedImage, onDropImages]);

  const cam = cameraRef.current;
  const scale = cam.zoom / 100;
  const isPanning = action === "pan";
  const isDragging = action?.type === "drag";
  const isDraggingText = action?.type === "textdrag";
  const isMarquee = action?.type === "marquee";
  const isGroupDrag = action?.type === "group_drag";
  const semanticPickActive =
    semanticEditEnabled && isSelectTool && semanticPickModifierHeld && !isPanning && !isDragging && !isDraggingText && !isGroupDrag && !isMarquee;

  const spacePanHeld = spacePanHeldRef.current;
  const cursor =
    isHandTool || spacePanHeld
      ? isPanning
        ? "cursor-grabbing"
        : "cursor-grab"
      : isShapeTool
        ? "cursor-crosshair"
        : isMarquee || action?.type === "shape_draw"
          ? "cursor-crosshair"
          : isPanning
            ? "cursor-grabbing"
            : isDraggingText || isDragging || isGroupDrag
              ? "cursor-move"
              : isTextTool
                ? "cursor-text"
                : "cursor-default";

  const handleSemanticPickCursorMove = useCallback((e) => {
    if (!semanticEditEnabled || !isSelectTool || !(e.ctrlKey || e.metaKey)) {
      setSemanticPickCursorPos(null);
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSemanticPickCursorPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, [isSelectTool, semanticEditEnabled]);

  return (
    <div
      ref={containerRef}
      className={`flex-1 relative overflow-hidden select-none ${cursor}`}
      style={{
        background: "var(--bg-primary)",
      }}
      onPointerDownCapture={handleMiddleButtonPanCapture}
      onPointerDown={handlePointerDown}
      onPointerMoveCapture={handleSemanticPickCursorMove}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setSemanticPickCursorPos(null)}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {semanticPickActive && (
        <div className="absolute top-4 left-1/2 z-30 -translate-x-1/2 pointer-events-none">
          <div className="px-3 py-1.5 rounded-full border border-accent/40 bg-bg-primary/92 backdrop-blur-xl text-[11px] text-accent shadow-lg">
            Ctrl/Cmd + 点击图片，选择对象区域
          </div>
        </div>
      )}

      {semanticPickActive && semanticPickCursorPos && (
        <div
          className="absolute z-30 pointer-events-none"
          style={{
            left: semanticPickCursorPos.x,
            top: semanticPickCursorPos.y,
            transform: "translate(2px, -8px)",
          }}
        >
          <div className="w-3 h-3 rounded-full bg-accent border-2 border-white shadow-[0_0_0_3px_rgba(63,202,88,0.2)]" />
        </div>
      )}

      {/* File drag overlay */}
      {fileDragOver && (
        <div className="absolute inset-0 z-30 bg-accent/10 border-2 border-dashed border-accent/50 flex items-center justify-center pointer-events-none">
          <div className="bg-bg-secondary/90 backdrop-blur-xl px-6 py-4 rounded-2xl border border-accent/30 shadow-2xl">
            <p className="text-sm text-accent font-medium">松手将图片添加到画布</p>
          </div>
        </div>
      )}

      {/* World layer：铺满画布便于命中；子元素为绝对定位 */}
      <div
        className="absolute inset-0 z-10"
        style={{
          transform: `translate(${cam.x}px, ${cam.y}px) scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {renderImages.length === 0 && textItems.length === 0 && shapeItems.length === 0 && !fileDragOver && (
          <div
            className="pointer-events-none absolute flex flex-col items-center justify-center text-center"
            style={{ left: "50%", top: "50%", transform: `translate(-50%, -50%) scale(${1 / scale})`, width: 300 }}
          >
            <div className="w-16 h-16 rounded-2xl bg-bg-secondary border border-border-primary flex items-center justify-center mb-4 opacity-30">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </div>
            <p className="text-sm text-text-tertiary opacity-40">在右侧面板输入提示词开始生成</p>
            <p className="text-xs text-text-tertiary opacity-25 mt-1">中键或按住空格拖拽平移 · 滚轮缩放 · Ctrl+C / Ctrl+V · 拖入图片 · 文字工具 · 右键菜单</p>
          </div>
        )}

        {action?.type === "marquee" && (() => {
          const a = action;
          const x = Math.min(a.sx, a.cx);
          const y = Math.min(a.sy, a.cy);
          const w = Math.abs(a.cx - a.sx);
          const h = Math.abs(a.cy - a.sy);
          return (
            <div
              className="absolute pointer-events-none z-[5] border border-accent/70 bg-accent/15 rounded-sm"
              style={{ left: x, top: y, width: w, height: h }}
            />
          );
        })()}

        {action?.type === "shape_draw" && (() => {
          const a = action;
          const x = Math.min(a.sx, a.cx);
          const y = Math.min(a.sy, a.cy);
          const w = Math.abs(a.cx - a.sx);
          const h = Math.abs(a.cy - a.sy);
          return (
            <div
              className={`absolute pointer-events-none z-[12] border-2 border-dashed border-emerald-400/90 bg-emerald-500/10 ${
                a.kind === "ellipse" ? "rounded-full" : "rounded-md"
              }`}
              style={{ left: x, top: y, width: w, height: h }}
            />
          );
        })()}

        {renderImages.map((img) => {
          const pos = positionsRef.current[img.id];
          if (!pos) return null;
          if (img.isGeneratingPlaceholder) {
            const placeholderHeight = getCanvasImageHeight(img, pos);
            const isRunning = img.generationStatus === "generating";
            const isHighlighted = multiSelectedImageIds.includes(img.id);
            return (
              <div
                key={img.id}
                data-canvas-item={img.id}
                className="absolute group cursor-move"
                style={{ left: pos.x, top: pos.y, width: pos.w }}
              >
                <div
                  className={`rounded-xl overflow-hidden border-2 bg-bg-secondary/80 transition-colors ${
                    isHighlighted ? "border-accent" : "border-border-primary hover:border-border-secondary"
                  }`}
                  style={{ height: placeholderHeight }}
                >
                  <div
                    className="w-full h-full flex flex-col items-center justify-center gap-3"
                    style={{
                      background: "linear-gradient(90deg, #161616 25%, #242424 50%, #161616 75%)",
                      backgroundSize: "200% 100%",
                      animation: "shimmer 1.5s infinite",
                    }}
                  >
                    <div className={`w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent ${isRunning ? "animate-spin" : ""}`} />
                    <div className="text-center">
                      <p className="text-xs text-text-primary font-medium">
                        {isRunning ? "生成中" : "等待中"}
                      </p>
                      {!img.hidePromptText && (
                        <p className="text-[10px] text-text-tertiary mt-1">
                          {img.prompt || "正在准备生成"}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          const isHighlighted =
            selectedImage?.id === img.id || multiSelectedImageIds.includes(img.id);
          const isChromeSingle =
            isHighlighted && multiSelectedImageIds.length === 0;
          const isLocked = lockedRef.current.has(img.id);
          const meta = imageMetaRef.current[img.id];
          const semanticForImage = semanticSelection?.imageId === img.id ? semanticSelection : null;
          const semanticBox = semanticForImage?.bbox;
          const semanticLabel = semanticForImage?.label ? String(semanticForImage.label).trim() : "";
          const displayHeight = meta
            ? Math.round((pos.w * meta.height) / meta.width)
            : Math.round(pos.w);
          const sizeLabel =
            meta?.width && meta?.height
              ? `${meta.width} × ${meta.height} px`
              : `${Math.round(pos.w)} × ${displayHeight}`;

          return (
            <div
              key={img.id}
              data-canvas-item={img.id}
              className={`absolute group ${isLocked ? "opacity-90" : ""}`}
              style={{ left: pos.x, top: pos.y, width: pos.w }}
            >
              {isChromeSingle && (
                <div className="absolute left-0 right-0 bottom-full mb-2 z-10 flex flex-col gap-2">
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl border border-border-primary bg-bg-primary/92 backdrop-blur-xl shadow-lg pointer-events-auto overflow-visible">
                    {quickEditActions.map((action) => {
                      if (action.id === "upscale") {
                        return (
                          <div key={action.id} className="relative">
                            <button
                              type="button"
                              data-upscale-trigger
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setUpscaleMenuFor((prev) => (prev === img.id ? null : img.id));
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors whitespace-nowrap"
                              title={action.label}
                            >
                              <action.icon size={12} />
                              <span>{action.label}</span>
                            </button>
                            {upscaleMenuFor === img.id && (
                              <div
                                data-upscale-menu
                                className="absolute left-0 top-[calc(100%+8px)] z-20 min-w-[168px] rounded-2xl border border-border-primary bg-bg-primary/96 shadow-2xl backdrop-blur-xl p-2"
                              >
                                {upscaleOptions.map((option) => (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setUpscaleMenuFor(null);
                                      onQuickUpscaleImage?.(option.id, img);
                                    }}
                                    className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left hover:bg-bg-hover transition-colors"
                                  >
                                    <span className="text-sm text-text-primary">{option.id}</span>
                                    <span className="text-xs text-text-tertiary">
                                      {getUpscalePreviewSize(meta, option.edge)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }

                      return (
                        <button
                          key={action.id}
                          type="button"
                          disabled={action.disabled}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (action.disabled) return;
                            onQuickEditImage?.(action.id, img);
                          }}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors whitespace-nowrap ${
                            action.disabled
                              ? "text-text-tertiary/45 bg-bg-hover/40 cursor-not-allowed"
                              : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                          }`}
                          title={action.label}
                        >
                          <action.icon size={12} />
                          <span>{action.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-accent pointer-events-none">
                    <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-bg-primary/90 border border-accent/40 min-w-0">
                      <ImageIcon size={10} />
                      <span className="truncate">{img.prompt || "Image"}</span>
                    </div>
                    <div className="px-1.5 py-0.5 rounded-md bg-bg-primary/90 border border-accent/40 shrink-0" title="原图像素尺寸">
                      {sizeLabel}
                    </div>
                  </div>
                </div>
              )}

              {/* 选区手柄相对图片线框定位，避免与下方标题栏错位 */}
              <div className="relative w-full">
                <div className={`rounded-xl overflow-hidden border-2 transition-colors ${
                  isHighlighted ? "border-accent" : "border-transparent hover:border-border-secondary"
                }`}>
                  <img
                    src={img.image_url}
                    alt={img.prompt}
                    className="w-full block pointer-events-none"
                    draggable={false}
                    onLoad={(e) => {
                      const { naturalWidth, naturalHeight } = e.currentTarget;
                      if (naturalWidth && naturalHeight) {
                        imageMetaRef.current[img.id] = {
                          width: naturalWidth,
                          height: naturalHeight,
                        };
                        forceRender();
                      }
                    }}
                  />
                  {semanticForImage?.maskDataUrl && (
                    <img
                      src={semanticForImage.maskDataUrl}
                      alt=""
                      className="absolute inset-0 w-full h-full pointer-events-none"
                      draggable={false}
                    />
                  )}
                  {semanticSelectingImageId === img.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px] pointer-events-none">
                      <div className="px-2.5 py-1 rounded-lg bg-black/60 text-[11px] text-white">
                        正在识别对象...
                      </div>
                    </div>
                  )}
                  {semanticBox && semanticForImage?.imageSize?.width && semanticForImage?.imageSize?.height && (
                    <>
                      <div
                        className="absolute border-2 border-emerald-300/90 rounded-lg pointer-events-none shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
                        style={{
                          left: `${(semanticBox.x / semanticForImage.imageSize.width) * 100}%`,
                          top: `${(semanticBox.y / semanticForImage.imageSize.height) * 100}%`,
                          width: `${(semanticBox.w / semanticForImage.imageSize.width) * 100}%`,
                          height: `${(semanticBox.h / semanticForImage.imageSize.height) * 100}%`,
                        }}
                      />
                      {semanticLabel && (
                        <div
                          className="absolute px-2 py-1 rounded-full bg-emerald-400 text-black text-[11px] font-medium pointer-events-none shadow-lg"
                          style={{
                            left: `${(semanticBox.x / semanticForImage.imageSize.width) * 100}%`,
                            top: `${Math.max(0, ((semanticBox.y / semanticForImage.imageSize.height) * 100) - 6)}%`,
                            transform: "translateY(-100%)",
                          }}
                        >
                          {semanticLabel}
                        </div>
                      )}
                    </>
                  )}

                  <div
                    className={`absolute top-2 right-2 flex gap-1 transition-opacity ${
                      isHighlighted ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <button onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); window.open(img.image_url, "_blank"); }}
                      className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm transition-all" title="查看原图">
                      <Maximize2 size={14} />
                    </button>
                    <button onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); handleContextAction("export", img); }}
                      className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm transition-all" title="下载">
                      <Download size={14} />
                    </button>
                    <button onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); if (!isLocked) onDeleteImage?.(img.id); }}
                      className={`p-1.5 rounded-lg bg-black/60 backdrop-blur-sm transition-all ${isLocked ? "text-zinc-600 cursor-not-allowed" : "text-red-400 hover:bg-red-500/80 hover:text-white"}`} title={isLocked ? "已锁定" : "删除"}>
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {isLocked && (
                    <div className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/60 text-amber-400 backdrop-blur-sm">
                      <Lock size={12} />
                    </div>
                  )}
                </div>

                {isChromeSingle && (
                  <>
                    <div className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-bg-primary border-2 border-accent rounded-[2px] pointer-events-none" />
                    <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-bg-primary border-2 border-accent rounded-[2px] pointer-events-none" />
                    <div className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-bg-primary border-2 border-accent rounded-[2px] pointer-events-none" />
                    {isLocked ? (
                      <div className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-bg-primary border-2 border-accent rounded-[2px] pointer-events-none" />
                    ) : (
                      <div
                        className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-bg-primary rounded-[2px] cursor-nwse-resize border-2 border-accent"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          const startX = e.clientX;
                          const startW = pos.w;
                          const onMove = (ev) => {
                            const sc = cameraRef.current.zoom / 100;
                            const dw = (ev.clientX - startX) / sc;
                            positionsRef.current[img.id] = { ...positionsRef.current[img.id], w: Math.max(120, startW + dw) };
                            forceRender();
                          };
                          const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
                          window.addEventListener("pointermove", onMove);
                          window.addEventListener("pointerup", onUp);
                        }}
                      />
                    )}
                  </>
                )}
              </div>

              <p className="text-[10px] text-text-tertiary truncate px-0.5 pointer-events-none mt-0 pt-1 leading-tight bg-bg-primary/85 border-t border-accent/25 rounded-b-lg">
                {img.prompt}
              </p>
            </div>
          );
        })}

        {shapeItems.map((s) => (
          <div
            key={s.id}
            data-shape-item={s.id}
            className={`absolute z-[15] pointer-events-auto border-2 transition-colors ${
              selectedShapeId === s.id
                ? "border-accent shadow-[0_0_0_1px_rgba(63,202,88,0.35)]"
                : "border-white/45 hover:border-white/70"
            } ${s.kind === "ellipse" ? "rounded-full" : "rounded-lg"}`}
            style={{
              left: s.x,
              top: s.y,
              width: s.w,
              height: s.h,
              background: "rgba(63, 202, 88, 0.06)",
            }}
          />
        ))}

        {textItems.map((t) => {
          const isHighlighted =
            selectedTextId === t.id || multiSelectedTextIds.includes(t.id);
          const isEditing = editingTextId === t.id;
          const fontPx = Math.min(MAX_TEXT_FONT, Math.max(MIN_TEXT_FONT, t.fontSize ?? DEFAULT_TEXT_FONT));
          const bumpFont = (delta) => {
            const next = Math.min(MAX_TEXT_FONT, Math.max(MIN_TEXT_FONT, fontPx + delta));
            onUpdateText?.(t.id, { fontSize: next });
          };
          const showSelectBar =
            isSelectTool &&
            isHighlighted &&
            !isEditing &&
            multiSelectedImageIds.length + multiSelectedTextIds.length <= 1;
          return (
            <div
              key={t.id}
              data-text-item={t.id}
              className={`absolute z-[25] max-w-[min(92vw,480px)] ${
                isHighlighted && !isEditing ? "outline outline-1 outline-accent/70 outline-offset-2 rounded-sm" : ""
              } ${isSelectTool && !isEditing ? "cursor-move" : ""}`}
              style={{ left: t.x, top: t.y }}
              onPointerDown={(e) => {
                if (isEditing) return;
                handleTextItemPointerDown(e, t);
              }}
            >
              {showSelectBar && (
                <div
                  className="absolute -top-9 left-0 flex items-center gap-0.5 rounded-lg bg-bg-secondary/95 border border-border-primary px-1 py-0.5 shadow-md pointer-events-auto"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    title="缩小字号"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                    onClick={() => bumpFont(-2)}
                  >
                    <Minus size={14} />
                  </button>
                  <span className="text-[10px] text-text-tertiary tabular-nums min-w-[2.25rem] text-center">{fontPx}px</span>
                  <button
                    type="button"
                    title="放大字号"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                    onClick={() => bumpFont(2)}
                  >
                    <Plus size={14} />
                  </button>
                  <div className="w-px h-5 bg-border-primary mx-0.5" />
                  <button
                    type="button"
                    title="删除文案"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-red-400 hover:bg-red-500/15 transition-colors"
                    onClick={() => {
                      onDeleteText?.(t.id);
                      setSelectedTextId(null);
                      setEditingTextId(null);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
              {isEditing ? (
                <textarea
                  data-text-editor={t.id}
                  value={t.text}
                  onChange={(e) => onUpdateText?.(t.id, { text: e.target.value })}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={() => setEditingTextId(null)}
                  autoFocus
                  rows={4}
                  placeholder="输入文案…"
                  style={{ fontSize: fontPx }}
                  className="w-[min(92vw,420px)] min-h-[4em] resize-y rounded-sm bg-transparent border-0 px-0.5 py-0 text-text-primary placeholder-text-tertiary/80 outline-none focus:ring-0 focus:shadow-[0_0_0_1px_rgba(63,202,88,0.5)] select-text leading-relaxed"
                />
              ) : (
                <div
                  role="presentation"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setMultiSelectedImageIds([]);
                    setMultiSelectedTextIds([]);
                    setSelectedShapeId(null);
                    setSelectedTextId(t.id);
                    setEditingTextId(t.id);
                  }}
                  style={{ fontSize: fontPx }}
                  className={`max-w-[min(92vw,480px)] whitespace-pre-wrap leading-relaxed ${
                    isSelectTool && !isEditing ? "cursor-move" : "cursor-text"
                  } ${
                    t.text.trim()
                      ? "text-text-primary [text-shadow:0_1px_3px_rgba(0,0,0,0.85),0_0_12px_rgba(0,0,0,0.35)]"
                      : "text-text-tertiary/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]"
                  }`}
                >
                  {t.text.trim() ? t.text : "选择工具：单击选中 · 拖拽移动 · 双击编辑"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating toolbar at bottom center */}
      <div data-toolbar>
        <Toolbar
          activeTool={activeTool}
          onToolChange={onToolChange}
          zoom={zoom}
          onZoomChange={handleToolbarZoomChange}
          shapeMode={shapeMode}
          onShapeModeChange={onShapeModeChange}
        />
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          img={contextMenu.img}
          isLocked={lockedRef.current.has(contextMenu.img.id)}
          onClose={() => setContextMenu(null)}
          onAction={handleContextAction}
        />
      )}
    </div>
  );
}
