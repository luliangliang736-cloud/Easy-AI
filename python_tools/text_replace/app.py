from __future__ import annotations

import tempfile
from pathlib import Path

import gradio as gr

from .ocr_engine import blocks_to_json
from .image_ops import draw_text_block_preview, load_image_bgr, save_image_bgr
from .pipeline import TextEditPipeline
from .schema import TextBlock


PIPELINES: dict[str, TextEditPipeline] = {}


def get_pipeline(
    lang: str,
    mask_engine: str = "auto",
    inpaint_engine: str = "auto",
    sam_checkpoint: str | None = None,
    sd_model_id: str = "runwayml/stable-diffusion-inpainting",
) -> TextEditPipeline:
    key = "|".join([lang, mask_engine, inpaint_engine, sam_checkpoint or "", sd_model_id])
    if key not in PIPELINES:
        PIPELINES[key] = TextEditPipeline(
            ocr_lang=lang,
            mask_engine=mask_engine,
            inpaint_engine=inpaint_engine,
            sam_checkpoint=sam_checkpoint,
            sd_model_id=sd_model_id,
        )
    return PIPELINES[key]


def _temp_png(prefix: str) -> Path:
    directory = Path(tempfile.mkdtemp(prefix=prefix))
    return directory / "preview.png"


def _load_blocks(json_text: str) -> list[TextBlock]:
    return TextEditPipeline().load_blocks(json_text)


def _render_preview(image_path: str, blocks: list[TextBlock], selected_id: str | None = None) -> str:
    image = load_image_bgr(image_path)
    preview = draw_text_block_preview(image, blocks, selected_id=selected_id)
    output_path = _temp_png("text_replace_preview_")
    save_image_bgr(preview, output_path)
    return str(output_path)


def _block_choices(blocks: list[TextBlock]) -> list[str]:
    return [block.id for block in blocks]


def _editor_values(blocks: list[TextBlock], selected_id: str | None) -> tuple[str, str, str, bool, int | None, str, str, str]:
    if not blocks:
        return "", "", "center", True, None, "", "", ""
    block = next((item for item in blocks if item.id == selected_id), blocks[0])
    fill = ",".join(str(v) for v in (block.fill or []))
    return (
        block.id,
        block.text,
        block.replacement,
        block.align,
        block.enabled,
        block.font_size,
        fill,
        block.notes,
    )


def detect_text(image_path: str, lang: str, mask_engine: str, sam_checkpoint: str):
    pipeline = get_pipeline(lang, mask_engine=mask_engine, sam_checkpoint=sam_checkpoint or None)
    blocks = pipeline.detect(image_path)
    json_text = blocks_to_json(blocks)
    selected_id = blocks[0].id if blocks else None
    preview = _render_preview(image_path, blocks, selected_id=selected_id) if blocks else None
    block_id, original, replacement, align, enabled, font_size, fill, notes = _editor_values(blocks, selected_id)
    return (
        json_text,
        pipeline.summarize_blocks(blocks),
        preview,
        gr.update(choices=_block_choices(blocks), value=selected_id),
        block_id,
        original,
        replacement,
        align,
        enabled,
        font_size,
        fill,
        notes,
    )


def select_block(image_path: str, blocks_json: str, selected_id: str):
    if not image_path or not blocks_json:
        return None, "", "", "", "center", True, None, "", ""
    blocks = _load_blocks(blocks_json)
    preview = _render_preview(image_path, blocks, selected_id=selected_id)
    block_id, original, replacement, align, enabled, font_size, fill, notes = _editor_values(blocks, selected_id)
    return preview, block_id, original, replacement, align, enabled, font_size, fill, notes


def update_block(
    image_path: str,
    blocks_json: str,
    selected_id: str,
    replacement: str,
    align: str,
    enabled: bool,
    font_size: int | None,
    fill: str,
    notes: str,
):
    blocks = _load_blocks(blocks_json)
    for block in blocks:
        if block.id != selected_id:
            continue
        block.replacement = replacement
        block.align = align
        block.enabled = enabled
        block.font_size = int(font_size) if font_size not in (None, "") else None
        block.notes = notes or ""
        fill_text = (fill or "").strip()
        if fill_text:
            block.fill = [int(item.strip()) for item in fill_text.split(",")]
        break

    updated_json = blocks_to_json(blocks)
    preview = _render_preview(image_path, blocks, selected_id=selected_id)
    summary = TextEditPipeline.summarize_blocks(blocks)
    return updated_json, summary, preview


def apply_text_edit(
    image_path: str,
    blocks_json: str,
    lang: str,
    method: str,
    radius: int,
    mask_engine: str,
    sam_checkpoint: str,
    sd_model: str,
) -> str:
    pipeline = get_pipeline(
        lang,
        mask_engine=mask_engine,
        inpaint_engine=method,
        sam_checkpoint=sam_checkpoint or None,
        sd_model_id=sd_model,
    )
    output_dir = Path(tempfile.mkdtemp(prefix="text_replace_"))
    output_path = output_dir / "output.png"
    pipeline.apply(
        image_path=image_path,
        blocks=blocks_json,
        output_path=output_path,
        inpaint_method=method,
        inpaint_radius=radius,
    )
    return str(output_path)


def build_app() -> gr.Blocks:
    with gr.Blocks(title="Text Replace Demo") as demo:
        gr.Markdown("# OCR Text Detect / Edit / Replace")
        with gr.Row():
            image = gr.Image(type="filepath", label="Input image")
            preview = gr.Image(type="filepath", label="Detected boxes preview")
            output = gr.Image(type="filepath", label="Rendered output")

        with gr.Row():
            lang = gr.Dropdown(choices=["en", "ch", "chinese_cht"], value="en", label="OCR language")
            method = gr.Dropdown(choices=["auto", "telea", "ns", "sd", "sdxl"], value="auto", label="Inpaint method")
            radius = gr.Slider(minimum=1, maximum=9, step=1, value=3, label="Inpaint radius")
        with gr.Row():
            mask_engine = gr.Dropdown(choices=["auto", "sam", "sam2", "refine"], value="auto", label="Mask engine")
            sam_checkpoint = gr.Textbox(label="SAM checkpoint", placeholder="可选：SAM 模型权重路径")
            sd_model = gr.Textbox(label="SD inpaint model", value="runwayml/stable-diffusion-inpainting")

        with gr.Row():
            detect_button = gr.Button("1. Detect text")
            save_block_button = gr.Button("2. Update selected block")
            apply_button = gr.Button("3. Apply edited JSON")

        with gr.Row():
            with gr.Column(scale=1):
                summary = gr.Textbox(label="Detected blocks", lines=8)
                block_selector = gr.Dropdown(choices=[], value=None, label="Select block")
                block_id = gr.Textbox(label="Block id", interactive=False)
                original_text = gr.Textbox(label="Detected text", lines=3, interactive=False)
                replacement_text = gr.Textbox(label="Replacement text", lines=3)
                align = gr.Dropdown(choices=["left", "center"], value="center", label="Alignment")
                enabled = gr.Checkbox(value=True, label="Enable redraw")
                font_size = gr.Number(value=None, precision=0, label="Font size override")
                fill = gr.Textbox(label="Fill color RGB", placeholder="e.g. 20,20,20")
                notes = gr.Textbox(label="Notes", lines=2)
            with gr.Column(scale=1):
                blocks_json = gr.Code(label="Editable JSON", language="json", lines=28)

        detect_button.click(
            fn=detect_text,
            inputs=[image, lang, mask_engine, sam_checkpoint],
            outputs=[
                blocks_json,
                summary,
                preview,
                block_selector,
                block_id,
                original_text,
                replacement_text,
                align,
                enabled,
                font_size,
                fill,
                notes,
            ],
        )
        block_selector.change(
            fn=select_block,
            inputs=[image, blocks_json, block_selector],
            outputs=[
                preview,
                block_id,
                original_text,
                replacement_text,
                align,
                enabled,
                font_size,
                fill,
                notes,
            ],
        )
        save_block_button.click(
            fn=update_block,
            inputs=[image, blocks_json, block_selector, replacement_text, align, enabled, font_size, fill, notes],
            outputs=[blocks_json, summary, preview],
        )
        apply_button.click(
            fn=apply_text_edit,
            inputs=[image, blocks_json, lang, method, radius, mask_engine, sam_checkpoint, sd_model],
            outputs=output,
        )

    return demo


if __name__ == "__main__":
    build_app().launch()
