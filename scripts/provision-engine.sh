#!/bin/bash
# Provisions the engine build the Discover e2e group runs (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md,
# M1), before the job's offline test phase: the official build of <version> for this platform, downloaded from
# Anthropic's release bucket (the engine's own updater's, https://downloads.claude.ai/claude-code-releases/<version>/
# <platform>/claude), verified against scripts/engine-checksums.txt, cached by version under the runner's user directory,
# its --version checked. A checksum that differs stops the job, naming the checksum it saw; nothing unverified is cached.
# Prints `export MAWS_E2E_ENGINE_BIN=<path>` (so `eval "$(scripts/provision-engine.sh 2.1.309)"` provisions a shell),
# and in a GitHub Actions job also writes it to $GITHUB_ENV for the steps after. Diagnostics go to stderr.
#   scripts/provision-engine.sh <version>
# The tests and a manual check may move it: MAWS_ENGINE_CACHE (default ~/Library/Caches/maws-engine),
# MAWS_ENGINE_DOWNLOAD_BASE, MAWS_ENGINE_CHECKSUMS, MAWS_ENGINE_PLATFORM.
set -euo pipefail
version=${1:?usage: scripts/provision-engine.sh <version>}
repo=$(cd "$(dirname "$0")/.." && pwd)
base=${MAWS_ENGINE_DOWNLOAD_BASE:-https://downloads.claude.ai/claude-code-releases}
checksums=${MAWS_ENGINE_CHECKSUMS:-$repo/scripts/engine-checksums.txt}
cache=${MAWS_ENGINE_CACHE:-$HOME/Library/Caches/maws-engine}
fail() { echo "provision-engine: $*" >&2; exit 1; }

if [[ -z ${MAWS_ENGINE_PLATFORM:-} ]]; then
  case "$(uname -s) $(uname -m)" in
    'Darwin arm64') MAWS_ENGINE_PLATFORM=darwin-arm64 ;;
    'Darwin x86_64') MAWS_ENGINE_PLATFORM=darwin-x64 ;;
    'Linux x86_64') MAWS_ENGINE_PLATFORM=linux-x64 ;;
    'Linux aarch64') MAWS_ENGINE_PLATFORM=linux-arm64 ;;
    *) fail "no engine platform for $(uname -s) $(uname -m)" ;;
  esac
fi
platform=$MAWS_ENGINE_PLATFORM
expected=$(awk -v v="$version" -v p="$platform" '$1 == v && $2 == p { print $3 }' "$checksums")
[[ $expected =~ ^[0-9a-f]{64}$ ]] || fail "no checksum for $version $platform in $checksums"
sha256() { if command -v shasum >/dev/null; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }

bin=$cache/$version/claude
if [[ -x $bin && $(sha256 "$bin") == "$expected" ]]; then
  echo "provision-engine: $version $platform cached at $bin" >&2
else
  mkdir -p "$cache/$version"
  partial=$(mktemp "$cache/$version/.claude.XXXXXX") # a sibling, so the move into place is atomic beside a concurrent job
  trap 'rm -f "$partial"' EXIT
  curl -fsSL --retry 3 -o "$partial" "$base/$version/$platform/claude" || fail "could not download $base/$version/$platform/claude"
  seen=$(sha256 "$partial")
  [[ $seen == "$expected" ]] || fail "$version $platform: the download's sha256 is $seen, not $expected ($checksums)"
  chmod 755 "$partial"
  mv -f "$partial" "$bin"
  echo "provision-engine: $version $platform downloaded to $bin (sha256 $seen)" >&2
fi

reported=$("$bin" --version 2>/dev/null) || fail "$bin does not answer --version"
[[ $(grep -oE '[0-9]+\.[0-9]+\.[0-9]+[^ ]*' <<<"$reported" | head -1) == "$version" ]] || fail "$bin reports $reported, not $version"
printf 'export MAWS_E2E_ENGINE_BIN=%q\n' "$bin"
if [[ -n ${GITHUB_ENV:-} ]]; then echo "MAWS_E2E_ENGINE_BIN=$bin" >>"$GITHUB_ENV"; fi
