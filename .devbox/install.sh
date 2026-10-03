#!/usr/bin/env bash
# devenv-inputs: package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc
#
# Makes a MAWS checkout ready to run and test on macOS: the pnpm workspace from its lockfile, whose
# postinstall fetches Electron and marks node-pty's darwin-arm64 spawn-helper executable (native
# builds are allowed in pnpm-workspace.yaml's allowBuilds). Idempotent: pnpm install against the
# lockfile. MAWS is a macOS Electron app, so on any other OS this installs nothing and says so.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname -s)" != Darwin ]; then
  echo "install: MAWS is a macOS Electron app; nothing installed on $(uname -s)"
  exit 0
fi

command -v node >/dev/null || { echo "install: node not found (MAWS needs Node >= 22.12)" >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' \
  || { echo "install: MAWS needs Node >= 22.12, found $(node --version)" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "install: pnpm not found (package.json pins pnpm@11.23.0; corepack enable)" >&2; exit 1; }
echo "== pnpm install (node $(node --version), pnpm $(pnpm --version))"
pnpm install --frozen-lockfile

# pnpm exits 0 even when a build it was not allowed to run left a native module unbuilt; check the
# two the app cannot start without.
electron_bin=$(node -p 'require("electron")')
[ -x "$electron_bin" ] || { echo "install: Electron binary missing at $electron_bin" >&2; exit 1; }
[ -x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper ] \
  || { echo "install: node-pty's spawn-helper is missing or not executable" >&2; exit 1; }
echo "== Electron $(node -p 'require("electron/package.json").version') and node-pty ready"
