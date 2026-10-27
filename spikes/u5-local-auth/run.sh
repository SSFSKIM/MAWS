#!/usr/bin/env bash
# U5's spike in one command: builds the LocalAuthentication addon, then runs main.cjs under this repository's Electron
# (node_modules/electron, the binary `pnpm dev` runs). It shows Touch ID, password and app prompts, so the owner must be
# at the Mac to answer them. Arguments pass to main.cjs (--only 1,3; --step-timeout-ms N). Writes nothing outside
# spikes/u5-local-auth/ except a scratch profile under $TMPDIR, removed at the end.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
electron="$root/node_modules/.bin/electron"

if [ ! -x "$electron" ]; then
  echo "u5 run: no Electron at $electron; run \`pnpm install --frozen-lockfile\` in $root first." >&2
  exit 1
fi
"$here/build.sh" >/dev/null
exec "$electron" "$here/main.cjs" "$@"
