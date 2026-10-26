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

# settings' Nerd Font case (e2e/settings.spec.ts) draws in MesloLGM Nerd Font Mono and skips where the Mac lacks it, which
# would leave a desktop's count lines short of another's (ci-kit's hosted-Mac spec, Admission). Where it is missing, its
# four files are installed from the Nerd Fonts release pinned below, by version and by its archive's sha256, checked
# before the archive is unpacked (as maws-app-scan.sh pins gitleaks): a mismatch refuses setup. A font already there,
# however it came, stays: the mini's was installed by hand, outside Homebrew, and Homebrew's cask (through ci-kit.yml's
# list, whose presence check is Homebrew's own) refuses to overwrite a font file it did not put there, failing setup.
MESLO_VERSION=3.5.1
MESLO_SHA256=6b6624632dc6873dfb7681c3f818e7c01ab601ab707690b6440933bbe57e2b11
meslo=MesloLGMNerdFontMono
if [[ $platform == Darwin ]] && [[ ! -e $HOME/Library/Fonts/$meslo-Regular.ttf && ! -e /Library/Fonts/$meslo-Regular.ttf ]]; then
  url=https://github.com/ryanoasis/nerd-fonts/releases/download/v$MESLO_VERSION/Meslo.tar.xz
  echo "MAWS setup: installing MesloLGM Nerd Font Mono $MESLO_VERSION from $url"
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  if ! curl -fsSL --retry 3 --connect-timeout 20 -o "$work/Meslo.tar.xz" "$url"; then
    echo "MAWS setup: could not download $url" >&2
    exit 1
  fi
  got=$(if command -v sha256sum >/dev/null; then sha256sum "$work/Meslo.tar.xz"; else shasum -a 256 "$work/Meslo.tar.xz"; fi | cut -d' ' -f1)
  if [[ $got != "$MESLO_SHA256" ]]; then
    echo "MAWS setup: refused: $url has sha256 $got, not the pinned $MESLO_SHA256" >&2
    exit 1
  fi
  tar -xJf "$work/Meslo.tar.xz" -C "$work" "$meslo-Regular.ttf" "$meslo-Bold.ttf" "$meslo-Italic.ttf" "$meslo-BoldItalic.ttf"
  mkdir -p "$HOME/Library/Fonts"
  cp "$work/$meslo"-*.ttf "$HOME/Library/Fonts/"
fi

# Recorded fixtures name macOS's /private/tmp; keep a real directory with the same permissions on Linux.
if [[ $platform == Linux ]] && [[ $(stat -c '%a:%F' /private/tmp 2>/dev/null || true) != '1777:directory' ]]; then
  sudo -n install -d -m 1777 /private/tmp
fi
