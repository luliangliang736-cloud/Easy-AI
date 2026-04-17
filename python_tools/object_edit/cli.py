from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Masked object edit")
    parser.add_argument("--input", required=True, help="Input image path.")
    parser.add_argument("--mask", required=True, help="Mask image path.")
    parser.add_argument("--output", required=True, help="Output image path.")
    parser.add_argument("--prompt", required=True, help="Edit prompt.")
    parser.add_argument("--negative-prompt", default="extra people, extra limbs, duplicate objects, broken anatomy, blur, distortion, text, watermark", help="Negative prompt.")
    parser.add_argument("--model", default="runwayml/stable-diffusion-inpainting", help="Inpaint model id.")
    parser.add_argument("--steps", type=int, default=28, help="Inference steps.")
    parser.add_argument("--guidance", type=float, default=7.5, help="Guidance scale.")
    return parser


def load_mask(mask_path: str) -> np.ndarray:
    mask = cv2.imread(mask_path, cv2.IMREAD_UNCHANGED)
    if mask is None:
        raise RuntimeError(f"Failed to read mask: {mask_path}")
    if mask.ndim == 3:
        if mask.shape[2] == 4:
            mask = mask[:, :, 3]
        else:
            mask = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
    mask = np.where(mask > 16, 255, 0).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.dilate(mask, kernel, iterations=1)
    return mask


def fallback_edit(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return cv2.inpaint(image, mask, 3, cv2.INPAINT_TELEA)


def run_diffusers_edit(
    image: np.ndarray,
    mask: np.ndarray,
    prompt: str,
    negative_prompt: str,
    model_id: str,
    steps: int,
    guidance: float,
) -> np.ndarray | None:
    try:
        import torch
        from diffusers import StableDiffusionInpaintPipeline
    except Exception:
        return None

    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    pipe = StableDiffusionInpaintPipeline.from_pretrained(model_id, torch_dtype=dtype)
    pipe = pipe.to("cuda" if torch.cuda.is_available() else "cpu")
    result = pipe(
        prompt=prompt,
        negative_prompt=negative_prompt,
        image=Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)),
        mask_image=Image.fromarray(mask).convert("L"),
        num_inference_steps=steps,
        guidance_scale=guidance,
    ).images[0]
    return cv2.cvtColor(np.array(result), cv2.COLOR_RGB2BGR)


def main() -> None:
    args = build_parser().parse_args()
    image = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Failed to read image: {args.input}")
    mask = load_mask(args.mask)
    edited = run_diffusers_edit(
        image,
        mask,
        prompt=args.prompt,
        negative_prompt=args.negative_prompt,
        model_id=args.model,
        steps=args.steps,
        guidance=args.guidance,
    )
    if edited is None:
        edited = fallback_edit(image, mask)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ok = cv2.imwrite(str(output_path), edited)
    if not ok:
        raise RuntimeError(f"Failed to write output: {output_path}")


if __name__ == "__main__":
    main()
