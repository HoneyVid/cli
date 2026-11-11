---
name: honeyvid-image-generation
description: "Generate or edit HoneyVid Playground images with prompts and saved reference photos. Use for 'make an image', 'edit this photo', 'create a product shot', 'design a logo', or 'make image variants' through HoneyVid."
---

# HoneyVid image generation

Use connected HoneyVid MCP tools; otherwise use `npx honeyvid`. Connect at `https://honeyvid.ai/mcp` or run `npx honeyvid login`.

## Choose a model

Read [the image model table](references/models.md) for all seven models, input limits, output counts, and settings. Refresh access and fields with `honeyvid_list_models {kind:"image"}` then `{model:"<id>"}`. CLI:

```sh
npx honeyvid models --kind image
npx honeyvid models --model gpt-image-1.5
```

Choose from the returned models. Use GPT Image 1.5 for long instructions or clean text, FLUX.2 Pro for photoreal detail, Qwen Image Edit for precise edits, Ideogram V3 for text/logos or style references, Recraft V3 for illustration/vector style, Nano Banana Pro for a general-purpose choice, or Seedream 4.5 for 2K/4K generation and edits. These are registry use cases, not benchmark rankings.

## Inputs: edit, generate, or guide style

- No input photos selects text generation where supported. Qwen requires at least one input photo; Recraft accepts none.
- Input photos select editing for Nano Banana, Seedream, GPT Image, FLUX, and Qwen. State what must stay and what should change.
- Ideogram inputs guide **style**, not identity or photo replacement. Do not promise it will preserve a reference person's face.
- Save input photos as characters with `honeyvid_add_character {image_url:"<https-url>",name:"<name>"}` or `npx honeyvid characters add ./photo.jpg --name '<name>'`. Reuse IDs from `honeyvid_list_characters` / `npx honeyvid characters` when suitable.
- MCP photo URLs must be public HTTPS PNG/JPG/WebP up to 10 MB. Use the CLI for local private photos rather than making them public. Use only photos the user has the right to use.
- Send MCP `character_ids:["<id>","<id>"]` in intended input order, or repeat `--image '<id>'`. Images have no start/end/ref role suffix in this workflow.
- Respect the model cap: Nano Banana 8, Seedream 10, GPT/FLUX/Qwen 4, Ideogram 3, Recraft 0. Do not pad a request with extra photos that add no useful detail.

## Write the image prompt

Describe subject, composition, setting, style, lighting, colors, and the intended use. Specify exact visible text in quotes and where it belongs. State the aspect ratio in settings rather than relying only on prompt text. Keep prompts within the live limit; the image registry caps them at 4000 characters.

For edits, name the source by input order and give a clear change: “Keep the person in the first photo, including face, pose, and jacket. Replace the background with a warm studio wall. Add soft light from the left.” Do not assume video `@Image1` tags work for image models.

For product shots, specify camera angle, background, shadows, materials, and label text. For logos or posters, specify text hierarchy and space around the subject. Use a supported `negative_prompt` only when needed. Inspect spelling, identity, and requested details before calling the result ready.

## Set, quote, create

1. Pick the listed aspect ratio or GPT `image_size` for the destination. Most models offer 1:1, 4:3, 3:4, 16:9, 9:16; Nano Banana offers more. Do not send `aspect_ratio` to GPT Image; use its size enum.
2. Set output count with `num_images` only if offered (1–4). FLUX and Recraft make one image per request. Start with one useful draft before spending on several variants unless the user asked for a batch.
3. Quote the exact prompt, settings, and inputs with `honeyvid_quote_generation {kind:"image",model,prompt,settings,images:[{character_id:"<id>"}]}`. The quote uses `images`; generation uses `character_ids`.
4. Compare credits and balance with the authorized budget. Submit `honeyvid_generate_image {model,prompt,settings,character_ids,max_credits,idempotency_key}` using the same quoted inputs, a ceiling within budget, and a saved unique key.

CLI example (replace cap/quote placeholders; omit `--image` for text-only generation):

```sh
npx honeyvid generate image --model nano-banana-pro \
  --prompt 'Keep the product from the photo. Warm studio wall, soft left light, centered composition.' \
  --image '<character-id>' --set aspect_ratio=4:5 --set resolution=2K \
  --set num_images=1 --max-credits <authorized-cap> --dry-run
# Submit the same inputs after checking the quote:
npx honeyvid generate image --model nano-banana-pro \
  --prompt 'Keep the product from the photo. Warm studio wall, soft left light, centered composition.' \
  --image '<character-id>' --set aspect_ratio=4:5 --set resolution=2K \
  --set num_images=1 --max-credits <quoted-credits> \
  --idempotency-key 'product-shot-001' --wait --output ./product-shot.png
```

Repeated `--set key=value` parses numeric and boolean values as those types. Output count, size/quality, reference count, and optional web search can affect price depending on model; use the quote, not a remembered per-image cost.

## Collect all outputs

- Use `honeyvid_get_video {job_id:"<id>",wait_seconds:45}` for image jobs too. Honor `retry_after_seconds`; read all `image_urls` when complete.
- CLI: `npx honeyvid videos --kind image`, then `npx honeyvid video '<id>' --wait --output ./product-shot.png`. Preserve the actual paths reported for multiple images. Match file extensions to returned formats; naming a JPEG `.png` does not convert it.
- Download each result. Compare the returned count with the requested count; report any shortfall rather than inventing missing images. Requery status to refresh expired private URLs.
- Return links, paths if saved, model, job ID, and actual charged credits. Check balance for refunds before reporting net spend. Say whether you inspected text, identity, framing, or edits.

## Spend and recovery

Always quote and pass `max_credits` / `--max-credits`. Preserve the same key and inputs after uncertain submission. Waiting timeout means keep waiting on the same job. For a confirmed failed image job, inspect status and balance before a newly quoted replacement; do not assume `honeyvid_retry_video` supports image jobs.

Agents share 30 jobs per rolling hour, including retries/upscales. A multi-image request is one job, but its quote covers all requested outputs. Use the batch skill for a total budget across requests. Honor 429 retry timing, stop repeated failures, and never raise a spending ceiling silently. On low balance return the account's top-up link; on missing access or Playground 404 stop unsupported generation.
