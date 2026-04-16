from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .layout_preserver import fit_font_with_layout
from .schema import TextBlock


COMMON_FONT_PATHS = [
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/calibri.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def load_image_bgr(image_path: str | Path) -> np.ndarray:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"Unable to read image: {image_path}")
    return image


def save_image_bgr(image: np.ndarray, output_path: str | Path) -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    ok = cv2.imwrite(str(output), image)
    if not ok:
        raise RuntimeError(f"Unable to write image: {output}")
    return output


def save_image_rgb(image: np.ndarray, output_path: str | Path) -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    ok = cv2.imwrite(str(output), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    if not ok:
        raise RuntimeError(f"Unable to write image: {output}")
    return output


def choose_font_path(requested: str | None = None) -> str:
    if requested and Path(requested).exists():
        return requested
    for candidate in COMMON_FONT_PATHS:
        if Path(candidate).exists():
            return candidate
    raise FileNotFoundError("No usable TTF font found. Pass font_path explicitly.")


def estimate_text_color(image: np.ndarray, bbox: dict[str, int]) -> list[int]:
    x = max(0, bbox["x"])
    y = max(0, bbox["y"])
    w = max(1, bbox["w"])
    h = max(1, bbox["h"])
    crop = image[y : y + h, x : x + w]
    if crop.size == 0:
        return [0, 0, 0]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    threshold = np.percentile(gray, 35)
    mask = gray <= threshold
    if int(mask.sum()) < 8:
        bgr = crop.reshape(-1, 3).mean(axis=0)
    else:
        bgr = crop[mask].reshape(-1, 3).mean(axis=0)
    return [int(bgr[2]), int(bgr[1]), int(bgr[0])]


def expand_quad(quad: list[list[float]], pad: float = 4.0, scale: float = 1.06) -> np.ndarray:
    points = np.array(quad, dtype=np.float32)
    center = points.mean(axis=0)
    expanded = center + (points - center) * scale
    vectors = expanded - center
    lengths = np.linalg.norm(vectors, axis=1, keepdims=True)
    lengths[lengths == 0] = 1.0
    expanded = expanded + (vectors / lengths) * pad
    return expanded.astype(np.int32)


def build_text_mask(
    image: np.ndarray,
    blocks: list[TextBlock],
    pad: float = 4.0,
    scale: float = 1.06,
) -> np.ndarray:
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    for block in blocks:
        if not block.enabled:
            continue
        polygon = expand_quad(block.quad, pad=pad, scale=scale)
        cv2.fillPoly(mask, [polygon], 255)
    return mask


def inpaint_image(
    image: np.ndarray,
    mask: np.ndarray,
    method: str = "telea",
    radius: int = 3,
) -> np.ndarray:
    flag = cv2.INPAINT_TELEA if method.lower() == "telea" else cv2.INPAINT_NS
    return cv2.inpaint(image, mask, radius, flag)


def _split_long_token(token: str, draw: ImageDraw.ImageDraw, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    pieces: list[str] = []
    current = ""
    for char in token:
        candidate = current + char
        width = draw.textbbox((0, 0), candidate, font=font)[2]
        if current and width > max_width:
            pieces.append(current)
            current = char
        else:
            current = candidate
    if current:
        pieces.append(current)
    return pieces


def wrap_text(text: str, draw: ImageDraw.ImageDraw, font: ImageFont.FreeTypeFont, max_width: int) -> str:
    paragraphs = text.splitlines() or [text]
    wrapped_lines: list[str] = []
    for paragraph in paragraphs:
        words = paragraph.split(" ")
        current = ""
        for word in words:
            candidate = word if not current else f"{current} {word}"
            width = draw.textbbox((0, 0), candidate, font=font)[2]
            if current and width > max_width:
                wrapped_lines.append(current)
                if draw.textbbox((0, 0), word, font=font)[2] > max_width:
                    wrapped_lines.extend(_split_long_token(word, draw, font, max_width))
                    current = ""
                else:
                    current = word
            else:
                current = candidate
        if current:
            wrapped_lines.append(current)
        if paragraph == "" and not wrapped_lines:
            wrapped_lines.append("")
    return "\n".join(wrapped_lines) if wrapped_lines else text


def fit_text(
    text: str,
    box_width: int,
    box_height: int,
    font_path: str,
    requested_size: int | None = None,
    min_size: int = 8,
) -> tuple[ImageFont.FreeTypeFont, str, int, int]:
    scratch = Image.new("RGBA", (max(4, box_width * 2), max(4, box_height * 2)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(scratch)
    size = requested_size or max(min_size, int(box_height * 0.72))
    best_wrapped = text
    best_spacing = max(2, int(size * 0.2))

    while size >= min_size:
        font = ImageFont.truetype(font_path, size=size)
        spacing = max(2, int(size * 0.2))
        wrapped = wrap_text(text, draw, font, max_width=max(1, box_width))
        left, top, right, bottom = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=spacing, align="left")
        width = right - left
        height = bottom - top
        if width <= box_width and height <= box_height:
            return font, wrapped, size, spacing
        best_wrapped = wrapped
        best_spacing = spacing
        size -= 1

    font = ImageFont.truetype(font_path, size=min_size)
    return font, best_wrapped, min_size, best_spacing


def _draw_line_with_tracking(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    stroke_width: int,
    stroke_fill: tuple[int, int, int, int],
    tracking: int = 0,
) -> None:
    x, y = position
    for char in text:
        draw.text(
            (x, y),
            char,
            font=font,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
        )
        bbox = draw.textbbox((x, y), char, font=font, stroke_width=stroke_width)
        x = bbox[2] + tracking


def _draw_multiline_text_with_tracking(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    spacing: int,
    align: str,
    stroke_width: int,
    stroke_fill: tuple[int, int, int, int],
    tracking: int = 0,
) -> None:
    x, y = position
    lines = text.splitlines() or [text]
    max_width = 0
    for line in lines:
        line_bbox = draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width)
        line_width = (line_bbox[2] - line_bbox[0]) + max(0, len(line) - 1) * tracking
        max_width = max(max_width, line_width)

    cursor_y = y
    for line in lines:
        line_bbox = draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width)
        line_width = (line_bbox[2] - line_bbox[0]) + max(0, len(line) - 1) * tracking
        if align == "left":
            cursor_x = x
        elif align == "right":
            cursor_x = x + max_width - line_width
        else:
            cursor_x = x + int((max_width - line_width) / 2)
        _draw_line_with_tracking(
            draw,
            (cursor_x, cursor_y),
            line,
            font=font,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
            tracking=tracking,
        )
        cursor_y += (line_bbox[3] - line_bbox[1]) + spacing


def render_text_blocks(
    image: np.ndarray,
    original_image: np.ndarray,
    blocks: list[TextBlock],
    default_font_path: str | None = None,
) -> np.ndarray:
    base = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGBA))
    canvas_size = base.size

    for block in blocks:
        if not block.enabled:
            continue
        replacement = (block.replacement or "").strip()
        if not replacement:
            continue

        x = int(block.bbox["x"])
        y = int(block.bbox["y"])
        w = max(1, int(block.bbox["w"]))
        h = max(1, int(block.bbox["h"]))
        font_path = choose_font_path(block.font_path or default_font_path)
        fill = tuple(block.fill or estimate_text_color(original_image, block.bbox))
        stroke_fill = tuple(block.stroke_fill or fill)
        fit_width = max(1, int(w * 0.96))
        fit_height = max(1, int(h * 0.96))
        font, layout = fit_font_with_layout(
            replacement,
            box_width=fit_width,
            box_height=fit_height,
            font_path=font_path,
            block=block,
        )
        wrapped = layout.wrapped_text
        spacing = layout.spacing
        tracking = layout.char_spacing

        patch_width = max(w * 3, 256)
        patch_height = max(h * 3, 128)
        patch = Image.new("RGBA", (patch_width, patch_height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(patch)
        left, top, right, bottom = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=spacing, align=block.align)
        text_width = right - left
        text_height = bottom - top

        if block.align == "left":
            tx = int(patch_width * 0.16)
        elif block.align == "right":
            tx = int(max(0, patch_width - text_width - patch_width * 0.16))
        else:
            tx = int((patch_width - text_width) / 2)
        ty = int((patch_height - text_height) / 2)

        _draw_multiline_text_with_tracking(
            draw,
            (tx, ty),
            wrapped,
            fill=fill + (255,),
            spacing=spacing,
            align=block.align,
            stroke_width=int(block.stroke_width),
            stroke_fill=stroke_fill + (255,),
            font=font,
            tracking=tracking,
        )

        rotated = patch.rotate(-math.degrees(block.angle), expand=True, resample=Image.Resampling.BICUBIC)
        cx = x + w / 2.0
        cy = y + h / 2.0
        px = int(cx - rotated.width / 2.0)
        py = int(cy - rotated.height / 2.0)

        overlay = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
        overlay.alpha_composite(rotated, (px, py))
        base = Image.alpha_composite(base, overlay)

    return cv2.cvtColor(np.array(base), cv2.COLOR_RGBA2BGR)


def draw_text_block_preview(
    image: np.ndarray,
    blocks: list[TextBlock],
    selected_id: str | None = None,
) -> np.ndarray:
    preview = image.copy()
    for index, block in enumerate(blocks, start=1):
        quad = np.array(block.quad, dtype=np.int32)
        color = (0, 200, 255) if block.id == selected_id else (60, 220, 60)
        thickness = 3 if block.id == selected_id else 2
        cv2.polylines(preview, [quad], isClosed=True, color=color, thickness=thickness)

        x = int(block.bbox["x"])
        y = max(0, int(block.bbox["y"]) - 24)
        label = f"{index}. {block.text[:24]}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.rectangle(preview, (x, y), (x + tw + 12, y + th + 10), color, -1)
        cv2.putText(
            preview,
            label,
            (x + 6, y + th + 2),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (20, 20, 20),
            1,
            cv2.LINE_AA,
        )
    return preview
