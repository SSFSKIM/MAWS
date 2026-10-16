#!/usr/bin/env bash
# Runs MAWS's class-1 gates for one tree on GitHub Actions (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.4, §3.6).
#
#   scripts/ci-gate.sh <worktree-or-sha> [--gates static,unit,unit:darwin,probes,e2e:<group>,…] [--runner linux|macos]
#                      [--class1a linux|macos|pool] [--evidence] [--label <name>] [--keep]
#
# Pushes the tree, plus one empty commit, to refs/heads/ci/<label>-<short> (force), waits for the run of
# .github/workflows/gate.yml on it, prints each job's conclusion, downloads the failed e2e jobs' reports to
# /tmp/maws-review/gates/ci-<short>/, keeps the whole transcript in /tmp/maws-review/gates/ci-<short>.log, deletes the
# ref (unless --keep) and exits with the run's status (0 green, 1 anything else).
#
#   <worktree-or-sha>  a worktree path (its HEAD is tested) or a commit
#   --gates            narrow to static, unit, unit:darwin, packaged (macOS), probes or e2e:<group>; default: class 1a
#                      (static, unit, probes), plus unit:darwin and every class-1 e2e group when the e2e lane is macOS
#   --runner           the e2e lane, linux or macos (default: $MAWS_GATE_RUNNER, else the repository's variables)
#   --class1a          class 1a's runner (static, unit, probes): linux, macos or pool, ci-kit's Hetzner box (default:
#                      the repository's variable GATE_RUNNER, else linux)
#   --evidence         upload e2e reports on success as well as failure for this run (default: failure only)
#   --label            the ref's name before the short sha (default: the worktree's branch, else `gate`)
#   --keep             leave the ci/ ref in place
#
# Every invocation pushes a fresh empty commit on top of the sha: its message carries a unique nonce (so the push always
# triggers a run of its own and the run found is this one's) and, when given, the `Gates:`, `Runner:`, `Class1a:` and `Evidence:`
# trailers. The pushed tree is always the tested tree plus that one commit. A Linux lane admits only the e2e groups green
# there (§3.1); the plan refuses the rest. The pool takes class 1a alone; the plan job, hosted, makes its box. Every gh
# call names the repository, so the script runs from any directory.
set -uo pipefail

REPO=SSFSKIM/MAWS
usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

target=''
gates=''
runner=${MAWS_GATE_RUNNER:-}
class1a=''
evidence=''
label=''
keep=false
while (($# > 0)); do
  case $1 in
    --gates) gates=${2:?--gates needs a list}; shift 2 ;;
    --runner) runner=${2:?--runner needs linux or macos}; shift 2 ;;
    --class1a) class1a=${2:?--class1a needs linux, macos or pool}; shift 2 ;;
    --evidence) evidence=yes; shift ;;
    --label) label=${2:?--label needs a name}; shift 2 ;;
    --keep) keep=true; shift ;;
    -h | --help) usage ;;
    -*) echo "ci-gate: unknown option $1" >&2; usage ;;
    *) [[ -z $target ]] || usage; target=$1; shift ;;
  esac
done
[[ -n $target ]] || usage
case $runner in '' | linux | macos) ;; *) echo "ci-gate: --runner is linux or macos, not $runner" >&2; exit 2 ;; esac
case $class1a in '' | linux | macos | pool) ;; *) echo "ci-gate: --class1a is linux, macos or pool, not $class1a" >&2; exit 2 ;; esac

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
[[ -n $class1a ]] && trailers+=$'\n'"Class1a: $class1a"
[[ -n $evidence ]] && trailers+=$'\n'"Evidence: $evidence"
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

echo "ci-gate: $sha as $ref${gates:+ (Gates: $gates)}${runner:+ (Runner: $runner)}${class1a:+ (Class1a: $class1a)}${evidence:+ (Evidence: $evidence)}"
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
# A run that can no longer be read (credentials revoked, run deleted) would be retried forever, so consecutive read failures are bounded.
unreadable=0
view_err=$out/ci-$short.err
while :; do
  gh -R "$REPO" run watch "$run_id" --compact --interval 30 >/dev/null 2>&1
  if run_status=$(gh -R "$REPO" run view "$run_id" --json status --jq .status 2>"$view_err"); then
    unreadable=0
    [[ $run_status == completed ]] && break
  else
    unreadable=$((unreadable + 1))
    if ((unreadable >= 20)); then
      echo "ci-gate: run $run_id cannot be read (the last gh error follows)" >&2
      cat "$view_err" >&2
      rm -f "$view_err"
      finish 1
    fi
  fi
  sleep 15
done
rm -f "$view_err"
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
