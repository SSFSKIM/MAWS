#!/usr/bin/env bash
# Builds the dictation helper (E9, Design §1) to build/voice-helper/maws-voice-helper.
# Refuses, and exits non-zero, anywhere it cannot build a working helper, so `pnpm build:app` fails loudly
# rather than packaging an app without one.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/native/voice-helper"
out_dir="$root/build/voice-helper"
out="$out_dir/maws-voice-helper"

if [ "$(uname -s)" != "Darwin" ] || [ "$(sysctl -in hw.optional.arm64)" != "1" ]; then
  echo "build-voice-helper: the dictation helper builds only on an Apple silicon Mac." >&2
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1 || ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "build-voice-helper: no Swift toolchain found. Install Xcode (or run \`xcode-select --install\`), then retry." >&2
  exit 1
fi

mkdir -p "$out_dir"
xcrun swiftc -O \
  -target arm64-apple-macosx13.0 \
  -framework Speech -framework AVFoundation \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$src/Info.plist" \
  -o "$out" \
  "$src/main.swift"

echo "$out"
