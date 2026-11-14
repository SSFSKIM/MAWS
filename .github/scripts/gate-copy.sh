#!/usr/bin/env bash
# The steps of gate.yml's e2e-copy job: the mini copies that take the guest (gate-plan.mjs), several e2e groups in one
# guest job, each group in a slot of its own.
#
#   gate-copy.sh run <slot>   one group: SCRIPT, its package script, run as the e2e job runs a guest entry's, its out/
#                             restored from the variants the job downloaded and never built (MAWS_E2E_BUILD_REQUIRE=1),
#                             in a process group of its own: Actions' step timeout ends the step's shell alone, and the
#                             orphans' cleanup comes at the job's end, so a group cut at its bound would go on running
#                             (pnpm, Playwright, Electron) beside the next. Each later slot, and the verdict, first stops
#                             whatever group a slot before it left (TERM, then KILL after REAP_GRACE seconds, 10), and a
#                             cut slot's detached strays (strays, below), and with LAUNCHD=true sweeps the e2e
#                             LaunchAgents, as the e2e job does after a group; what outlives SIGKILL fails the slot, and
#                             the verdict, keeping the record. Then the
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

# A process's identity: its start time (`ps -o lstart=`), empty once it is gone. A pid compared by it is never taken for
# a later process that reused it.
started() { LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//'; }
alive_group() { kill -0 -- "-$1" 2>/dev/null; }

# Every process a cut slot left outside its group: a private host or supervisor spawned detached, in a session and group
# of its own (src/shared/host/detached-transport.ts), which the worker's exit hook ends (e2e/support/launch.ts), and a
# SIGKILL skips. No sweep the repository has runs from the shell (processes.ts's needs the profile), so: each process
# working in this checkout or naming it or an e2e scratch root in its command line (STRAY_NAMES, space-separated:
# launch.ts's `/maws-e2e-` and `/tmp/mws-`), but this script's own ancestry, as `pid<TAB>start time` lines. The job is
# the guest's alone, so nothing else works there.
# Called in this shell (not a subshell): the readers' own processes, children of it, have gone before the identities
# are read, so none of them is taken for a stray.
strays() {
  local root real ancestors=' ' up=$$ pid candidates
  root=$PWD
  real=$(pwd -P)
  while [[ -n $up && $up -gt 1 ]]; do ancestors+="$up "; up=$(ps -o ppid= -p "$up" 2>/dev/null | tr -d ' '); done
  candidates=$({
    if [[ -d /proc/self ]]; then
      for pid in /proc/[0-9]*; do echo "${pid#/proc/} $(readlink "$pid/cwd" 2>/dev/null)"; done
    else
      lsof -nP -d cwd -Fpn 2>/dev/null | awk '/^p/ { pid = substr($0, 2) } /^n/ { print pid, substr($0, 2) }'
    fi | awk -v real="$real" -v root="$root" '{ cwd = substr($0, index($0, " ") + 1) } cwd == real || cwd == root || index(cwd, real "/") == 1 || index(cwd, root "/") == 1 { print $1 }'
    ps -axo pid=,command= | awk -v real="$real" -v root="$root" -v names="${STRAY_NAMES:-/maws-e2e- /tmp/mws-}" '
      BEGIN { n = split(names, name, " ") }
      { hit = index($0, real "/") || index($0, root "/"); for (i = 1; i <= n && !hit; i++) hit = index($0, name[i]) } hit { print $1 }'
  } | sort -un)
  for pid in $candidates; do
    [[ $ancestors == *" $pid "* ]] && continue
    up=$(started "$pid")
    [[ -n $up ]] && printf '%s\t%s\n' "$pid" "$up"
  done
  return 0
}

# TERM, then KILL what is left after REAP_GRACE seconds (10), then up to 5 s for it to go: each `pid<TAB>start` line of
# stdin, signalled only while its start time is the one read. Fails, naming the survivors, when any outlives the KILL.
stop_processes() {
  local pid when left='' i
  local -a ids=()
  while IFS=$'\t' read -r pid when; do [[ -n $pid ]] && ids+=("$pid	$when"); done
  ((${#ids[@]} > 0)) || return 0
  for signal in TERM KILL; do
    left=''
    for id in "${ids[@]}"; do
      pid=${id%%	*}
      [[ $(started "$pid") == "${id#*	}" ]] && left+=" $pid"
    done
    [[ -n $left ]] || return 0
    # shellcheck disable=SC2086 # the pids, one word each
    kill "-$signal" $left 2>/dev/null
    for ((i = 0; i < $([[ $signal == TERM ]] && echo "${REAP_GRACE:-10}" || echo 5); i++)); do
      left=''
      for id in "${ids[@]}"; do pid=${id%%	*}; [[ $(started "$pid") == "${id#*	}" ]] && left+=" $pid"; done
      [[ -n $left ]] || return 0
      sleep 1
    done
  done
  echo "gate-copy: processes outlived SIGKILL:$left" >&2
  return 1
}

# Stops what every recorded slot left running, and fails, keeping the record (a group's, or `<slot>.unstoppable`, the
# strays that survived, checked again on every later reap), when any of it outlives SIGKILL. A slot
# with no status was cut at its bound: its record's group (the leader's pid and start time, checked before any signal:
# a live leader of another start is a reused pid, not ours; a group whose leader has exited keeps its id, which no new
# process takes while the group lives), then its strays.
reap() {
  local file slot pgid when pid i failed=0
  for file in "$dir"/*.pgid; do
    [[ -f $file ]] || continue
    IFS=$'\t' read -r pgid when <"$file"
    slot=$(basename "$file" .pgid)
    if [[ $pgid =~ ^[0-9]+$ ]] && alive_group "$pgid" && { [[ -z $(started "$pgid") ]] || [[ $(started "$pgid") == "$when" ]]; }; then
      [[ -f $dir/$slot.status ]] || touch "$dir/$slot.killed"
      kill -TERM -- "-$pgid" 2>/dev/null
      for ((i = 0; i < ${REAP_GRACE:-10}; i++)); do alive_group "$pgid" || break; sleep 1; done
      if alive_group "$pgid"; then
        kill -KILL -- "-$pgid" 2>/dev/null
        for ((i = 0; i < 5; i++)); do alive_group "$pgid" || break; sleep 1; done
      fi
      if alive_group "$pgid"; then
        echo "gate-copy: slot $slot's process group $pgid outlived SIGKILL" >&2
        failed=1
        continue
      fi
      echo "gate-copy: stopped what slot $slot left running (process group $pgid)"
    fi
    if [[ ! -f $dir/$slot.status ]]; then
      strays >"$dir/$slot.strays"
      if [[ -s $dir/$slot.strays ]]; then
        if ! stop_processes <"$dir/$slot.strays"; then
          mv "$dir/$slot.strays" "$dir/$slot.unstoppable"
          failed=1
          continue
        fi
        touch "$dir/$slot.killed"
        echo "gate-copy: stopped what slot $slot left outside its group: $(cut -f1 "$dir/$slot.strays" | paste -sd' ' -)"
      fi
      rm -f "$dir/$slot.strays"
    fi
    rm -f "$file"
  done
  # Strays an earlier reap could not stop, as long as one of them is still the process it was.
  for file in "$dir"/*.unstoppable; do
    [[ -f $file ]] || continue
    slot=$(basename "$file" .unstoppable)
    while IFS=$'\t' read -r pid when; do
      if [[ -n $pid && $(started "$pid") == "$when" ]]; then
        echo "gate-copy: slot $slot left process $pid, which outlived SIGKILL" >&2
        failed=1
        continue 2
      fi
    done <"$file"
    rm -f "$file"
  done
  if [[ ${LAUNCHD:-} == true ]]; then .github/scripts/launchd-sweep.sh || failed=1; fi
  return "$failed"
}

case ${1:-} in
  run)
    slot=${2:?gate-copy.sh run <slot>}
    mkdir -p "$dir"
    reap || exit 1
    date +%s >"$dir/$slot.start"
    rm -rf playwright-report test-results
    export MAWS_E2E_BUILD_CACHE=$RUNNER_TEMP/maws-e2e-build MAWS_E2E_BUILD_KEY=${GITHUB_SHA:?} MAWS_E2E_BUILD_REQUIRE=1
    # Backgrounded without job control, the child shares this shell's group, so setsid() makes it a group's leader, the
    # group's id its pid. The record holds that pid and the leader's start time.
    # shellcheck disable=SC2016 # the inner script's own arguments
    perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!\n"; exec @ARGV or die "exec: $!\n"' \
      bash -c '.github/scripts/gate-run.sh "$1" pnpm "$SCRIPT" 2>&1 | tee "$2"; exit "${PIPESTATUS[0]}"' _ \
      '^flaky: |^ +[0-9]+ (passed|failed|flaky|skipped|interrupted|did not run)|^e2e-build: ' "$dir/$slot.log" &
    leader=$!
    printf '%s\t%s\n' "$leader" "$(started "$leader")" >"$dir/$slot.pgid"
    wait "$leader"
    status=$?
    echo "$status" >"$dir/$slot.status"
    date +%s >"$dir/$slot.end"
    exit "$status"
    ;;
  verdict)
    mkdir -p "$dir"
    reaped=0
    reap || reaped=1
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
    if ((reaped)); then echo 'mini copy: what a slot left running could not be stopped (above); the job is red'; red=1; fi
    exit "$red"
    ;;
  *) echo 'usage: gate-copy.sh run <slot> | verdict' >&2; exit 2 ;;
esac
