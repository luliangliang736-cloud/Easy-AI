from __future__ import annotations

import argparse
from pathlib import Path

from .pipeline import TextEditPipeline


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Detect, remove, and replace text in images.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    detect_parser = subparsers.add_parser("detect", help="Run PaddleOCR and export editable JSON.")
    detect_parser.add_argument("--input", required=True, help="Input image path.")
    detect_parser.add_argument("--json", required=True, help="Output JSON path.")
    detect_parser.add_argument("--lang", default="en", help="PaddleOCR language code.")
    detect_parser.add_argument("--mask-engine", default="auto", choices=["auto", "sam", "sam2", "refine"], help="Text mask generation backend.")
    detect_parser.add_argument("--sam-checkpoint", default=None, help="Optional SAM checkpoint path.")

    apply_parser = subparsers.add_parser("apply", help="Inpaint old text and render new text.")
    apply_parser.add_argument("--input", required=True, help="Input image path.")
    apply_parser.add_argument("--json", required=True, help="Edited JSON path.")
    apply_parser.add_argument("--output", required=True, help="Output image path.")
    apply_parser.add_argument("--lang", default="en", help="PaddleOCR language code.")
    apply_parser.add_argument("--method", default="auto", choices=["auto", "telea", "ns", "sd", "sdxl"], help="Inpainting backend.")
    apply_parser.add_argument("--radius", default=3, type=int, help="OpenCV inpainting radius.")
    apply_parser.add_argument("--mask-engine", default="auto", choices=["auto", "sam", "sam2", "refine"], help="Text mask generation backend.")
    apply_parser.add_argument("--sam-checkpoint", default=None, help="Optional SAM checkpoint path.")
    apply_parser.add_argument("--sd-model", default="runwayml/stable-diffusion-inpainting", help="Diffusers inpaint model id.")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    pipeline = TextEditPipeline(
        ocr_lang=args.lang,
        mask_engine=getattr(args, "mask_engine", "auto"),
        sam_checkpoint=getattr(args, "sam_checkpoint", None),
        inpaint_engine="auto" if args.command == "detect" else getattr(args, "method", "auto"),
        sd_model_id=getattr(args, "sd_model", "runwayml/stable-diffusion-inpainting"),
    )

    if args.command == "detect":
        json_text = pipeline.detect_to_json(args.input, args.json)
        blocks = pipeline.load_blocks(json_text)
        print("Detected text blocks:")
        print(pipeline.summarize_blocks(blocks))
        print(f"\nEditable JSON saved to: {Path(args.json).resolve()}")
        return

    if args.command == "apply":
        output = pipeline.apply(
            image_path=args.input,
            blocks=args.json,
            output_path=args.output,
            inpaint_method=args.method,
            inpaint_radius=args.radius,
        )
        print(f"Rendered image saved to: {output.resolve()}")


if __name__ == "__main__":
    main()
