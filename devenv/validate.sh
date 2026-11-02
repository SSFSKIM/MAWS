#!/usr/bin/env bash
# The quickest real check of MAWS's environment (devcloud's devenv contract; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md,
# M8 "The devenv step"): one focused unit suite, and on Linux the installed release's session host present and
# executable (P5 O16 M4: every lane B launch runs under it), the installed daemon answering `mawsd status` (its pid,
# build, machine ref, role and hosts) and the render runtime through the default profile's command line. Safe to re-run.
set -euo pipefail

pnpm vitest run src/mawsd/release.test.ts

[[ $(uname -s) == Linux ]] || exit 0
if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "devenv: systemctl --user reaches no user manager here, so no mawsd unit runs to ask"
  exit 0
fi
host=$HOME/.local/share/maws/mawsd/current/bin/maws-session-host # src/mawsd/release.ts releasesRoot, the pack's bin/
if [[ ! -f $host || ! -x $host ]]; then
  echo "devenv: the installed release has no executable session host at $host" >&2
  exit 1
fi
"$host" --version
"${XDG_CONFIG_HOME:-$HOME/.config}/MAWS/mawsd/bin/mawsd" status
"${XDG_CONFIG_HOME:-$HOME/.config}/MAWS/mawsd/bin/mawsd" render status # P5 O5 M6: the render runtime, its sandbox and libraries
