---
name: honeyvid-batch
description: "Make several HoneyVid video or image variants within one total credit budget. Use for 'make five versions', 'batch these prompts', 'try several styles', or 'stay under this credit budget'."
---

# HoneyVid batches

Use connected MCP tools first; otherwise use `npx honeyvid`. Connect at `https://honeyvid.ai/mcp` or run `npx honeyvid login`. A batch is a plan over normal jobs, not a separate batch endpoint or tool.

## Plan the budget

1. Take the user's total credit ceiling from the request or existing authorization. If none exists, quote the plan and return its total before spending. Never treat the whole account balance as permission to spend it.
2. Read `honeyvid_get_account` / `npx honeyvid account`. Available funding is the smaller of the authorized budget and balance.
3. List variants with short names, model/template, prompt, inputs, settings, and output count. Reuse saved character IDs and source uploads. Discover live model schemas with `honeyvid_list_models` / `npx honeyvid models`.
4. Vary one useful dimension at a time when comparing outputs: action, camera, style, light, or model. Hold seed/settings constant where supported to make comparisons easier; never promise identical output.
5. Quote **each distinct request** with `honeyvid_quote_generation` or `honeyvid_quote_video`. CLI: `generate video|image ... --max-credits <cap> --dry-run`, or `quote --template '<id>' --quality standard`. Choose one of `video` or `image`, not the literal pipe notation.
6. Sum quotes before launching. If the plan exceeds budget, reduce count, duration, resolution, or another priced option, then requote. Keep the user's priorities; do not silently change the subject or intended result.

For several image variants with the same prompt/settings, use `num_images` 1–4 if the model offers it. FLUX and Recraft support one output per job. Quote the requested count. Different prompts or settings need separate requests.

## Track every request

Keep a small manifest in the working directory when writing files is appropriate:

| Variant | Inputs/settings | Quote | Ceiling | Key | Job ID | Status | Charged | Output paths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| studio-01 | model + prompt + saved character IDs + settings | from quote | within budget | saved before submit | from response | pending | from response | after download |

Save full request inputs with the key so a lost response can be replayed exactly. Never save tokens or unnecessary private media URLs in the manifest. Use a distinct key per intended job, 8–100 letters/digits/underscores/hyphens, such as `studio-01-20261111`.

Before each submit, compute:

```text
remaining budget = total authorized credits - all charges/reservations not confirmed refunded
new job ceiling <= remaining budget
```

Use the quoted credits as the per-job ceiling when they fit. Include all active jobs in reserved spend. Even with several concurrent requests, their ceilings plus earlier unrefunded charges must fit the total. A quote does not lock price; a price-cap rejection calls for a new quote, not a larger cap.

## Run without overload

- Run sequentially by default. If faster delivery matters and the budget covers all reservations, use a small group of up to three jobs at a time. Save each response before launching more.
- Use the normal create tools: `honeyvid_create_video` for templates, `honeyvid_generate_video` for Playground video, `honeyvid_generate_image` for images. Always pass `max_credits` and `idempotency_key`.
- CLI equivalents are `npx honeyvid create ...`, `npx honeyvid generate video ...`, and `npx honeyvid generate image ...`, each with `--max-credits <n> --idempotency-key '<key>'`. Add `--wait --output <path>` for sequential runs.
- The account gets **30 agent jobs per rolling hour**, shared by all clients, retries and upscales. Read calls and idempotent replays do not create another job. Account for earlier work; do not assume all 30 slots are free.
- On 429, stop launching and honor `Retry-After` / `retryAfter`. Do not bypass the limit with another client or repeated new keys.
- Wait with `honeyvid_get_video {job_id:"<id>",wait_seconds:45}` and respect retry timing. CLI: `npx honeyvid video '<id>' --wait --timeout 600`. Do not start extra work to replace a wait timeout.
- On an uncertain submission, reuse the exact same request and key. On a confirmed failure, check its refund and remaining budget before a new quoted attempt. Bound retries; stop repeated failures instead of draining the budget.
- On low balance, return the account's top-up link and unfinished variants. Do not top up or increase the authorized total yourself.

## Download and review

Use names such as `01-studio-front.mp4` or `02-warm-light.png`. Preserve real extensions and the CLI's reported multi-image paths. Never overwrite another variant. Save every returned `image_urls` entry or the `video_url`; refresh expired private links with `honeyvid_get_video`. Recover older image jobs with `honeyvid_list_videos {kind:"image"}` / `npx honeyvid videos --kind image`.

Check which variants completed, which are still running, and how many outputs each returned. Inspect results when possible. Rank only on criteria actually reviewed, such as readable text, subject identity, framing, or the requested motion. Label unchecked outputs clearly.

## Report the result

Return a compact table using real values:

| Variant | Model / quality | Job ID | Status | Charged credits | Confirmed refund | Result link / file |
| --- | --- | --- | --- | --- | --- | --- |
| name | selected option | returned ID | actual status | actual charge | verified amount or unconfirmed | returned output |

State the authorized budget, gross charged/reserved credits, confirmed refunds, net spend, and remaining budget. Do not count an expected refund until confirmed. Separate running jobs from completed outputs. Flag missing images and partial refunds. Never report quotes as actual spend; if a refund cannot be verified, report gross charges and mark net spend unconfirmed.

Give the best inspected result first, then the other links and any unfinished work. Do not spend the leftover budget on unrequested variants.
