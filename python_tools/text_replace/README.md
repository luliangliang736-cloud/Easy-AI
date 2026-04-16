# Python text replace pipeline

This tool provides a complete OCR -> mask -> inpaint -> redraw workflow for editing text inside images.

## Features

- PaddleOCR text detection with quadrilateral boxes
- OCR-guided refined text mask generation, with optional SAM backend
- Human-editable JSON output
- Optional Stable Diffusion inpainting for cleaner background restoration
- OpenCV fallback inpainting to remove original text
- Auto style estimation: font weight, fill color, stroke color, alignment
- Layout-preserving redraw that tries to keep line breaks and spacing
- Multiple text blocks
- English-friendly wrapping
- Optional Gradio UI

## Install

Create and activate a virtual environment first:

```bash
python -m venv .venv
.venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r python_tools/text_replace/requirements.txt
```

If `paddlepaddle` install fails on your machine, install the matching wheel from the official PaddlePaddle site first, then rerun the command above.

For the stronger visual pipeline:

- `segment-anything` is optional; provide a SAM checkpoint to enable deep text masks.
- `diffusers` + `torch` are used for Stable Diffusion inpainting.
- If those dependencies or weights are unavailable, the pipeline automatically falls back to refined OCR masks plus OpenCV inpaint.

## Step 1: detect text and export editable JSON

```bash
python -m python_tools.text_replace.cli detect ^
  --input "input.png" ^
  --json "blocks.json" ^
  --lang en ^
  --mask-engine auto
```

This prints each block and writes an editable JSON file.

Example JSON entry:

```json
[
  {
    "id": "text_0",
    "text": "OLD TEXT",
    "replacement": "NEW TEXT",
    "score": 0.998,
    "quad": [[10, 12], [140, 12], [140, 44], [10, 44]],
    "bbox": { "x": 10, "y": 12, "w": 130, "h": 32 },
    "angle": 0.0,
    "align": "center",
    "enabled": true,
    "font_path": null,
    "font_size": null,
    "fill": [12, 12, 12],
    "stroke_fill": null,
    "stroke_width": 0,
    "notes": ""
  }
]
```

Edit `replacement`, `align`, `font_size`, or `fill` as needed.
You can also adjust newer style fields such as `font_weight`, `stroke_fill`, `line_spacing`, or `char_spacing`.

## Step 2: remove old text and render new text

```bash
python -m python_tools.text_replace.cli apply ^
  --input "input.png" ^
  --json "blocks.json" ^
  --output "output.png" ^
  --method auto ^
  --radius 3
```

## Gradio UI

```bash
python -m python_tools.text_replace.app
```

The UI lets you:

1. Upload an image
2. Run OCR detection
3. Preview detected boxes visually
4. Select a text block and edit replacement/alignment/font size/color/style
5. Edit the JSON directly if needed
6. Apply refined-mask inpainting + text redraw

## Notes

- Default font selection tries common Windows/macOS/Linux fonts. For production, set `font_path` per block.
- Stable Diffusion inpainting is slower but usually preserves complex backgrounds better than classic OpenCV inpaint.
- PaddleOCR supports more languages. Change `--lang` or the UI dropdown when needed.
