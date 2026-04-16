from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class TextBlock:
    id: str
    text: str
    replacement: str
    score: float
    quad: list[list[float]]
    bbox: dict[str, int]
    angle: float = 0.0
    align: str = "center"
    enabled: bool = True
    font_path: str | None = None
    font_size: int | None = None
    font_weight: str = "auto"
    style_name: str = ""
    fill: list[int] | None = None
    fill_confidence: float = 0.0
    stroke_fill: list[int] | None = None
    stroke_confidence: float = 0.0
    stroke_width: int = 0
    shadow_fill: list[int] | None = None
    shadow_offset: list[int] | None = None
    line_boxes: list[dict[str, int]] | None = None
    line_spacing: float | None = None
    char_spacing: float | None = None
    mask_box: dict[str, int] | None = None
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TextBlock":
        return cls(
            id=str(data["id"]),
            text=str(data.get("text", "")),
            replacement=str(data.get("replacement", data.get("text", ""))),
            score=float(data.get("score", 0.0)),
            quad=[[float(x), float(y)] for x, y in data.get("quad", [])],
            bbox={
                "x": int(data.get("bbox", {}).get("x", 0)),
                "y": int(data.get("bbox", {}).get("y", 0)),
                "w": int(data.get("bbox", {}).get("w", 0)),
                "h": int(data.get("bbox", {}).get("h", 0)),
            },
            angle=float(data.get("angle", 0.0)),
            align=str(data.get("align", "center")),
            enabled=bool(data.get("enabled", True)),
            font_path=data.get("font_path"),
            font_size=int(data["font_size"]) if data.get("font_size") is not None else None,
            font_weight=str(data.get("font_weight", "auto")),
            style_name=str(data.get("style_name", "")),
            fill=[int(v) for v in data["fill"]] if data.get("fill") else None,
            fill_confidence=float(data.get("fill_confidence", 0.0)),
            stroke_fill=[int(v) for v in data["stroke_fill"]] if data.get("stroke_fill") else None,
            stroke_confidence=float(data.get("stroke_confidence", 0.0)),
            stroke_width=int(data.get("stroke_width", 0)),
            shadow_fill=[int(v) for v in data["shadow_fill"]] if data.get("shadow_fill") else None,
            shadow_offset=[int(v) for v in data["shadow_offset"]] if data.get("shadow_offset") else None,
            line_boxes=[
                {
                    "x": int(item.get("x", 0)),
                    "y": int(item.get("y", 0)),
                    "w": int(item.get("w", 0)),
                    "h": int(item.get("h", 0)),
                }
                for item in data.get("line_boxes", []) or []
            ] or None,
            line_spacing=float(data["line_spacing"]) if data.get("line_spacing") is not None else None,
            char_spacing=float(data["char_spacing"]) if data.get("char_spacing") is not None else None,
            mask_box={
                "x": int(data.get("mask_box", {}).get("x", 0)),
                "y": int(data.get("mask_box", {}).get("y", 0)),
                "w": int(data.get("mask_box", {}).get("w", 0)),
                "h": int(data.get("mask_box", {}).get("h", 0)),
            } if data.get("mask_box") else None,
            notes=str(data.get("notes", "")),
        )
