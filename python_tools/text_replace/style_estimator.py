from __future__ import annotations

import cv2
import numpy as np

from .schema import TextBlock


def _rgb_from_bgr(values: np.ndarray) -> list[int]:
    bgr = np.clip(values, 0, 255).astype(np.uint8)
    return [int(bgr[2]), int(bgr[1]), int(bgr[0])]


def _estimate_fill_from_mask(image: np.ndarray, mask: np.ndarray) -> tuple[list[int], float]:
    pixels = image[mask > 0]
    if pixels.size == 0:
        return [0, 0, 0], 0.0
    median = np.median(pixels, axis=0)
    mad = np.mean(np.abs(pixels.astype(np.float32) - median), axis=0).mean()
    confidence = float(max(0.0, min(1.0, 1.0 - (mad / 64.0))))
    return _rgb_from_bgr(median), confidence


def _estimate_stroke(image: np.ndarray, mask: np.ndarray) -> tuple[list[int] | None, int, float]:
    if mask.sum() == 0:
        return None, 0, 0.0
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    outer = cv2.dilate(mask, kernel, iterations=2)
    ring = cv2.subtract(outer, mask)
    pixels = image[ring > 0]
    if pixels.size == 0:
        return None, 0, 0.0
    stroke = _rgb_from_bgr(np.median(pixels, axis=0))
    coverage = float((ring > 0).sum()) / float(max(1, (mask > 0).sum()))
    stroke_width = 1 if coverage > 0.1 else 0
    confidence = float(max(0.0, min(1.0, coverage)))
    if stroke_width == 0:
        return None, 0, 0.0
    return stroke, stroke_width, confidence


def _estimate_weight(mask: np.ndarray, bbox: dict[str, int]) -> str:
    area = max(1, bbox["w"] * bbox["h"])
    density = float((mask > 0).sum()) / float(area)
    return "bold" if density > 0.22 else "regular"


def _estimate_alignment(quad: list[list[float]], bbox: dict[str, int]) -> str:
    quad_x = np.array([point[0] for point in quad], dtype=np.float32)
    center_x = float(quad_x.mean())
    left = float(bbox["x"])
    width = max(1.0, float(bbox["w"]))
    relative = (center_x - left) / width
    if relative < 0.42:
        return "left"
    if relative > 0.58:
        return "right"
    return "center"


def enrich_block_style(image: np.ndarray, mask: np.ndarray, block: TextBlock) -> TextBlock:
    fill, fill_confidence = _estimate_fill_from_mask(image, mask)
    stroke_fill, stroke_width, stroke_confidence = _estimate_stroke(image, mask)

    if block.fill is None:
        block.fill = fill
    block.fill_confidence = max(block.fill_confidence, fill_confidence)

    if block.stroke_fill is None and stroke_fill is not None:
        block.stroke_fill = stroke_fill
    block.stroke_confidence = max(block.stroke_confidence, stroke_confidence)
    block.stroke_width = max(block.stroke_width, stroke_width)

    if block.font_weight == "auto":
        block.font_weight = _estimate_weight(mask, block.bbox)
    if not block.align or block.align == "center":
        block.align = _estimate_alignment(block.quad, block.bbox)

    if block.font_size is None:
        block.font_size = max(8, int(block.bbox["h"] * (0.82 if block.font_weight == "bold" else 0.74)))
    if block.line_boxes is None:
        block.line_boxes = [dict(block.bbox)]
    if block.line_spacing is None:
        block.line_spacing = round(block.font_size * 0.2, 2)
    if block.char_spacing is None:
        block.char_spacing = round(block.font_size * (0.04 if block.font_weight == "bold" else 0.02), 2)
    if not block.style_name:
        block.style_name = f"{block.font_weight}-{block.align}"
    return block
