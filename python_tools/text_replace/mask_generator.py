from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .schema import TextBlock


@dataclass
class MaskResult:
    mask: np.ndarray
    method: str
    box: dict[str, int]


def _bbox_from_mask(mask: np.ndarray) -> dict[str, int]:
    ys, xs = np.where(mask > 0)
    if len(xs) == 0 or len(ys) == 0:
        return {"x": 0, "y": 0, "w": 0, "h": 0}
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    return {"x": x0, "y": y0, "w": max(1, x1 - x0 + 1), "h": max(1, y1 - y0 + 1)}


class TextMaskGenerator:
    """Generate a pixel mask for each text block.

    Preferred mode is SAM-style box-prompt segmentation when available.
    If no checkpoint is configured, we gracefully fall back to a refined
    OCR-guided mask built from the quad, luminance contrast, and morphology.
    """

    def __init__(
        self,
        engine: str = "auto",
        sam_model_type: str = "vit_b",
        sam_checkpoint: str | Path | None = None,
    ) -> None:
        self.engine = engine
        self.sam_model_type = sam_model_type
        self.sam_checkpoint = str(sam_checkpoint) if sam_checkpoint else None
        self._predictor = None

    @property
    def predictor(self):
        if self._predictor is not None:
            return self._predictor
        if self.engine not in {"auto", "sam", "sam2"}:
            return None
        if not self.sam_checkpoint or not Path(self.sam_checkpoint).exists():
            return None
        try:
            from segment_anything import SamPredictor, sam_model_registry
        except Exception:
            return None
        model = sam_model_registry[self.sam_model_type](checkpoint=self.sam_checkpoint)
        self._predictor = SamPredictor(model)
        return self._predictor

    def generate(self, image: np.ndarray, block: TextBlock, pad: int = 8) -> MaskResult:
        predictor = self.predictor
        if predictor is not None:
            try:
                mask = self._generate_with_sam(image, block, predictor, pad=pad)
                return MaskResult(mask=mask, method="sam", box=_bbox_from_mask(mask))
            except Exception:
                pass
        mask = self._generate_with_refine(image, block, pad=pad)
        return MaskResult(mask=mask, method="refine", box=_bbox_from_mask(mask))

    def build_full_mask(self, image: np.ndarray, blocks: list[TextBlock], pad: int = 8) -> tuple[np.ndarray, list[TextBlock]]:
        full_mask = np.zeros(image.shape[:2], dtype=np.uint8)
        enriched_blocks: list[TextBlock] = []
        for block in blocks:
            if not block.enabled:
                enriched_blocks.append(block)
                continue
            result = self.generate(image, block, pad=pad)
            full_mask = np.maximum(full_mask, result.mask)
            block.mask_box = result.box
            note = f"mask={result.method}"
            block.notes = f"{block.notes}; {note}".strip("; ").strip()
            enriched_blocks.append(block)
        return full_mask, enriched_blocks

    def _generate_with_sam(self, image: np.ndarray, block: TextBlock, predictor, pad: int = 8) -> np.ndarray:
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        predictor.set_image(rgb)
        bbox = block.bbox
        x0 = max(0, bbox["x"] - pad)
        y0 = max(0, bbox["y"] - pad)
        x1 = min(image.shape[1] - 1, bbox["x"] + bbox["w"] + pad)
        y1 = min(image.shape[0] - 1, bbox["y"] + bbox["h"] + pad)
        input_box = np.array([x0, y0, x1, y1], dtype=np.float32)
        masks, scores, _ = predictor.predict(box=input_box, multimask_output=True)
        if masks is None or len(masks) == 0:
            raise RuntimeError("SAM returned no mask")
        best_index = int(np.argmax(scores))
        mask = (masks[best_index].astype(np.uint8) * 255)
        return self._cleanup_mask(mask, block)

    def _generate_with_refine(self, image: np.ndarray, block: TextBlock, pad: int = 8) -> np.ndarray:
        h, w = image.shape[:2]
        bbox = block.bbox
        x0 = max(0, bbox["x"] - pad)
        y0 = max(0, bbox["y"] - pad)
        x1 = min(w, bbox["x"] + bbox["w"] + pad)
        y1 = min(h, bbox["y"] + bbox["h"] + pad)
        crop = image[y0:y1, x0:x1]
        crop_mask = np.zeros(crop.shape[:2], dtype=np.uint8)

        quad = np.array(block.quad, dtype=np.float32)
        quad[:, 0] -= x0
        quad[:, 1] -= y0
        cv2.fillPoly(crop_mask, [quad.astype(np.int32)], 255)

        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        _, otsu_inv = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        poly_pixels = gray[crop_mask > 0]
        if poly_pixels.size == 0:
            refined = crop_mask
        else:
            median = float(np.median(poly_pixels))
            contrast_dark = np.abs(gray.astype(np.float32) - median) > 18.0
            candidate = ((otsu_inv > 0) | (otsu > 0) | contrast_dark).astype(np.uint8) * 255
            refined = cv2.bitwise_and(candidate, crop_mask)

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        refined = cv2.morphologyEx(refined, cv2.MORPH_CLOSE, kernel, iterations=1)
        refined = cv2.dilate(refined, kernel, iterations=1)

        full_mask = np.zeros(image.shape[:2], dtype=np.uint8)
        full_mask[y0:y1, x0:x1] = refined
        return self._cleanup_mask(full_mask, block)

    def _cleanup_mask(self, mask: np.ndarray, block: TextBlock) -> np.ndarray:
        quad_mask = np.zeros_like(mask)
        cv2.fillPoly(quad_mask, [np.array(block.quad, dtype=np.int32)], 255)
        mask = cv2.bitwise_and(mask, cv2.dilate(quad_mask, np.ones((5, 5), np.uint8), iterations=1))
        if mask.sum() == 0:
            return quad_mask
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
        cleaned = np.zeros_like(mask)
        min_area = max(6, int(block.bbox["w"] * block.bbox["h"] * 0.01))
        for idx in range(1, num_labels):
            area = stats[idx, cv2.CC_STAT_AREA]
            if area >= min_area:
                cleaned[labels == idx] = 255
        return cleaned if cleaned.sum() > 0 else mask
