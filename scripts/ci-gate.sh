#!/usr/bin/env bash
# Runs MAWS's class-1 gates for one tree on GitHub Actions (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.4, §3.6).
#
#   scripts/ci-gate.sh <worktree-or-sha> [--gates static,unit,probes,e2e:<group>,…] [--runner linux|macos]
#                      [--label <name>] [--keep]
#
# Pushes the tree, plus one empty commit, to refs/heads/ci/<label>-<short> (force), waits for .github/workflows/gate.yml's
# run of it, prints each job's conclusion, downloads the failed e2e jobs' reports to /tmp/maws-review/gates/ci-<short>/, keeps the
# whole transcript in /tmp/maws-review/gates/ci-<short>.log, deletes the ref (unless --keep) and exits with the run's
# status (0 green, 1 anything else).
#
#   <worktree-or-sha>  a worktree path (its HEAD is tested) or a commit
#   --gates            narrow the set; without it the run takes the default (class 1a: static, unit, probes; with every
#                      class-1 e2e group too when the e2e lane is macOS)
#   --runner           the e2e lane, linux or macos (default: $MAWS_GATE_RUNNER, else the repository's variables)
#   --label            the ref's name before the short sha (default: the worktree's branch, else `gate`)
#   --keep             leave the ci/ ref in place
#
# Every invocation pushes a fresh empty commit on top of the sha: its message carries a unique nonce (so the push always
# triggers a run of its own and the run found is this one's) and, when given, the `Gates:` and `Runner:` trailers. The
# pushed tree is always the tested tree plus that one commit. A Linux lane admits only the e2e groups green there
# (§3.1); the plan refuses the rest. Every gh call names the repository, so the script runs from any directory.
set -uo pipefail

REPO=SSFSKIM/MAWS
usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

target=''
gates=''
runner=${MAWS_GATE_RUNNER:-}
label=''
keep=false
while (($# > 0)); do
  case $1 in
    --gates) gates=${2:?--gates needs a list}; shift 2 ;;
    --runner) runner=${2:?--runner needs linux or macos}; shift 2 ;;
    --label) label=${2:?--label needs a name}; shift 2 ;;
    --keep) keep=true; shift ;;
    -h | --help) usage ;;
    -*) echo "ci-gate: unknown option $1" >&2; usage ;;
    *) [[ -z $target ]] || usage; target=$1; shift ;;
  esac
done
[[ -n $target ]] || usage
case $runner in '' | linux | macos) ;; *) echo "ci-gate: --runner is linux or macos, not $runner" >&2; exit 2 ;; esac

# The repository the git commands run in: the worktree given, or this script's own checkout for a bare sha.
if [[ -d $target ]]; then
  git_dir=$target
  sha=$(git -C "$git_dir" rev-parse --verify HEAD) || exit 2
  branch=$(git -C "$git_dir" symbolic-ref --quiet --short HEAD || true)
else
  git_dir=$(dirname "$0")
  sha=$(git -C "$git_dir" rev-parse --verify --quiet "$target^{commit}") || { echo "ci-gate: no commit $target" >&2; exit 2; }
  branch=''
fi
short=${sha:0:8}
label=${label:-${branch:-gate}}
label=${label//[^A-Za-z0-9._-]/-}
ref=ci/$label-$short
out=/tmp/maws-review/gates
mkdir -p "$out"
log=$out/ci-$short.log
exec > >(tee "$log") 2>&1

# One paragraph of trailers: the nonce makes every pushed sha unique, so pushing the same sha again still triggers a run.
trailers="Nonce: $(date +%s)-$$"
[[ -n $gates ]] && trailers+=$'\n'"Gates: $gates"
[[ -n $runner ]] && trailers+=$'\n'"Runner: $runner"
pushed=$(git -C "$git_dir" commit-tree "$sha^{tree}" -p "$sha" -m "ci-gate: $short" -m "$trailers") || exit 1

run_id=''
finish() {
  local status=$1
  if [[ $keep == false ]]; then
    # Only while the ref is still this invocation's commit: a later invocation's push to it is not ours to delete.
    if git -C "$git_dir" push --quiet --force-with-lease="refs/heads/$ref:$pushed" origin ":refs/heads/$ref" 2>/dev/null; then
      echo "ci-gate: removed $ref"
    else
      echo "ci-gate: left $ref (moved by a later push)"
    fi
  fi
  echo "ci-gate: transcript in $log"
  exit "$status"
}
# shellcheck disable=SC2329 # invoked by the trap below
interrupted() {
  [[ -n $run_id ]] && gh -R "$REPO" run cancel "$run_id" >/dev/null 2>&1 && echo "ci-gate: cancelled run $run_id"
  finish 130
}
trap interrupted INT TERM

echo "ci-gate: $sha as $ref${gates:+ (Gates: $gates)}${runner:+ (Runner: $runner)}"
{ git -C "$git_dir" push --quiet --force origin "$pushed:refs/heads/$ref" 2>&1; } | sed '/^remote:/d' || { echo 'ci-gate: push failed' >&2; exit 1; }

# The run appears a few seconds after the push; a minute without it means the workflow did not trigger.
for _ in $(seq 1 30); do
  run_id=$(gh -R "$REPO" run list --workflow gate.yml --event push --branch "$ref" --json databaseId,headSha --jq ".[] | select(.headSha == \"$pushed\") | .databaseId" | head -1)
  [[ -n $run_id ]] && break
  sleep 2
done
[[ -n $run_id ]] || { echo "ci-gate: no run of $pushed on $ref" >&2; finish 1; }
echo "ci-gate: https://github.com/$REPO/actions/runs/$run_id"

# A failed watch (an API error mid-poll) is not the end of the run: only the status `completed` is.
while :; do
  gh -R "$REPO" run watch "$run_id" --compact --interval 30 >/dev/null 2>&1
  [[ $(gh -R "$REPO" run view "$run_id" --json status --jq .status 2>/dev/null) == completed ]] && break
  sleep 15
done
conclusion=$(gh -R "$REPO" run view "$run_id" --json conclusion --jq .conclusion)
gh -R "$REPO" run view "$run_id" --json jobs --jq '.jobs[] | "\(.conclusion // .status)\t\(.name)"' | sort -k2

if [[ $conclusion != success ]]; then
  rm -rf "$out/ci-$short"
  if gh -R "$REPO" run download "$run_id" -D "$out/ci-$short" 2>/dev/null; then echo "ci-gate: failed jobs' reports in $out/ci-$short/"; fi
  # The failed steps' last lines, each under its job's name, colours and timestamps stripped.
  gh -R "$REPO" run view "$run_id" --log-failed | perl -pe 's/(\e|\^\[)\[[0-9;]*[A-Za-z]//g; s/^([^\t]*)\t[^\t]*\t\S+ /$1  /' | tail -80
fi
echo "ci-gate: run $run_id $conclusion"
[[ $conclusion == success ]] && finish 0
finish 1
