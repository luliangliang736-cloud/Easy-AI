from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont

from .schema import TextBlock


@dataclass
class LayoutResult:
    wrapped_text: str
    spacing: int
    char_spacing: int
    line_count: int


def _split_words(text: str) -> list[str]:
    parts = [part for part in text.replace("\n", " ").split(" ") if part]
    return parts or [text.strip()]


def _rebalance_to_line_count(
    text: str,
    draw: ImageDraw.ImageDraw,
    font: ImageFont.FreeTypeFont,
    target_lines: int,
    max_width: int,
) -> str:
    if target_lines <= 1:
        return text
    words = _split_words(text)
    if len(words) <= 1:
        return text

    lines: list[str] = []
    remaining = words[:]
    for line_index in range(target_lines):
        lines_left = target_lines - line_index
        if lines_left <= 1:
            lines.append(" ".join(remaining))
            break
        target_words = max(1, round(len(remaining) / lines_left))
        current = []
        while remaining:
            candidate = " ".join(current + [remaining[0]])
            width = draw.textbbox((0, 0), candidate, font=font)[2]
            if current and width > max_width:
                break
            current.append(remaining.pop(0))
            if len(current) >= target_words:
                break
        lines.append(" ".join(current))
    return "\n".join(line for line in lines if line)


def preserve_layout(
    text: str,
    draw: ImageDraw.ImageDraw,
    font: ImageFont.FreeTypeFont,
    box_width: int,
    block: TextBlock,
) -> LayoutResult:
    original_lines = [line for line in (block.text or "").splitlines() if line.strip()]
    target_line_count = max(1, len(original_lines))
    wrapped = _rebalance_to_line_count(text, draw, font, target_line_count, max_width=max(1, box_width))
    spacing = max(2, int(block.line_spacing if block.line_spacing is not None else font.size * 0.2))
    char_spacing = max(0, int(block.char_spacing if block.char_spacing is not None else font.size * 0.02))
    return LayoutResult(
        wrapped_text=wrapped,
        spacing=spacing,
        char_spacing=char_spacing,
        line_count=max(1, wrapped.count("\n") + 1),
    )


def fit_font_with_layout(
    text: str,
    box_width: int,
    box_height: int,
    font_path: str,
    block: TextBlock,
    min_size: int = 8,
) -> tuple[ImageFont.FreeTypeFont, LayoutResult]:
    scratch = Image.new("RGBA", (max(4, box_width * 2), max(4, box_height * 2)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(scratch)
    size = block.font_size or max(min_size, int(box_height * 0.72))
    best_layout: LayoutResult | None = None
    best_font: ImageFont.FreeTypeFont | None = None

    while size >= min_size:
        font = ImageFont.truetype(font_path, size=size)
        layout = preserve_layout(text, draw, font, box_width=box_width, block=block)
        left, top, right, bottom = draw.multiline_textbbox(
            (0, 0),
            layout.wrapped_text,
            font=font,
            spacing=layout.spacing,
            align=block.align,
        )
        width = right - left
        height = bottom - top
        best_layout = layout
        best_font = font
        if width <= box_width and height <= box_height:
            return font, layout
        size -= 1

    assert best_font is not None and best_layout is not None
    return best_font, best_layout
