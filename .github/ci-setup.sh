#!/usr/bin/env bash
# Project tools shared by CI jobs and ci-kit's image bakes; packages live in ci-kit.yml.
set -euo pipefail

platform=$(uname -s)
# Only Mac groups launch the installed engine (connectors and live suites); Linux uses replay/stubs.
# MAWS resolves this path directly, not whichever claude happens to be on PATH.
engine="$HOME/.local/bin/claude"
if [[ $platform == Darwin ]] && ! "$engine" --version >/dev/null 2>&1; then
  echo "MAWS setup: installing Claude Code at $engine"
  curl -fsSL https://claude.ai/install.sh | bash
  "$engine" --version
fi

# Recorded fixtures name macOS's /private/tmp; keep a real directory with the same permissions on Linux.
if [[ $platform == Linux ]] && [[ $(stat -c '%a:%F' /private/tmp 2>/dev/null || true) != '1777:directory' ]]; then
  sudo -n install -d -m 1777 /private/tmp
fi
