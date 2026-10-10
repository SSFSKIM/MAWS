#!/usr/bin/env bash
# Builds the peer identity addon (cua docs/doperpowers/specs/2026-10-09-maws-socket-peer-auth-design.md, M1) from
# native/peer-auth/peer-auth.c into native/peer-auth/prebuilds/darwin-arm64/peer-auth.node, the prebuild committed
# beside its source. Run by hand when the C source changes, then copy the source and the prebuild to cua's
# native/peer-auth/ (the two repositories' copies must match). Refuses off Apple silicon macOS.
# The install name is fixed (not the output path), so the build is the same bytes in either repository.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/native/peer-auth/peer-auth.c"
out_dir="$root/native/peer-auth/prebuilds/darwin-arm64"
out="$out_dir/peer-auth.node"

if [ "$(uname -s)" != "Darwin" ] || [ "$(sysctl -in hw.optional.arm64)" != "1" ]; then
  echo "build-peer-auth: the peer identity addon builds only on an Apple silicon Mac." >&2
  exit 1
fi
if ! xcrun --find clang >/dev/null 2>&1; then
  echo "build-peer-auth: no clang found. Install the Xcode command line tools (\`xcode-select --install\`), then retry." >&2
  exit 1
fi
include="$(cd "$root" && node -p 'require("node-api-headers").include_dir')"

mkdir -p "$out_dir"
xcrun clang -shared -fPIC -O2 -Wall -Wextra -Werror \
  -undefined dynamic_lookup \
  -install_name @rpath/peer-auth.node \
  -target arm64-apple-macosx13.0 \
  -I "$include" \
  -o "$out" \
  "$src"

echo "$out"
