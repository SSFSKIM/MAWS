#!/usr/bin/env bash
# Runs MAWS's class-1 gates for one tree on GitHub Actions (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.4, §3.6).
#
#   scripts/ci-gate.sh <worktree-or-sha> --gates all|static,unit,unit:darwin,probes,e2e:<group>,… [--runner linux|macos]
#                      [--class1a linux|macos|pool] [--lane vm|vm-trial|hosted|no-hosted] [--default-beside <groups>] [--evidence]
#                      [--hosted-route direct|mirror] [--live] [--affected] [--peer <ref>|none | --peer-exact <ref>]
#                      [--no-mini-copy <reason>] [--label <name>] [--keep]
#
#   scripts/ci-gate.sh <worktree> --gates static,unit,probes     class 1a alone
#   scripts/ci-gate.sh <worktree> --gates all                    the whole set (on a macOS e2e lane, every Mac job)
#
# Pushes the tree, plus one empty commit, to refs/heads/ci/<label>-<short> (force), waits for the run of
# .github/workflows/gate.yml on it, prints each job's conclusion, downloads the failed e2e jobs' reports to
# /tmp/maws-review/gates/ci-<short>-<run-id>-<invocation>/reports/ (including hosted reports from SSFSKIM/maws-app),
# keeps the whole transcript beside it in transcript.log, deletes the
# ref (unless --keep) and exits with the run's status (0 green, 1 anything else). A call that ends without the run's
# verdict while the run exists (unreadable, interrupted) keeps the ref for a rerun and prints how to delete it. A read
# the exhausted API budget refuses is waited out until the budget's reset, up to 90 minutes (scripts/ci-gate-pace.sh).
# On ci-kit's pool, a failed GCE job annotated "The operation was canceled." without a timeout, or a failed EC2 job
# annotated "The self-hosted runner lost communication with the server.", is rerun alone, once per job per run. The
# EC2 annotation can mean a spot
# interruption or a box the tree starved, not a proven preemption. The script reports the run's final attempt: the line
# before the run's status, `ci-gate: run <id> <conclusion>`, is `ci-gate: run <id> attempt <n>`, and a line before those
# names each interrupted job and how its rerun ended, one interrupted again staying red (Decision Log 70).
# When the mini refused jobs (ci-kit's
# job-started check: a dialog or the wrong app in front; its measured-job guard: a MEASURED_E2E group's desktop not
# settled within 15 minutes), the last line before the run's status names the refused, the green and the red, and the
# --gates that relaunches the refused and the red on the same tree (Decision Log 58(c), 59(1)), with --default-beside
# naming the run's other e2e groups when the relaunch takes e2e:default (Decision Log 66); the refused and red mini copies
# follow on lines of their own, relaunched on the mini alone (ci-gate-refusals.sh).
#
#   <worktree-or-sha>  a worktree path (its HEAD is tested) or a commit
#   --gates            required: a comma list over static, unit, unit:darwin, packaged (macOS), probes and e2e:<group>, or
#                      `all`, the whole set: class 1a (static, unit, probes), plus unit:darwin and every class-1 e2e group
#                      when the e2e lane is macOS (about 35 jobs and 70 minutes on the one Mac), and packaged where it
#                      would take GitHub's hosted Macs (the direct route, HOSTED_MAC_JOBS). A call without --gates is
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
#                      fetched first. Either candidate maps to the first master first-parent commit containing it; a
#                      mid-branch draft is not a master state. An explicit peer outside master ancestry is refused.
#                      The resolved commit goes in a `Peer:` trailer beside both trees' wires (`Peer-Wire:`, `Wire:`,
#                      each the major.minor of its src/shared/ipc/wire-manifest.json), and the plan adds those groups to a
#                      run whose two wires are a minor apart and whose gates hold unit, unit:darwin or an e2e group (so
#                      class 1a and --gates all do, a static or probes check does not), unless the run is --live or
#                      --affected. No trailer when the tree has no manifest, is its own merge base, or with `none`. Refused
#                      (exit 2), naming --peer: a --peer that names no commit or one with no manifest, and a checkout that
#                      cannot find its merge base (shallow, or with none with origin/master). A refused run's relaunch
#                      line carries the peer as resolved, its sha or `none`. Naming a PEER_E2E group in --gates
#                      requires two wires with different minors within one major; equal minors, different majors and
#                      --peer none are refused before pushing. Choose --peer at a master commit a minor apart, or leave
#                      the group out of --gates. This does not change the default set selected by --gates all
#   --peer-exact       the peer as one commit and no other: it is not mapped to a first-parent master state. For a
#                      build that is a master ancestor off master's first-parent chain (it came in as a merge's second
#                      parent, as a build the machines run can), which --peer would replace with the merge that contains
#                      it, a different tree. The commit must hold a manifest and be an ancestor of origin/master (exit 2
#                      otherwise, naming --peer-exact); it is refused beside --peer (exit 2); the transcript says the
#                      peer was taken exactly, with its full sha and wire. --peer's other rules hold: the trailers, the
#                      two minors a named PEER_E2E group needs, a shallow checkout refused. A refused run's relaunch
#                      line and an alert refusal's override carry --peer-exact with that sha
#   --hosted-route     override HOSTED_MAC_ROUTE for this run: direct (macos-26 in MAWS) or mirror (maws-app).
#                      Unset uses the repository variable, which defaults to mirror. Admission and --lane still apply.
#   --no-mini-copy     no mini copies for this run, for the reason given (letters, digits, spaces and . _ : / # , = + -),
#                      which the plan's summary prints: for a head whose copies already stand on an earlier head of the
#                      same change, as a re-merge of master's. Without it, each e2e group the run asks for (for `all`, the
#                      tested commit's CLASS1_E2E) whose specs reach a path under e2e/ that the change edits (a spec or
#                      e2e/support; the spec-import graph from the merge base with origin/master, fetched first) gets a
#                      `MiniCopy: <group> <paths>` trailer, and where the run puts that group off the mini, on a hosted
#                      Mac or EC2, the plan runs it once more on the mini, in the guest or on its home host, as a
#                      `(mini copy)` job (gate-plan.mjs): scenes went green on the hosted Macs and red on the mini. A
#                      graph that cannot be read (no merge base, no TypeScript) gives no copy, and an E2E-Coverage note
#                      that says so
#   --label            the ref's name before the short sha, sanitized as before. Without it: auto-<branch-or-gate>-
#                      <gates-and-lane>-<configuration-hash>, bounded and never a reserved final label. Different
#                      configurations have distinct refs; an identical call may supersede its predecessor
#   --keep             leave the ci/ ref in place
#
# Every invocation pushes a fresh empty commit on top of the sha: its message carries a unique nonce (so the push always
# triggers a run of its own and the run found is this one's) and, when given, the `Gates:` (none for `all`, the plan's
# default set), `Runner:`, `Class1a:`, `Lane:`, `DefaultBeside:`, `Evidence:` and `Live:` trailers; under --affected its subject is
# `ci-gate: <short> affected` and it carries `Selection: affected`, `Affected-Count:` and an `Affected:` trailer per path.
# The peer's `Peer:`, `Peer-Wire:` and `Wire:` trailers follow when there is one (--peer, --peer-exact), then the run's
# `MiniCopy:` trailers, one per group, or `MiniCopy: none (<reason>)` under --no-mini-copy.
# Direct e2e runs without --lane hosted or no-hosted add `Mac-Backlog:` when the caller can read the account queues and
# self-hosted runners and mini lane publication (cached for 60 s).
# The plan may overflow eligible groups to EC2 or the mini; an absent or older-than-five-minute sample preserves normal placement.
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
# The last two lines name the transcript and reports directory (also on green or error), or explicitly say none
# when validation/preflight stopped the call before logging. Once preflight succeeds but before a run exists,
# they live under ci-pending.<invocation>/; once found, that directory is renamed to include its run id. Read the
# printed paths, not a path reconstructed from the sha. Each invocation owns its paths, including identical calls.
#
#   MAWS_GATE_IGNORE_ALERTS=1  skip that check, for an alert left open by mistake
# The whole script is one brace group, closed on its last line: bash parses a group whole before running it, so
# editing this file while a call started from this worktree is still waiting cannot change the waiting call
# (it read the file as it went, and died mid-run with 'view_err: unbound variable', leaving its ci/ ref).
{
set -uo pipefail

# Preflight errors keep stderr and have no run evidence. Once admitted, every exit names this invocation's paths.
log=''
reports=''
print_paths() {
  if [[ -n $log ]]; then
    echo "ci-gate: transcript in $log"
    echo "ci-gate: reports in $reports/"
  else
    echo 'ci-gate: transcript: none (stopped before a run)'
    echo 'ci-gate: reports: none (stopped before a run)'
  fi
}
trap print_paths EXIT

# paced_gh: a read the exhausted API budget refuses, waited out rather than failed (bounded at 90 minutes).
# shellcheck source=scripts/ci-gate-pace.sh
source "$(dirname "$0")/ci-gate-pace.sh" || exit 2
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
hosted_route=''
default_beside=''
evidence=''
live=''
affected=''
peer=''
peer_exact=''
no_mini_copy=''
label=''
keep=false
while (($# > 0)); do
  case $1 in
    --gates) gates=${2?--gates needs a list}; shift 2 ;;
    --runner) runner=${2:?--runner needs linux or macos}; shift 2 ;;
    --class1a) class1a=${2:?--class1a needs linux, macos or pool}; shift 2 ;;
    --hosted-route) hosted_route=${2:?--hosted-route needs direct or mirror}; shift 2 ;;
    --lane) lane=${2:?--lane needs vm, vm-trial, hosted or no-hosted}; shift 2 ;;
    --default-beside) default_beside=${2:?--default-beside needs a list of e2e groups}; shift 2 ;;
    --evidence) evidence=yes; shift ;;
    --live) live=yes; shift ;;
    --affected) affected=yes; shift ;;
    --peer) peer=${2:?--peer needs a ref or none}; shift 2 ;;
    --peer-exact) peer_exact=${2:?--peer-exact needs a commit}; shift 2 ;;
    --no-mini-copy) no_mini_copy=${2:?--no-mini-copy needs a reason}; shift 2 ;;
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
case $hosted_route in '' | direct | mirror) ;; *) echo "ci-gate: --hosted-route is direct or mirror, not $hosted_route" >&2; exit 2 ;; esac
case $lane in '' | vm | vm-trial | hosted | no-hosted) ;; *) echo "ci-gate: --lane is vm, vm-trial, hosted or no-hosted, not $lane" >&2; exit 2 ;; esac
# The names land unquoted in a printed relaunch command, so only characters that are inert there pass.
case $default_beside in *[!A-Za-z0-9._:,\ -]*) echo "ci-gate: --default-beside takes group names of letters, digits, . _ : - separated by commas, not $default_beside" >&2; exit 2 ;; esac
# The reason reaches a trailer and, quoted, a printed relaunch command, so only characters inert in both pass.
case $no_mini_copy in *[!A-Za-z0-9._:/#,=+\ -]*) echo "ci-gate: --no-mini-copy takes a reason of letters, digits, spaces and . _ : / # , = + -, not $no_mini_copy" >&2; exit 2 ;; esac
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
  git_dir=$(git -C "$target" rev-parse --show-toplevel) || exit 2
  sha=$(git -C "$git_dir" rev-parse --verify HEAD) || exit 2
  branch=$(git -C "$git_dir" symbolic-ref --quiet --short HEAD || true)
else
  # The checkout's top, not scripts/: `git archive` run from a subfolder archives only that subfolder, which left the
  # coverage graph and mini copies without package.json for every bare-sha call.
  git_dir=$(git -C "$(dirname "$0")" rev-parse --show-toplevel) || exit 2
  sha=$(git -C "$git_dir" rev-parse --verify --quiet "$target^{commit}") || { echo "ci-gate: no commit $target" >&2; exit 2; }
  branch=''
fi

# The target's origin is also the API target: writes (notably cancellation) must not depend on transfer redirects.
# Read the configured URL, before local insteadOf transport rewrites. Non-GitHub origins retain today's fallback.
REPO=SSFSKIM/MAWS
origin_url=$(git -C "$git_dir" config --get remote.origin.url || true)
if [[ $origin_url =~ ^(https://github\.com/|git@github\.com:|ssh://git@(github\.com|ssh\.github\.com)(:[0-9]+)?/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/?$ ]]; then
  REPO=${BASH_REMATCH[4]%.git}
fi

# Explicit labels preserve their routing (reserved final refs stay on the self-hosted Mac).
# The default is derived after peer, affected paths and repository variables are resolved.
short=${sha:0:8}
label=${label//[^A-Za-z0-9._-]/-}
ref=ci/$label-$short

# The peer of the PEER_E2E groups and both trees' wires, as trailers (ci-gate-peer.mjs), read before the alert check, whose
# plan they can add a Mac job to; what it decided is said once the transcript starts.
peer_notes=$(mktemp)
peer_trailers=$(node "$(dirname "$0")/ci-gate-peer.mjs" --git-dir "$git_dir" --sha "$sha" --peer "$peer" --peer-exact "$peer_exact" --gates "$gates" 2>"$peer_notes")
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
# An exact peer stays exact in a relaunch, named by its sha: --peer with that sha would map it to another commit, and
# --peer none beside the call's own --peer-exact would be refused. So also when the run has no peer trailer (the exact
# peer is the tested commit itself): the relaunch then resolves to no peer again, as this call did.
relaunch_peer_flag=--peer
if [[ -n $peer_exact ]]; then
  relaunch_peer_flag=--peer-exact
  relaunch_peer=$(git -C "$git_dir" rev-parse --verify --quiet "$peer_exact^{commit}") || exit 2
fi

# --affected: the change's paths, from the merge base with origin/master to the tested commit, each as a line of
# `git diff --name-status -M` (status, tab, path, and a rename's new path after another tab). A failed fetch goes ahead:
# a stale origin/master only widens the set. Above AFFECTED_BOUND paths none is listed and the plan runs the whole suite
# ("too many paths"): the list reaches the plan inside the commit message, as one environment variable, which Linux caps
# at 128 KiB, and at the bound even renames between the tree's longest paths (140 characters on 2026-10-21) stay near
# 60 KiB. The bound is the 93rd percentile of the files a landing changed over the 200 landings to 2026-10-21 (median
# 14); a change that size reaches most suites anyway.
AFFECTED_BOUND=200
affected_lines=()
affected_note=''
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
  affected_note="ci-gate: --affected: ${#affected_lines[@]} paths from the merge base ${base:0:8} with origin/master$(if ((${#affected_lines[@]} > AFFECTED_BOUND)); then echo ", above the bound of $AFFECTED_BOUND, so none is listed and the plan runs the whole suite"; fi)"
fi

# Mini copies: the run's e2e groups whose specs reach a changed path under e2e/ (ci-gate-e2e-coverage.mjs --mini-copy),
# read before the alert check, the label and the pool hint, whose plans the copies change; what it found is said once the
# transcript starts. Under --no-mini-copy, its reason instead.
mini_copy_trailers=''
mini_copy_said=''
if [[ -n $no_mini_copy ]]; then
  mini_copy_trailers="MiniCopy: none ($no_mini_copy)"
  mini_copy_said="ci-gate: no mini copies: $no_mini_copy"
elif [[ $gates == all || $gates == *e2e:* ]]; then
  git -C "$git_dir" fetch --quiet origin master || echo 'ci-gate: warning: fetching origin/master failed; mini copies use the local origin/master' >&2
  mini_copy_notes=$(mktemp)
  mini_copy_trailers=$(node "$(dirname "$0")/ci-gate-e2e-coverage.mjs" --mini-copy --git-dir "$git_dir" --sha "$sha" --gates "$gates_trailer" 2>"$mini_copy_notes")
  mini_copy_said=$(<"$mini_copy_notes")
  rm -f "$mini_copy_notes"
fi

# One paragraph of trailers: the nonce makes every pushed sha unique, so pushing the same sha again still triggers a run.
trailers="Nonce: $(date +%s)-$$"
[[ -n $gates_trailer ]] && trailers+=$'\n'"Gates: $gates_trailer"
[[ -n $runner ]] && trailers+=$'\n'"Runner: $runner"
[[ -n $class1a ]] && trailers+=$'\n'"Class1a: $class1a"
[[ -n $lane ]] && trailers+=$'\n'"Lane: $lane"
[[ -n $hosted_route ]] && trailers+=$'\n'"Hosted-Route: $hosted_route"
[[ -n $default_beside ]] && trailers+=$'\n'"DefaultBeside: $default_beside"
[[ -n $evidence ]] && trailers+=$'\n'"Evidence: $evidence"
[[ -n $live ]] && trailers+=$'\n'"Live: $live"
if [[ -n $affected ]]; then
  trailers+=$'\n'"Selection: affected"$'\n'"Affected-Count: ${#affected_lines[@]}"
  if ((${#affected_lines[@]} > 0 && ${#affected_lines[@]} <= AFFECTED_BOUND)); then for line in "${affected_lines[@]}"; do trailers+=$'\n'"Affected: $line"; done; fi
fi
[[ -n $peer_trailers ]] && trailers+=$'\n'"$peer_trailers"
[[ -n $mini_copy_trailers ]] && trailers+=$'\n'"$mini_copy_trailers"
# ci-kit's attempt-1 pre-launch hint: this plan's exact pool jobs, not the shape of a historical run. Advisory only:
# an unreadable variable, tree or plan omits the hint and leaves the launcher its history fallback. Read the variables
# now, and the package scripts and workflow env at the sha we push (never the caller's possibly dirty checkout).
variables_ok=true
gate_runner=$(gh variable get GATE_RUNNER -R "$REPO") || variables_ok=false
gate_e2e_runner=$(gh variable get GATE_E2E_RUNNER -R "$REPO") || variables_ok=false
gate_hosted_route=$(gh variable list -R "$REPO" --json name,value --jq '.[] | select(.name == "HOSTED_MAC_ROUTE") | .value') || variables_ok=false
gate_mac_ec2=$(gh variable list -R "$REPO" --json name,value --jq '.[] | select(.name == "MAC_EC2") | .value') || variables_ok=false
gate_mini_overflow=$(gh variable list -R "$REPO" --json name,value --jq '.[] | select(.name == "MAC_MINI_OVERFLOW") | .value') || variables_ok=false
gate_hosted_cap=$(gh variable list -R "$REPO" --json name,value --jq '.[] | select(.name == "HOSTED_MAC_CAP") | .value') || variables_ok=false
gate_hosted_repos=$(gh variable list -R "$REPO" --json name,value --jq '.[] | select(.name == "HOSTED_MAC_REPOS") | .value') || variables_ok=false
# The mini's scheduled holds, for the plan's advisory window line alone: a failed read only leaves the line out.
gate_mini_lanes=$(gh variable list -R "$REPO" --json name,value --jq '.[] | select(.name == "MAC_MINI_LANES") | .value') || gate_mini_lanes=''
# Sample only when the direct route could host e2e work (unit may add the peer group) and the caller named no hosted
# lane: --lane hosted asks for GitHub's hosted Macs themselves (a trial or an admission), so nothing of it may move to
# self-hosted, and no-hosted puts nothing there. The caller's token sees the account-wide queue and self-hosted state. Missing/failed
# reads leave out the trailer; gate-plan then does exactly as before.
backlog_trailer=''
if [[ ${hosted_route:-$gate_hosted_route} == direct && $lane != no-hosted && $lane != hosted && -z $live ]]; then
  case $gates in
    all|*e2e:*|*unit*)
      backlog_trailer=$(REPO="$REPO" HOSTED_MAC_REPOS="$gate_hosted_repos" node "$(dirname "$0")/ci-gate-backlog.mjs") || {
        backlog_status=$?
        [[ $backlog_status != 2 ]] || exit 2
        backlog_trailer=''
      } ;;
  esac
  [[ -z $backlog_trailer ]] || trailers+=$'\n'"$backlog_trailer"
fi
if [[ -z $label ]]; then
  label=$(HEAD_MESSAGE="$trailers" GATE_RUNNER="$gate_runner" GATE_E2E_RUNNER="$gate_e2e_runner" HOSTED_MAC_ROUTE="$gate_hosted_route" HOSTED_MAC_CAP="$gate_hosted_cap" MAC_EC2="$gate_mac_ec2" MAC_MINI_OVERFLOW="$gate_mini_overflow" \
    node "$(dirname "$0")/ci-gate-identity.mjs" --git-dir "$git_dir" --sha "$sha" --branch "$branch") || exit 2
  label=${label//[^A-Za-z0-9._-]/-}
  ref=ci/$label-$short
fi

# ci-kit's alert watcher: while no online Mac runner is free of an open alert, a run with Mac jobs is not pushed, its jobs
# would only be refused. Exit 2, as for the script's other refusals; anything else from the check goes ahead.
if [[ ${MAWS_GATE_IGNORE_ALERTS:-} == 1 ]]; then
  alert_check='ci-gate: MAWS_GATE_IGNORE_ALERTS=1, the ci-kit alert check skipped'
else
  # the peer's trailers, and an iteration run's Selection, which keeps the peer groups off the run
  alert_trailers=$peer_trailers
  [[ -z $mini_copy_trailers ]] || alert_trailers+=$'\n'"$mini_copy_trailers"
  [[ -z $backlog_trailer ]] || alert_trailers+=$'\n'"$backlog_trailer"
  [[ -n $hosted_route ]] && alert_trailers+=$'\n'"Hosted-Route: $hosted_route"
  [[ -n $affected ]] && alert_trailers+=$'\n'"Selection: affected"
  alert_check=$(node "$(dirname "$0")/ci-gate-alerts.mjs" --gates "$gates_trailer" --runner "$runner" --class1a "$class1a" --lane "$lane" --live "$live" --trailers "$alert_trailers" --git-dir "$git_dir" --sha "$sha" --ref "$ref")
  case $? in
    0) ;;
    2)
      printf '%s\n' "$alert_check" >&2
      # Shell-quoted, so a reason's spaces or its `#` stay one argument when the line is pasted.
      echo "ci-gate: to push anyway, for an alert left open by mistake: MAWS_GATE_IGNORE_ALERTS=1 scripts/ci-gate.sh $(printf '%q ' "${args[@]}")$relaunch_peer_flag $relaunch_peer" >&2
      exit 2 ;;
    *) alert_check+="${alert_check:+$'\n'}ci-gate: warning: the ci-kit alert check failed; going ahead (the runner's job-started check still refuses jobs under a dialog)" ;;
  esac
fi
out=/tmp/maws-review/gates
mkdir -p "$out" || exit 2
invocation=$(mktemp -d "$out/ci-pending.XXXXXX") || exit 2
invocation_token=${invocation##*.}
mkdir -p "$invocation/reports" || exit 2
log=$invocation/transcript.log
reports=$invocation/reports
exec > >(tee "$log") 2>&1
# The pacer's waits reach the transcript also from a read whose stderr goes elsewhere (ci-gate-pace.sh).
exec 3>&2
PACE_NOTES_FD=3
[[ -z $alert_check ]] || printf '%s\n' "$alert_check"
[[ -z $peer_said ]] || printf '%s\n' "$peer_said"
[[ -z $mini_copy_said ]] || printf '%s\n' "$mini_copy_said"
[[ -z $affected_note ]] || printf '%s\n' "$affected_note"
[[ -z $backlog_trailer ]] || printf 'ci-gate: %s\n' "$backlog_trailer"

# The same plan says on stderr, into the transcript, when one of the mini's scheduled holds will keep this run's jobs waiting.
if [[ $variables_ok == true ]] &&
   pool_demand=$(HEAD_MESSAGE="$trailers" GATE_RUNNER="$gate_runner" GATE_E2E_RUNNER="$gate_e2e_runner" HOSTED_MAC_ROUTE="$gate_hosted_route" HOSTED_MAC_CAP="$gate_hosted_cap" MAC_EC2="$gate_mac_ec2" MAC_MINI_OVERFLOW="$gate_mini_overflow" MAC_MINI_LANES="$gate_mini_lanes" \
     node "$(dirname "$0")/ci-gate-pool-demand.mjs" --git-dir "$git_dir" --sha "$sha"); then
  trailers+=$'\n'"Pool-Demand: $pool_demand"
else
  echo 'ci-gate: warning: could not plan pool demand; pushing without the advisory Pool-Demand trailer'
fi
# Advisory unit and spec-import coverage: use the merge-base diff and the committed tree, even without dependencies.
# All already requests the whole set. A failed check never stops the push; its notes travel to the run summary.
if [[ -n $gates_trailer ]]; then
  git -C "$git_dir" fetch --quiet origin master || echo 'ci-gate: warning: fetching origin/master failed; coverage uses the local origin/master' >&2
  if unit_trailers=$(node "$(dirname "$0")/ci-gate-unit-coverage.mjs" --git-dir "$git_dir" --sha "$sha" --gates "$gates_trailer"); then
    [[ -z $unit_trailers ]] || trailers+=$'\n'"$unit_trailers"
  else
    echo 'ci-gate: warning: unit coverage failed; going ahead' >&2
    trailers+=$'\n''Unit-Coverage: note: unit coverage failed; no advice available'
  fi
  if coverage_trailers=$(node "$(dirname "$0")/ci-gate-e2e-coverage.mjs" --git-dir "$git_dir" --sha "$sha" --gates "$gates_trailer"); then
    [[ -z $coverage_trailers ]] || trailers+=$'\n'"$coverage_trailers"
  else
    echo 'ci-gate: warning: spec-import coverage failed; going ahead' >&2
    trailers+=$'\n''E2E-Coverage: note: spec-import coverage failed; no advice available'
  fi
fi
pushed=$(git -C "$git_dir" commit-tree "$sha^{tree}" -p "$sha" -m "ci-gate: $short${affected:+ affected}" -m "$trailers") || exit 1

run_id=''
verdict=''
# The ref goes once the run has a verdict, green or red, and when no run came of the push. A call that ends without one
# while its run exists (unreadable, the budget spent past its bound, interrupted), or when the spent budget hid the run,
# keeps it, so a rerun of the run, or a read of its head, still finds the branch; it says how to delete it.
finish() {
  local status=$1
  if [[ $keep == false ]]; then
    if [[ -z $verdict ]] && { [[ -n $run_id ]] || pace_limited; }; then
      echo "ci-gate: kept $ref, as this call ends without the run's verdict; delete it with: git -C $(printf %q "$git_dir") push origin --delete refs/heads/$ref" >&2
    # Only while the ref is still this invocation's commit: a later invocation's push to it is not ours to delete.
    elif git -C "$git_dir" push --quiet --force-with-lease="refs/heads/$ref:$pushed" origin ":refs/heads/$ref" 2>/dev/null; then
      echo "ci-gate: removed $ref"
    else
      echo "ci-gate: left $ref (moved by a later push)"
    fi
  fi
  rm -f "$PACE_MARK"
  exit "$status"
}
# shellcheck disable=SC2329 # invoked by the trap below
interrupted() {
  [[ -n $run_id ]] && gh -R "$REPO" run cancel "$run_id" >/dev/null 2>&1 && echo "ci-gate: cancelled run $run_id"
  finish 130
}
trap interrupted INT TERM

echo "ci-gate: $sha as $ref${gates:+ (Gates: $gates)}${runner:+ (Runner: $runner)}${class1a:+ (Class1a: $class1a)}${lane:+ (Lane: $lane)}${hosted_route:+ (Hosted-Route: $hosted_route)}${default_beside:+ (DefaultBeside: $default_beside)}${evidence:+ (Evidence: $evidence)}${live:+ (Live: $live)}${affected:+ (Selection: affected)}${no_mini_copy:+ (MiniCopy: none ($no_mini_copy))}"
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

# The run usually appears a few seconds after the push, but GitHub has created it more than a minute late (2026-11-04,
# twice in a row on one head), and the late run still ran after ci-gate had given up. So: every 2 s for a minute, then
# every 10 s up to 5 min. Only a run that never comes costs the longer wait, and then the workflow did not trigger. A wait
# for the spent budget counts no poll.
for poll in $(seq 1 54); do
  run_id=$(paced_gh -R "$REPO" run list --workflow gate.yml --event push --branch "$ref" --json databaseId,headSha --jq ".[] | select(.headSha == \"$pushed\") | .databaseId" | head -1)
  [[ -n $run_id ]] && break
  if [[ $poll -lt 30 ]]; then sleep 2; else
    [[ $poll -eq 30 ]] && echo "ci-gate: no run of $pushed yet after a minute; waiting up to 5 min" >&2
    sleep 10
  fi
done
if [[ -z $run_id ]]; then
  if pace_limited; then
    echo "ci-gate: no run of $pushed on $ref could be read through the exhausted API rate limit (find it later: gh -R $REPO run list --commit $pushed)" >&2
  else
    echo "ci-gate: no run of $pushed on $ref after 5 min (a run GitHub creates later still runs: gh -R $REPO run list --commit $pushed)" >&2
  fi
  finish 1
fi
# tee keeps the same open file while the invocation directory gains its run id.
run_dir=$out/ci-$short-$run_id-$invocation_token
mv "$invocation" "$run_dir" || finish 1
invocation=$run_dir
log=$invocation/transcript.log
reports=$invocation/reports
echo "ci-gate: https://github.com/$REPO/actions/runs/$run_id"

# Waits for the run's status `completed`, reading the run alone (settle_run reads its jobs once it completes), each
# read conditional on the last one's ETag: an unchanged run answers 304, which GitHub does not count against the budget
# every session on the account shares, where `gh run watch` read the run and its jobs, and the annotations of each job
# not completed, every 30 s. A minute apart for the first five polls, which sees a short run end soon, then two.
# A failed read (an API error mid-poll) is not the end of the run, nor a limit waited out (paced_gh). A run that can no
# longer be read (credentials revoked, run deleted) would be retried forever, so consecutive read failures are bounded,
# 15 s apart.
await_run() {
  local etag='' polls=0 unreadable=0 view_err=$invocation/view.err answer head
  while :; do
    # gh exits 1 on a 304, having printed its headers (-i) and no body.
    answer=$(paced_gh api -i ${etag:+-H "If-None-Match: $etag"} "repos/$REPO/actions/runs/$run_id" --jq .status 2>"$view_err")
    answer=${answer//$'\r'/}
    head=${answer%%$'\n'*}
    if [[ $head == HTTP/*' 304'* ]]; then
      unreadable=0
    elif [[ $head == HTTP/*' 200'* ]]; then
      unreadable=0
      etag=$(printf '%s\n' "$answer" | awk -F': ' 'tolower($1) == "etag" { print $2; exit }')
      [[ ${answer##*$'\n'} == completed ]] && break
    else
      unreadable=$((unreadable + 1))
      if ((unreadable >= 20)); then
        echo "ci-gate: run $run_id cannot be read (the last gh error follows)" >&2
        cat "$view_err" >&2
        rm -f "$view_err"
        finish 1
      fi
      sleep 15
      continue
    fi
    polls=$((polls + 1))
    if ((polls <= 5)); then sleep 60; else sleep 120; fi
  done
  rm -f "$view_err"
}
# The run's final attempt: a job a spot preemption ended is rerun alone, once (Decision Log 70).
settle_run
printf '%s\n' "$jobs"

if [[ $conclusion != success ]]; then
  if paced_gh -R "$REPO" run download "$run_id" -D "$reports" 2>/dev/null; then echo "ci-gate: failed jobs' reports in $reports/"; fi
  failed_log=$(paced_gh -R "$REPO" run view "$run_id" --log-failed | perl -pe 's/(\e|\^\[)\[[0-9;]*[A-Za-z]//g')
  hosted_reports "$failed_log" "$reports"
  # The failed steps' last lines, each under its job's name, colours and timestamps stripped.
  printf '%s\n' "$failed_log" | perl -pe 's/^([^\t]*)\t[^\t]*\t\S+ /$1  /' | tail -80
fi
[[ -z $preemptions ]] || printf '%s\n' "$preemptions"
[[ $conclusion == success ]] || refusals "$jobs" "$failed_log"
# Retry passes are still flakes: keep their locations beside the verdict, also on a green run.
if [[ $jobs == *e2e:* ]]; then node "$(dirname "$0")/ci-gate-flaky.mjs" "$REPO" "$run_id"; fi
# The attempt on a line of its own, so the status line stays what every waiter matches (^ci-gate: run [0-9]+ [a-z_]+$).
echo "ci-gate: run $run_id attempt $run_attempt"
echo "ci-gate: run $run_id $conclusion"
verdict=$conclusion
[[ $conclusion == success ]] && finish 0
finish 1
exit 1
}
