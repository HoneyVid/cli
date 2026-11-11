---
name: honeyvid
description: "Use HoneyVid through MCP or the CLI to connect an account, check credits, quote, create, wait for, and download videos or images. Use for requests like 'use HoneyVid', 'connect HoneyVid', 'check my credits', or 'download my video'."
---

# HoneyVid

Use connected HoneyVid MCP tools first. Otherwise use `npx honeyvid` (Node.js 20+). Never invent a tool, model ID, template ID, price, or completed result.

## Connect and discover

- Connect the MCP client to `https://honeyvid.ai/mcp` and complete its browser consent flow.
- For Claude Code: `claude mcp add --transport http honeyvid https://honeyvid.ai/mcp`.
- For CLI access: run `npx honeyvid login`, then `npx honeyvid whoami`.
- `npx honeyvid login` prints a Connect URL and an 8-character code (XXXX-XXXX) and waits up to ten minutes. Give the user the URL and code; they click Connect and check the code matches; the CLI finishes by itself. If your shell times out, run `npx honeyvid login --wait` to keep waiting. If nobody can complete consent, report the URL and stop account work.
- Never print, export, or put login tokens in prompts or files shared with the user.
- Discover live models with `honeyvid_list_models`; pass `model` for the full field schema. CLI: `npx honeyvid models --kind video` or `npx honeyvid models --model '<id>'`.
- Only choose models returned for this account. A Playground 404 can mean Playground access is closed.

## Choose the workflow

- Trending clip + one character photo: use **honeyvid-viral-template**.
- A new shot, start/end frames, references, or source-video edits: use **honeyvid-video-generation**.
- Still images, photo edits, or style references: use **honeyvid-image-generation**.
- Several outputs under one spending cap: use **honeyvid-batch**.

## Credits and paid requests

1. Read the balance with `honeyvid_get_account` or `npx honeyvid account`.
2. Get a free quote using the exact model, prompt, images, video, and settings you intend to submit. Templates use `honeyvid_quote_video`; Playground uses `honeyvid_quote_generation`.
3. Check the quote against the user's authorized budget and balance. If no budget is available, return the quote before spending. A quote does not reserve credits or lock the price.
4. Always send `max_credits` in MCP or `--max-credits` in CLI, no higher than the authorized remaining budget. Prefer the quoted cost as the per-job ceiling.
5. Save a unique `idempotency_key` before submitting. Use 8–100 letters, digits, underscores, or hyphens. Reuse the same key **and identical inputs** after a network error, server error, or uncertain submission. A new key may create another paid job.
6. Save the returned job ID and actual charge. Agents share a limit of **30 jobs per rolling hour per user**, across clients, retries, and upscales. Idempotent replays reuse the job.

Failed videos receive an automatic credit refund. Check job status and the current balance before planning a replacement. Do not treat a slow job or a client timeout as failure.

When the balance is too low, return the quote, shortfall, and `top_up_url` from `honeyvid_get_account` (`topUpUrl` from CLI `account`). Use `https://honeyvid.ai/pricing` if needed. Let the user buy credits; never buy them or change a plan without instruction. A rate limit or access error does not call for a top-up.

## Wait and download

- Call `honeyvid_get_video` with `{job_id, wait_seconds:45}`. If still queued or processing, honor `retry_after_seconds`, then call again. Avoid rapid polling.
- CLI: `npx honeyvid video '<job-id>' --wait --timeout 600 --output ./result.mp4`.
- For images use the same status tool; read `image_urls`. CLI: `npx honeyvid video '<job-id>' --wait --output ./result.png`. Save every returned image and report its actual path.
- On wait timeout, keep the job ID and resume waiting on it. Never create a replacement just because waiting stopped.
- Download `video_url` or every `image_urls` URL when complete. Private media links last 6–12 hours; call the status tool again for fresh links. Keep job IDs for later retrieval.
- Give the user the result link, local path if saved, job ID, and credits charged. Claim visual checks only if you inspected the output.

## Tool and command cheat sheet

All CLI commands below start with `npx honeyvid`.

| MCP tool | CLI command |
| --- | --- |
| `honeyvid_get_account` | `account` |
| `honeyvid_search_templates` | `templates --search '<query>'` |
| `honeyvid_get_template` | `template '<template-id>'` |
| `honeyvid_list_characters` | `characters` |
| `honeyvid_add_character` | `characters add --url '<https-url>' --name '<name>'` or `characters add ./photo.jpg --name '<name>'` |
| `honeyvid_upload_video` | `upload ./source.mp4` (MCP takes `video_url`) |
| `honeyvid_quote_video` | `quote --template '<id>' --quality standard` (or `--upload '<id>'`) |
| `honeyvid_create_video` | `create --template '<id>' --character '<id>' --quality standard --max-credits <n> --idempotency-key '<key>'` |
| `honeyvid_list_models` | `models [--kind video\|image] [--model '<id>']` |
| `honeyvid_quote_generation` | `generate video\|image --model '<id>' --prompt '<text>' --max-credits <n> --dry-run` plus all intended inputs/settings |
| `honeyvid_generate_video` | `generate video --model '<id>' --prompt '<text>' --max-credits <n> --idempotency-key '<key>'` |
| `honeyvid_generate_image` | `generate image --model '<id>' --prompt '<text>' --max-credits <n> --idempotency-key '<key>'` |
| `honeyvid_get_video` | `video '<job-id>' [--wait] [--output ./result.mp4]` |
| `honeyvid_list_videos` | `videos --kind image` (MCP: `kind:'image'`; use `video` for videos) |
| `honeyvid_retry_video` | `retry '<failed-job-id>' --max-credits <n> --idempotency-key '<retry-key>'` |

Choose one value wherever the table uses `|`: run `generate video` or `generate image`, not the literal pipe notation. For a CLI quote without an authorized spending budget, use `--max-credits 0 --dry-run`; this creates no job.

For Playground, map MCP `settings` to repeated `--set key=value`. Values that look like numbers or booleans are parsed as those types. Video `images` use `{character_id,role}` and CLI flags such as `--image '<id>:start'`, `--image '<id>:end'`, or `--image '<id>:ref'`; image `character_ids` use repeated `--image '<id>'`. Source videos use `{source:'upload'|'template',id}` or `--video 'upload:<id>'` / `--video 'template:<id>'`.

## Recover without duplicate charges

| Error | Action |
| --- | --- |
| 401 / CLI exit 3 | Reconnect or run `login`; keep any submitted key and job ID. |
| 403 | Check granted scope and account access; stop unsupported work. |
| 404 | Check the ID and live model list; Playground may be closed. |
| Invalid input / CLI exit 2 | Read live fields or command `--help`; fix only the invalid inputs. |
| 409 price above ceiling | Nothing is charged for this rejection. Requote, lower cost, or return the new price; never silently raise the budget. |
| Insufficient credits | Return the account's top-up link and the shortfall. |
| 429 | Honor `Retry-After` / `retryAfter`; keep the key and stop launching jobs until allowed. |
| Network / 5xx | Check a known job ID; otherwise replay identical inputs with the saved key, with bounded backoff. Stop repeated failures. |
| CLI exit 7 | Job still runs; resume `video '<id>' --wait`. |
| Failed job / CLI exit 6 | Read the reason and balance. A replacement costs credits; quote and keep it within budget. |

Use `honeyvid_retry_video` only for a failed template/upload video. Do not assume it handles Playground jobs. For a confirmed failed Playground job, submit a quoted replacement with a new key only within the authorized budget.

CLI automation: use `--json`, read `{ok:true,data:...}` or `{ok:false,error:...}`, and parse stdout only. Progress goes to stderr. Read `npx honeyvid schema` or command `--help` if a deployed version differs; stop if required tools are missing.
