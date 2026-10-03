#!/usr/bin/env bash
# devenv-inputs: package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc
# MAWS install for devenv (a minimal hand-written one; the cloud-env-setup skill replaces it).
# Idempotent: pnpm install against the lockfile; postinstall fetches Electron and readies node-pty.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v pnpm >/dev/null || { echo "install: pnpm is not on PATH (packageManager pins pnpm@11.23.0)" >&2; exit 1; }
pnpm install --frozen-lockfile
