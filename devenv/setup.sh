#!/usr/bin/env bash
# devenv-inputs: pnpm-lock.yaml package.json pnpm-workspace.yaml packaging/mawsd/node.json
# MAWS's environment for the devenv runner (devcloud's devenv contract; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md,
# M8 "The devenv step"), run from the repository root on the owner's Macs and on devcloud's Ubuntu hosts; safe to re-run.
#
# Both: the missing system tools, then the workspace from its lockfile. On Linux, a machine with no app, it also packs
# `mawsd` (pnpm mawsd:pack: main's build, the externals' closure and the pinned Node) and installs it for the default
# profile: `mawsd install` copies the pack into ~/.local/share/maws/mawsd/releases/, points `current` at it, and
# enables the systemd user unit and lingering, so the daemon survives logout. With MAWS_DELEGATION_ID set (the
# delegation id from the driver profile's `[desk] delegation_id`, which devcloud carries through its descriptor into
# /etc/devcloud/env, P5 O14; the devcloud seed is a GCP credential and carries none), the profile's machine ref is
# minted with it as its prefix at the first install; without it the ref has none. Where `systemctl --user` reaches no user manager (a container), it
# says so and installs no unit. On macOS it never touches launchd: the app installs its own LaunchAgent (M7).
set -euo pipefail

os=$(uname -s)
missing() { ! command -v "$1" >/dev/null 2>&1; }

case $os in
Darwin)
  if missing node; then brew install node; fi
  ;;
Linux)
  if missing node; then
    echo "devenv: MAWS needs Node 22 or newer on PATH (devcloud hosts carry Node LTS)" >&2
    exit 1
  fi
  # node-pty 1.1.0 ships no Linux prebuild: pnpm builds it with node-gyp (pnpm-workspace.yaml's allowBuilds)
  packages=()
  if missing make || missing g++; then packages+=(build-essential); fi
  if missing python3; then packages+=(python3); fi
  if ((${#packages[@]})); then
    sudo apt-get update -q
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq "${packages[@]}"
  fi
  # no app runs here, so no Electron binary (scripts/postinstall.mjs); set here, since devenv/env applies on the Macs too
  export ELECTRON_SKIP_BINARY_DOWNLOAD=1
  ;;
*)
  echo "devenv: MAWS has no setup for $os" >&2
  exit 1
  ;;
esac

if missing pnpm; then
  pnpm_version=$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")
  npm install --global --prefix "$HOME/.local" "pnpm@$pnpm_version"
  export PATH="$HOME/.local/bin:$PATH"
fi
pnpm install --frozen-lockfile

[[ $os == Linux ]] || exit 0

pack=$(pnpm --silent mawsd:pack | tail -n 1)
mkdir -p "$HOME/.local/bin" # where `mawsd install` links the default profile's command line, on a login shell's PATH
install=(install)
if [[ -n ${MAWS_DELEGATION_ID:-} ]]; then install+=(--delegation-id "$MAWS_DELEGATION_ID"); fi
code=0
"$pack/runtime/bin/node" --disable-sigusr1 "$pack/out/main/mawsd.js" "${install[@]}" || code=$?
case $code in
0) ;;
2) echo "devenv: systemctl --user reaches no user manager here (a container?), so mawsd's unit is not installed" ;;
*) exit "$code" ;;
esac
