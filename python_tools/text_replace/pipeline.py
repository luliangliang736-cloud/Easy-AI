from __future__ import annotations

from pathlib import Path

from .image_ops import (
    inpaint_image,
    load_image_bgr,
    render_text_blocks,
    save_image_bgr,
)
from .mask_generator import TextMaskGenerator
from .ocr_engine import OCRDetector, blocks_to_json, load_blocks_json, save_blocks_json
from .sd_inpaint import InpaintConfig, StableDiffusionInpainter
from .schema import TextBlock
from .style_estimator import enrich_block_style


class TextEditPipeline:
    def __init__(
        self,
        ocr_lang: str = "en",
        use_angle_cls: bool = True,
        mask_engine: str = "auto",
        inpaint_engine: str = "auto",
        sam_checkpoint: str | Path | None = None,
        sd_model_id: str = "runwayml/stable-diffusion-inpainting",
    ) -> None:
        self.detector = OCRDetector(lang=ocr_lang, use_angle_cls=use_angle_cls)
        self.mask_generator = TextMaskGenerator(engine=mask_engine, sam_checkpoint=sam_checkpoint)
        self.inpainter = StableDiffusionInpainter(
            InpaintConfig(engine=inpaint_engine, model_id=sd_model_id)
        )

    def detect(self, image_path: str | Path) -> list[TextBlock]:
        image = load_image_bgr(image_path)
        blocks = self.detector.detect(image_path)
        for block in blocks:
            mask_result = self.mask_generator.generate(image, block)
            block.mask_box = mask_result.box
            enrich_block_style(image, mask_result.mask, block)
        return blocks

    def detect_to_json(self, image_path: str | Path, output_json: str | Path | None = None) -> str:
        blocks = self.detect(image_path)
        if output_json is not None:
            save_blocks_json(blocks, output_json)
        return blocks_to_json(blocks)

    def load_blocks(self, json_text_or_path: str | Path) -> list[TextBlock]:
        source = Path(json_text_or_path)
        if source.exists():
            return load_blocks_json(source.read_text(encoding="utf-8"))
        return load_blocks_json(str(json_text_or_path))

    def apply(
        self,
        image_path: str | Path,
        blocks: list[TextBlock] | str | Path,
        output_path: str | Path,
        inpaint_method: str = "telea",
        inpaint_radius: int = 3,
        mask_pad: float = 4.0,
        mask_scale: float = 1.06,
    ) -> Path:
        image = load_image_bgr(image_path)
        parsed_blocks = self.load_blocks(blocks) if isinstance(blocks, (str, Path)) else blocks
        editable_blocks = [
            block
            for block in parsed_blocks
            if block.enabled
            and str(block.replacement or "").strip()
            and str(block.replacement or "").strip() != str(block.text or "").strip()
        ]
        if editable_blocks:
            mask, parsed_blocks = self.mask_generator.build_full_mask(
                image,
                [
                    block if block in editable_blocks else TextBlock.from_dict({
                        **block.to_dict(),
                        "enabled": False,
                    })
                    for block in parsed_blocks
                ],
                pad=max(1, int(mask_pad)),
            )
        else:
            mask = image[:, :, 0] * 0

        use_sd = inpaint_method.lower() in {"auto", "sd", "sdxl"}
        if use_sd:
            cleaned, method_used = self.inpainter.inpaint(
                image,
                mask,
                fallback_method="telea" if inpaint_method.lower() in {"auto", "sd", "sdxl"} else inpaint_method,
                fallback_radius=inpaint_radius,
            )
        else:
            cleaned = inpaint_image(image, mask, method=inpaint_method, radius=inpaint_radius)
            method_used = f"opencv-{inpaint_method.lower()}"

        for block in parsed_blocks:
            if block.enabled and str(block.replacement or "").strip():
                block.notes = f"{block.notes}; inpaint={method_used}".strip("; ").strip()
        rendered = render_text_blocks(cleaned, image, parsed_blocks)
        return save_image_bgr(rendered, output_path)

    @staticmethod
    def summarize_blocks(blocks: list[TextBlock]) -> str:
        lines = []
        for block in blocks:
            bbox = block.bbox
            lines.append(
                f"{block.id}: '{block.text}' "
                f"score={block.score:.3f} "
                f"bbox=({bbox['x']}, {bbox['y']}, {bbox['w']}, {bbox['h']}) "
                f"style={block.style_name or block.font_weight} "
                f"fill={block.fill}"
            )
        return "\n".join(lines)
