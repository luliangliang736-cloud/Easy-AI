from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class SelectionResult:
    mask: np.ndarray
    method: str
    box: dict[str, int]
    score: float | None = None


def load_image_bgr(image_path: str | Path) -> np.ndarray:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Failed to read image: {image_path}")
    return image


def bbox_from_mask(mask: np.ndarray) -> dict[str, int]:
    ys, xs = np.where(mask > 0)
    if len(xs) == 0 or len(ys) == 0:
        return {"x": 0, "y": 0, "w": 0, "h": 0}
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    return {"x": x0, "y": y0, "w": max(1, x1 - x0 + 1), "h": max(1, y1 - y0 + 1)}


def _clamp_point(x: int, y: int, width: int, height: int) -> tuple[int, int]:
    return max(0, min(width - 1, int(x))), max(0, min(height - 1, int(y)))


def _cleanup_mask(mask: np.ndarray, x: int, y: int) -> np.ndarray:
    binary = (mask > 0).astype(np.uint8)
    if binary.sum() == 0:
        return np.zeros_like(binary, dtype=np.uint8)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    selected_label = labels[y, x] if 0 <= y < labels.shape[0] and 0 <= x < labels.shape[1] else 0

    if selected_label <= 0:
        best_label = 0
        best_area = 0
        for idx in range(1, num_labels):
            area = int(stats[idx, cv2.CC_STAT_AREA])
            if area > best_area:
                best_label = idx
                best_area = area
        selected_label = best_label

    cleaned = np.zeros_like(binary, dtype=np.uint8)
    if selected_label > 0:
        cleaned[labels == selected_label] = 255
    else:
        cleaned = (binary * 255).astype(np.uint8)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel, iterations=1)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_OPEN, kernel, iterations=1)
    cleaned = cv2.GaussianBlur(cleaned, (5, 5), 0)
    return np.where(cleaned > 32, 255, 0).astype(np.uint8)


def _select_with_sam(image: np.ndarray, x: int, y: int, sam_model_type: str, sam_checkpoint: str | None) -> SelectionResult | None:
    if not sam_checkpoint or not Path(sam_checkpoint).exists():
        return None
    try:
        from segment_anything import SamPredictor, sam_model_registry
    except Exception:
        return None

    predictor = SamPredictor(sam_model_registry[sam_model_type](checkpoint=sam_checkpoint))
    predictor.set_image(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    point_coords = np.array([[x, y]], dtype=np.float32)
    point_labels = np.array([1], dtype=np.int32)
    masks, scores, _ = predictor.predict(
        point_coords=point_coords,
        point_labels=point_labels,
        multimask_output=True,
    )
    if masks is None or len(masks) == 0:
        return None

    image_area = float(image.shape[0] * image.shape[1])
    best_mask = None
    best_score = -1.0
    for idx, mask in enumerate(masks):
        candidate = (mask.astype(np.uint8) * 255)
        if candidate[y, x] == 0:
            continue
        area_ratio = float(candidate.sum() / 255.0) / max(1.0, image_area)
        if area_ratio > 0.92:
            continue
        score = float(scores[idx]) - (area_ratio * 0.15)
        if score > best_score:
            best_score = score
            best_mask = candidate

    if best_mask is None:
        return None

    cleaned = _cleanup_mask(best_mask, x, y)
    return SelectionResult(
        mask=cleaned,
        method="sam",
        box=bbox_from_mask(cleaned),
        score=best_score,
    )


def _select_with_grabcut(image: np.ndarray, x: int, y: int) -> SelectionResult:
    h, w = image.shape[:2]
    mask = np.full((h, w), cv2.GC_PR_BGD, dtype=np.uint8)
    border = max(6, int(min(h, w) * 0.03))
    mask[:border, :] = cv2.GC_BGD
    mask[-border:, :] = cv2.GC_BGD
    mask[:, :border] = cv2.GC_BGD
    mask[:, -border:] = cv2.GC_BGD

    fg_radius = max(10, int(min(h, w) * 0.035))
    probable_radius = max(fg_radius * 3, int(min(h, w) * 0.16))
    cv2.circle(mask, (x, y), probable_radius, cv2.GC_PR_FGD, thickness=-1)
    cv2.circle(mask, (x, y), fg_radius, cv2.GC_FGD, thickness=-1)

    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(image, mask, None, bgd_model, fgd_model, 4, cv2.GC_INIT_WITH_MASK)

    binary = np.where(
        (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD),
        255,
        0,
    ).astype(np.uint8)
    cleaned = _cleanup_mask(binary, x, y)
    return SelectionResult(mask=cleaned, method="grabcut", box=bbox_from_mask(cleaned))


def select_object(
    image: np.ndarray,
    x: int,
    y: int,
    sam_model_type: str = "vit_b",
    sam_checkpoint: str | None = None,
) -> SelectionResult:
    h, w = image.shape[:2]
    x, y = _clamp_point(x, y, w, h)
    sam_result = _select_with_sam(image, x, y, sam_model_type=sam_model_type, sam_checkpoint=sam_checkpoint)
    if sam_result is not None:
        return sam_result
    return _select_with_grabcut(image, x, y)


def mask_to_data_url(mask: np.ndarray, color: tuple[int, int, int, int] = (63, 202, 88, 170)) -> str:
    rgba = np.zeros((mask.shape[0], mask.shape[1], 4), dtype=np.uint8)
    rgba[:, :, 1] = color[1]
    rgba[:, :, 2] = color[2]
    rgba[:, :, 3] = np.where(mask > 0, color[3], 0).astype(np.uint8)
    rgba[:, :, 0] = color[0]
    success, encoded = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    if not success:
        raise RuntimeError("Failed to encode mask image")
    return f"data:image/png;base64,{base64.b64encode(encoded.tobytes()).decode('ascii')}"
