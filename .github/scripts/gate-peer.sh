#!/usr/bin/env bash
# The peer build of a PEER_E2E group (gate.yml's e2e job; gate-plan.mjs's peer groups; e2e/cross-build.spec.ts). Run from
# the checkout's root.
#
#   gate-peer.sh prepare <sha> <dir>   fetches the one commit <sha> into this (shallow) checkout, checks it out at <dir>
#                                      as a worktree, installs it against the runner's pnpm store and builds its out/
#                                      through its own `scripts/e2e-build.sh plain`, never from the build cache
#   gate-peer.sh stop <dir>            kills every supervisor of this checkout's build or <dir>'s with its process group
#                                      (its engines), then every app run from either (the peer's helpers with them), and
#                                      removes the worktree
#
# A supervisor is detached by design, in a session and process group of its own, so it outlives the app that started it
# and the job's end: stop is the job's always() step. Each is named by its argv, `maws-supervisor … <root>/out/…
# --detached <dir>` (src/main/hosts/detached-transport.ts), its bundle under the checkout whose app spawned it.
set -euo pipefail

usage() {
  echo 'usage: gate-peer.sh prepare <sha> <dir> | stop <dir>' >&2
  exit 2
}

case ${1:-} in
  prepare)
    (($# == 3)) && [[ $2 =~ ^[0-9a-f]{40}$ ]] || usage
    sha=$2 dir=$3
    git fetch --quiet --depth=1 --no-tags origin "$sha"
    # a previous job's checkout, registered or not: its directory, then its registration
    rm -rf "$dir"
    git worktree prune
    git worktree add --quiet --detach "$dir" "$sha"
    echo "gate-peer: $sha checked out at $dir"
    cd "$dir"
    pnpm install --frozen-lockfile --prefer-offline
    MAWS_E2E_BUILD_CACHE='' MAWS_E2E_BUILD_KEY='' MAWS_E2E_BUILD_REQUIRE='' scripts/e2e-build.sh plain
    echo "gate-peer: $sha built at $dir/out"
    ;;
  stop)
    (($# == 2)) || usage
    here=$PWD dir=$2
    # One reading, then the signals, so this script's own processes are never among them.
    listing=$(ps -ww -axo pid=,pgid=,command=)
    while read -r pid pgid command; do
      ((pid != $$)) || continue
      case $command in
        "maws-supervisor "*" $here/out/"* | "maws-supervisor "*" $dir/out/"*)
          # its group when it leads one, as a supervisor does: its engines go with it
          if ((pgid == pid)); then kill -KILL -- "-$pgid" 2>/dev/null || true; else kill -KILL "$pid" 2>/dev/null || true; fi
          echo "gate-peer: stopped supervisor pid $pid: $command" ;;
        *" $here/out/main/index.js"* | *"$dir/"*)
          kill -KILL "$pid" 2>/dev/null || true
          echo "gate-peer: stopped pid $pid: $command" ;;
      esac
    done <<<"$listing"
    git worktree remove --force "$dir" 2>/dev/null || rm -rf "$dir"
    git worktree prune 2>/dev/null || true
    ;;
  *) usage ;;
esac
