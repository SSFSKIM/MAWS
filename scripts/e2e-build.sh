#!/usr/bin/env bash
# The build an e2e group runs before its tests (package.json's e2e:<group> scripts; docs/doperpowers/plans/
# 2026-10-14-gate-offload.md Decision Log 35): `electron-vite build` into out/, the harness variant (MAWS_HARNESS=1,
# which adds src/renderer/harness.html as a second renderer entry) or the plain one.
#
#   scripts/e2e-build.sh harness|plain
#
# It builds every time unless MAWS_E2E_BUILD_CACHE (a directory) and MAWS_E2E_BUILD_KEY (the commit under test) are
# both set, as the gate's macOS lane sets them; then out/ is restored from <cache>/<key>/<variant>/ when a build is
# stored there, else built and stored there, so a gate on the one-job runner builds each variant once however many
# groups it runs. A stored build carries the digest of the out/ it copied, checked after every restore; the newest
# four keys are kept.
set -euo pipefail

case ${1:-} in
  harness) harness=1 ;;
  plain) harness=0 ;; # named, so a MAWS_HARNESS=1 in the caller's environment cannot build the other variant
  *) echo 'usage: scripts/e2e-build.sh harness|plain' >&2; exit 2 ;;
esac
variant=$1
cd "$(dirname "$0")/.."

build() { MAWS_HARNESS=$harness node_modules/.bin/electron-vite build; }
digest() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256) | shasum -a 256 | cut -d' ' -f1; }

cache=${MAWS_E2E_BUILD_CACHE:-}
key=${MAWS_E2E_BUILD_KEY:-}
if [[ -z $cache || -z $key ]]; then
  build
  exit
fi
# The key names a directory the pruning below deletes beside others.
[[ $key =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "e2e-build: MAWS_E2E_BUILD_KEY is not a commit-like name: $key" >&2; exit 2; }
entry=$cache/$key/$variant

if [[ -f $entry/digest ]]; then
  rm -rf out
  cp -R "$entry/out" out
  if [[ $(digest out) == "$(<"$entry/digest")" ]]; then
    touch "$cache/$key"
    echo "e2e-build: out/ ($variant) restored from $entry, sha256 $(<"$entry/digest")"
    exit 0
  fi
  echo "e2e-build: $entry does not match its digest; discarded, building" >&2
  rm -rf "$entry"
fi

build
mkdir -p "$cache/$key"
staging=$(mktemp -d "$cache/$key/.$variant.XXXXXX")
cp -R out "$staging/out"
digest out >"$staging/digest"
rm -rf "$entry"
mv "$staging" "$entry"
echo "e2e-build: out/ ($variant) built and stored in $entry, sha256 $(<"$entry/digest")"
# The newest four keys stay: one gate's, and a rerun or two of the ones before it.
# shellcheck disable=SC2012 # by modification time; every entry is a key the check above admitted
ls -1t "$cache" | tail -n +5 | while IFS= read -r old; do rm -rf "${cache:?}/$old"; done
