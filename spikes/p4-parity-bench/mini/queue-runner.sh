#!/bin/zsh
# The parity bench's MAWS arm on the Mac mini (findings.txt §7a): a serial executor that runs inside the console's
# login session, started there as a one-shot LaunchAgent (bench-queue.sh start), so each repetition's Electron app runs
# where the gate's own e2e jobs run and never in an ssh session. It takes one request at a time from QUEUE: a file
# <name>.req of KEY=VALUE lines (the bench's own keys only), renamed <name>.run while its repetition runs, which writes
# <name>.log and then <name>.done holding the exit code. It stops when QUEUE/stop appears, after the repetition in hand.
# On TERM or INT (bench-queue.sh stop --force's bootout) it ends the repetition in hand and removes its runner.pid: zsh
# runs no EXIT trap on a signal and defers a trap while a foreground child runs, so the repetition runs in the background
# and the runner waits on it.
#
#   queue-runner.sh QUEUE
#
# BENCH_QUEUE_CMD replaces the bench's playwright invocation (tests only).
set -u
queue=${1:?usage: queue-runner.sh QUEUE}
repo=${BENCH_REPO:-${0:A:h:h:h:h}}
mkdir -p $queue
print -r -- $$ > $queue/runner.pid
child=
trap 'rm -f $queue/runner.pid' EXIT
trap '[[ -n $child ]] && kill -TERM $child 2>/dev/null; rm -f $queue/runner.pid; exit 143' TERM INT
keys=(MAWS_BENCH_TASKS MAWS_BENCH_REPS MAWS_BENCH_REP_FROM MAWS_BENCH_SCOPE MAWS_BENCH_PIN MAWS_BENCH_OUT MAWS_BENCH_PROFILE MAWS_BENCH_CWD MAWS_BENCH_VARIANT)
# P4-A3: MAWS_BENCH_REPO=<checkout> runs the request in another of the bench's checkouts (a lever's build beside the base
# one, their repetitions interleaved through this one runner); it is where the repetition runs, not a key it reads
finish() { print -r -- $2 > $1.done.tmp && mv $1.done.tmp $1.done; }
while [[ ! -e $queue/stop ]]; do
  touch $queue/heartbeat
  reqs=($queue/*.req(N))
  if (( ${#reqs} == 0 )); then sleep 1; continue; fi
  reqs=(${(o)reqs})  # the oldest name first: bench-queue.sh names a request by its time
  base=${reqs[1]%.req}
  mv $base.req $base.run || continue
  envs=() bad=() at=$repo
  while IFS= read -r line || [[ -n $line ]]; do
    [[ -z $line ]] && continue
    if [[ $line == MAWS_BENCH_REPO=* ]]; then at=${line#MAWS_BENCH_REPO=}
    elif (( ${keys[(Ie)${line%%=*}]} )) && [[ $line == *=* ]]; then envs+=($line); else bad+=(${line%%=*}); fi
  done < $base.run
  if (( ${#bad} )); then
    print -r -- "refused: not the bench's keys: ${bad[*]}" > $base.log
    finish $base 2
    continue
  fi
  if [[ $at != $repo && ! -f $at/e2e/bench-edit-live.spec.ts ]]; then
    print -r -- "refused: MAWS_BENCH_REPO $at is not a checkout of the bench (no e2e/bench-edit-live.spec.ts)" > $base.log
    finish $base 2
    continue
  fi
  where=; [[ $at != $repo ]] && where=" in $at"
  print -r -- "$(date -u +%FT%TZ) start ${envs[*]}$where" >> $queue/runner.log
  if [[ -n ${BENCH_QUEUE_CMD:-} ]]; then
    (cd $at && env MAWS_LIVE=1 MAWS_HARNESS=0 MAWS_E2E_QUIET=1 $envs /bin/zsh -c $BENCH_QUEUE_CMD) > $base.log 2>&1 &
  else
    (cd $at && env MAWS_LIVE=1 MAWS_HARNESS=0 MAWS_E2E_QUIET=1 $envs node_modules/.bin/playwright test e2e/bench-edit-live.spec.ts --reporter=line) > $base.log 2>&1 &
  fi
  child=$!
  wait $child
  rc=$?
  child=
  print -r -- "$(date -u +%FT%TZ) done $rc ${base:t}" >> $queue/runner.log
  finish $base $rc
done
