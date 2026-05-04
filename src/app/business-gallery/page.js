"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";

const TILE_COORDINATES = [-1, 0, 1];
const PLACEHOLDER_COUNT = 60;
const BUSINESS_GALLERY_IMAGES = Array.from({ length: 50 }, (_, index) => ({
  name: `业务展示 ${index + 1}`,
  url: `/images/business-gallery/business-${index + 1}.webp`,
}));

function wrapOffset(value, size) {
  if (size <= 0) return 0;

  const half = size / 2;
  let next = value;
  while (next <= -half) next += size;
  while (next > half) next -= size;
  return next;
}

function getCanvasMetrics(viewportWidth) {
  if (viewportWidth >= 1600) {
    const columns = 5;
    const cellWidth = 360;
    const cellHeight = 180;
    const gapX = 116;
    const gapY = 108;
    const rows = Math.ceil(PLACEHOLDER_COUNT / columns);
    return {
      columns,
      rows,
      cellWidth,
      cellHeight,
      gapX,
      gapY,
      width: columns * cellWidth + columns * gapX,
      height: rows * cellHeight + rows * gapY,
    };
  }

  if (viewportWidth >= 1200) {
    const columns = 4;
    const cellWidth = 320;
    const cellHeight = 160;
    const gapX = 96;
    const gapY = 92;
    const rows = Math.ceil(PLACEHOLDER_COUNT / columns);
    return {
      columns,
      rows,
      cellWidth,
      cellHeight,
      gapX,
      gapY,
      width: columns * cellWidth + columns * gapX,
      height: rows * cellHeight + rows * gapY,
    };
  }

  if (viewportWidth >= 768) {
    const columns = 3;
    const cellWidth = 280;
    const cellHeight = 140;
    const gapX = 76;
    const gapY = 78;
    const rows = Math.ceil(PLACEHOLDER_COUNT / columns);
    return {
      columns,
      rows,
      cellWidth,
      cellHeight,
      gapX,
      gapY,
      width: columns * cellWidth + columns * gapX,
      height: rows * cellHeight + rows * gapY,
    };
  }

  const columns = 1;
  const cellWidth = 260;
  const cellHeight = 130;
  const gapX = 64;
  const gapY = 72;
  const rows = Math.ceil(PLACEHOLDER_COUNT / columns);
  return {
    columns,
    rows,
    cellWidth,
    cellHeight,
    gapX,
    gapY,
    width: columns * cellWidth + columns * gapX,
    height: rows * cellHeight + rows * gapY,
  };
}

function getCardPosition(index, metrics) {
  const column = index % metrics.columns;
  const row = Math.floor(index / metrics.columns);
  const xPitch = metrics.cellWidth + metrics.gapX;
  const yPitch = metrics.cellHeight + metrics.gapY;

  return {
    x: metrics.gapX / 2 + column * xPitch,
    y: metrics.gapY / 2 + row * yPitch,
  };
}

export default function BusinessGalleryPage() {
  const [viewportWidth, setViewportWidth] = useState(1200);
  const [isDragging, setIsDragging] = useState(false);
  const [trailPoints, setTrailPoints] = useState([]);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const trailClearTimerRef = useRef(null);
  const currentOffsetRef = useRef({ x: 0, y: 0 });
  const targetOffsetRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const dragStateRef = useRef({
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
  });
  const metrics = useMemo(() => getCanvasMetrics(viewportWidth), [viewportWidth]);
  const placeholders = useMemo(
    () => Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => ({
      id: `business-placeholder-${index + 1}`,
      label: String(index + 1).padStart(2, "0"),
    })),
    []
  );

  const applyTransform = useCallback((offset) => {
    if (!canvasRef.current) return;
    canvasRef.current.style.transform = `translate3d(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px), 0)`;
  }, []);

  const normalizeOffset = useCallback((offset) => ({
    x: wrapOffset(offset.x, metrics.width),
    y: wrapOffset(offset.y, metrics.height),
  }), [metrics.height, metrics.width]);

  const startAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) return;

    const tick = () => {
      if (!dragStateRef.current.active) {
        if (Math.abs(velocityRef.current.x) > 0.008 || Math.abs(velocityRef.current.y) > 0.008) {
          const rawTarget = {
            x: targetOffsetRef.current.x + velocityRef.current.x,
            y: targetOffsetRef.current.y + velocityRef.current.y,
          };
          const normalizedTarget = normalizeOffset(rawTarget);

          if (rawTarget.x !== normalizedTarget.x) {
            currentOffsetRef.current = {
              ...currentOffsetRef.current,
              x: currentOffsetRef.current.x + (rawTarget.x > 0 ? -metrics.width : metrics.width),
            };
          }

          if (rawTarget.y !== normalizedTarget.y) {
            currentOffsetRef.current = {
              ...currentOffsetRef.current,
              y: currentOffsetRef.current.y + (rawTarget.y > 0 ? -metrics.height : metrics.height),
            };
          }

          targetOffsetRef.current = normalizedTarget;
          velocityRef.current = {
            x: velocityRef.current.x * 0.982,
            y: velocityRef.current.y * 0.982,
          };
        } else {
          velocityRef.current = { x: 0, y: 0 };
        }
      }

      const current = currentOffsetRef.current;
      const target = targetOffsetRef.current;
      const easing = dragStateRef.current.active ? 0.16 : 0.06;
      const next = {
        x: current.x + (target.x - current.x) * easing,
        y: current.y + (target.y - current.y) * easing,
      };

      currentOffsetRef.current = next;
      applyTransform(next);

      const settled =
        Math.abs(target.x - next.x) < 0.2 &&
        Math.abs(target.y - next.y) < 0.2 &&
        Math.abs(velocityRef.current.x) < 0.008 &&
        Math.abs(velocityRef.current.y) < 0.008 &&
        !dragStateRef.current.active;

      if (settled) {
        animationFrameRef.current = null;
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [applyTransform, metrics.height, metrics.width, normalizeOffset]);

  const shiftCanvas = useCallback((dx, dy) => {
    const rawTarget = {
      x: targetOffsetRef.current.x + dx,
      y: targetOffsetRef.current.y + dy,
    };
    const normalizedTarget = normalizeOffset(rawTarget);

    if (rawTarget.x !== normalizedTarget.x) {
      currentOffsetRef.current = {
        ...currentOffsetRef.current,
        x: currentOffsetRef.current.x + (rawTarget.x > 0 ? -metrics.width : metrics.width),
      };
    }

    if (rawTarget.y !== normalizedTarget.y) {
      currentOffsetRef.current = {
        ...currentOffsetRef.current,
        y: currentOffsetRef.current.y + (rawTarget.y > 0 ? -metrics.height : metrics.height),
      };
    }

    targetOffsetRef.current = normalizedTarget;
    startAnimation();
  }, [metrics.height, metrics.width, normalizeOffset, startAnimation]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const normalized = normalizeOffset(targetOffsetRef.current);
    targetOffsetRef.current = normalized;
    currentOffsetRef.current = normalized;
    applyTransform(normalized);
  }, [applyTransform, normalizeOffset]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    if (trailClearTimerRef.current !== null) {
      window.clearTimeout(trailClearTimerRef.current);
    }
  }, []);

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    const diagonalDelta = (event.deltaY + event.deltaX) * 0.2;
    const wheelVelocity = diagonalDelta * 0.42;
    velocityRef.current = {
      x: velocityRef.current.x * 0.42 - wheelVelocity * 0.58,
      y: velocityRef.current.y * 0.42 - wheelVelocity * 0.58,
    };
    shiftCanvas(-diagonalDelta, -diagonalDelta);
    startAnimation();
  }, [shiftCanvas, startAnimation]);

  const handlePointerDown = useCallback((event) => {
    dragStateRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
    };
    velocityRef.current = { x: 0, y: 0 };
    if (trailClearTimerRef.current !== null) {
      window.clearTimeout(trailClearTimerRef.current);
      trailClearTimerRef.current = null;
    }
    setTrailPoints([{ x: event.clientX, y: event.clientY }]);
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    startAnimation();
  }, [startAnimation]);

  const handlePointerMove = useCallback((event) => {
    if (!dragStateRef.current.active) return;

    const now = performance.now();
    const dx = (event.clientX - dragStateRef.current.lastX) * 0.52;
    const dy = (event.clientY - dragStateRef.current.lastY) * 0.52;
    const deltaTime = Math.max(now - dragStateRef.current.lastTime, 16);

    dragStateRef.current.lastX = event.clientX;
    dragStateRef.current.lastY = event.clientY;
    dragStateRef.current.lastTime = now;
    const measuredVelocity = {
      x: (dx / deltaTime) * 22,
      y: (dy / deltaTime) * 22,
    };
    velocityRef.current = {
      x: velocityRef.current.x * 0.6 + measuredVelocity.x * 0.4,
      y: velocityRef.current.y * 0.6 + measuredVelocity.y * 0.4,
    };

    shiftCanvas(dx, dy);
    setTrailPoints((prev) => {
      const next = [...prev, { x: event.clientX, y: event.clientY }];
      return next.slice(-18);
    });
  }, [shiftCanvas]);

  const finishDrag = useCallback((event) => {
    if (
      event &&
      dragStateRef.current.pointerId === event.pointerId &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStateRef.current.active = false;
    dragStateRef.current.pointerId = null;
    setIsDragging(false);
    trailClearTimerRef.current = window.setTimeout(() => {
      setTrailPoints([]);
      trailClearTimerRef.current = null;
    }, 260);
    startAnimation();
  }, [startAnimation]);

  return (
    <main className="h-screen overflow-hidden bg-black">
      {trailPoints.length > 1 && (
        <svg className="pointer-events-none fixed inset-0 z-40 h-screen w-screen">
          <defs>
            <filter id="business-drag-trail-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {trailPoints.slice(1).map((point, index) => {
            const prev = trailPoints[index];
            const opacity = (index + 1) / Math.max(trailPoints.length - 1, 1);
            return (
              <line
                key={`${point.x}-${point.y}-${index}`}
                x1={prev.x}
                y1={prev.y}
                x2={point.x}
                y2={point.y}
                stroke="#3FCA58"
                strokeWidth={3}
                strokeLinecap="round"
                opacity={opacity * 0.85}
                filter="url(#business-drag-trail-glow)"
              />
            );
          })}
        </svg>
      )}
      <div className="fixed left-0 right-0 top-0 z-50">
        <nav className="flex items-center justify-between bg-black/65 px-6 py-4 shadow-2xl shadow-black/30 backdrop-blur-xl lg:px-12">
          <Link href="/" className="flex items-center" aria-label="返回首页">
            <BrandLogo className="h-8" wordmarkOffsetClassName="translate-y-[2px]" />
          </Link>
          <div className="flex items-center gap-2 text-xs text-white/55">
            <Link href="/" className="rounded-xl px-3 py-2 transition-colors hover:bg-white/10 hover:text-[#3FCA58]">
              首页
            </Link>
            <Link href="/chat" className="rounded-xl px-3 py-2 transition-colors hover:bg-white/10 hover:text-[#3FCA58]">
              一键创作
            </Link>
            <Link href="/canvas" className="flex items-center gap-1 rounded-xl px-3 py-2 transition-colors hover:bg-white/10 hover:text-[#3FCA58]">
              工作台
              <ArrowRight size={13} />
            </Link>
          </div>
        </nav>
      </div>
      <div
        className={`relative h-screen overflow-hidden touch-none select-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div
          ref={canvasRef}
          className="absolute left-1/2 top-1/2 will-change-transform"
          style={{ transform: "translate3d(-50%, -50%, 0)" }}
        >
          {TILE_COORDINATES.flatMap((tileY) => TILE_COORDINATES.map((tileX) => (
            <div
              key={`tile-${tileX}-${tileY}`}
              className="absolute"
              style={{
                left: tileX * metrics.width,
                top: tileY * metrics.height,
                width: metrics.width,
                height: metrics.height,
              }}
            >
              <div className="relative" style={{ width: `${metrics.width}px`, height: `${metrics.height}px` }}>
                {placeholders.map((item, index) => {
                  const position = getCardPosition(index, metrics);
                  const businessImage = BUSINESS_GALLERY_IMAGES[index % BUSINESS_GALLERY_IMAGES.length];
                  return (
                    <article
                      key={`${tileX}-${tileY}-${item.id}`}
                      className="group absolute"
                      style={{
                        left: `${position.x}px`,
                        top: `${position.y}px`,
                        width: `${metrics.cellWidth}px`,
                        height: `${metrics.cellHeight}px`,
                      }}
                    >
                      <div className="relative h-full w-full overflow-hidden rounded-2xl bg-white/[0.045] transition-transform duration-500 ease-out group-hover:scale-[1.08] group-hover:rotate-[-2deg] group-hover:[transform:perspective(760px)_rotateX(3deg)_rotateY(-5deg)_scale(1.08)]">
                        <img
                          src={businessImage.url}
                          alt={businessImage.name || `业务展示 ${item.label}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )))}
        </div>
      </div>
    </main>
  );
}
