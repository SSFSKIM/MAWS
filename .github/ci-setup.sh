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
# would leave a desktop's count lines short of another's (ci-kit's hosted-Mac spec, Admission). Its cask installs it where
# it is missing. A font already there, however it came, stays: the mini's was installed by hand, outside Homebrew, so
# ci-kit.yml's cask list (presence by `brew info --installed`) would install it again, and Homebrew refuses to overwrite
# a font file it did not put there ("It seems there is already a Font at …"), failing every job's setup.
meslo=MesloLGMNerdFontMono-Regular.ttf
if [[ $platform == Darwin ]] && [[ ! -e $HOME/Library/Fonts/$meslo && ! -e /Library/Fonts/$meslo ]]; then
  echo "MAWS setup: installing the MesloLG Nerd Font (font-meslo-lg-nerd-font)"
  HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install --cask font-meslo-lg-nerd-font
fi

# Recorded fixtures name macOS's /private/tmp; keep a real directory with the same permissions on Linux.
if [[ $platform == Linux ]] && [[ $(stat -c '%a:%F' /private/tmp 2>/dev/null || true) != '1777:directory' ]]; then
  sudo -n install -d -m 1777 /private/tmp
fi
