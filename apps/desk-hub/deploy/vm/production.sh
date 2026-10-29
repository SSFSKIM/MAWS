#!/bin/bash
# The endpoint acceptance run's production scene on the devcloud acceptance VM (P5 O10 M11's part 2, acceptance item
# 7): the verbs endpoint-production.ts's machine asks of the VM's real, cut-over `mawsd` (the owner's, port 47830,
# run as the user `new` by its systemd user unit), with the same words as scene.sh's so the items read them alike.
# DRAFT: part 1 wrote it and never ran it; part 2's setup installs it as /opt/o10-m11/production.sh once the owner
# has approved what it does. It changes nothing but what an item changes and restores (the endpoint's policy), a
# `mawsd restart` the unit brings back, and the daemon's hub sockets cut by force (ss -K), as item 2 asks.
#
# Lane A here is the open question part 2 settles first (task-11-report.md): the cut-over sminos on this machine is the
# owner's own, so a session under it is the owner's, and no engine may start with the owner's credentials. Until it is
# settled, `lane-a-up` refuses, and so does every verb that needs the session.
set -uo pipefail
OWNER=new
OH=/Users/new
CUR=$OH/.local/share/maws/mawsd/current
DIR=$OH/.config/MAWS/mawsd
SMINOS_HOME_OWNER=$OH/.claude/sminos
say() { printf '%s\n' "$*"; }
fail() { say "production.sh: $*"; exit 1; }
word() { [[ $1 =~ ^[A-Za-z0-9._:/=@+-]+$ ]] || fail "a word, not '$1'"; }
uid=$(id -u $OWNER) || fail "no user $OWNER"
as_owner() { runuser -u $OWNER -- env -i HOME=$OH USER=$OWNER LOGNAME=$OWNER PATH=$CUR/runtime/bin:/usr/bin:/bin LANG=C.UTF-8 XDG_RUNTIME_DIR=/run/user/$uid "$@"; }
mawsd_cli() { as_owner $CUR/runtime/bin/node $CUR/out/main/mawsd.js "$@"; }
pid() { pgrep -u $OWNER -f "$CUR/.*mawsd.js run" | head -1; }
logfile() { case $1 in mawsd) say $DIR/mawsd.log ;; sminos) say $SMINOS_HOME_OWNER/daemon.log ;; *) fail "a log: mawsd or sminos" ;; esac; }
no_lane_a() { fail "lane A in production is not settled (see the M11 report): $1 refused"; }

verb=${1:-}; (($#)) && shift
case $verb in
  check) say "mawsd: pid $(pid || echo none)"; mawsd_cli endpoint status --json ;;
  up) [[ -n $(pid) ]] || fail "the production mawsd is not running"; say "up: the production mawsd runs (pid $(pid)); nothing started" ;;
  enroll) fail "production enrolls nothing: its machine is cut over and listed already" ;;
  mawsd)
    for a in "$@"; do word "$a"; done
    case "${1:-} ${2:-}" in
      "keys --json" | "endpoint status" | "endpoint policy") mawsd_cli "$@" ;;
      *) fail "production.sh mawsd runs keys --json, endpoint status and endpoint policy only" ;;
    esac ;;
  restart)
    before=$(pid); mawsd_cli restart >/dev/null 2>&1
    for _ in $(seq 120); do p=$(pid); [[ -n $p && $p != "$before" ]] && mawsd_cli endpoint status --json >/dev/null 2>&1 && { say "restarted: pid $before -> $p"; exit 0; }; sleep 1; done
    fail "the production mawsd did not come back within 120 s" ;;
  cut-hub)
    p=$(pid); [[ -n $p ]] || fail "the production mawsd is not running"
    n=$(ss -tnpH state established '( dport = :443 )' | grep -c "pid=$p,") || n=0
    ss -K -tnp state established '( dport = :443 )' 2>/dev/null | grep -q "pid=$p," || true
    say "cut $n hub socket(s) of pid $p" ;;
  listening) p=$(pid); ss -ltnpH | grep "pid=$p," | awk '{print $4}' ;;
  log-size) f=$(logfile "${1:-}") || exit 1; stat -c %s "$f" 2>/dev/null || echo 0 ;;
  log-since) f=$(logfile "${1:-}") || exit 1; [[ ${2:-} =~ ^[0-9]+$ ]] || fail "a byte offset"; tail -c +$(($2 + 1)) "$f" 2>/dev/null ;;
  sminos-revoked) if [[ -f $SMINOS_HOME_OWNER/daemon/revoked.json ]]; then python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))))' $SMINOS_HOME_OWNER/daemon/revoked.json; else say none; fi ;;
  lane-a-up | lane-a-stop | lane-a-resume | transcript | sminos-status | local-spawn | retire) no_lane_a "$verb" ;;
  down) say "down: nothing of the run's to end on the production machine" ;;
  *) fail "production.sh check | up | mawsd <keys|endpoint …> | restart | cut-hub | listening | log-size <log> | log-since <log> <bytes> | sminos-revoked | down" ;;
esac
