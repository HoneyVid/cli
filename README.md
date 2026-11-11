# HoneyVid CLI for agents

Use HoneyVid from Claude Code, Codex, Cursor, shell scripts, or another agent. Create from a template or use Playground video and image models with your own prompt, settings, and reference photos. Generation uses account credits and usually takes 2–10 minutes.

Node.js 20 or newer. Plain ESM, no build step, no runtime dependencies. Published on npm as [`honeyvid`](https://www.npmjs.com/package/honeyvid):

```sh
npx honeyvid --help
# Or install globally:
npm install -g honeyvid
honeyvid --help
honeyvid schema
```

Prefer a remote MCP connection instead? Add `https://honeyvid.ai/mcp` (Streamable HTTP, OAuth, no API key) to your MCP client. Setup instructions: https://honeyvid.ai/mcp

## Sign in

```sh
honeyvid login
honeyvid whoami
```

Login prints a URL and an eight-character code, such as `HVQK-7M2P`, and opens the system browser when available. Check the code on HoneyVid matches your terminal, then click **Connect**. The browser shows **Connected** with the same code. The CLI finishes by itself and prints your account. No copy-paste or local listener is needed. Login lasts 10 minutes and uses PKCE S256 with no client secret.

For an agent, SSH, or a machine without a browser:

```sh
honeyvid login --no-browser
# Open data.url on any browser, check data.code, and click Connect.
# Leave the command running; it finishes after approval.
```

Piped output and `--json` print a JSON envelope immediately with `{url, code, expiresInSeconds: 600, next: "Open the url and click Connect. Check the code matches."}`, then a second envelope with the account after approval. In a terminal, the URL and code go to stderr. The CLI polls every two seconds. `--no-browser` skips opening the browser and still waits.

If the process stops, resume the same saved login within its original 10 minutes:

```sh
honeyvid login --wait
```

Use the same config directory and base URL. The saved verifier and state stay private in the local auth file; approval requires the verifier to exchange the code. `login --code '<long-oauth-code>'` remains as a legacy fallback for one release if you already copied an OAuth code. The new browser page shows only the short matching code, which is not an OAuth code.

Tokens are stored per base URL at `${XDG_CONFIG_HOME:-~/.config}/honeyvid/auth.json` (file `0600`, directory `0700`). Expiring tokens refresh before requests; a `401` refreshes once and replays the request once. Rotated refresh tokens are saved atomically. A config lock serializes refreshes and writes so parallel commands share the latest rotating token. Queued jobs are exposed as `processing`.

```sh
honeyvid auth export --json
honeyvid logout
```

`auth export` returns `data.refreshToken` and warns on stderr. Treat it as a secret. `HONEYVID_TOKEN` supplies a refresh token for CI and overrides the local login. Its rotated credentials are cached separately, so later commands on the same machine use the new token without replacing the interactive login. Export the current token when moving CI to another machine. Never put tokens in source control, shared logs, or prompts. Logout removes local credentials for the selected base URL; it does not revoke a token or unset `HONEYVID_TOKEN`.

## Template flow

```sh
honeyvid templates --search dance --limit 10 --json
honeyvid template '<template-id>'
honeyvid characters add ./face.jpg --name Alex
# Or:
honeyvid characters add --url 'https://example.com/face.jpg' --name Alex
honeyvid characters
honeyvid quote --template '<template-id>' --quality standard
honeyvid create --template '<template-id>' --character '<character-id>' \
  --quality standard --max-credits 50 --idempotency-key 'my-video-001' \
  --wait --timeout 600 --output ./video.mp4
```

Use IDs and prices returned by the API. Choose a template with available `qualities`. Template results contain compact details and absolute poster and preview URLs. Character uploads accept PNG, JPG, and WebP up to 10 MB; names contain 1–60 characters. URL images must use HTTPS and are downloaded without account credentials.

`--max-credits` is required for create and retry. The server must enforce this ceiling and reject a higher price with `409`. A quote does not reserve a price or credits. `--dry-run` returns the same output as quote, does not submit a job, and needs only the source and quality:

```sh
honeyvid create --template '<template-id>' --quality high --dry-run
```

Create, retry, and generate always print the idempotency key to stderr before submission and include it as `data.idempotencyKey` or `error.idempotencyKey`. On a network failure, timeout, or server error, the outcome may be unknown: rerun the same command with the **same key and inputs**. A new key can create and charge for another job. There are no automatic retries for `429`, network errors, or `5xx` responses.

```sh
honeyvid video '<job-id>' --wait --timeout 600
honeyvid job '<job-id>'                 # Alias for video
honeyvid videos --status completed --limit 10
honeyvid download '<job-id>'            # ./honeyvid-<id>.mp4
honeyvid retry '<failed-job-id>' --max-credits 50 \
  --idempotency-key 'my-retry-001' --wait
honeyvid account                       # Credits, plan, topUpUrl
```

Wait checks every five seconds and writes progress to stderr. A timeout stops waiting; it does not cancel generation. Output paths are absolute in results. The response Content-Type sets the file extension; a mismatched extension is replaced and the actual path is reported on stderr and in JSON. Downloads stream to a temporary file, never overwrite an existing destination, and remove partial files on failure. `--output` on create, video, or retry downloads after completion; add `--wait` if the video is processing.

For your own source video:

```sh
honeyvid upload ./clip.mp4
honeyvid quote --upload '<upload-id>' --quality standard
honeyvid create --upload '<upload-id>' --character '<character-id>' \
  --quality standard --max-credits 50 --wait --output ./my-video.mp4
```

Use an MP4 up to 100 MB and 3–30 seconds. Uploads stream as raw `video/mp4` with a content length, not multipart. Own-video generation may be unavailable for the account. Choose exactly one of `--template` and `--upload`.

## Playground flow

Discover the models available to the signed-in account, then inspect the selected model's full fields. Model availability and settings come from the server; do not guess model IDs or supported values.

```sh
honeyvid models --kind video
honeyvid models --kind image
honeyvid models --model '<model-id>' --json
honeyvid characters add ./reference.jpg --name Reference
honeyvid generate video --model '<model-id>' --prompt 'A honey river at sunrise' \
  --set duration=5 --image '<character-id>:start' --max-credits 50 --dry-run
honeyvid generate video --model '<model-id>' --prompt 'A honey river at sunrise' \
  --set duration=5 --image '<character-id>:start' --max-credits 50 \
  --idempotency-key 'playground-video-001' --wait --timeout 600 --output ./river.mp4
honeyvid generate image --model '<image-model-id>' --prompt 'A honey jar in warm light' \
  --image '<character-id>' --max-credits 50 --dry-run
honeyvid generate image --model '<image-model-id>' --prompt 'A honey jar in warm light' \
  --image '<character-id>' --max-credits 50 \
  --idempotency-key 'playground-image-001' --wait --output ./jar.png
```

The settings above are examples; use fields returned by `models --model` for the selected model. Repeat `--set key=value` for each setting. Numbers (including decimals, negatives, and exponents) and lowercase `true`/`false` become JSON numbers and booleans. Other values stay strings. Duplicate setting keys are rejected. Video references accept `--image <character-id>[:start|end|ref]`; image generation accepts character IDs without roles. Repeat `--image` for more references. If the model accepts a source video, add `--video upload:<id>` or `--video template:<id>`.

Both generate commands require `--model`, `--prompt`, and `--max-credits`, including for `--dry-run`. A dry run calls the free Playground quote endpoint and returns `credits`, `balance`, and `estimatedSeconds`; it creates no job. A real run sends the cap to the server. A price above it returns exit 5 without charging. Quotes do not reserve prices.

Generate prints a caller-supplied or generated idempotency key before submitting and returns it in success or error JSON. Reuse the same key and inputs after an uncertain outcome. Waiting and downloading work like template creation.

```sh
honeyvid videos --kind image
honeyvid video '<image-job-id>'
honeyvid video '<image-job-id>' --wait --output ./image.png
```

Image job output includes image URLs. The first image is saved at `--output`; more images use `image-2.png`, `image-3.png`, and so on. Results include `path` for the first download and `paths` for all downloads. Existing files are preserved. In a terminal, `models` prints a compact table; `--model` prints the full schema. Piped output and `--json` always use JSON envelopes.

## Agent skills

```sh
honeyvid skills list
honeyvid skills install                 # Claude and Codex
honeyvid skills install --agent claude
honeyvid skills install --agent codex
honeyvid skills install --agent all
honeyvid skills install --dir ./skills
```

These commands work without login. Bundled skills use HoneyVid MCP tools when connected and the CLI otherwise. The installer copies all bundled skill folders into `$HOME/.claude/skills/<name>/` and/or `$HOME/.codex/skills/<name>/`. `--dir` overrides the skills root and installs once into `<dir>/<name>/`, regardless of `--agent`.

The JSON result lists written absolute paths in `paths` and preserved paths in `skipped`. A small `.honeyvid-cli.json` ownership file lets later installs update only files previously written by this installer. Existing user files, edited installed files, extra files, and skill directory symlinks are preserved. The installer never deletes user files or prompts.

## Machine interface

Every command accepts `--json`; it is the default when stdout is not a TTY. JSON commands print one envelope, except `login`, which prints connection details before its final account or error envelope:

```json
{"ok":true,"data":{"credits":12,"quality":"standard","estimatedSeconds":120,"balance":100}}
```

Failures print one envelope to stdout and exit nonzero:

```json
{"ok":false,"error":{"code":"not_signed_in","message":"You are not signed in.","suggestion":"Run honeyvid login.","retryable":false}}
```

Errors can also contain `idempotencyKey`, `jobId`, and `retryAfter` (seconds). `retryable` describes the error; the CLI does not automatically retry it. Never parse stderr as data. Help is plain text. `schema` returns all commands, flags, enums, constraints, output shapes, environment variables, and exit codes in `data`. Every command has `--help`, examples, environment variables, and exit codes.

Known API error codes are `price_above_max` (409 with credits), `insufficient_credits` (402), `rate_limited` (429), `generation_closed`, `not_found` (404), and `forbidden` (403). Their exit codes follow the table below: credit, limit and conflict errors use 5; forbidden uses 1.

| Exit | Meaning | Agent action |
| --- | --- | --- |
| 0 | Success | Read `data`. |
| 1 | Request, network, file, or other error | Read the suggestion; preserve a submitted key. |
| 2 | Usage error | Read command help. |
| 3 | Not signed in | Run `honeyvid login`. |
| 4 | Not found | Check the ID and base URL. |
| 5 | Credits, limits, conflict, or price above maximum | Read the error. For `429`, respect `retryAfter` and reuse the key. |
| 6 | Job failed | Inspect the job; quote and retry if wanted. |
| 7 | Wait timed out; job still running | Run `honeyvid video <id> --wait`. |

Environment:

- `HONEYVID_URL`: API/site base URL; defaults to `https://honeyvid.ai`. `--base-url <url>` overrides it. HTTPS is required except for loopback development URLs. Credentials are isolated by base URL.
- `HONEYVID_TOKEN`: secret refresh token overriding stored login.
- `HOME`: home directory for agent skills (or the OS home if unset).
- `XDG_CONFIG_HOME`: parent of the `honeyvid/` config directory.
- `DISPLAY`: when absent on Linux, login prints a Connect URL instead of opening a browser.

The CLI never prompts. It never publishes, tops up credits, or changes subscription plans.

## Remote MCP setup

```sh
honeyvid setup all
honeyvid setup claude --apply
honeyvid setup codex
honeyvid setup cursor
```

Setup also suggests `honeyvid skills install`. The endpoint is `<base>/mcp`. Claude setup prints `claude mcp add --transport http honeyvid <url>`; `--apply` runs it if Claude is on PATH. Codex setup prints the `~/.codex/config.toml` block. Cursor setup prints the `~/.cursor/mcp.json` block. The CLI never edits these config files itself.

## Development checks

From the repository root, using the existing dependencies:

```sh
npx vitest run tests/cli/cli.test.ts
node packages/cli/bin/honeyvid.mjs --help
node packages/cli/bin/honeyvid.mjs schema
```

Tests start a local fake HTTP server and use temporary config directories. They do not call a real account, spend credits, or generate real videos. The CLI is outside the root TypeScript/Vite build.
