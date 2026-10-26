#!/usr/bin/env bash
# The secret scan a push to SSFSKIM/maws-app passes first (ci-kit's docs/doperpowers/specs/2026-10-26-maws-hosted-mac-design.md,
# The secret scan): gitleaks over every file of a directory, with .github/maws-app/gitleaks.toml, which carries the
# pinned release's default rules (without its exempt paths) and the known false positives of MAWS's tree. Symlinks are
# not followed. Fails closed: a finding, or a scanner that cannot be had or cannot run, exits 1 and
# prints `maws-app-scan: refused`. A finding is printed as its file, line and rule, never its value.
#
#   .github/scripts/maws-app-scan.sh <dir>
#
# gitleaks is the release pinned below, by version and by its archive's sha256: the one on PATH when it is that version,
# else downloaded with curl into $MAWS_APP_GITLEAKS_CACHE (default: under $RUNNER_TEMP, else the temp directory) and
# checked before every use. $MAWS_APP_GITLEAKS_URL replaces the release's download base, for the tests.
set -euo pipefail

GITLEAKS_VERSION=8.30.1
# gitleaks_8.30.1_checksums.txt, for the platforms a scan runs on: the pool and hosted Linux, the Macs.
sha256_of_asset() {
  case $1 in
    linux_x64) echo 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
    linux_arm64) echo e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
    darwin_arm64) echo b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
    darwin_x64) echo dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
    *) return 1 ;;
  esac
}

refuse() {
  echo "maws-app-scan: $1" >&2
  echo "maws-app-scan: refused"
  exit 1
}

(($# == 1)) || { echo "usage: maws-app-scan.sh <dir>" >&2; exit 2; }
[[ -d $1 ]] || { echo "maws-app-scan: $1 is not a directory" >&2; exit 2; }
target=$(cd "$1" && pwd)
config=$(cd "$(dirname "$0")/.." && pwd)/maws-app/gitleaks.toml
[[ -f $config ]] || refuse "no config at $config"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

# The pinned gitleaks, on PATH or from its verified release archive.
gitleaks=
if command -v gitleaks >/dev/null && [[ $(gitleaks version 2>/dev/null) == "$GITLEAKS_VERSION" ]]; then
  gitleaks=$(command -v gitleaks)
else
  case $(uname -s)-$(uname -m) in
    Linux-x86_64) asset=linux_x64 ;;
    Linux-aarch64 | Linux-arm64) asset=linux_arm64 ;;
    Darwin-arm64) asset=darwin_arm64 ;;
    Darwin-x86_64) asset=darwin_x64 ;;
    *) refuse "no pinned gitleaks for $(uname -s) $(uname -m)" ;;
  esac
  want=$(sha256_of_asset "$asset")
  cache=${MAWS_APP_GITLEAKS_CACHE:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/maws-app-gitleaks}
  archive=$cache/gitleaks_${GITLEAKS_VERSION}_$asset.tar.gz
  if [[ ! -f $archive || $(sha256 "$archive") != "$want" ]]; then
    mkdir -p "$cache"
    url=${MAWS_APP_GITLEAKS_URL:-https://github.com/gitleaks/gitleaks/releases/download}/v$GITLEAKS_VERSION/${archive##*/}
    curl -fsSL --retry 3 --connect-timeout 20 -o "$work/download" "$url" || refuse "could not download gitleaks from $url"
    [[ $(sha256 "$work/download") == "$want" ]] || refuse "gitleaks from $url fails its checksum (want $want)"
    mv "$work/download" "$archive"
  fi
  # Checked again here: the cache may be shared.
  cp "$archive" "$work/gitleaks.tar.gz"
  [[ $(sha256 "$work/gitleaks.tar.gz") == "$want" ]] || refuse "the cached gitleaks fails its checksum (want $want)"
  tar -xzf "$work/gitleaks.tar.gz" -C "$work" gitleaks || refuse "could not unpack gitleaks"
  gitleaks=$work/gitleaks
fi

# From inside the target, so a finding's file is its path in the tree; with no .gitleaksignore and no inline
# `gitleaks:allow` honoured, so nothing in the scanned tree can quiet the scan.
status=0
(cd "$target" && "$gitleaks" dir . --config "$config" --redact --no-banner --no-color --log-level error \
  --ignore-gitleaks-allow --gitleaks-ignore-path "$work/no-ignore-file" \
  --report-format json --report-path "$work/report.json" --exit-code 99) || status=$?
case $status in
  0) echo "maws-app-scan: clean" ;;
  99)
    python3 -I - "$work/report.json" <<'EOF'
import json, sys
findings = json.load(open(sys.argv[1]))
for f in sorted(findings, key=lambda f: (f['File'], f['StartLine'], f['RuleID'])):
    print(f"maws-app-scan: {f['File'].removeprefix('./')}:{f['StartLine']} {f['RuleID']}")
print(f"maws-app-scan: {len(findings)} finding{'s' if len(findings) != 1 else ''}")
EOF
    echo "maws-app-scan: refused"
    exit 1
    ;;
  *) refuse "gitleaks could not scan $target (exit $status)" ;;
esac
