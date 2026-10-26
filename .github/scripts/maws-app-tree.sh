#!/usr/bin/env bash
# The filter: writes the tree SSFSKIM/maws-app runs CI on, made from one MAWS commit (ci-kit's
# docs/doperpowers/specs/2026-10-26-maws-hosted-mac-design.md, What the filter leaves out). Deterministic: the same
# commit and the same filter version give the same files, byte for byte. Prints the filter's version on stdout.
#
#   .github/scripts/maws-app-tree.sh <MAWS git dir> <sha> <empty dir>
#
# The git dir is the one whose HEAD you mean: in a worktree, `git rev-parse --absolute-git-dir`, not the common dir.
# The tree comes from `git archive` of the commit, never a working tree, and the overlay from that commit's own
# .github/maws-app/, read from git's objects. A request's tree is the whole output added with `git add -A --force`: MAWS tracks files its own
# .gitignore matches, and the filter keeps them.
#
# Any change to what this removes, rewrites or adds, or to the overlay's mapping, bumps the version.
set -euo pipefail
FILTER=v2

(($# == 3)) || { echo "usage: maws-app-tree.sh <MAWS git dir> <sha> <empty dir>" >&2; exit 2; }
git_dir=$1 sha=$2 out=$3
[[ -d $git_dir ]] || { echo "maws-app-tree: no git dir at $git_dir" >&2; exit 2; }
git_dir=$(cd "$git_dir" && pwd)
mkdir -p "$out"
[[ -z $(ls -A "$out") ]] || { echo "maws-app-tree: $out must be an empty directory" >&2; exit 2; }
commit=$(git --git-dir="$git_dir" rev-parse --verify --quiet "$sha^{commit}") || { echo "maws-app-tree: $sha is not a commit in $git_dir" >&2; exit 2; }
mode_of() { git --git-dir="$git_dir" ls-tree "$commit" -- "$1" | cut -d' ' -f1; }
# An export never reads or writes outside <empty dir>: no directory the filter enters may be a symlink in the commit,
# the overlay is read from git's objects and must be regular files, and the files it writes replace whatever was there.
# Symlinks elsewhere are published as links; nothing below follows one.
for dir in .github .github/maws-app mockups mockups/desk spikes spikes/p4-parity-bench docs docs/doperpowers \
  docs/doperpowers/evidence; do
  [[ $(mode_of "$dir") != 120000 ]] || { echo "maws-app-tree: $commit has a symlink at $dir" >&2; exit 1; }
done
for overlay in README.md hosted-mac.yml; do
  case $(mode_of ".github/maws-app/$overlay") in
    100644 | 100755) ;;
    *) echo "maws-app-tree: $commit has no overlay file .github/maws-app/$overlay (a regular file)" >&2; exit 1 ;;
  esac
done

git --git-dir="$git_dir" archive --format=tar "$commit" | tar -x -C "$out"
cd "$out"

# The self-hosted gate and any workflow a branch adds: the overlay's is the only workflow maws-app runs.
rm -rf .github/workflows
# The sminos project file, which names the desk hub; the analyses of the reference apps' bundles; the bench's recordings
# of the owner's sittings; the mockups' screenshots.
rm -rf .smns research mockups/shots spikes/p4-parity-bench/record-*
if [[ -d mockups/desk ]]; then find mockups/desk -type f -iname '*.png' -delete; fi
# The evidence, but for the one file a suite reads: src/shared/plugins/cli.test.ts (gate-affected.mjs's READ_AS_DATA).
probe=docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt
if [[ -d docs/doperpowers/evidence ]]; then
  find docs/doperpowers/evidence -mindepth 1 \( -type f -o -type l \) ! -path "$probe" -delete
  find docs/doperpowers/evidence -mindepth 1 -depth -type d -empty -delete
fi

# The overlay, from the commit's objects to its places, then gone.
mkdir -p .github/workflows
rm -f README.md
git --git-dir="$git_dir" cat-file blob "$commit:.github/maws-app/README.md" >README.md
git --git-dir="$git_dir" cat-file blob "$commit:.github/maws-app/hosted-mac.yml" >.github/workflows/hosted-mac.yml
rm -rf .github/maws-app

# The owner's four addresses, everywhere, binary files included, as bytes: line endings and everything else stay. A
# symlink is neither read nor written, and the walk does not enter a linked directory.
python3 -I - <<'EOF'
import os
addresses = {
    b'supremekim17@gmail.com': b'owner@example.com',
    b'supremekim17@icloud.com': b'owner@example.com',
    b'makeworth17@gmail.com': b'test-account-1@example.com',
    b'haegi236@gmail.com': b'test-account-2@example.com',
}
for top, dirs, names in os.walk('.', followlinks=False):
    for name in names:
        path = os.path.join(top, name)
        if os.path.islink(path):
            continue
        with open(path, 'rb') as f:
            data = f.read()
        changed = data
        for address, placeholder in addresses.items():
            changed = changed.replace(address, placeholder)
        if changed != data:
            with open(path, 'wb') as f:
                f.write(changed)
EOF

echo "$FILTER"
