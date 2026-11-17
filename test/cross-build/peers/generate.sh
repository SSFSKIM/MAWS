#!/usr/bin/env bash
# The committed snapshots of the two older builds' `files.*` schemas (UX wave U6e,
# docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, Concrete Steps 6 and "Reported" 15), read by
# test/cross-build/files-schema.test.ts, which needs no git history and never skips. For each peer, that commit's
# src/shared/ipc/schema/files.ts and src/shared/ipc/names/files.ts as `git show` prints them, with nothing changed but the
# one relative import, pointed at this tree's module. Run once from a checkout that holds both commits; the output is
# committed beside this script.
#
# UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, Concrete Steps 7): also
# that commit's endpoint offer table and capability list, src/endpoint/offers.ts and src/endpoint/capabilities.ts, read
# by test/cross-build/outside-offers.test.ts. Neither holds a relative import at either commit, so each is copied as
# `git show` prints it.
set -euo pipefail
cd "$(dirname "$0")"
here=$(pwd)
repo=$(git rev-parse --show-toplevel)
# build F (on the owner's machines) and master before U6e
for commit in f1852de3a 2c7044231; do
  mkdir -p "$here/$commit"
  git -C "$repo" show "$commit:src/shared/ipc/schema/files.ts" | sed "s#from './common'#from '@shared/ipc/schema/common'#" > "$here/$commit/schema-files.ts"
  git -C "$repo" show "$commit:src/shared/ipc/names/files.ts" > "$here/$commit/names-files.ts"
  git -C "$repo" show "$commit:src/endpoint/offers.ts" > "$here/$commit/endpoint-offers.ts"
  git -C "$repo" show "$commit:src/endpoint/capabilities.ts" > "$here/$commit/endpoint-capabilities.ts"
done
