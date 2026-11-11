---
name: honeyvid-viral-template
description: "Put a person, pet, or character into a trending HoneyVid video template from one photo. Use for 'put me in this video', 'make my pet dance', 'use a viral template', or 'swap the character'."
---

# HoneyVid viral template

Use connected HoneyVid MCP tools; otherwise run `npx honeyvid`. Connect at `https://honeyvid.ai/mcp` or run `npx honeyvid login`. Use the live library and quote; never invent available templates or prices.

## Pick the clip and character

1. Search with `honeyvid_search_templates` using `query`, `category`, and a small `limit`. CLI: `npx honeyvid templates --search dance --limit 10`.
2. Match the user's vibe, action, and desired duration. Open full details with `honeyvid_get_template {template_id}` or `npx honeyvid template '<id>'`. Use the returned preview, `durationSeconds`, available qualities, and picks. Only generate an available template; do not treat an unvalidated sample as a paid option.
3. For pets, choose a returned model/pick that supports animals and fits the clip length. Do not assume every human dance template works for a pet. Use SCAIL-2 only where it is offered; its clip cap is 10 seconds.
4. Reuse a suitable saved character from `honeyvid_list_characters` / `npx honeyvid characters`. Otherwise add the user's photo:

```text
honeyvid_add_character {image_url:"<public-https-photo-url>", name:"Milo"}
```

```sh
npx honeyvid characters add ./milo.jpg --name Milo
# Or use a public HTTPS URL:
npx honeyvid characters add --url 'https://example.com/milo.jpg' --name Milo
```

Use the returned character ID, not the image URL, in generation. Accept PNG, JPG, or WebP up to 10 MB. Use photos the user has the right to use. Choose one clear subject, face visible, facing the camera in good light; whole body or waist up works well. Avoid group shots, hidden faces, heavy blur, and tiny subjects. Do not send a private photo to a public host just to make a URL; use a local CLI upload instead.

## Quote Standard and HD

Quote both returned quality options using the same template. API quality IDs are `standard` and `high` (HD). Skip an option if the template does not offer it.

```text
honeyvid_quote_video {template_id:"<id>", quality:"standard"}
honeyvid_quote_video {template_id:"<id>", quality:"high"}
```

```sh
npx honeyvid quote --template '<id>' --quality standard
npx honeyvid quote --template '<id>' --quality high
```

Compare credits and estimated time. Favor the requested quality; otherwise use Standard within the authorized budget. Check balance with `honeyvid_get_account` / `npx honeyvid account`. If the user chose a returned `pick`, include that exact pick in both MCP quote and create. CLI template commands have no pick flag; use the offered quality rather than inventing one.

The core flow picks a template, character, and quality. Playground model IDs are a separate interface; never pass them as template pick IDs. Do not promise the template's source motion or sound was preserved until you inspect the result.

## Create, wait, deliver

- Use the exact quoted source/quality/pick. Set `max_credits` to the quote within the authorized budget, and save a unique key before submission.
- MCP: `honeyvid_create_video {template_id:"<id>", character_id:"<id>", quality:"standard", max_credits:<quoted-credits>, idempotency_key:"milo-dance-001"}`.
- CLI:

```sh
npx honeyvid create --template '<template-id>' --character '<character-id>' \
  --quality standard --max-credits <quoted-credits> \
  --idempotency-key 'milo-dance-001' --wait --timeout 600 --output ./milo-dance.mp4
```

- Wait with `honeyvid_get_video {job_id:"<id>", wait_seconds:45}`. Honor `retry_after_seconds` between calls. Or resume with `npx honeyvid video '<id>' --wait --output ./milo-dance.mp4`.
- Give the user `video_url`, the job ID, credits charged, and the local path if downloaded. Inspect the clip when possible for character, motion, and framing; report only checks actually performed.

## Spend and recovery rules

Quote before every new paid attempt. Never exceed the user's budget. Reuse the same key and inputs after an uncertain submission; a new key can charge again. A wait timeout does not cancel the job. Failed videos are refunded automatically; check balance before replacing one. `honeyvid_retry_video` / `npx honeyvid retry '<id>' --max-credits <n> --idempotency-key '<new-retry-key>'` retries a confirmed failed template video once, with a new charge.

Agents share 30 jobs per rolling hour, including retries and upscales. Honor 429 retry timing. If balance is too low, return the account's `top_up_url` / CLI `topUpUrl`; do not buy credits. Reconnect on auth failure. Stop on unavailable templates or missing access instead of bypassing them. Refresh expired private links with `honeyvid_get_video`.
