#!/usr/bin/env bash
# Runs static's checks at once inside its one job (tsc and eslint are single-threaded, so in series they left the box's
# other cores idle). `start` puts one gate-run.sh command in the background; a later step's `wait` streams that command's
# log as it runs, adds its gate-run summary to its own step's summary, and exits with its status, so each check keeps a
# step, a log and a summary block of its own however the runs overlap.
#
#   gate-bg.sh start <name> <count-pattern> <command> [args…]
#   gate-bg.sh start-parts <name> <count-pattern> <package script>
#       each ` && ` part of a package.json script as a command of its own, <name>-1, <name>-2, …, with node_modules/.bin
#       on PATH as `pnpm run` has it; a script with any other shell operator runs whole, as <name>-1
#   gate-bg.sh wait <name>…
#       each one's log in turn (a start-parts name: each part's), then its time; exits 1 if any failed
#
# A background command outlives the step that started it (the runner ends a job's processes when the job ends). Run
# from the checkout's root.
set -uo pipefail
dir=${RUNNER_TEMP:?}/gate-bg
mkdir -p "$dir"
here=$(dirname "$0")

start() {
  local name=$1
  shift
  date +%s >"$dir/$name.start"
  # gate-run.sh appends to the step summary; each command writes its own file, which its wait step appends. Nothing
  # holds the step's own output open, where the runner would wait about 5 s for it to close.
  (
    GITHUB_STEP_SUMMARY=$dir/$name.summary "$here/gate-run.sh" "$@" >"$dir/$name.log" 2>&1 </dev/null
    echo "$?" >"$dir/$name.status.part"
    date +%s >"$dir/$name.end"
    mv "$dir/$name.status.part" "$dir/$name.status"
  ) >/dev/null 2>&1 </dev/null &
  echo "gate-bg: $name started: ${*:2}"
}

mode=${1:?usage: gate-bg.sh start <name> <count-pattern> <command…> | start-parts <name> <count-pattern> <script> | wait <name>…}
shift
case $mode in
  start)
    start "$@"
    ;;
  start-parts)
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
