#!/usr/bin/env bash
# Builds U5's second candidate, the LocalAuthentication addon (local-auth.m), into spikes/u5-local-auth/build/, as
# scripts/build-peer-auth.sh builds native/peer-auth/. Shows no prompt: it only compiles. Apple silicon macOS with the
# Xcode command line tools.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$here/build/local-auth.node"

if [ "$(uname -s)" != "Darwin" ] || [ "$(sysctl -in hw.optional.arm64)" != "1" ]; then
  echo "u5 build: the LocalAuthentication addon builds only on an Apple silicon Mac." >&2
  exit 1
fi
if ! xcrun --find clang >/dev/null 2>&1; then
  echo "u5 build: no clang found. Install the Xcode command line tools (\`xcode-select --install\`), then retry." >&2
  exit 1
fi
include="$(cd "$root" && node -p 'require("node-api-headers").include_dir')"

mkdir -p "$here/build"
xcrun clang -shared -fPIC -O2 -Wall -Wextra -Werror -fobjc-arc \
  -undefined dynamic_lookup \
  -install_name @rpath/local-auth.node \
  -target arm64-apple-macosx13.0 \
  -framework Foundation -framework LocalAuthentication \
  -I "$include" \
  -o "$out" \
  "$here/local-auth.m"

echo "$out"
