#!/usr/bin/env bash
# Runs MAWS's class-1 gates for one tree on GitHub Actions (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.4, §3.6).
#
#   scripts/ci-gate.sh <worktree-or-sha> --gates all|static,unit,unit:darwin,probes,e2e:<group>,… [--runner linux|macos]
#                      [--class1a linux|macos|pool] [--lane vm|vm-trial|hosted|no-hosted] [--default-beside <groups>] [--evidence]
#                      [--live] [--affected] [--peer <ref>|none] [--label <name>] [--keep]
#
#   scripts/ci-gate.sh <worktree> --gates static,unit,probes     class 1a alone
#   scripts/ci-gate.sh <worktree> --gates all                    the whole set (on a macOS e2e lane, every Mac job)
#
# Pushes the tree, plus one empty commit, to refs/heads/ci/<label>-<short> (force), waits for the run of
# .github/workflows/gate.yml on it, prints each job's conclusion, downloads the failed e2e jobs' reports to
# /tmp/maws-review/gates/ci-<short>/ (a hosted group's from the SSFSKIM/maws-app run its log names), keeps the whole transcript in /tmp/maws-review/gates/ci-<short>.log, deletes the
# ref (unless --keep) and exits with the run's status (0 green, 1 anything else). A job GCE preempted on ci-kit's pool
# is rerun alone, once per job per run, and the script reports the run's final attempt: the line before the run's status,
# `ci-gate: run <id> <conclusion>`, is `ci-gate: run <id> attempt <n>`, and a line before those names each preempted job
# and how its rerun ended, one preempted again staying red (Decision Log 70). When the mini refused jobs (ci-kit's
# job-started check: a dialog or the wrong app in front; its measured-job guard: a MEASURED_E2E group's desktop not
# settled within 15 minutes), the last line before the run's status names the refused, the green and the red, and the
# --gates that relaunches the refused and the red on the same tree (Decision Log 58(c), 59(1)), with --default-beside
# naming the run's other e2e groups when the relaunch takes e2e:default (Decision Log 66).
#
#   <worktree-or-sha>  a worktree path (its HEAD is tested) or a commit
#   --gates            required: a comma list over static, unit, unit:darwin, packaged (macOS), probes and e2e:<group>, or
#                      `all`, the whole set: class 1a (static, unit, probes), plus unit:darwin and every class-1 e2e group
#                      when the e2e lane is macOS (about 35 jobs and 70 minutes on the one Mac). A call without --gates is
#                      refused (exit 2) before anything is pushed: it used to mean `all`, and sessions meaning class 1a
#                      queued the whole Mac set by leaving it out. e2e:default is the bare `pnpm e2e` less the specs the
#                      run's other e2e groups collect
#   --runner           the e2e lane, linux or macos (default: $MAWS_GATE_RUNNER, else the repository's variables)
#   --class1a          class 1a's runner (static, unit, probes): linux, macos or pool, ci-kit's pool (default: the
#                      repository's variable GATE_RUNNER, else linux). With pool, the POOL_E2E groups (desk-web)
#                      run on the pool too, on either lane; otherwise they run on the hosted Linux runner, never a Mac
#   --lane             where the run's MAC_VM_E2E groups (gate.yml) go on a Mac: vm, ci-kit's macOS guest alone
#                      ([ci-kit-mac-vm]: a group's trial, a re-measurement, a host you know is held), or vm-trial, the
#                      guest's trial slot ([ci-kit-mac-vm-trial], which only a candidate image's trial clone carries: the
#                      commit for an image trial, and nothing else). A MEASURED_E2E group keeps the exclusive instance
#                      whatever this says (ci-kit's mac-lane concurrency spec, The VM lane). Or hosted: every eligible
#                      e2e group to GitHub's hosted Macs, each a waiter on the pool that runs it through SSFSKIM/maws-app
#                      (not default, a measured, live or MAC_SECRET_E2E group, nor a POOL_E2E one, which stay where they
#                      would be; ci-kit's hosted-Mac spec); or no-hosted: none there, every group as before the hosted
#                      Macs, for diagnosis or a baseline. Default: none, the MAC_VM_E2E groups on [ci-kit-mac-solo],
#                      whichever of the exclusive instance and the guest is free, and HOSTED_MAC_E2E's on the hosted Macs
#   --default-beside   e2e groups, a comma list (side,library,…), that e2e:default subtracts the specs of as if they ran
#                      beside it: a relaunch of part of a set names the whole set's other groups, so its default runs the
#                      specs the whole set's default ran. A name with no script, or a script the derivation cannot read,
#                      makes default the bare `pnpm e2e` with a warning (default: none)
#   --evidence         upload e2e reports on success as well as failure for this run (default: failure only)
#   --live             a paid run on purpose: the live e2e groups (gate.yml's LIVE_E2E: library-live, document-live, …)
#                      run rather than skip, the e2e job with MAWS_LIVE, MAWS_LIBRARY_LIVE and MAWS_LIVE_DOCUMENT at 1,
#                      each spec within its own cap. --gates names live groups alone, the plan refusing any other gate
#                      beside them, and without --live any live group, Decision Log 75 (default: off)
#   --affected         an iteration run: unit and unit:darwin test only what the change can reach (vitest's related mode
#                      over its paths), or the whole suite, with the reason in the run's summary, where vitest's module
#                      graph cannot see (a package.json or the lockfile, a vitest or vite config, test support, gate
#                      files, a path outside the source and test trees, a deleted or renamed non-test file, a file read
#                      as data; .github/scripts/gate-affected.mjs). A path under docs/, which no suite reads, counts for
#                      nothing, so a docs-only change runs no unit suite; docs/doperpowers/evidence/p1-e8, which a suite
#                      reads, is data. The change is every path `git diff --name-status -M` lists from the merge base with
#                      origin/master, fetched first, to the tested commit. The run's title says `affected` (ci-kit's
#                      test-history spec, M4). A selected run is NEVER landing evidence, even when it ran the whole
#                      suite: a landing needs a full class 1a run on the head's tree without --affected, and a red
#                      selected run counts as red (default: off)
#   --peer             the build the PEER_E2E groups (gate.yml: e2e:cross-build, the two-build check) run the tested tree
#                      against, a ref this checkout resolves, or `none`. Default: the merge base with origin/master,
#                      fetched first. The commit goes in a `Peer:` trailer beside both trees' wires (`Peer-Wire:`, `Wire:`,
#                      each the major.minor of its src/shared/ipc/wire-manifest.json), and the plan adds those groups to a
#                      run whose two wires are a minor apart and whose gates hold unit, unit:darwin or an e2e group (so
#                      class 1a and --gates all do, a static or probes check does not), unless the run is --live or
#                      --affected. No trailer when the tree has no manifest, is its own merge base, or with `none`. Refused
#                      (exit 2), naming --peer: a --peer that names no commit or one with no manifest, and a checkout that
#                      cannot find its merge base (shallow, or with none with origin/master). A refused run's relaunch
#                      line carries the peer as resolved, its sha or `none`
#   --label            the ref's name before the short sha (default: the worktree's branch, else `gate`)
#   --keep             leave the ci/ ref in place
#
# Every invocation pushes a fresh empty commit on top of the sha: its message carries a unique nonce (so the push always
# triggers a run of its own and the run found is this one's) and, when given, the `Gates:` (none for `all`, the plan's
# default set), `Runner:`, `Class1a:`, `Lane:`, `DefaultBeside:`, `Evidence:` and `Live:` trailers; under --affected its subject is
# `ci-gate: <short> affected` and it carries `Selection: affected`, `Affected-Count:` and an `Affected:` trailer per path.
# The peer's `Peer:`, `Peer-Wire:` and `Wire:` trailers follow when there is one (--peer).
# A successful local plan adds `Pool-Demand:`, ci-kit's advisory attempt-1 pre-launch hint: the exact multiset of pool
# jobs, or `none` when no job uses the pool. If it fails, no hint is written and the push still proceeds.
# The pushed tree is always the tested tree plus that one commit. A Linux lane admits only the e2e groups green there (§3.1); the plan refuses the rest.
# The pool takes class 1a and the POOL_E2E groups; the plan job, hosted, makes its box. Every gh call names the
# repository, so the script runs from any directory.
#
# Before the push, a run that puts jobs on a Mac (resolved from the flags and the repository variables as the plan does)
# reads ci-kit's open alerts (SSFSKIM/ci-kit-sandbox, label ci-kit-alert: a system dialog holds a Mac's front) and MAWS's
# runners. When no online ci-kit-mac-<machine> runner is free of an alert, it pushes nothing, prints each alert and exits
# 2, since the runner's job-started check would refuse those jobs; when one is, it names the blocked and goes ahead. ci-kit's
# macOS guest (ci-kit-mac-<machine>-vm…) counts as a free Mac only for a run whose Mac jobs all can run in it, which the tested
# commit's own plan (its gate-plan.mjs on its gate.yml, the trailers below) decides: every Mac job on a label the guest carries
# (ci-kit-mac-solo, ci-kit-mac-vm, or the trial slot's ci-kit-mac-vm-trial), so only the groups on MAC_VM_E2E, and --lane is
# read for that; a run with any other Mac job needs a host free of alerts, and so does one the plan cannot be run for. A
# run whose plan puts no job on a Mac (its e2e groups all hosted) goes ahead. A failed read warns and goes ahead
# (scripts/ci-gate-alerts.mjs).
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
# hosted_reports: a failed hosted group's report, from the SSFSKIM/maws-app run its waiter's log names.
# shellcheck source=scripts/ci-gate-hosted.sh
source "$(dirname "$0")/ci-gate-hosted.sh" || exit 2
usage() {
  awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0" >&2
  exit 2
}

args=("$@")
target=''
gates=''
runner=${MAWS_GATE_RUNNER:-}
class1a=''
lane=''
default_beside=''
evidence=''
live=''
affected=''
peer=''
label=''
keep=false
while (($# > 0)); do
  case $1 in
    --gates) gates=${2?--gates needs a list}; shift 2 ;;
    --runner) runner=${2:?--runner needs linux or macos}; shift 2 ;;
    --class1a) class1a=${2:?--class1a needs linux, macos or pool}; shift 2 ;;
    --lane) lane=${2:?--lane needs vm, vm-trial, hosted or no-hosted}; shift 2 ;;
    --default-beside) default_beside=${2:?--default-beside needs a list of e2e groups}; shift 2 ;;
    --evidence) evidence=yes; shift ;;
    --live) live=yes; shift ;;
    --affected) affected=yes; shift ;;
    --peer) peer=${2:?--peer needs a ref or none}; shift 2 ;;
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
case $lane in '' | vm | vm-trial | hosted | no-hosted) ;; *) echo "ci-gate: --lane is vm, vm-trial, hosted or no-hosted, not $lane" >&2; exit 2 ;; esac
# The names land unquoted in a printed relaunch command, so only characters that are inert there pass.
case $default_beside in *[!A-Za-z0-9._:,\ -]*) echo "ci-gate: --default-beside takes group names of letters, digits, . _ : - separated by commas, not $default_beside" >&2; exit 2 ;; esac
# The whole set is asked for by name: left implicit, it was queued by calls that meant class 1a alone. A value of commas
# and spaces names nothing either: the plan reads it as the whole set. A live run takes only its live groups (Decision
# Log 75), so its hint names those.
if [[ -z ${gates//[[:space:],]/} ]]; then
  if [[ -n $live ]]; then
    echo "ci-gate: name the gates: a live run takes its live e2e groups alone, --live --gates e2e:<group>,… (gate.yml's LIVE_E2E)" >&2
  else
    echo 'ci-gate: name the gates: --gates static,unit,probes for class 1a only, --gates all for the whole set' >&2
  fi
  exit 2
fi
# `all` is the plan's default set, which a run without a `Gates:` trailer takes.
gates_trailer=$gates
[[ $gates == all ]] && gates_trailer=''

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

# The peer of the PEER_E2E groups and both trees' wires, as trailers (ci-gate-peer.mjs), read before the alert check, whose
# plan they can add a Mac job to; what it decided is said once the transcript starts.
peer_notes=$(mktemp)
peer_trailers=$(node "$(dirname "$0")/ci-gate-peer.mjs" --git-dir "$git_dir" --sha "$sha" --peer "$peer" 2>"$peer_notes")
peer_status=$?
peer_said=$(<"$peer_notes")
rm -f "$peer_notes"
if ((peer_status != 0)); then
  printf '%s\n' "${peer_said:-ci-gate: the peer could not be resolved}" >&2
  exit 2
fi
# A relaunch (ci-gate-refusals.sh) checks the same pair: the peer as resolved, or none.
relaunch_peer=$(printf '%s\n' "$peer_trailers" | sed -n 's/^Peer: //p')
relaunch_peer=${relaunch_peer:-none}

# ci-kit's alert watcher: while no online Mac runner is free of an open alert, a run with Mac jobs is not pushed, its jobs
# would only be refused. Exit 2, as for the script's other refusals; anything else from the check goes ahead.
if [[ ${MAWS_GATE_IGNORE_ALERTS:-} == 1 ]]; then
  alert_check='ci-gate: MAWS_GATE_IGNORE_ALERTS=1, the ci-kit alert check skipped'
else
  # the peer's trailers, and an iteration run's Selection, which keeps the peer groups off the run
  alert_trailers=$peer_trailers
  [[ -n $affected ]] && alert_trailers+=$'\n'"Selection: affected"
  alert_check=$(node "$(dirname "$0")/ci-gate-alerts.mjs" --gates "$gates_trailer" --runner "$runner" --class1a "$class1a" --lane "$lane" --live "$live" --trailers "$alert_trailers" --git-dir "$git_dir" --sha "$sha")
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
[[ -z $peer_said ]] || printf '%s\n' "$peer_said"

# --affected: the change's paths, from the merge base with origin/master to the tested commit, each as a line of
# `git diff --name-status -M` (status, tab, path, and a rename's new path after another tab). A failed fetch goes ahead:
# a stale origin/master only widens the set. Above AFFECTED_BOUND paths none is listed and the plan runs the whole suite
# ("too many paths"): the list reaches the plan inside the commit message, as one environment variable, which Linux caps
# at 128 KiB, and at the bound even renames between the tree's longest paths (140 characters on 2026-10-21) stay near
# 60 KiB. The bound is the 93rd percentile of the files a landing changed over the 200 landings to 2026-10-21 (median
# 14); a change that size reaches most suites anyway.
AFFECTED_BOUND=200
affected_lines=()
if [[ -n $affected ]]; then
  git -C "$git_dir" fetch --quiet origin master || echo 'ci-gate: warning: fetching origin/master failed; the change is taken from the local origin/master'
  base=$(git -C "$git_dir" merge-base origin/master "$sha") || { echo "ci-gate: --affected: no merge base of $short with origin/master" >&2; exit 2; }
  # -z: each field ends in a NUL, a rename's two paths after its status, and no path is quoted.
  while IFS= read -r -d '' change_status && IFS= read -r -d '' change_path; do
    change_to=''
    if [[ $change_status == [RC]* ]]; then IFS= read -r -d '' change_to || break; fi
    if [[ $change_path$change_to == *[$'\t\n']* ]]; then
      echo "ci-gate: --affected cannot list a path with a tab or a newline in its name ($change_path$change_to); run without it" >&2
      exit 2
    fi
    affected_lines+=("$change_status"$'\t'"$change_path${change_to:+$'\t'$change_to}")
  done < <(git -C "$git_dir" diff --name-status -M -z "$base" "$sha")
  echo "ci-gate: --affected: ${#affected_lines[@]} paths from the merge base ${base:0:8} with origin/master$( ((${#affected_lines[@]} > AFFECTED_BOUND)) && echo ", above the bound of $AFFECTED_BOUND, so none is listed and the plan runs the whole suite")"
fi

# One paragraph of trailers: the nonce makes every pushed sha unique, so pushing the same sha again still triggers a run.
trailers="Nonce: $(date +%s)-$$"
[[ -n $gates_trailer ]] && trailers+=$'\n'"Gates: $gates_trailer"
[[ -n $runner ]] && trailers+=$'\n'"Runner: $runner"
[[ -n $class1a ]] && trailers+=$'\n'"Class1a: $class1a"
[[ -n $lane ]] && trailers+=$'\n'"Lane: $lane"
[[ -n $default_beside ]] && trailers+=$'\n'"DefaultBeside: $default_beside"
[[ -n $evidence ]] && trailers+=$'\n'"Evidence: $evidence"
[[ -n $live ]] && trailers+=$'\n'"Live: $live"
if [[ -n $affected ]]; then
  trailers+=$'\n'"Selection: affected"$'\n'"Affected-Count: ${#affected_lines[@]}"
  if ((${#affected_lines[@]} > 0 && ${#affected_lines[@]} <= AFFECTED_BOUND)); then for line in "${affected_lines[@]}"; do trailers+=$'\n'"Affected: $line"; done; fi
fi
[[ -n $peer_trailers ]] && trailers+=$'\n'"$peer_trailers"
# ci-kit's attempt-1 pre-launch hint: this plan's exact pool jobs, not the shape of a historical run. Advisory only:
# an unreadable variable, tree or plan omits the hint and leaves the launcher its history fallback. Read the variables
# now, and the package scripts and workflow env at the sha we push (never the caller's possibly dirty checkout).
if gate_runner=$(gh variable get GATE_RUNNER -R "$REPO") &&
   gate_e2e_runner=$(gh variable get GATE_E2E_RUNNER -R "$REPO") &&
   pool_demand=$(HEAD_MESSAGE="$trailers" GATE_RUNNER="$gate_runner" GATE_E2E_RUNNER="$gate_e2e_runner" \
     node "$(dirname "$0")/ci-gate-pool-demand.mjs" --git-dir "$git_dir" --sha "$sha"); then
  trailers+=$'\n'"Pool-Demand: $pool_demand"
else
  echo 'ci-gate: warning: could not plan pool demand; pushing without the advisory Pool-Demand trailer'
fi
pushed=$(git -C "$git_dir" commit-tree "$sha^{tree}" -p "$sha" -m "ci-gate: $short${affected:+ affected}" -m "$trailers") || exit 1

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

echo "ci-gate: $sha as $ref${gates:+ (Gates: $gates)}${runner:+ (Runner: $runner)}${class1a:+ (Class1a: $class1a)}${lane:+ (Lane: $lane)}${default_beside:+ (DefaultBeside: $default_beside)}${evidence:+ (Evidence: $evidence)}${live:+ (Live: $live)}${affected:+ (Selection: affected)}"
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
  hosted_reports "$failed_log" "$out/ci-$short"
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
