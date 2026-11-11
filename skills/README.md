# HoneyVid agent skills

Teach Claude Code, Codex, and other agents to make HoneyVid videos and images through connected MCP tools or the `npx honeyvid` CLI.

Install the bundled skills:

```sh
npx honeyvid skills install
npx honeyvid skills install --agent claude
npx honeyvid skills install --agent codex
npx honeyvid skills install --agent all --dir ./my-skills
npx honeyvid skills list
```

The installer copies owned skill files into `~/.claude/skills/<name>/` and/or `~/.codex/skills/<name>/` and prints the paths. Use `--dir` for a custom destination. It overwrites only files it owns.

For the public skills repository, once published:

```sh
npx skills add honeyvid/skills
```

- **honeyvid** — Connect, check credits, quote, create, wait, download, and handle errors.
- **honeyvid-viral-template** — Put a person, pet, or character into a trending template.
- **honeyvid-video-generation** — Choose a Playground video model, write a prompt, and use frames, references, or source video.
- **honeyvid-image-generation** — Generate or edit images with model-specific reference limits and settings.
- **honeyvid-batch** — Make several variants within a total credit budget and report the spend.

Connect an MCP client to `https://honeyvid.ai/mcp`, or run `npx honeyvid login`. Skills supply instructions; connecting the account supplies tool access. Model access and prices come from the live account. Read each skill's linked references only when needed.
