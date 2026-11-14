#!/usr/bin/env bash
# The steps of gate.yml's e2e-copy job: the mini copies that take the guest (gate-plan.mjs), several e2e groups in one
# guest job, each group in a slot of its own.
#
#   gate-copy.sh run <slot>   one group: SCRIPT, its package script, run as the e2e job runs a guest entry's, its out/
#                             restored from the variants the job downloaded and never built (MAWS_E2E_BUILD_REQUIRE=1),
#                             in a process group of its own: Actions' step timeout ends the step's shell alone, and the
#                             orphans' cleanup comes at the job's end, so a group cut at its bound would go on running
#                             (pnpm, Playwright, Electron) beside the next. Each later slot, and the verdict, first stops
#                             whatever group a slot before it left (TERM, then KILL after REAP_GRACE seconds, 10), and
#                             with LAUNCHD=true sweeps the e2e LaunchAgents, as the e2e job does after a group. Then the
#                             last group's reports are cleared (its own upload has taken them). The slot's start, end,
#                             status, process group and log go under $RUNNER_TEMP/maws-copy for the verdict
#   gate-copy.sh verdict      one line per group, its slot's outcome and minutes, to the log and the step summary, then
#                             each group not green with its log's last lines (a slot that continues on error is not
#                             among the failed steps whose logs ci-gate.sh prints, this step is); exit 1 when any group
#                             is not green. A slot with no status was cut at its bound, which its line says, with
#                             whether its processes had to be stopped. COPY_GROUPS the job's groups (`a, b`), OUTCOMES
#                             its slots' outcomes in order, space-separated
set -uo pipefail
dir=${RUNNER_TEMP:?}/maws-copy

# Stops every recorded slot's process group still alive. A slot that left one without a status was cut at its bound.
reap() {
  local file slot pgid i
  for file in "$dir"/*.pgid; do
    [[ -f $file ]] || continue
    pgid=$(<"$file")
    slot=$(basename "$file" .pgid)
    if [[ $pgid =~ ^[0-9]+$ ]] && kill -0 -- "-$pgid" 2>/dev/null; then
      [[ -f $dir/$slot.status ]] || touch "$dir/$slot.killed"
      kill -TERM -- "-$pgid" 2>/dev/null
      for ((i = 0; i < ${REAP_GRACE:-10}; i++)); do kill -0 -- "-$pgid" 2>/dev/null || break; sleep 1; done
      kill -KILL -- "-$pgid" 2>/dev/null
      echo "gate-copy: stopped what slot $slot left running (process group $pgid)"
    fi
    rm -f "$file"
  done
  if [[ ${LAUNCHD:-} == true ]]; then .github/scripts/launchd-sweep.sh; fi
}

case ${1:-} in
  run)
    slot=${2:?gate-copy.sh run <slot>}
    mkdir -p "$dir"
    reap || exit 1
    date +%s >"$dir/$slot.start"
    rm -rf playwright-report test-results
    export MAWS_E2E_BUILD_CACHE=$RUNNER_TEMP/maws-e2e-build MAWS_E2E_BUILD_KEY=${GITHUB_SHA:?} MAWS_E2E_BUILD_REQUIRE=1
    # Backgrounded without job control, the child shares this shell's group, so setsid() makes it a group's leader.
    # shellcheck disable=SC2016 # the inner script's own arguments
    perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!\n"; open(my $f, ">", shift) or die "pgid: $!\n"; print $f "$$\n"; close $f; exec @ARGV or die "exec: $!\n"' \
      "$dir/$slot.pgid" bash -c '.github/scripts/gate-run.sh "$1" pnpm "$SCRIPT" 2>&1 | tee "$2"; exit "${PIPESTATUS[0]}"' _ \
      '^flaky: |^ +[0-9]+ (passed|failed|flaky|skipped|interrupted|did not run)|^e2e-build: ' "$dir/$slot.log" &
    wait "$!"
    status=$?
    echo "$status" >"$dir/$slot.status"
    date +%s >"$dir/$slot.end"
    exit "$status"
    ;;
  verdict)
    mkdir -p "$dir"
    reap
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
      if [[ -f $dir/$slot.start && ! -f $dir/$slot.status ]]; then
        outcome+=", cut at its bound$(if [[ -f $dir/$slot.killed ]]; then echo ', its processes stopped'; fi)"
      fi
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
