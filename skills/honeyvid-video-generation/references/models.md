# Video model decisions and limits

Source: HoneyVid `worker/providers/playground-models.ts` and `limits.ts`. Use HoneyVid IDs below, not provider endpoint strings. Refresh with `honeyvid_list_models {model:"<id>"}` / `npx honeyvid models --model '<id>'` before choosing settings or quoting. Choose only models returned for this account.

Lengths are seconds. Prompt caps are characters. Every image-taking video model needs at least one image. `start` and `end` each accept at most one image; a required start is marked below. Total image count includes all roles. No video model accepts more than 4 photos in HoneyVid.

## Text to video: no images, no source video

| Model ID | Name | Choose for | Duration | Prompt max |
| --- | --- | --- | --- | --- |
| `kling-v3-t2v-standard` | Kling 3.0 Standard | Prompt-led scenes with sound and voices | 3–15 | 2500 |
| `kling-v3-t2v-pro` | Kling 3.0 Pro | Same workflow at the Pro tier | 3–15 | 2500 |
| `veo31-t2v` | Veo 3.1 | Cinematic scenes, dialogue and sound | 4, 6, 8 | 4000 |
| `veo31-fast-t2v` | Veo 3.1 Fast | Fast Veo variant; compare its quote | 4, 6, 8 | 4000 |
| `seedance2-t2v` | Seedance 2.0 | Smooth motion from a prompt | 4–15 | 4000 |
| `minimax-h3-t2v` | MiniMax H3 | Natural faces and physics | 5–15 | 2000 |
| `wan3-prime-t2v` | Wan 3.0 Prime | Longer takes with sound | 2–30 | 3000 |

All text-only models require a prompt. Kling duration values are strings such as `"5"`, Veo uses `"8s"`, Seedance uses strings such as `"5"`, MiniMax and Wan use numeric ranges; live validation resolves listed choice values.

## Animate images: no source video

| Model ID | Name | Choose for | Roles; max images | Duration | Prompt max; required? |
| --- | --- | --- | --- | --- | --- |
| `kling-v3-i2v-standard` | Kling 3.0 Standard | Animate a start and optionally land on an end | start required, end; 2 | 3–15 | 2500; no |
| `kling-v3-i2v-pro` | Kling 3.0 Pro | Same frame workflow at the Pro tier | start required, end; 2 | 3–15 | 2500; no |
| `veo31-i2v` | Veo 3.1 | One frame with cinematic motion and sound | start required; 1 | 4, 6, 8 | 4000; yes |
| `veo31-fast-i2v` | Veo 3.1 Fast | Fast Veo animation from one frame | start required; 1 | 4, 6, 8 | 4000; yes |
| `seedance2-i2v` | Seedance 2.0 | Motion between start and optional end frames | start required, end; 2 | 4–15 | 4000; yes |
| `minimax-h3-i2v` | MiniMax H3 | Natural faces/physics with a start or end frame | start, end; 2; at least one | 5–15 | 2000; yes |
| `wan3-prime-i2v` | Wan 3.0 Prime | Long image-led takes with sound | start required, end; 2 | 2–30 | 3000; no |

## Reference images: no source video

| Model ID | Name | Choose for | Roles; max images | Duration | Prompt max |
| --- | --- | --- | --- | --- | --- |
| `kling-o3-ref-standard` | Kling O3 Reference Standard | Combine characters, objects and places; `@Image1` tags | ref, start, end; 4 total | 3–15 | 2500 |
| `kling-o3-ref-pro` | Kling O3 Reference Pro | Same reference workflow at the Pro tier | ref, start, end; 4 total | 3–15 | 2500 |
| `seedance2-ref` | Seedance 2.0 Reference | Blend images in one scene; `@Image1` tags | ref; 4 | 4–15 | 4000 |
| `veo31-ref` | Veo 3.1 Reference | Keep subjects consistent through a clip | ref; 3 | 8 only | 4000 |

All four reference models require a prompt. Kling O3 supports start/end roles without requiring a start; use `ref` for identity or scene references. Seedance's HoneyVid cap is 4, even if provider documentation describes more. Veo Reference has no end frame or seed field.

## Source-video edits and motion

All require one `ref` character image and a source video. Output length follows the source. Use a saved upload or library template, never a raw video URL in the generation request. Uploads accept 3–30 seconds even where a model's minimum below is shorter. These Playground jobs do not automatically split clips to evade model caps.

| Model ID | Name | Choose for | Source length | Prompt max; required? | Main settings |
| --- | --- | --- | --- | --- | --- |
| `kling-4` | Kling 4.0 | Default character swap while keeping the scene | 3–30 | 2500; no | resolution 720p/1080p; source audio restored |
| `kling-o3-edit-standard` | Kling O3 Edit Standard | Swap a character in the source scene | 3–15 | 2500; yes | keep_audio, default true |
| `kling-o3-edit-pro` | Kling O3 Edit Pro | Same swap at the Pro tier | 3–15 | 2500; yes | keep_audio, default true |
| `kling-motion-standard` | Kling Motion Control Standard | Move the character image like the source | 3–30; 10 max with image framing | 2500; no | character_orientation video/image; keep_original_sound |
| `kling-motion-pro` | Kling Motion Control Pro | Same motion workflow at the Pro tier | 3–30; 10 max with image framing | 2500; no | character_orientation video/image; keep_original_sound |
| `wan22-replace` | Wan 2.2 Animate | Character replacement with resolution choices | 1–30 | 0; hidden; send empty string | resolution 480p/580p/720p; source audio restored |
| `scail2` | SCAIL-2 | Swap people or animals | 1–10 | 2000; no | subject_type human/animal; resolution 512p/704p; source audio restored |

## Settings that change a decision

- **Kling 3.0 / O3 Reference:** `duration` 3–15; `generate_audio`; `shot_type` customize/intelligent. Text and reference variants expose 16:9, 9:16, 1:1; i2v exposes no aspect field. Only non-reference variants expose `negative_prompt` and `cfg_scale` 0–1. Reference audio defaults off; others on.
- **Veo:** `duration` 4s/6s/8s (reference only 8s); `resolution` 720p/1080p/4k; `generate_audio` defaults on. Text/reference ratios 16:9 or 9:16; i2v also auto. Non-reference variants expose `negative_prompt` and `seed`. All expose `auto_fix`.
- **Seedance:** duration 4–15, resolution 480p/720p/1080p/4k, `generate_audio`, `bitrate_mode` standard/high. Text ratios auto/16:9/4:3/1:1/3:4/9:16; image/reference also 21:9. No seed field.
- **MiniMax:** duration 5–15; resolution **480P/768P/2K/4K**; `prompt_expansion_mode` disabled/fast/balanced/quality; `seed`. Text exposes 21:9/16:9/4:3/1:1/3:4/9:16; i2v has no aspect field. No audio field.
- **Wan 3:** duration 2–30; resolution 480p/720p/1080p; `audio`; `enable_prompt_expansion`; `enable_thinking`; `seed`; ratios adaptive/16:9/4:3/1:1/3:4/9:16.
- Where exposed, seed is an integer from 0 to 2147483647. A fixed seed and settings give a similar result; do not promise identical output.

## Cost rules

Quote customer credits with `honeyvid_quote_generation` / CLI `generate video ... --dry-run`. Do not present provider dollar rates as the customer's charge. Credits round up, and an active beta discount can change the charge.

- Kling 3.0 and O3 Reference cost scales with duration, tier and generated audio.
- Veo cost scales with duration, Fast/full, resolution tier and audio. 720p and 1080p share the same rate; 4k costs more. Fast is not a fixed fraction of full pricing.
- Seedance cost scales with duration and resolution; its current cost function charges the same with audio on/off.
- MiniMax and Wan 3 cost scales with duration and resolution. Wan's current audio switch does not change its cost function.
- Video-input models charge by source length and tier; Kling 4 and Wan 2.2 also use resolution. Models that restore source audio include an audio-merge allowance.
- Aspect ratio and Seedance bitrate do not change the current cost functions. Still quote the exact settings. Never infer an unlisted resolution or price.
