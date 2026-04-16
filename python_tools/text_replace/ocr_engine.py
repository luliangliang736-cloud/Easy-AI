from __future__ import annotations

import json
import math
import os
from pathlib import Path

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from paddleocr import PaddleOCR

from .schema import TextBlock


def quad_to_bbox(quad: list[list[float]]) -> dict[str, int]:
    xs = [point[0] for point in quad]
    ys = [point[1] for point in quad]
    x_min = int(min(xs))
    y_min = int(min(ys))
    x_max = int(max(xs))
    y_max = int(max(ys))
    return {
        "x": x_min,
        "y": y_min,
        "w": max(1, x_max - x_min),
        "h": max(1, y_max - y_min),
    }


def quad_angle(quad: list[list[float]]) -> float:
    if len(quad) < 2:
        return 0.0
    x1, y1 = quad[0]
    x2, y2 = quad[1]
    return math.atan2(y2 - y1, x2 - x1)


def blocks_to_json(blocks: list[TextBlock]) -> str:
    return json.dumps([block.to_dict() for block in blocks], ensure_ascii=False, indent=2)


def save_blocks_json(blocks: list[TextBlock], output_path: str | Path) -> Path:
    output = Path(output_path)
    output.write_text(blocks_to_json(blocks), encoding="utf-8")
    return output


def load_blocks_json(json_text: str) -> list[TextBlock]:
    data = json.loads(json_text)
    if not isinstance(data, list):
        raise ValueError("Expected a JSON array of text blocks.")
    return [TextBlock.from_dict(item) for item in data]


class OCRDetector:
    def __init__(self, lang: str = "en", use_angle_cls: bool = True) -> None:
        self.lang = lang
        self.use_angle_cls = use_angle_cls
        self._ocr: PaddleOCR | None = None

    @property
    def engine(self) -> PaddleOCR:
        if self._ocr is None:
            self._ocr = PaddleOCR(
                lang=self.lang,
                use_textline_orientation=self.use_angle_cls,
                enable_mkldnn=False,
            )
        return self._ocr

    def detect(self, image_path: str | Path) -> list[TextBlock]:
        result = self.engine.predict(
            str(image_path),
            use_textline_orientation=self.use_angle_cls,
        )
        blocks: list[TextBlock] = []
        if not result:
            return blocks

        first = result[0]
        if isinstance(first, (list, tuple)):
            lines = first
            for index, entry in enumerate(lines):
                quad_raw, payload = entry
                text = str(payload[0]).strip()
                if not text:
                    continue
                quad = [[float(x), float(y)] for x, y in quad_raw]
                blocks.append(
                    TextBlock(
                        id=f"text_{index}",
                        text=text,
                        replacement=text,
                        score=float(payload[1]),
                        quad=quad,
                        bbox=quad_to_bbox(quad),
                        angle=quad_angle(quad),
                    )
                )
            return blocks

        texts = list(first.get("rec_texts", []) or [])
        scores = list(first.get("rec_scores", []) or [])
        polys = list(first.get("rec_polys", []) or first.get("dt_polys", []) or [])
        limit = min(len(texts), len(scores), len(polys))
        for index in range(limit):
            text = str(texts[index] or "").strip()
            score = float(scores[index] or 0.0)
            if not text or score <= 0.15:
                continue
            quad_raw = polys[index]
            quad = [[float(point[0]), float(point[1])] for point in quad_raw]
            blocks.append(
                TextBlock(
                    id=f"text_{index}",
                    text=text,
                    replacement=text,
                    score=score,
                    quad=quad,
                    bbox=quad_to_bbox(quad),
                    angle=quad_angle(quad),
                )
            )

        return blocks
