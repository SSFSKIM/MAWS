#!/bin/zsh
# The operator's side of the MAWS arm on the Mac mini (findings.txt §7a), run on the mini over ssh. The queue runner
# lives in the console's login session; this script starts it there, hands it one repetition at a time and waits for
# the answer, so the interleaving with Desktop's repetitions stays with the operator.
#
#   bench-queue.sh plist  RUN                 render RUN/queue/queue.plist (no launchd)
#   bench-queue.sh start  RUN                 the runner bootstrapped into gui/<uid> as a one-shot LaunchAgent
#   bench-queue.sh run    RUN KEY=VALUE ...   one repetition (MAWS_BENCH_* keys): submitted, waited on; prints the log's
#                                             tail and exits with the repetition's code
#   bench-queue.sh status RUN
#   bench-queue.sh stop   RUN                 the runner stopped after the repetition in hand, and booted out
#
# BENCH_NODE_DIR is the node the runner's PATH starts with (default: the newest ~/.nvm node 22, else this shell's);
# BENCH_RUN_TIMEOUT (s, default 1800) bounds one repetition; BENCH_LAUNCHCTL replaces launchctl (tests only).
set -u
here=${0:A:h}
label=com.ssfskim.maws-bench.queue
launchctl=${BENCH_LAUNCHCTL:-launchctl}
cmd=${1:?usage: bench-queue.sh plist|start|run|status|stop RUN ...}
run=${2:?usage: bench-queue.sh $cmd RUN ...}
run=${run:A}
queue=$run/queue
domain=gui/$(id -u)

alive() { [[ -f $queue/runner.pid ]] && kill -0 $(<$queue/runner.pid) 2>/dev/null; }

node_dir() {
  if [[ -n ${BENCH_NODE_DIR:-} ]]; then print -r -- $BENCH_NODE_DIR; return; fi
  local nvm=(~/.nvm/versions/node/v22.*/bin(N/On))
  if (( ${#nvm} )); then print -r -- ${nvm[1]}; else print -r -- ${$(command -v node):h}; fi
}

render() {
  mkdir -p $queue
  local path_value="$(node_dir):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  sed -e "s|@LABEL@|$label|g" -e "s|@RUNNER@|$here/queue-runner.sh|g" -e "s|@QUEUE@|$queue|g" -e "s|@PATH@|$path_value|g" \
    $here/queue.plist.template > $queue/queue.plist
  plutil -lint -s $queue/queue.plist
}

case $cmd in
  plist)
    render ;;
  start)
    if alive; then print -r -- "the runner is already running (pid $(<$queue/runner.pid))"; exit 0; fi
    render || exit 1
    rm -f $queue/stop
    $launchctl bootout $domain/$label 2>/dev/null
    $launchctl bootstrap $domain $queue/queue.plist || { print -r -- "launchctl bootstrap $domain refused; start the runner from a Terminal in the console session instead: /bin/zsh $here/queue-runner.sh $queue"; exit 1; }
    for i in {1..40}; do alive && [[ -f $queue/heartbeat ]] && { print -r -- "runner up (pid $(<$queue/runner.pid)) in $domain"; exit 0; }; sleep 0.5; done
    print -r -- "the runner did not start; see $queue/runner.err"; exit 1 ;;
  run)
    shift 2
    alive || { print -r -- "no runner in $queue (bench-queue.sh start $run)"; exit 1; }
    name=$(date -u +%Y%m%dT%H%M%S)-$$-$RANDOM
    print -rl -- "$@" > $queue/$name.tmp && mv $queue/$name.tmp $queue/$name.req
    deadline=$(( SECONDS + ${BENCH_RUN_TIMEOUT:-1800} ))
    until [[ -f $queue/$name.done ]]; do
      if ! alive; then print -r -- "the runner stopped before answering $name"; exit 1; fi
      if (( SECONDS > deadline )); then print -r -- "no answer to $name within ${BENCH_RUN_TIMEOUT:-1800} s (still running: $queue/$name.log)"; exit 1; fi
      sleep 1
    done
    tail -n 40 $queue/$name.log
    exit $(<$queue/$name.done) ;;
  status)
    if alive; then print -r -- "runner up (pid $(<$queue/runner.pid)), heartbeat $(( $(date +%s) - $(stat -f %m $queue/heartbeat) )) s ago"; else print -r -- 'no runner'; fi
    queued=($queue/*.req(N)) running=()
    for f in $queue/*.run(N); do [[ -f ${f%.run}.done ]] || running+=(${f:t:r}); done
    print -r -- "queued: ${#queued}; running: ${running[*]:-none}" ;;
  stop)
    touch $queue/stop
    for i in {1..900}; do alive || break; sleep 1; done
    $launchctl bootout $domain/$label 2>/dev/null
    if alive; then print -r -- "the runner is still running after 15 minutes (pid $(<$queue/runner.pid))"; exit 1; fi
    print -r -- 'runner stopped' ;;
  *)
    print -r -- "unknown command $cmd"; exit 2 ;;
esac
