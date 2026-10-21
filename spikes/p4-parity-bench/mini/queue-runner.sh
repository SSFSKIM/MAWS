#!/bin/zsh
# The parity bench's MAWS arm on the Mac mini (findings.txt §7a): a serial executor that runs inside the console's
# login session, started there as a one-shot LaunchAgent (bench-queue.sh start), so each repetition's Electron app runs
# where the gate's own e2e jobs run and never in an ssh session. It takes one request at a time from QUEUE: a file
# <name>.req of KEY=VALUE lines (the bench's own keys only), renamed <name>.run while its repetition runs, which writes
# <name>.log and then <name>.done holding the exit code. It stops when QUEUE/stop appears, after the repetition in hand.
#
#   queue-runner.sh QUEUE
#
# BENCH_QUEUE_CMD replaces the bench's playwright invocation (tests only).
set -u
queue=${1:?usage: queue-runner.sh QUEUE}
repo=${BENCH_REPO:-${0:A:h:h:h:h}}
mkdir -p $queue
print -r -- $$ > $queue/runner.pid
trap 'rm -f $queue/runner.pid' EXIT
keys=(MAWS_BENCH_TASKS MAWS_BENCH_REPS MAWS_BENCH_REP_FROM MAWS_BENCH_SCOPE MAWS_BENCH_PIN MAWS_BENCH_OUT MAWS_BENCH_PROFILE MAWS_BENCH_CWD)
finish() { print -r -- $2 > $1.done.tmp && mv $1.done.tmp $1.done; }
while [[ ! -e $queue/stop ]]; do
  touch $queue/heartbeat
  reqs=($queue/*.req(N))
  if (( ${#reqs} == 0 )); then sleep 1; continue; fi
  reqs=(${(o)reqs})  # the oldest name first: bench-queue.sh names a request by its time
  base=${reqs[1]%.req}
  mv $base.req $base.run || continue
  envs=() bad=()
  while IFS= read -r line || [[ -n $line ]]; do
    [[ -z $line ]] && continue
    if (( ${keys[(Ie)${line%%=*}]} )) && [[ $line == *=* ]]; then envs+=($line); else bad+=(${line%%=*}); fi
  done < $base.run
  if (( ${#bad} )); then
    print -r -- "refused: not the bench's keys: ${bad[*]}" > $base.log
    finish $base 2
    continue
  fi
  print -r -- "$(date -u +%FT%TZ) start ${envs[*]}" >> $queue/runner.log
  if [[ -n ${BENCH_QUEUE_CMD:-} ]]; then
    (cd $repo && env MAWS_LIVE=1 MAWS_HARNESS=0 MAWS_E2E_QUIET=1 $envs /bin/zsh -c $BENCH_QUEUE_CMD) > $base.log 2>&1
  else
    (cd $repo && env MAWS_LIVE=1 MAWS_HARNESS=0 MAWS_E2E_QUIET=1 $envs node_modules/.bin/playwright test e2e/bench-edit-live.spec.ts --reporter=line) > $base.log 2>&1
  fi
  rc=$?
  print -r -- "$(date -u +%FT%TZ) done $rc ${base:t}" >> $queue/runner.log
  finish $base $rc
done
