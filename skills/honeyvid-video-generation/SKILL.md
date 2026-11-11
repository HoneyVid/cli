---
name: honeyvid-video-generation
description: "Make HoneyVid Playground videos from prompts, start/end frames, reference photos, or source-video motion. Use for 'text to video', 'animate this image', 'use these reference images', 'match this motion', or 'edit a video'."
---

# HoneyVid video generation

Use connected MCP tools first; otherwise use `npx honeyvid`. Connect to `https://honeyvid.ai/mcp` or run `npx honeyvid login`. For a ready-made trending clip and one photo, use the template workflow instead.

## Choose the model and inputs

Read [the video model decision tables](references/models.md) for all 25 registry models, roles, lengths, and prompt limits. Then call `honeyvid_list_models {kind:"video"}` and `honeyvid_list_models {model:"<id>"}` for the live schema. CLI:

```sh
npx honeyvid models --kind video
npx honeyvid models --model seedance2-i2v
```

Use only a returned model and listed settings. The reference is a registry guide, not proof that every provider is configured for this account.

- **Text only:** choose a `t2v` model; omit images and source video.
- **Animate a frame:** choose an `i2v` model. Use one `start` frame and an optional `end` only if supported. MiniMax permits start or end, but still needs at least one image.
- **Guide subjects or scene:** use a reference model with `ref` images. For models supporting reference tags, refer to images as `@Image1`, `@Image2`, in reference order. Do not use those tags as a promise of perfect identity.
- **Copy motion or swap a subject:** choose a video-input model, one `ref` character image, and a source video. Source models follow source duration; do not add a `duration` setting they do not expose.

Save every input photo as a character with `honeyvid_add_character {image_url:"<https-url>",name:"<name>"}`. For local files use `npx honeyvid characters add ./frame.jpg --name 'Start frame'`. Reuse saved characters when suitable. MCP URL photos must be public HTTPS PNG/JPG/WebP up to 10 MB; use the CLI for private local photos.

For source video, use an existing template ID or upload an MP4 with `honeyvid_upload_video {video_url:"<https-url>"}` / `npx honeyvid upload ./motion.mp4`. Uploads accept 3–30 seconds, up to 100 MB; the MCP URL must send Content-Length. The selected model may impose a shorter cap. Pass `{source:"upload",id:"<id>"}` or `{source:"template",id:"<id>"}`; never send a URL as the ID.

## Write the shot

Describe **subject → action → camera → scene/style → lighting → timing**. Keep one clear action in a short shot. Say what changes over the clip and what should stay stable. Put the requested length in the model's duration setting; prompt text does not override it.

Example: “A red fox steps onto a mossy stone and turns toward the lens. Slow low-angle push-in, one continuous shot. Realistic woodland, warm dawn light through mist. The fox pauses at the end.”

For image-led shots, describe motion rather than restating every visible detail. With start/end frames, describe the transition between them. For video edits, name the subject to replace and what scene, camera, timing, or sound to keep. Use `prompt:""` for `wan22-replace`; its prompt is hidden and has a zero-character limit.

For dialogue-capable models, state the short spoken line and desired sound and enable the listed audio setting. Do not promise sound on a model without audio controls. Use negative prompts only where listed; they are not a separate universal parameter.

## Set, quote, create

1. Set duration, resolution, aspect ratio, and audio from the full schema. Field names and case differ: Wan uses `audio`; many others use `generate_audio`; MiniMax resolution values include `768P` and `2K`.
2. Longer duration, higher resolution, or audio can raise cost, depending on the model. Aspect ratio controls framing; do not claim it always raises price. Quote the full chosen configuration, including image roles and source video.
3. MCP: call `honeyvid_quote_generation {kind:"video",model,prompt,settings,images:[{character_id,role}],video}`; omit unused inputs. Compare `credits` and `balance` with the authorized budget.
4. Call `honeyvid_generate_video` with the same inputs plus `max_credits` and a saved `idempotency_key`. Set the ceiling to the quote within the budget. A new key means a new paid job.

CLI example, after adding start/end characters (replace placeholders with real IDs and the quote):

```sh
npx honeyvid generate video --model seedance2-i2v \
  --prompt 'A slow push-in as the fox turns, ending in the supplied pose.' \
  --image '<start-id>:start' --image '<end-id>:end' \
  --set duration=5 --set resolution=720p --set aspect_ratio=9:16 \
  --max-credits <authorized-cap> --dry-run
# Submit the identical configuration after checking the quote:
npx honeyvid generate video --model seedance2-i2v \
  --prompt 'A slow push-in as the fox turns, ending in the supplied pose.' \
  --image '<start-id>:start' --image '<end-id>:end' \
  --set duration=5 --set resolution=720p --set aspect_ratio=9:16 \
  --max-credits <quoted-credits> --idempotency-key 'fox-shot-001' \
  --wait --timeout 600 --output ./fox-shot.mp4
```

Use repeated `--set key=value`; numeric and boolean values are parsed as such. For video-input jobs, use `--image '<character-id>:ref' --video 'upload:<upload-id>'` or `--video 'template:<template-id>'`. For text-only jobs, omit both image and video flags.

## Finish and recover

- Wait with `honeyvid_get_video {job_id:"<id>",wait_seconds:45}` and honor `retry_after_seconds`; CLI `--wait` handles waiting. Resume a timeout with `npx honeyvid video '<id>' --wait`.
- Save the returned video URL or use `--output ./name.mp4`. Refresh private links with the status tool when expired. Return the job ID, link, local path if saved, and actual credits charged.
- Inspect character, action, camera, framing, and start/end continuity when possible. Say which checks you actually performed.
- Reuse the same key and unchanged inputs after an uncertain submission. Never launch a duplicate because waiting timed out. Failed videos are refunded; a confirmed failed Playground replacement is a new quoted job with a new key, within the remaining budget.
- Honor the shared 30-agent-jobs/hour limit and 429 retry timing. On price-cap rejection, requote or lower settings; never raise the budget silently. On low balance, return `top_up_url` from `honeyvid_get_account` / `topUpUrl` from `npx honeyvid account`. On Playground 404 or missing tools, stop unsupported generation.
