#!/usr/bin/env bash
# The steps of gate.yml's e2e-copy job: the mini copies that take the guest (gate-plan.mjs), several e2e groups in one
# guest job, each group in a slot of its own.
#
#   gate-copy.sh run <slot>   one group: SCRIPT, its package script, run as the e2e job runs a guest entry's, its out/
#                             restored from the variants the job downloaded and never built (MAWS_E2E_BUILD_REQUIRE=1).
#                             The last group's reports are cleared first (its own upload has taken them), and with
#                             LAUNCHD=true the e2e LaunchAgents a group before it left are swept. The slot's start and end
#                             go under $RUNNER_TEMP/maws-copy for the verdict, with its log
#   gate-copy.sh verdict      one line per group, its slot's outcome and minutes, to the log and the step summary, then
#                             each group not green with its log's last lines (a slot that continues on error is not
#                             among the failed steps whose logs ci-gate.sh prints, this step is); exit 1 when any group
#                             is not green. COPY_GROUPS the job's groups (`a, b`), OUTCOMES its slots'
#                             outcomes in order, space-separated
set -uo pipefail
dir=${RUNNER_TEMP:?}/maws-copy

case ${1:-} in
  run)
    slot=${2:?gate-copy.sh run <slot>}
    mkdir -p "$dir"
    date +%s >"$dir/$slot.start"
    trap 'date +%s >"$dir/$slot.end"' EXIT
    rm -rf playwright-report test-results
    if [[ ${LAUNCHD:-} == true ]]; then .github/scripts/launchd-sweep.sh || exit 1; fi
    export MAWS_E2E_BUILD_CACHE=$RUNNER_TEMP/maws-e2e-build MAWS_E2E_BUILD_KEY=${GITHUB_SHA:?} MAWS_E2E_BUILD_REQUIRE=1
    .github/scripts/gate-run.sh '^flaky: |^ +[0-9]+ (passed|failed|flaky|skipped|interrupted|did not run)|^e2e-build: ' pnpm "${SCRIPT:?}" 2>&1 | tee "$dir/$slot.log"
    exit "${PIPESTATUS[0]}"
    ;;
  verdict)
    IFS=, read -ra groups <<<"${COPY_GROUPS:?}"
    read -ra outcomes <<<"${OUTCOMES:-}"
    now=$(date +%s)
    red=0
    lines=()
    for i in "${!groups[@]}"; do
      group=${groups[i]//[[:space:]]/}
      slot=$((i + 1))
      outcome=${outcomes[i]:-skipped}
      minutes=''
      if [[ -f $dir/$slot.start ]]; then
        start=$(<"$dir/$slot.start")
        # A slot cut at its bound may leave no end: the next slot's start, else now, bounds it.
        if [[ -f $dir/$slot.end ]]; then end=$(<"$dir/$slot.end")
        elif [[ -f $dir/$((slot + 1)).start ]]; then end=$(<"$dir/$((slot + 1)).start")
        else end=$now; fi
        minutes=$(((end - start + 30) / 60))
      fi
      [[ $outcome == success ]] || red=1
      lines+=("e2e:$group	$outcome	${minutes:-not started}")
      echo "mini copy: e2e:$group $outcome${minutes:+ in $minutes min}"
    done
    for i in "${!groups[@]}"; do
      slot=$((i + 1))
      [[ ${outcomes[i]:-skipped} != success && -s $dir/$slot.log ]] || continue
      echo "mini copy: e2e:${groups[i]//[[:space:]]/}, the last lines of its log:"
      sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$dir/$slot.log" | tail -40
    done
    {
      echo '#### Mini copies'
      echo
      echo '| group | result | minutes |'
      echo '| --- | --- | --- |'
      for line in "${lines[@]}"; do IFS=$'\t' read -r group outcome minutes <<<"$line"; echo "| $group | $outcome | $minutes |"; done
    } >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
    exit "$red"
    ;;
  *) echo 'usage: gate-copy.sh run <slot> | verdict' >&2; exit 2 ;;
esac
