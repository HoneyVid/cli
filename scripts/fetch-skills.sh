#!/usr/bin/env bash
# Copies the HoneyVid skills at the commit pinned in skills.ref into ./skills (bundled into the npm package).
# Update skills.ref in a PR to ship newer skills with the next release.
set -euo pipefail
cd "$(dirname "$0")/.."
ref=$(tr -d '[:space:]' < skills.ref)
[[ "$ref" =~ ^[0-9a-f]{40}$ ]] || { echo "skills.ref must be a 40-character commit SHA"; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
git init -q "$tmp" && git -C "$tmp" remote add origin https://github.com/HoneyVid/skills.git
git -C "$tmp" fetch -q --depth 1 origin "$ref" && git -C "$tmp" checkout -q FETCH_HEAD
rm -rf skills && cp -R "$tmp/skills" skills && cp "$tmp/LICENSE" skills/LICENSE && cp "$tmp/README.md" skills/README.md
echo "Skills from HoneyVid/skills@${ref:0:12}: $(ls skills | grep -v -e README -e LICENSE | tr '\n' ' ')"
