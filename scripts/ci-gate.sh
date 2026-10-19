#!/usr/bin/env bash
# Runs MAWS's class-1 gates for one tree on GitHub Actions (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.4, §3.6).
#
#   scripts/ci-gate.sh <worktree-or-sha> [--gates static,unit,unit:darwin,probes,e2e:<group>,…] [--runner linux|macos]
#                      [--class1a linux|macos|pool] [--default-beside <groups>] [--evidence] [--live] [--label <name>]
#                      [--keep]
#
# Pushes the tree, plus one empty commit, to refs/heads/ci/<label>-<short> (force), waits for the run of
# .github/workflows/gate.yml on it, prints each job's conclusion, downloads the failed e2e jobs' reports to
# /tmp/maws-review/gates/ci-<short>/, keeps the whole transcript in /tmp/maws-review/gates/ci-<short>.log, deletes the
# ref (unless --keep) and exits with the run's status (0 green, 1 anything else). A job GCE preempted on ci-kit's pool
# is rerun alone, once per job per run, and the script reports the run's final attempt: the line before the run's status,
# `ci-gate: run <id> <conclusion>`, is `ci-gate: run <id> attempt <n>`, and a line before those names each preempted job
# and how its rerun ended, one preempted again staying red (Decision Log 70). When the mini refused jobs (ci-kit's
# job-started check: a dialog or the wrong app in front), the last line before the run's status names the refused, the
# green and the red, and the --gates that relaunches the refused and the red on the same tree (Decision Log 58(c), 59(1)),
# with --default-beside naming the run's other e2e groups when the relaunch takes e2e:default (Decision Log 66).
#
#   <worktree-or-sha>  a worktree path (its HEAD is tested) or a commit
#   --gates            narrow to static, unit, unit:darwin, packaged (macOS), probes or e2e:<group>; default: class 1a
#                      (static, unit, probes), plus unit:darwin and every class-1 e2e group when the e2e lane is macOS.
#                      e2e:default is the bare `pnpm e2e` less the specs the run's other e2e groups collect
#   --runner           the e2e lane, linux or macos (default: $MAWS_GATE_RUNNER, else the repository's variables)
#   --class1a          class 1a's runner (static, unit, probes): linux, macos or pool, ci-kit's pool (default: the
#                      repository's variable GATE_RUNNER, else linux). With pool, the POOL_E2E groups (desk-web)
#                      run on the pool too, on either lane; otherwise they run on the hosted Linux runner, never a Mac
#   --default-beside   e2e groups, a comma list (side,library,…), that e2e:default subtracts the specs of as if they ran
#                      beside it: a relaunch of part of a set names the whole set's other groups, so its default runs the
#                      specs the whole set's default ran. A name with no script, or a script the derivation cannot read,
#                      makes default the bare `pnpm e2e` with a warning (default: none)
#   --evidence         upload e2e reports on success as well as failure for this run (default: failure only)
#   --live             a paid run on purpose: the live e2e groups (gate.yml's LIVE_E2E: library-live, document-live, …)
#                      run rather than skip, the e2e job with MAWS_LIVE, MAWS_LIBRARY_LIVE and MAWS_LIVE_DOCUMENT at 1,
#                      each spec within its own cap. --gates names live groups alone, the plan refusing any other gate
#                      beside them, Decision Log 75 (default: off, the live specs skip)
#   --label            the ref's name before the short sha (default: the worktree's branch, else `gate`)
#   --keep             leave the ci/ ref in place
#
# Every invocation pushes a fresh empty commit on top of the sha: its message carries a unique nonce (so the push always
# triggers a run of its own and the run found is this one's) and, when given, the `Gates:`, `Runner:`, `Class1a:`,
# `DefaultBeside:`, `Evidence:` and `Live:` trailers. The pushed tree is always the tested tree plus that one commit. A
# Linux lane admits only the e2e groups green there (§3.1); the plan refuses the rest. The pool takes class 1a and the
# POOL_E2E groups; the plan job, hosted, makes its box. Every gh call names the repository, so the script runs
# from any directory.
#
# Before the push, a run that puts jobs on a Mac (resolved from the flags and the repository variables as the plan does)
# reads ci-kit's open alerts (SSFSKIM/ci-kit-sandbox, label ci-kit-alert: a system dialog holds a Mac's front) and MAWS's
# runners. When no online ci-kit-mac-<machine> runner is free of an alert, it pushes nothing, prints each alert and exits
# 2, since the runner's job-started check would refuse those jobs; when one is, it names the blocked and goes ahead. A
# failed read warns and goes ahead (scripts/ci-gate-alerts.mjs).
#
#   MAWS_GATE_IGNORE_ALERTS=1  skip that check, for an alert left open by mistake
set -uo pipefail

REPO=SSFSKIM/MAWS
# refusals: the refused against the finished, and the relaunch line, when the mini refused jobs (Decision Log 58(c), 66).
# shellcheck source=scripts/ci-gate-refusals.sh
source "$(dirname "$0")/ci-gate-refusals.sh" || exit 2
# settle_run: the run's final attempt, a job a spot preemption ended rerun alone, once (Decision Log 70).
# shellcheck source=scripts/ci-gate-preemptions.sh
source "$(dirname "$0")/ci-gate-preemptions.sh" || exit 2
usage() {
  awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0" >&2
  exit 2
}

args=("$@")
target=''
gates=''
runner=${MAWS_GATE_RUNNER:-}
class1a=''
default_beside=''
evidence=''
live=''
label=''
keep=false
while (($# > 0)); do
  case $1 in
    --gates) gates=${2:?--gates needs a list}; shift 2 ;;
    --runner) runner=${2:?--runner needs linux or macos}; shift 2 ;;
    --class1a) class1a=${2:?--class1a needs linux, macos or pool}; shift 2 ;;
    --default-beside) default_beside=${2:?--default-beside needs a list of e2e groups}; shift 2 ;;
    --evidence) evidence=yes; shift ;;
    --live) live=yes; shift ;;
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
# The names land unquoted in a printed relaunch command, so only characters that are inert there pass.
case $default_beside in *[!A-Za-z0-9._:,\ -]*) echo "ci-gate: --default-beside takes group names of letters, digits, . _ : - separated by commas, not $default_beside" >&2; exit 2 ;; esac

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

# ci-kit's alert watcher: while no online Mac runner is free of an open alert, a run with Mac jobs is not pushed, its jobs
# would only be refused. Exit 2, as for the script's other refusals; anything else from the check goes ahead.
if [[ ${MAWS_GATE_IGNORE_ALERTS:-} == 1 ]]; then
  alert_check='ci-gate: MAWS_GATE_IGNORE_ALERTS=1, the ci-kit alert check skipped'
else
  alert_check=$(node "$(dirname "$0")/ci-gate-alerts.mjs" --gates "$gates" --runner "$runner" --class1a "$class1a")
  case $? in
    0) ;;
    2)
      printf '%s\n' "$alert_check" >&2
      echo "ci-gate: to push anyway, for an alert left open by mistake: MAWS_GATE_IGNORE_ALERTS=1 scripts/ci-gate.sh ${args[*]}" >&2
      exit 2 ;;
    *) alert_check+="${alert_check:+$'\n'}ci-gate: warning: the ci-kit alert check failed; going ahead (the runner's job-started check still refuses jobs under a dialog)" ;;
  esac
fi
short=${sha:0:8}
label=${label:-${branch:-gate}}
label=${label//[^A-Za-z0-9._-]/-}
ref=ci/$label-$short
out=/tmp/maws-review/gates
mkdir -p "$out"
log=$out/ci-$short.log
exec > >(tee "$log") 2>&1
[[ -z $alert_check ]] || printf '%s\n' "$alert_check"

# One paragraph of trailers: the nonce makes every pushed sha unique, so pushing the same sha again still triggers a run.
trailers="Nonce: $(date +%s)-$$"
[[ -n $gates ]] && trailers+=$'\n'"Gates: $gates"
[[ -n $runner ]] && trailers+=$'\n'"Runner: $runner"
[[ -n $class1a ]] && trailers+=$'\n'"Class1a: $class1a"
[[ -n $default_beside ]] && trailers+=$'\n'"DefaultBeside: $default_beside"
[[ -n $evidence ]] && trailers+=$'\n'"Evidence: $evidence"
[[ -n $live ]] && trailers+=$'\n'"Live: $live"
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

echo "ci-gate: $sha as $ref${gates:+ (Gates: $gates)}${runner:+ (Runner: $runner)}${class1a:+ (Class1a: $class1a)}${default_beside:+ (DefaultBeside: $default_beside)}${evidence:+ (Evidence: $evidence)}${live:+ (Live: $live)}"
# The ref is this invocation's own and the commit fixed, so a forced re-push is idempotent: a transient rejection
# (a remote index-pack race while another gate pushes, a "[remote rejected] (failed)") is retried twice; an
# authentication failure is not (Decision Log 54).
for attempt in 1 2 3; do
  if push_out=$(git -C "$git_dir" push --quiet --force origin "$pushed:refs/heads/$ref" 2>&1); then break; fi
  printf '%s\n' "$push_out" | sed '/^remote:/d' >&2
  case $push_out in
    *"Authentication failed"*|*"Permission denied"*|*"could not read Username"*) echo 'ci-gate: push failed (authentication)' >&2; exit 1;;
  esac
  [[ $attempt -lt 3 ]] || { echo 'ci-gate: push failed after 3 attempts' >&2; exit 1; }
  echo "ci-gate: push attempt $attempt failed, retrying" >&2
  if [[ $attempt -eq 1 ]]; then sleep 3; else sleep 8; fi
done

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
await_run() {
  local unreadable=0 view_err=$out/ci-$short.err run_status
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
}
# The run's final attempt: a job a spot preemption ended is rerun alone, once (Decision Log 70).
settle_run
printf '%s\n' "$jobs"

if [[ $conclusion != success ]]; then
  rm -rf "$out/ci-$short"
  if gh -R "$REPO" run download "$run_id" -D "$out/ci-$short" 2>/dev/null; then echo "ci-gate: failed jobs' reports in $out/ci-$short/"; fi
  failed_log=$(gh -R "$REPO" run view "$run_id" --log-failed | perl -pe 's/(\e|\^\[)\[[0-9;]*[A-Za-z]//g')
  # The failed steps' last lines, each under its job's name, colours and timestamps stripped.
  printf '%s\n' "$failed_log" | perl -pe 's/^([^\t]*)\t[^\t]*\t\S+ /$1  /' | tail -80
fi
[[ -z $preemptions ]] || printf '%s\n' "$preemptions"
[[ $conclusion == success ]] || refusals "$jobs" "$failed_log"
# The attempt on a line of its own, so the status line stays what every waiter matches (^ci-gate: run [0-9]+ [a-z_]+$).
echo "ci-gate: run $run_id attempt $run_attempt"
echo "ci-gate: run $run_id $conclusion"
[[ $conclusion == success ]] && finish 0
finish 1
