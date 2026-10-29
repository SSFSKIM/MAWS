#!/bin/bash
# The endpoint acceptance run's production scene on the devcloud acceptance VM (P5 O10 M11's part 2, acceptance item
# 7): the verbs endpoint-production.ts's machine asks of the VM's real, cut-over `mawsd` (the owner's, port 47830, run
# as the user `new` by its systemd user unit), in scene.sh's words so the items read them alike. setup.sh installs it
# as /opt/o10-m11/production.sh; only the production run calls it. What it may change is what production's allowlist
# allows (endpoint-items.ts's PRODUCTION_CLAUSES): the endpoint's policy (the items restore it), a `mawsd restart` the
# unit brings back, the daemon's own sockets to the hub cut by their tuples, and the run's lane A session.
#
# Lane A (the owner's ruling, 2026-10-28): the VM's sminos runs as the owner's user, so the run's session does too, under
# that sminos (SMINOS_HOME=$SH). It is a `claude` against the stub model on 127.0.0.1 (no credential, no spend), started
# under `env -i` with a scratch CLAUDE_CONFIG_DIR ($X/claude) that holds the sminos plugin alone, inside a private mount
# namespace whose /etc/claude-code is an empty tmpfs; `down` ends it and removes $X. Of the owner's processes this reads
# only which are claude's (their executable and terminal, never their arguments) and, for a seat the run spawned, the
# two environment variables local-spawn names.
set -uo pipefail
OWNER=new
OH=/Users/new
CUR=$OH/.local/share/maws/mawsd/current
DIR=$OH/.config/MAWS/mawsd
SH=$OH/.claude/sminos                 # the VM's own sminos home
O=/opt/o10-m11
X=$OH/.local/share/o10-m11-lane-a     # the run's scratch: claude/ (the config dir), work/ (the checkout), run/
R=$X/run
W=$X/work
PLUGIN=$X/claude/plugins/sminos
STUB_PORT=47899
STUB_URL=http://127.0.0.1:$STUB_PORT
CLAUDE=$O/bin/claude
SMINOS=$O/bin/sminos
TX=o10-m11-prod
say() { printf '%s\n' "$*"; }
fail() { say "production.sh: $*"; exit 1; }
word() { [[ $1 =~ ^[A-Za-z0-9._:/=@+-]+$ ]] || fail "a word, not '$1'"; }
within() { local s=$1 i; shift; for ((i = 0; i < s * 2; i++)); do "$@" && return 0; sleep 0.5; done; return 1; }

# Every verb but check and down registers its pid in $VERBS while it runs: the run's end kills a step's local ssh,
# which is no proof that this script stopped on the VM, so down stops a verb still running here, its whole process
# tree frozen first so nothing forks past it, and says LEFT for one it could not.
VERBS=/run/o10-m11-production-verbs
register() { install -d -m 700 $VERBS && say "$1" >$VERBS/$$ && trap 'rm -f $VERBS/$$' EXIT; }
# Pid $1 and every process beneath it.
tree() { ps -e -o pid=,ppid= | awk -v root="$1" '{ parent[$1] = $2 } END { for (p in parent) { q = p; while (q in parent && q != root && q > 1) q = parent[q]; if (q == root) print p } }'; }
stop_verbs() {
  local f p what pids left=0
  for f in "$VERBS"/*; do
    [[ -f $f ]] || continue
    p=${f##*/}; what=$(cat "$f" 2>/dev/null)
    [[ $p == "$$" ]] && continue
    if ! tr '\0' ' ' </proc/"$p"/cmdline 2>/dev/null | grep -qF -- "/opt/o10-m11/production.sh "; then rm -f "$f"; continue; fi # ended, or another process now
    for _ in 1 2 3; do pids=$(tree "$p"); [[ -n $pids ]] && kill -STOP $pids 2>/dev/null; done
    pids=$(tree "$p"); [[ -n $pids ]] && kill -KILL $pids 2>/dev/null
    if within 5 bash -c "! kill -0 $p 2>/dev/null"; then
      say "stopped the verb $what (pid $p), still running when the run ended"; rm -f "$f"
    else
      say "LEFT the verb $what (pid $p) running on the VM"; left=1
    fi
  done
  return $left
}
pid() { pgrep -u $OWNER -f "$CUR/.*mawsd.js run" | head -1; }
logfile() { case $1 in mawsd) say $DIR/mawsd.log ;; sminos) say $SH/daemon.log ;; *) fail "a log: mawsd or sminos" ;; esac; }

as_owner() { runuser -u $OWNER -- env -i "${OWNER_ENV[@]}" "$@"; }
mawsd_cli() { as_owner $CUR/runtime/bin/node $CUR/out/main/mawsd.js "$@"; }
anchor() { local p; p=$(cat $R/anchor.pid 2>/dev/null) && [[ -d /proc/$p ]] && [[ $(readlink /proc/"$p"/ns/mnt) != "$(readlink /proc/1/ns/mnt)" ]] && say "$p"; }
inns() { local p; p=$(anchor) || fail "no lane A namespace: run lane-a-up first"; nsenter --mount=/proc/"$p"/ns/mnt -- "$@"; }
# A command as the owner in the lane A namespace, in the session's environment alone.
as_session() { inns runuser -u $OWNER -- env -i "${SESSION_ENV[@]}" "$@"; }

# The established sockets to :443 of process $1, each cut by its own four-tuple (src and dst), never by port alone: the
# VM's other processes (sminos, the gateway, sessions) hold sockets to :443 too. Prints how many it cut; fails when one
# of them is still there.
cut_tuples() {
  local pid=$1 n=0 here there t
  local -a tuples=()
  mapfile -t tuples < <(ss -tnpH state established '( dport = :443 )' | grep -F "pid=$pid," | awk '{print $3, $4}')
  for t in "${tuples[@]}"; do
    read -r here there <<<"$t"
    [[ -n $here && -n $there ]] || continue
    ss -K -tnH state established "( src $here and dst $there )" >/dev/null || fail "ss -K failed on $here -> $there"
    [[ -z $(ss -tnH state established "( src $here and dst $there )") ]] || fail "the socket $here -> $there is still there"
    n=$((n + 1))
  done
  say $n
}

# ---- what the run calls its own --------------------------------------------------------------------------------------
# A process is the run's only inside the run's private mount namespace: nothing but this script's verbs enters it, so
# every process there descends from them. The selection is pure, over tables read from /proc (the suite,
# test/deploy/production-scene.test.ts, sources this script and feeds them); of the owner's other processes only their
# executable and their namespace are read, never their arguments or environment.

# Why the session engine described on stdin (`KEY=value` lines: CLAUDE_CONFIG_DIR, ANTHROPIC_BASE_URL, cwd, ns) is not
# the run's lane A session, one line a reason; none, status 0, when it is ($1: the run's namespace).
session_problems() {
  local ours=$1 line cfg='' base='' cwd='' ns='' bad=0
  while IFS= read -r line; do
    case $line in CLAUDE_CONFIG_DIR=*) cfg=${line#*=} ;; ANTHROPIC_BASE_URL=*) base=${line#*=} ;; cwd=*) cwd=${line#*=} ;; ns=*) ns=${line#*=} ;; esac
  done
  [[ $cfg == "$X/claude" ]] || { say "CLAUDE_CONFIG_DIR is ${cfg:-unset}, not $X/claude"; bad=1; }
  [[ $base == "$STUB_URL" ]] || { say "ANTHROPIC_BASE_URL is ${base:-unset}, not $STUB_URL"; bad=1; }
  [[ $cwd == "$W" ]] || { say "its directory is ${cwd:-unknown}, not $W"; bad=1; }
  [[ $ns == "$ours" ]] || { say "it runs outside the run’s namespace (${ns:-unknown})"; bad=1; }
  return $bad
}
# The pids of the `pid ns` lines on stdin outside namespace $1: claude processes the run cannot call its own.
foreign() { local ours=$1 p ns; while read -r p ns; do [[ -n $p && $ns != "$ours" ]] && say "$p"; done; return 0; }
# The seat's session as `sminos spawn` printed it (`seat spawned: <group>/<alias>  [<short> / <session>] …`).
seat_session() { local id; id=$(sed -n 's|^seat [a-z-]*: .*\[[0-9a-z]* / \([0-9a-f-]\{36\}\)\].*|\1|p' | tail -1); [[ -n $id ]] && say "$id"; }
# The claude processes a spawn brought (`pid ns [KEY=value…]` lines on stdin), each `ours` (in namespace $1, with the
# scratch config and the stub), `kill` (in it, with another environment) or `foreign` (outside it: not the run's to
# kill); status 0 only when there is at least one and every one is `ours`.
seat_verdict() {
  local ours=$1 p ns rest n=0 ok=1
  while read -r p ns rest; do
    [[ -n $p ]] || continue
    n=$((n + 1))
    if [[ $ns != "$ours" ]]; then
      say "foreign $p"; ok=0
    elif [[ " $rest " == *" CLAUDE_CONFIG_DIR=$X/claude "* && " $rest " == *" ANTHROPIC_BASE_URL=$STUB_URL "* ]]; then
      say "ours $p"
    else
      say "kill $p"; ok=0
    fi
  done
  ((n > 0 && ok == 1))
}

ns_of() { readlink /proc/"$1"/ns/mnt 2>/dev/null; }
ours_ns() { local a; a=$(anchor) && ns_of "$a"; }
# `pid ns` of every process of the owner's that runs a claude binary (the installed versions, or the run's copy).
claude_table() {
  local p comm exe
  while read -r p comm; do
    exe=$(readlink /proc/"$p"/exe 2>/dev/null) || continue
    case $exe in "$OH"/.local/share/claude/versions/* | "$CLAUDE") ;; *) [[ $comm == claude ]] || continue ;; esac
    say "$p $(ns_of "$p")"
  done < <(ps -u $OWNER -o pid=,comm=)
}
# The two variables the ruling lets the run read of a claude process of its own.
two_vars() { tr '\0' '\n' </proc/"$1"/environ 2>/dev/null | grep -E '^(CLAUDE_CONFIG_DIR|ANTHROPIC_BASE_URL)=' | sort; }
# Kills the pids given that are still in the run's namespace (a pid read earlier may since be another process's).
kill_ours() { local ours p; ours=$(ours_ns) || return 0; for p in "$@"; do [[ $(ns_of "$p") == "$ours" ]] && kill -KILL "$p" 2>/dev/null; done; return 0; }

# ---- lane A -----------------------------------------------------------------------------------------------------------

gone() { ! test -S "$1"; }

lane_a_up() {
  local project=$1 name=$2 org sid launch alias
  [[ $project =~ ^[0-9a-f-]{36}$ ]] || fail "a project id"; word "$name"
  [[ -f $SH/daemon/identity.json ]] || fail "the VM's sminos is not cut over to its endpoint (no daemon/identity.json)"
  [[ -x $CLAUDE && -x $SMINOS && -f $O/sminos/.claude-plugin/plugin.json ]] || fail "no claude or sminos in $O: run setup.sh first"
  lane_a_down >/dev/null 2>&1
  [[ -z $(ss -ltnH "( sport = :$STUB_PORT )") ]] || fail "port $STUB_PORT is taken: the stub model cannot listen there"
  install -d -m 700 -o $OWNER -g $OWNER $X $R $W $X/claude $X/claude/plugins
  cp -R $O/sminos $PLUGIN && chown -R $OWNER:$OWNER $X || fail "the scratch config dir"
  # The namespace's anchor: a sleep whose mount namespace has /etc/claude-code as an empty tmpfs (propagation private,
  # so the host's mount table never sees it). Every process of the session is started inside it.
  setsid -f unshare -m --propagation private sh -c "mount -t tmpfs -o mode=755,size=1m tmpfs /etc/claude-code && echo \$\$ > $R/anchor.pid && exec sleep infinity" </dev/null >/dev/null 2>&1
  within 10 anchor >/dev/null || fail "the lane A namespace did not come up"
  [[ -z $(inns ls -A /etc/claude-code) ]] || fail "the namespace still shows /etc/claude-code's files"
  inns setsid -f runuser -u $OWNER -- env -i "${SESSION_ENV[@]}" $CUR/runtime/bin/node $O/stub-model.mjs --port $STUB_PORT </dev/null >>$R/stub.log 2>&1
  within 20 bash -c "exec 3<>/dev/tcp/127.0.0.1/$STUB_PORT" 2>/dev/null || fail "the stub model did not listen"
  org=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["org"])' $SH/daemon/identity.json) || fail "identity.json names no org"
  as_session git -c init.defaultBranch=main init -q $W || fail "git init"
  as_session python3 -c 'import json,sys; json.dump({"project": sys.argv[2], "name": sys.argv[3], "hub": {"org": sys.argv[4]}}, open(sys.argv[1], "w"))' $W/.smns "$project" "$name" "$org"
  as_session bash -c "cd $W && git add .smns && git -c user.name=o10-m11 -c user.email=o10-m11@scene.invalid commit -qm scene"
  as_session python3 -c 'import json,sys; w=sys.argv[2]; json.dump({"hasCompletedOnboarding": True, "projects": {w: {"hasTrustDialogAccepted": True}}}, open(sys.argv[1], "w"))' $X/claude/.claude.json $W
  as_session python3 -c 'import json,sys; json.dump({"permissions": {"allow": ["Bash(echo:*)"]}}, open(sys.argv[1], "w"))' $X/claude/settings.json
  sid=$(cat /proc/sys/kernel/random/uuid) && say "$sid" >$R/session || fail "no session id"
  start_session "$sid" new
  launch=$(bridge_launch "$sid") || fail "the bridge answered no launch"
  alias=$(as_session bash -c "cd $W && $SMINOS list --here --json" | python3 -c '
import json, sys
def walk(x):
    if isinstance(x, dict):
        if sys.argv[1] in x.values() and isinstance(x.get("alias"), str):
            yield x["alias"]
        for v in x.values():
            yield from walk(v)
    elif isinstance(x, list):
        for v in x:
            yield from walk(v)
print(next(walk(json.load(sys.stdin)), ""))' "$sid") || alias=
  [[ -n $alias ]] || fail "sminos lists no alias for $sid"
  python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1], "launch": sys.argv[2], "org": sys.argv[3], "alias": sys.argv[4], "checkout": sys.argv[5]}))' "$sid" "$launch" "$org" "$alias" "$W"
}

# The session in its tmux pane (its own server, -L $TX), in the namespace: a new one under the session id the run
# chose (`--session-id`), so no session of the owner's can be taken for it; `--resume <sid>` to start it again. Its
# bridge waited for, then its engine checked to be the run's (session_problems) before anything uses it.
start_session() {
  local sid=$1 how=$2 flags=(--plugin-dir "$PLUGIN" --model sonnet -n o10-m11-lane-a)
  [[ $sid =~ ^[0-9a-f-]{36}$ ]] || fail "a session id"
  if [[ $how == resume ]]; then flags+=(--resume "$sid"); else flags+=(--session-id "$sid"); fi
  as_session tmux -L $TX new-session -d -s lane-a -x 200 -y 50 -c $W "$CLAUDE ${flags[*]}" || fail "tmux"
  within 120 test -S "$SH/bridge/$sid.sock" || { pane; fail "no bridge for $sid within 120 s"; }
  check_engine "$sid"
}
# The pane's claude: in the run's namespace, with the scratch config, the stub and the checkout; else lane A fails.
check_engine() {
  local pane engine ours problems
  ours=$(ours_ns) || fail "no lane A namespace"
  pane=$(as_session tmux -L $TX list-panes -t lane-a -F '#{pane_pid}' 2>/dev/null | head -1)
  [[ -n $pane ]] || fail "no lane A pane"
  engine=$(claude_table | awk '{print $1}' | grep -xF -f <(tree "$pane") | head -1)
  [[ -n $engine ]] || fail "no claude under the lane A pane"
  problems=$({ two_vars "$engine"; say "cwd=$(readlink /proc/"$engine"/cwd)"; say "ns=$(ns_of "$engine")"; } | session_problems "$ours") ||
    fail "the session on $1's bridge is not the run's: ${problems//$'\n'/; }"
}
pane() { say "the pane, last lines:"; as_session tmux -L $TX capture-pane -p -t lane-a 2>/dev/null | grep -v '^\s*$' | tail -15; }

bridge_launch() { as_owner curl -sf --max-time 5 --unix-socket "$SH/bridge/$1.sock" http://bridge/status | python3 -c 'import json,sys; print(json.load(sys.stdin)["launch"])'; }

lane_a_stop() {
  local sid; sid=$(cat $R/session) || fail "no session"
  as_session tmux -L $TX kill-session -t lane-a 2>/dev/null
  within 30 gone "$SH/bridge/$sid.sock" || fail "the bridge did not go within 30 s"
  say "the session's engine ended"
}

lane_a_resume() {
  local sid; sid=$(cat $R/session) || fail "no session to resume"
  start_session "$sid" resume
  python3 -c 'import json,sys; print(json.dumps({"launch": sys.argv[1]}))' "$(bridge_launch "$sid")"
}

transcript() {
  local sid=$1 file
  [[ $sid =~ ^[0-9a-f-]{36}$ ]] || fail "a session id"
  [[ -z ${2:-} || $2 =~ ^[a-z0-9-]{4,64}$ ]] || fail "a marker token ([a-z0-9-])"
  file=$(find $X/claude/projects -name "$sid.jsonl" 2>/dev/null | head -1)
  [[ -n $file ]] || fail "no transcript for $sid"
  python3 -c '
import json, sys
count, kinds = 0, []
for line in open(sys.argv[1], encoding="utf-8"):
    try:
        row = json.loads(line)
    except ValueError:
        continue
    if not isinstance(row, dict) or not isinstance(row.get("uuid"), str) or not row["uuid"]:
        continue
    if len(sys.argv) < 3:
        print(row["uuid"])
    elif row.get("type") not in ("assistant", "queue-operation", "summary", "system") and sys.argv[2] in json.dumps(row, ensure_ascii=False):
        count += 1
        kinds.append(str(row.get("type")))
if len(sys.argv) >= 3:
    print("rows:", " ".join(kinds) or "none")
    print(count)
' "$file" ${2:+"$2"}
}

# A local `sminos spawn` from the session's checkout, inside the owner's ruling's guard. A background seat inherits
# the claude supervisor's environment, not its spawner's, so before the spawn no claude of the owner's may run outside
# the run's namespace (one with a terminal could be a supervisor all the same: unproven is declined); after it, the
# seat is the session `sminos spawn` names, and every claude process the spawn brought must be in the run's namespace
# with the scratch config and the stub, read from /proc/<pid>/environ and shown for those two variables alone. Exit 10:
# the first check failed and nothing was spawned; 11: the second failed, the run's own of them killed at once and the
# seat retired (one outside the namespace is not the run's to kill).
local_spawn() {
  local alias=$1 ours others before out rc sid p ns verdict seats=() bad=0
  word "$alias"
  ours=$(ours_ns) || fail "no lane A namespace"
  others=$(claude_table | foreign "$ours" | tr '\n' ' ')
  if [[ -n ${others// /} ]]; then say "not spawned: claude of $OWNER's outside the run's namespace, not proven no supervisor (pid ${others% })"; exit 10; fi
  say "before the spawn: no claude of $OWNER's but the run's own"
  before=" $(claude_table | awk '{print $1}' | tr '\n' ' ') "
  out=$(as_session bash -c "cd $W && exec $SMINOS spawn $alias 'o10-m11: a local spawn; answer ok' --cwd $W" 2>&1); rc=$?
  say "$out" | tail -3
  sid=$(say "$out" | seat_session) && say "$sid" >$R/seat.session
  brought() { claude_table | while read -r p ns; do [[ $before == *" $p "* ]] || say "$p $ns"; done; }
  any_brought() { [[ -n $(brought) ]]; }
  within 30 any_brought && sleep 2 # the supervisor, then its seat
  local table rest what
  table=$(brought | while read -r p ns; do if [[ $ns == "$ours" ]]; then say "$p $ns $(two_vars "$p" | tr '\n' ' ')"; else say "$p $ns"; fi; done)
  # A spawn that failed and brought nothing is the clause's failure, not the guard's.
  [[ -z $table && $rc -ne 0 ]] && exit $rc
  verdict=$(say "$table" | seat_verdict "$ours") || bad=1
  while read -r p ns rest; do [[ -n $p && $ns == "$ours" ]] && say "seat pid $p: ${rest% }"; done <<<"$table"
  while read -r what p; do [[ $what == ours || $what == kill ]] && seats+=("$p"); done <<<"$verdict"
  say "${seats[*]}" >$R/seat.pids
  [[ -n ${sid:-} ]] || { say "sminos spawn named no seat session"; bad=1; }
  if ((bad)); then
    kill_ours "${seats[@]}"
    as_session bash -c "cd $W && exec $SMINOS retire $alias" >/dev/null 2>&1
    say "the seat was stopped at once: ${verdict//$'\n'/, }${verdict:+; }its processes are not all the run's with the scratch config and the stub"
    exit 11
  fi
  exit $rc
}

# The run's seat retired, and its processes, those still in the run's namespace, ended.
retire() {
  word "$1"
  as_session bash -c "cd $W && exec $SMINOS retire $1"; local rc=$?
  # shellcheck disable=SC2046
  kill_ours $(cat $R/seat.pids 2>/dev/null)
  return $rc
}

# Everything of the run's lane A ended and its scratch directory removed: a seat the run spawned (its processes in
# the run's namespace), the tmux server and the session under it, the stub, the namespace's anchor. The owner's mawsd
# and sminos are not the run's to end.
lane_a_down() {
  local left=0 p
  # shellcheck disable=SC2046
  kill_ours $(cat $R/seat.pids 2>/dev/null)
  runuser -u $OWNER -- tmux -L $TX kill-server 2>/dev/null
  pkill -u $OWNER -f "$O/stub-model.mjs --port $STUB_PORT" 2>/dev/null
  p=$(cat $R/anchor.pid 2>/dev/null) && kill "$p" 2>/dev/null
  within 10 bash -c "! pgrep -u $OWNER -f 'tmux -L $TX' >/dev/null && ! pgrep -u $OWNER -f '$O/stub-model.mjs' >/dev/null"
  rm -rf $X
  [[ -e $X ]] && { say "LEFT $X"; left=1; }
  pgrep -u $OWNER -f "$O/stub-model.mjs" >/dev/null && { say "LEFT the stub model"; left=1; }
  pgrep -u $OWNER -f "tmux -L $TX" >/dev/null && { say "LEFT the lane A session's tmux"; left=1; }
  ((left == 0)) && say "down: the run's lane A session, its seat and its stub ended, $X removed (the owner's mawsd and sminos run on)"
  return $left
}

# Sourced (the suite), the script stops here: nothing above has run anything.
[[ ${BASH_SOURCE[0]} == "$0" ]] || return 0
uid=$(id -u $OWNER) || fail "no user $OWNER"
OWNER_ENV=("HOME=$OH" "USER=$OWNER" "LOGNAME=$OWNER" "PATH=$CUR/runtime/bin:/usr/bin:/bin" "LANG=C.UTF-8" "XDG_RUNTIME_DIR=/run/user/$uid")
SESSION_ENV=("${OWNER_ENV[@]}" "PATH=$O/bin:$CUR/runtime/bin:/usr/bin:/bin" "SHELL=/bin/bash" "TERM=xterm-256color" "SMINOS_HOME=$SH"
  "CLAUDE_CONFIG_DIR=$X/claude" "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1" "ANTHROPIC_BASE_URL=$STUB_URL" "ANTHROPIC_AUTH_TOKEN=o10-m11-stub-no-credential"
  "DISABLE_AUTOUPDATER=1" "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1" "DISABLE_TELEMETRY=1" "DISABLE_ERROR_REPORTING=1")

verb=${1:-}; (($#)) && shift
case $verb in check | down | "") ;; *) register "$verb" || fail "cannot register the verb $verb" ;; esac
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
    n=$(cut_tuples "$p") || { say "$n"; exit 1; }
    ((n > 0)) || fail "mawsd pid $p holds no socket to :443"
    say "cut $n socket(s) of mawsd pid $p to :443, each by its own tuple" ;;
  listening) p=$(pid); ss -ltnpH | grep -F "pid=$p," | awk '{print $4}' ;;
  log-size) f=$(logfile "${1:-}") || exit 1; stat -c %s "$f" 2>/dev/null || echo 0 ;;
  log-since) f=$(logfile "${1:-}") || exit 1; [[ ${2:-} =~ ^[0-9]+$ ]] || fail "a byte offset"; tail -c +$(($2 + 1)) "$f" 2>/dev/null ;;
  lane-a-up) lane_a_up "${1:-}" "${2:-}" ;;
  lane-a-stop) lane_a_stop ;;
  lane-a-resume) lane_a_resume ;;
  transcript) transcript "${1:-}" "${2:-}" ;;
  sminos-status) as_owner env "SMINOS_HOME=$SH" $SMINOS daemon status; [[ -e $SH/daemon/hub.json ]] && say "hub.json: present" || say "hub.json: absent" ;;
  sminos-revoked) if [[ -f $SH/daemon/revoked.json ]]; then python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))))' $SH/daemon/revoked.json; else say none; fi ;;
  imported) [[ ${1:-} =~ ^[a-z0-9-]{4,64}$ ]] || fail "a marker token"; { find $SH -path '*/log/*.jsonl' -type f -exec cat {} + 2>/dev/null | grep -cF -- "$1"; true; } ;;
  local-spawn) local_spawn "${1:-}" ;;
  retire) retire "${1:-}" ;;
  down) stop_verbs; v=$?; lane_a_down; d=$?; exit $((v | d)) ;;
  *) fail "production.sh check | up | mawsd <keys|endpoint …> | restart | cut-hub | listening | log-size <log> | log-since <log> <bytes> | lane-a-up <project> <name> | lane-a-stop | lane-a-resume | transcript <session> [token] | sminos-status | sminos-revoked | imported <token> | local-spawn <alias> | retire <alias> | down" ;;
esac
