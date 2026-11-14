# shellcheck shell=bash
# scripts/ci-gate.sh's summary of a run the mini refused jobs of (docs/doperpowers/plans/2026-10-14-gate-offload.md
# Decision Log 58(c), 59(1), 66), sourced by it and by scripts/ci-gate-refusals.test.mjs. It reads ci-gate.sh's sha,
# runner, class1a, lane, live, gates, default_beside and label, and relaunch_peer (the run's peer, a sha or `none`) with
# relaunch_peer_flag (--peer-exact for a peer taken exactly; unset means --peer).
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
# A job's name is its gate's, but for unit's pool shards and packaged's hosted shards, `<gate> <k>/<n>`: the
# relaunch names that gate once, the plan sharding it again. Names are whole, spaces included: the refused, one a line.
# A mini copy (gate-plan.mjs) is relaunched as its plain group. A guest copy job's groups, `e2e: mini copy (<group>, …)`,
# go on a line of their own under the label's `-mini` (a ref of its own) with --lane vm, the guest alone, where each is
# already on the mini, so that relaunch copies none. A host copy, `e2e:<group> (mini copy)`, joins the main relaunch,
# with this run's lane: no flag reaches the home label it took (--lane no-hosted leaves an unlisted group on today's
# three labels, which the EC2 Mac carries too), and its original, off the mini again there, is copied to it again.
refusals() { # <the jobs, "conclusion<TAB>name" lines> <the failed jobs' logs>
  local refused beside lead="scripts/ci-gate.sh $sha" relaunch rest=''
  refused=$(printf '%s\n' "$2" | perl -ne 'print "$1\n" if /^([^\t]+)\t[^\t]*\t\S+ ci-kit: .*rerun\s*$/' | sort -u)
  [[ -n $refused ]] || return 0
  [[ -n $runner ]] && lead+=" --runner $runner"
  [[ -n $class1a ]] && lead+=" --class1a $class1a"
  relaunch=$lead
  # A run on a Lane: relaunches there: the guest's own refusals (a dialog in it, a display off its geometry) included.
  [[ -n $lane ]] && relaunch+=" --lane $lane"
  [[ -n ${hosted_route:-} ]] && rest+=" --hosted-route $hosted_route"
  # A live run's groups are refused without --live (Decision Log 75), so its relaunch stays live.
  [[ -n $live ]] && rest+=" --live"
  # The peer the run checked against, resolved (its full sha) or `none`: the relaunch checks the same pair, never the
  # merge base of the moment. A peer taken exactly is named with --peer-exact: --peer would map it to another commit.
  [[ -n ${relaunch_peer:-} ]] && rest+=" ${relaunch_peer_flag:---peer} $relaunch_peer"
  relaunch+=$rest
  # A run without copies relaunches without them (ci-gate.sh admits only characters inert inside the quotes).
  [[ -n ${no_mini_copy:-} ]] && relaunch+=" --no-mini-copy '$no_mini_copy'"
  beside=$({
    printf '%s\n' "$1" | awk -F'\t' '{ sub(/ \((EC2|mini) overflow\)$/, "", $2) } $1 != "skipped" && $2 ~ /^e2e:[A-Za-z0-9._:-]+$/ { print substr($2, 5) }'
    printf '%s\n' "$default_beside" | tr ', ' '\n'
  } | awk 'NF && $0 != "default" && !seen[$0]++' | paste -sd, -)
  # The refused through the environment, since awk's -v takes no newline.
  printf '%s\n' "$1" | refused=$refused awk -F'\t' -v relaunch="$relaunch" -v copies="$lead" -v rest="$rest" -v label="$label" -v asked="$gates" -v beside="$beside" '
    # A red build skips the guest matrix before expansion, losing its group names. It is a prerequisite, not a gate:
    # relaunch the requested set, as for a refused plan, rather than omit the unnamed guest groups.
    function relaunched(job,   list, parts, n, i) {
      sub(/ \(mini copy\)$/, "", job)
      if (job ~ /^e2e: mini copy \(.+\)$/) {
        list = substr(job, 17, length(job) - 17)
        n = split(list, parts, ", ")
        for (i = 1; i <= n; i++) if (!(("e2e:" parts[i]) in guest)) { guest["e2e:" parts[i]] = 1; guests = guests " e2e:" parts[i] }
        return
      }
      sub(/ \((EC2|mini) overflow\)$/, "", job)
      if (job ~ /^e2e-build \([^)]+\)$/) { build = 1; return }
      if (job ~ /^(unit|packaged) [0-9]+\/[0-9]+$/) sub(/ [0-9]+\/[0-9]+$/, "", job)
      if (job == "docs" || job == "static-local" || job ~ /^static \/ /) job = "static"
      if (!(job in named)) { named[job] = 1; gates = gates "," job }
    }
    # The copies whose own group the main relaunch takes are left to it: its plan copies them again.
    function uncovered(list,   parts, n, i, out) {
      n = split(list, parts, " ")
      for (i = 1; i <= n; i++) if (!(parts[i] in named)) out = out "," parts[i]
      return substr(out, 2)
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
      if (gates != "") printf "relaunch the refused and the red (less any red baseline, Decision Log 58(c)): %s --gates %s%s --label %s --evidence\n",
        relaunch, substr(gates, 2), (beside != "" && index(gates ",", ",e2e:default,") ? " --default-beside " beside : ""), label
      else printf "the refused and the red are mini copies alone\n"
      guests = uncovered(guests)
      if (guests != "") printf "ci-gate: relaunch the mini copies in the guest: %s --lane vm%s --gates %s --label %s-mini --evidence\n", copies, rest, guests, label
    }'
}
