#!/bin/zsh
# The operator's side of the MAWS arm on the Mac mini (findings.txt §7a), run on the mini over ssh. The queue runner
# lives in the console's login session; this script starts it there, hands it one repetition at a time and waits for
# the answer, so the interleaving with Desktop's repetitions stays with the operator.
#
#   bench-queue.sh plist  RUN                 render RUN/queue/queue.plist (no launchd)
#   bench-queue.sh start  RUN                 the runner bootstrapped into gui/<uid> as a one-shot LaunchAgent
#   bench-queue.sh run    RUN KEY=VALUE ...   one repetition (MAWS_BENCH_* keys; MAWS_BENCH_TASKS, MAWS_BENCH_OUT and
#                                             MAWS_BENCH_SCOPE required): submitted, waited on; prints the log's tail and
#                                             exits with the repetition's code
#   bench-queue.sh status RUN
#   bench-queue.sh stop   RUN [--force]       the runner stopped after the repetition in hand, then booted out; one still
#                                             on its repetition at BENCH_STOP_TIMEOUT is left running (it stops when the
#                                             repetition ends) and stop exits 1, unless --force boots it out then, ending
#                                             the repetition
#
# run's own exits: 2 a request refused (a required key missing; the runner refuses a key that is not the bench's with 2
# too), 124 no answer within BENCH_RUN_TIMEOUT (the repetition still running), 125 no runner, or the runner gone before
# answering; any other code is the repetition's.
# BENCH_NODE_DIR is the node the runner's PATH starts with (default: the newest ~/.nvm node 22, else this shell's);
# BENCH_RUN_TIMEOUT (s, default 1800) bounds one repetition and BENCH_STOP_TIMEOUT (s, default 1800) stop's wait;
# BENCH_LAUNCHCTL replaces launchctl (tests only).
set -u
here=${0:A:h}
label=com.ssfskim.maws-bench.queue
launchctl=${BENCH_LAUNCHCTL:-launchctl}
cmd=${1:?usage: bench-queue.sh plist|start|run|status|stop RUN ...}
run=${2:?usage: bench-queue.sh $cmd RUN ...}
run=${run:A}
queue=$run/queue
domain=gui/$(id -u)

# The runner is up when runner.pid names a live queue-runner.sh: a pid left by a runner that was killed may name another
# process by now.
alive() {
  local pid
  [[ -f $queue/runner.pid ]] && pid=$(<$queue/runner.pid) && [[ $pid == <-> ]] && [[ $(ps -o command= -p $pid 2>/dev/null) == *queue-runner.sh* ]]
}

node_dir() {
  if [[ -n ${BENCH_NODE_DIR:-} ]]; then print -r -- $BENCH_NODE_DIR; return; fi
  local nvm=(~/.nvm/versions/node/v22.*/bin(N/nOn))  # numerically: v22.18.0 before v22.9.0
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
    missing=()
    for k in MAWS_BENCH_TASKS MAWS_BENCH_OUT MAWS_BENCH_SCOPE; do (( ${argv[(I)$k=?*]} )) || missing+=($k); done
    if (( ${#missing} )); then print -r -- "refused: the request lacks ${missing[*]} (the bench would run on its defaults)"; exit 2; fi
    alive || { print -r -- "no runner in $queue (bench-queue.sh start $run)"; exit 125; }
    name=$(date -u +%Y%m%dT%H%M%S)-$$-$RANDOM
    print -rl -- "$@" > $queue/$name.tmp && mv $queue/$name.tmp $queue/$name.req
    deadline=$(( SECONDS + ${BENCH_RUN_TIMEOUT:-1800} ))
    until [[ -f $queue/$name.done ]]; do
      if ! alive; then print -r -- "the runner stopped before answering $name"; exit 125; fi
      if (( SECONDS > deadline )); then print -r -- "no answer to $name within ${BENCH_RUN_TIMEOUT:-1800} s (still running: $queue/$name.log)"; exit 124; fi
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
    force=${3:-}
    [[ -z $force || $force == --force ]] || { print -r -- "usage: bench-queue.sh stop RUN [--force]"; exit 2; }
    touch $queue/stop
    limit=${BENCH_STOP_TIMEOUT:-1800}
    deadline=$(( SECONDS + limit ))
    while alive && (( SECONDS < deadline )); do sleep 1; done
    if alive && [[ -z $force ]]; then
      print -r -- "the runner is still on its repetition after $limit s (pid $(<$queue/runner.pid)); not booted out: it stops when the repetition ends (bench-queue.sh stop $run again waits for it; stop $run --force ends it)"
      exit 1
    fi
    $launchctl bootout $domain/$label 2>/dev/null
    for i in {1..30}; do alive || break; sleep 1; done
    if alive; then print -r -- "the runner is still running after its bootout (pid $(<$queue/runner.pid))"; exit 1; fi
    print -r -- 'runner stopped' ;;
  *)
    print -r -- "unknown command $cmd"; exit 2 ;;
esac
