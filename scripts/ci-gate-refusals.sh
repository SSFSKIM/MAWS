# shellcheck shell=bash
# scripts/ci-gate.sh's summary of a run the mini refused jobs of (docs/doperpowers/plans/2026-10-14-gate-offload.md
# Decision Log 58(c), 59(1), 66), sourced by it and by scripts/ci-gate-refusals.test.mjs. It reads ci-gate.sh's sha,
# runner, class1a, lane, live, gates, default_beside and label.
# shellcheck disable=SC2154 # those variables are ci-gate.sh's

# When ci-kit refused jobs on the mini (its `ci-kit: … rerun` line in a job's log: the job-started check's, before any of
# the job's steps ran, or the measured-job guard's, at a MEASURED_E2E group's first step when the desktop did not settle),
# one line of the refused against the finished, green and red, and the relaunch of the refused and the red on the same
# tree. Nothing when no job was refused.
# A relaunch that takes e2e:default names, in --default-beside, every e2e group this run's `default` ran beside: its other
# e2e jobs, as the plan made them, and the groups of its own --default-beside. The relaunch's `default` then runs the
# specs this run's `default` ran, not also those of every group the relaunch leaves out (Decision Log 66).
# The invocation's own names go through verbatim, its --gates (`all` included; ci-gate.sh refuses a call without one)
# among them: the relaunch's plan normalises them exactly as this run's plan did.
# A job's name is its gate's, but for unit's shards on the pool, `unit <k>/<n>`, each a job of the gate `unit`: the
# relaunch names that gate once, the plan sharding it again. Names are whole, spaces included: the refused, one a line.
refusals() { # <the jobs, "conclusion<TAB>name" lines> <the failed jobs' logs>
  local refused beside relaunch="scripts/ci-gate.sh $sha"
  refused=$(printf '%s\n' "$2" | perl -ne 'print "$1\n" if /^([^\t]+)\t[^\t]*\t\S+ ci-kit: .*rerun\s*$/' | sort -u)
  [[ -n $refused ]] || return 0
  [[ -n $runner ]] && relaunch+=" --runner $runner"
  [[ -n $class1a ]] && relaunch+=" --class1a $class1a"
  # A run on a Lane: relaunches there: the guest's own refusals (a dialog in it, a display off its geometry) included.
  [[ -n $lane ]] && relaunch+=" --lane $lane"
  # A live run's groups are refused without --live (Decision Log 75), so its relaunch stays live.
  [[ -n $live ]] && relaunch+=" --live"
  beside=$({
    printf '%s\n' "$1" | awk -F'\t' '$1 != "skipped" && $2 ~ /^e2e:[A-Za-z0-9._:-]+$/ { print substr($2, 5) }'
    printf '%s\n' "$default_beside" | tr ', ' '\n'
  } | awk 'NF && $0 != "default" && !seen[$0]++' | paste -sd, -)
  # The refused through the environment, since awk's -v takes no newline.
  printf '%s\n' "$1" | refused=$refused awk -F'\t' -v relaunch="$relaunch" -v label="$label" -v asked="$gates" -v beside="$beside" '
    # A red build skips the guest matrix before expansion, losing its group names. It is a prerequisite, not a gate:
    # relaunch the requested set, as for a refused plan, rather than omit the unnamed guest groups.
    function relaunched(job) {
      if (job ~ /^e2e-build \([^)]+\)$/) { build = 1; return }
      if (job ~ /^unit [0-9]+\/[0-9]+$/) job = "unit"
      if (!(job in named)) { named[job] = 1; gates = gates "," job }
    }
    BEGIN { n = split(ENVIRON["refused"], names, "\n"); for (i = 1; i <= n; i++) isrefused[names[i]] = 1 }
    # Under GATE_RUNNER=macos the plan runs on the mini too; refused, it ran nothing, so the relaunch is the whole run.
    $2 == "plan" && $2 in isrefused { plan = 1 }
    $2 == "plan" || $1 == "skipped" { next }
    $2 in isrefused { r = r " " $2; relaunched($2); nr++; next }
    $1 == "success" { g = g " " $2; ng++; next }
    { d = d " " $2 ($1 == "failure" ? "" : " (" $1 ")"); relaunched($2); nd++ }
    END {
      if (plan) {
        printf "ci-gate: the mini refused the plan job, so nothing ran; relaunch the run: %s --gates %s%s --label %s --evidence\n", relaunch, asked, (beside != "" ? " --default-beside " beside : ""), label
        exit
      }
      printf "ci-gate: refused by the mini (%d):%s; green (%d):%s; red (%d):%s; ", nr, r, ng, (ng ? g : " none"), nd, (nd ? d : " none")
      if (build) {
        printf "e2e-build did not succeed, so the skipped guest groups cannot be named; relaunch the run: %s --gates %s%s --label %s --evidence\n", relaunch, asked, (beside != "" ? " --default-beside " beside : ""), label
        exit
      }
      printf "relaunch the refused and the red (less any red baseline, Decision Log 58(c)): %s --gates %s%s --label %s --evidence\n",
        relaunch, substr(gates, 2), (beside != "" && index(gates ",", ",e2e:default,") ? " --default-beside " beside : ""), label
    }'
}
