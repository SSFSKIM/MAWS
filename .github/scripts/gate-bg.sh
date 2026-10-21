#!/usr/bin/env bash
# Runs static's checks at once inside its one job (tsc and eslint are single-threaded, so in series they left the box's
# other cores idle). `start` puts one gate-run.sh command in the background; a later step's `wait` streams that command's
# log as it runs, adds its gate-run summary to its own step's summary, and exits with its status, so each check keeps a
# step, a log and a summary block of its own however the runs overlap.
#
# At once only on a machine with AT_ONCE_GIB of memory or more: together the checks peak at about 15 GB (measured on the
# pool's 16-core box, which has 32), more than the hosted runner's 7 GB or the 16 GB Mac, which e2e shares, can hold.
# On a smaller machine `start` runs its command to its end before it returns, one at a time, and writes the same log,
# summary and status, so the wait steps read them as they would a background command's. The job's first start decides,
# from /proc/meminfo's MemTotal on Linux or `sysctl -n hw.memsize` on macOS, says which in its output, and the job's
# later starts keep it. GATE_BG_MEMORY, in bytes, stands in for that reading in a test.
#
#   gate-bg.sh start <name> <count-pattern> <command> [args…]
#   gate-bg.sh start-parts <name> <count-pattern> <package script>
#       each ` && ` part of a package.json script as a command of its own, <name>-1, <name>-2, …, with node_modules/.bin
#       on PATH as `pnpm run` has it; a script with any other shell operator runs whole, as <name>-1
#   gate-bg.sh wait <name>…
#       each one's log in turn (a start-parts name: each part's), then its time; exits 1 if any failed
#
# A background command outlives the step that started it (the runner ends a job's processes when the job ends). Run
# from the checkout's root. Bash 3.2 and BSD userland (a macOS runner) as well as Linux.
set -uo pipefail
dir=${RUNNER_TEMP:?}/gate-bg
mkdir -p "$dir"
here=$(dirname "$0")
AT_ONCE_GIB=24

# Sets at_once, true or false: the job's first start decides, and its later starts read the decision.
pace() {
  local bytes kib gib
  if [[ -f $dir/at-once ]]; then
    at_once=$(cat "$dir/at-once")
    return
  fi
  if [[ -n ${GATE_BG_MEMORY:-} ]]; then
    bytes=$GATE_BG_MEMORY
  elif [[ -r /proc/meminfo ]]; then
    kib=$(awk '$1 == "MemTotal:" { print $2 }' /proc/meminfo)
    case $kib in '' | *[!0-9]*) bytes='' ;; *) bytes=$((kib * 1024)) ;; esac
  else
    bytes=$(sysctl -n hw.memsize 2>/dev/null)
  fi
  at_once=false
  case $bytes in
    '' | *[!0-9]*)
      echo "gate-bg: the machine's memory could not be read, so the checks run one at a time" ;;
    *)
      gib=$(awk -v b="$bytes" 'BEGIN { printf "%.1f", b / 1073741824 }')
      if ((bytes >= AT_ONCE_GIB * 1024 * 1024 * 1024)); then
        at_once=true
        echo "gate-bg: $gib GiB of memory, $AT_ONCE_GIB or more, so the checks run at once"
      else
        echo "gate-bg: $gib GiB of memory, under $AT_ONCE_GIB, so the checks run one at a time"
      fi ;;
  esac
  echo "$at_once" >"$dir/at-once"
}

# One command through gate-run.sh, into its log, summary, status and end time; the status file appears once the rest
# is written. gate-run.sh appends to the step summary, so each command writes a file of its own, which its wait step
# appends.
run() {
  local name=$1
  shift
  GITHUB_STEP_SUMMARY=$dir/$name.summary "$here/gate-run.sh" "$@" >"$dir/$name.log" 2>&1 </dev/null
  echo "$?" >"$dir/$name.status.part"
  date +%s >"$dir/$name.end"
  mv "$dir/$name.status.part" "$dir/$name.status"
}

start() {
  local name=$1
  shift
  date +%s >"$dir/$name.start"
  if $at_once; then
    # Nothing holds the step's own output open, where the runner would wait about 5 s for it to close.
    run "$name" "$@" >/dev/null 2>&1 </dev/null &
    echo "gate-bg: $name started: ${*:2}"
  else
    run "$name" "$@"
    echo "gate-bg: $name ran in $(($(cat "$dir/$name.end") - $(cat "$dir/$name.start"))) s, exit $(cat "$dir/$name.status"): ${*:2}"
  fi
}

mode=${1:?usage: gate-bg.sh start <name> <count-pattern> <command…> | start-parts <name> <count-pattern> <script> | wait <name>…}
shift
case $mode in
  start)
    pace
    start "$@"
    ;;
  start-parts)
    pace
    name=${1:?start-parts needs a name}
    pattern=${2:?start-parts needs a count pattern}
    script=${3:?start-parts needs a package script}
    body=$(node -p "require('./package.json').scripts[process.argv[1]] ?? ''" "$script")
    [[ -n $body ]] || { echo "::error::gate-bg: package.json has no script $script"; exit 1; }
    parts=()
    rest=$body
    while [[ $rest == *' && '* ]]; do
      parts+=("${rest%% && *}")
      rest=${rest#* && }
    done
    parts+=("$rest")
    for part in "${parts[@]}"; do
      case $part in *['|;&()<>`$']*) parts=("$body"); break ;; esac
    done
    i=0
    for part in "${parts[@]}"; do
      i=$((i + 1))
      PATH=$PWD/node_modules/.bin:$PATH start "$name-$i" "$pattern" bash -c "$part"
    done
    echo "$i" >"$dir/$name.parts"
    ;;
  wait)
    names=()
    for name in "$@"; do
      if [[ -f $dir/$name.parts ]]; then
        for ((i = 1; i <= $(cat "$dir/$name.parts"); i++)); do names+=("$name-$i"); done
      else
        names+=("$name")
      fi
    done
    failed=0
    for name in "${names[@]}"; do
      if [[ ! -f $dir/$name.start ]]; then
        echo "::error::gate-bg: $name was never started"
        failed=1
        continue
      fi
      # Streams the log as it grows (BSD tail, on a macOS runner, has no --pid). The status is written once the command
      # has exited, so a read after it is seen holds the whole log.
      log=$dir/$name.log
      shown=0
      while :; do
        ended=false
        [[ -f $dir/$name.status ]] && ended=true
        size=$(wc -c <"$log")
        if ((size > shown)); then
          tail -c +$((shown + 1)) "$log" | head -c $((size - shown))
          shown=$size
        fi
        $ended && break
        sleep 1
      done
      status=$(cat "$dir/$name.status")
      [[ -f $dir/$name.summary ]] && cat "$dir/$name.summary" >>"$GITHUB_STEP_SUMMARY"
      seconds=$(($(cat "$dir/$name.end") - $(cat "$dir/$name.start")))
      if ((status == 0)); then
        echo "gate-bg: $name passed in $seconds s"
      else
        echo "gate-bg: $name failed (exit $status) in $seconds s"
        failed=1
      fi
    done
    exit "$failed"
    ;;
  *)
    echo "gate-bg: no such mode: $mode (start, start-parts or wait)" >&2
    exit 2
    ;;
esac
