# Image model decisions and limits

Source: HoneyVid `worker/providers/image-models.ts`. Read the live schema with `honeyvid_list_models {model:"<id>"}` / `npx honeyvid models --model '<id>'`. Models appear only when configured and available for the account. Use registry limits, not larger limits mentioned in provider comments.

All image prompts have a 4000-character cap. Photo inputs are saved characters, supplied in order. These models do not use video image roles. A model with an edit endpoint uses it when photos are supplied; Ideogram always treats its photos as style references. Only Qwen requires photos.

| Model ID | Name | Registry use case | Input photos max | Output images/request | Modes |
| --- | --- | --- | --- | --- | --- |
| `nano-banana-pro` | Nano Banana Pro | General-purpose choice (registry: Best overall) | 8 | 1–4 | Generate or edit/combine |
| `seedream-4.5` | Seedream 4.5 | Low-cost 2K/4K generation and edits; compare quotes | 10 | 1–4 | Generate or edit/combine |
| `gpt-image-1.5` | GPT Image 1.5 | Long prompts and clean text | 4 | 1–4 | Generate or edit/combine |
| `flux-2-pro` | FLUX.2 Pro | Photoreal detail | 4 | 1 | Generate or edit/combine |
| `qwen-image-edit` | Qwen Image Edit | Precise photo edits | 4; at least 1 | 1–4 | Edit only |
| `ideogram-v3` | Ideogram V3 | Text and logos | 3 | 1–4 | Generate, with optional style references |
| `recraft-v3` | Recraft V3 | Illustration and vector style | 0 | 1 | Text only |

“Best overall” and other source notes are selection hints, not measured rankings. Seedream is not always the cheapest configuration; quote alternatives with matching output needs. Recraft's vector style does not establish SVG delivery; use the actual returned media format.

## Settings

The common aspect set is **1:1, 4:3, 3:4, 16:9, 9:16**. Only send keys listed for the selected model. Case matters for choices.

| Model | Settings that affect the request |
| --- | --- |
| Nano Banana Pro | `aspect_ratio`: auto, common set, 21:9, 3:2, 2:3, 5:4, 4:5; default auto. `resolution`: 1K/2K/4K, default 2K. `num_images`: 1–4. `enable_web_search`: boolean, default false. `output_format`: png/jpeg/webp. `seed`. |
| Seedream 4.5 | Common `aspect_ratio`, default 1:1. `resolution`: 2K/4K, default 2K. `num_images`: 1–4. `seed`. No format picker. |
| GPT Image 1.5 | `image_size`: 1024x1024, 1536x1024, 1024x1536; default square. `quality`: low/medium/high, default medium. `num_images`: 1–4. `background`: auto/transparent/opaque. `input_fidelity`: low/high, default high, applies to edits. `output_format`: png/jpeg/webp. No seed or aspect-ratio field. |
| FLUX.2 Pro | Common `aspect_ratio`, default 1:1. `resolution`: 1MP/4MP, default 1MP. `output_format`: jpeg/png, default jpeg. `seed`. No output-count field. |
| Qwen Image Edit | Common `aspect_ratio`, default 1:1. `num_images`: 1–4. `num_inference_steps`: 1–50, default 28. `guidance_scale`: 1–20 in 0.5 steps, default 4.5. `negative_prompt`. `acceleration`: none/regular/high, default regular. `output_format`: png/jpeg/webp. `seed`. |
| Ideogram V3 | Common `aspect_ratio`, default 1:1. `rendering_speed`: TURBO/BALANCED/QUALITY, default BALANCED. `num_images`: 1–4. `style`: AUTO/GENERAL/REALISTIC/DESIGN. `negative_prompt`. `enable_prompt_expansion`: boolean, default true. `seed`. No format picker. |
| Recraft V3 | Common `aspect_ratio`, default 1:1. `style`: realistic_image/digital_illustration/vector_illustration, default realistic_image. No seed, format, resolution, or output-count picker. |

Where offered, `seed` is a whole number from 0 to 2147483647. A fixed seed and settings produce a similar result, not a guaranteed identical image. For transparent backgrounds, use GPT's transparent option and a format that supports transparency, such as PNG.

## Size mappings

For Seedream, FLUX, Qwen, Ideogram, and Recraft, HoneyVid turns the aspect/resolution choices into provider pixel sizes. Send the exposed settings, not an invented width/height field.

- Seedream 2K: square 2048×2048, landscape 4:3 2304×1728, portrait 3:4 1728×2304, 16:9 2560×1440, 9:16 1440×2560.
- Seedream 4K: square 4096×4096, 4:3 4096×3072, 3:4 3072×4096, 16:9 4096×2304, 9:16 2304×4096.
- FLUX 1MP and Qwen/Ideogram/Recraft: square 1024×1024, 4:3 1152×864, 3:4 864×1152, 16:9 1280×720, 9:16 720×1280.
- FLUX 4MP uses the Seedream 2K sizes above. Resolution labels are settings names; dimensions vary with ratio.

## Cost behavior

Use `honeyvid_quote_generation {kind:"image",model,prompt,settings,images:[{character_id:"<id>"}]}`. Generate with `character_ids`, not quote-style `images`. CLI `generate image ... --dry-run` quotes the same configuration without spending.

The following explains the code's provider-cost function, not customer prices. Customer credits are rounded up and may include a beta discount. Do not bypass the live quote with local arithmetic.

- Nano Banana: output count times a per-image rate; 4K doubles the 1K/2K rate. Web search adds a fixed request cost.
- Seedream: output count changes the cost; its 2K/4K setting does not change the current rate.
- GPT: quality, output size, output count, input-photo count, and a fixed prompt allowance enter the estimate. Reference photos can increase the quote.
- FLUX: rounded-up output megapixels plus an allowance of 2 megapixels per input photo; one output per job.
- Qwen: output count times rounded-up output megapixels. Steps and acceleration do not change the current cost function.
- Ideogram: output count and rendering speed tier. Style-reference count does not change the current cost function.
- Recraft: vector style costs twice the current photo/illustration provider rate; one output per job.

Check actual output count and balance after completion. A multi-image job can return fewer images than requested; the pipeline records a partial refund for missing outputs. Do not report requested count as delivered count or a quoted cost as verified net spend.
