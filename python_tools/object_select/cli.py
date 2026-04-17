from __future__ import annotations

import argparse
import json
from pathlib import Path

from .selector import load_image_bgr, mask_to_data_url, select_object


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Click-to-select object mask extraction.")
    parser.add_argument("--input", required=True, help="Input image path.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    parser.add_argument("--x", required=True, type=int, help="Clicked x coordinate in source-image pixels.")
    parser.add_argument("--y", required=True, type=int, help="Clicked y coordinate in source-image pixels.")
    parser.add_argument("--sam-model-type", default="vit_b", help="SAM model type.")
    parser.add_argument("--sam-checkpoint", default=None, help="Optional SAM checkpoint path.")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    image = load_image_bgr(args.input)
    result = select_object(
        image,
        x=args.x,
        y=args.y,
        sam_model_type=args.sam_model_type,
        sam_checkpoint=args.sam_checkpoint,
    )
    payload = {
        "mask_data_url": mask_to_data_url(result.mask),
        "bbox": result.box,
        "method": result.method,
        "score": result.score,
        "point": {"x": int(args.x), "y": int(args.y)},
        "image_size": {"width": int(image.shape[1]), "height": int(image.shape[0])},
    }
    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
