from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image


@dataclass
class InpaintConfig:
    engine: str = "auto"
    model_id: str = "runwayml/stable-diffusion-inpainting"
    prompt: str = "clean design background with the text removed, preserve gradients, shadows, and layout"
    negative_prompt: str = "text, letters, typography, logo, watermark, icon, extra object, distortion, blur"
    num_inference_steps: int = 28
    guidance_scale: float = 7.5


class StableDiffusionInpainter:
    def __init__(self, config: InpaintConfig | None = None) -> None:
        self.config = config or InpaintConfig()
        self._pipe = None

    @property
    def pipe(self):
        if self._pipe is not None:
            return self._pipe
        if self.config.engine not in {"auto", "sd", "sdxl"}:
            return None
        try:
            import torch
            from diffusers import StableDiffusionInpaintPipeline
        except Exception:
            return None

        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        pipe = StableDiffusionInpaintPipeline.from_pretrained(
            self.config.model_id,
            torch_dtype=dtype,
        )
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self._pipe = pipe.to(device)
        return self._pipe

    def available(self) -> bool:
        return self.pipe is not None

    def inpaint(self, image: np.ndarray, mask: np.ndarray, fallback_method: str = "telea", fallback_radius: int = 3) -> tuple[np.ndarray, str]:
        pipe = self.pipe
        if pipe is None:
            flag = cv2.INPAINT_TELEA if fallback_method.lower() == "telea" else cv2.INPAINT_NS
            return cv2.inpaint(image, mask, fallback_radius, flag), "opencv"

        pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        pil_mask = Image.fromarray(mask).convert("L")
        result = pipe(
            prompt=self.config.prompt,
            negative_prompt=self.config.negative_prompt,
            image=pil_image,
            mask_image=pil_mask,
            num_inference_steps=self.config.num_inference_steps,
            guidance_scale=self.config.guidance_scale,
        ).images[0]
        inpainted = cv2.cvtColor(np.array(result), cv2.COLOR_RGB2BGR)
        return inpainted, "stable-diffusion"
