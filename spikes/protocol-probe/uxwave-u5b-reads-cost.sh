#!/usr/bin/env bash
# UX wave U5b-2, P5 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, "Probes" and Concrete Steps
# 4a): the branch the cost run reads. Run on the build VM, outside any checkout of MAWS, in a scratch folder that holds
# an anonymous https clone of a large public repository as `repo/` (the run of record: rust-lang/rust, its default
# branch only, full history and blobs, no credentials):
#   git clone --single-branch --no-tags https://github.com/rust-lang/rust.git <scratch>/repo
#   spikes/protocol-probe/uxwave-u5b-reads-cost.sh <scratch>
# It makes, in that clone only, a branch some hundreds of commits of the default branch back with a few hundred changed
# files (a one-file commit, a 200-file commit, three of 20 files, the rest uncommitted) and a few hundred untracked
# files, an emulated upstream holding the first two commits, and writes the commits the timing reads to
# <scratch>/probe.json. Then uxwave-u5b-reads-cost.test.ts times this build's GitService over it.
set -euo pipefail
scratch=$(cd "$1" && pwd)
cd "$scratch/repo"
git config user.email probe@example.invalid
git config user.name 'P5 probe'
default=$(git symbolic-ref -q --short refs/remotes/origin/HEAD || echo origin/master)
start=$(git rev-parse "$default~300") # 300 merges back along the first parent: the base moved on since the branch began
git checkout -q -B p5/reads "$start"

# 400 tracked Rust files spread over the tree by a fixed stride; each edited at its top and its end
git ls-files -- '*.rs' | awk 'NR % 37 == 0 && ++n <= 400' > "$scratch/changed.txt" # no head: under pipefail its early close would fail the run
edit() { while read -r f; do sed -i '1s|^|// p5 probe: an edit at the top\n|' "$f"; printf '\n// p5 probe: an edit at the end\n' >> "$f"; done; }
sed -n '1p' "$scratch/changed.txt" | edit
git add -A -- $(sed -n '1p' "$scratch/changed.txt") && git commit -q -m 'p5: a small commit (one file)'
small=$(git rev-parse HEAD)
sed -n '2,201p' "$scratch/changed.txt" | edit
git add -- $(sed -n '2,201p' "$scratch/changed.txt") && git commit -q -m 'p5: a large commit (200 files)'
large=$(git rev-parse HEAD)
for n in 0 1 2; do
  from=$((202 + n * 20)); to=$((from + 19))
  sed -n "${from},${to}p" "$scratch/changed.txt" | edit
  git add -- $(sed -n "${from},${to}p" "$scratch/changed.txt") && git commit -q -m "p5: twenty files ($n)"
done
sed -n '262,400p' "$scratch/changed.txt" | edit # left uncommitted

# 500 untracked files, each a copy of a tracked Rust file's text, beside tracked files (so the status lists each file,
# not a folder)
git ls-files -- '*.rs' | awk 'NR % 53 == 7 && ++n <= 500' > "$scratch/copied.txt"
i=0
while read -r f; do cp "$f" "$(dirname "$f")/p5_new_$(printf '%03d' "$i").rs"; i=$((i + 1)); done < "$scratch/copied.txt"

# an upstream, as a push of the first two commits would leave it
git update-ref refs/remotes/origin/p5/reads "$large"
git config --add remote.origin.fetch '+refs/heads/p5/*:refs/remotes/origin/p5/*' # a single-branch clone maps no other branch
git config branch.p5/reads.remote origin
git config branch.p5/reads.merge refs/heads/p5/reads

merge=$(git rev-list --merges -n 1 "$start")
printf '{"small":"%s","large":"%s","merge":"%s","start":"%s"}\n' "$small" "$large" "$merge" "$start" > "$scratch/probe.json"
cat "$scratch/probe.json"
