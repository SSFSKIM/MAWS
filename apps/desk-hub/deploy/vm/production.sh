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
uid=$(id -u $OWNER) || fail "no user $OWNER"
within() { local s=$1 i; shift; for ((i = 0; i < s * 2; i++)); do "$@" && return 0; sleep 0.5; done; return 1; }
pid() { pgrep -u $OWNER -f "$CUR/.*mawsd.js run" | head -1; }
logfile() { case $1 in mawsd) say $DIR/mawsd.log ;; sminos) say $SH/daemon.log ;; *) fail "a log: mawsd or sminos" ;; esac; }

OWNER_ENV=("HOME=$OH" "USER=$OWNER" "LOGNAME=$OWNER" "PATH=$CUR/runtime/bin:/usr/bin:/bin" "LANG=C.UTF-8" "XDG_RUNTIME_DIR=/run/user/$uid")
SESSION_ENV=("${OWNER_ENV[@]}" "PATH=$O/bin:$CUR/runtime/bin:/usr/bin:/bin" "SHELL=/bin/bash" "TERM=xterm-256color" "SMINOS_HOME=$SH"
  "CLAUDE_CONFIG_DIR=$X/claude" "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1" "ANTHROPIC_BASE_URL=$STUB_URL" "ANTHROPIC_AUTH_TOKEN=o10-m11-stub-no-credential"
  "DISABLE_AUTOUPDATER=1" "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1" "DISABLE_TELEMETRY=1" "DISABLE_ERROR_REPORTING=1")
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

# ---- the owner's claude processes, by executable and terminal only ----------------------------------------------------

# `pid tty` of every process of the owner's that runs a claude binary (the installed versions, or the run's copy).
claude_procs() {
  local p tty comm exe
  while read -r p tty comm; do
    exe=$(readlink /proc/"$p"/exe 2>/dev/null) || continue
    case $exe in "$OH"/.local/share/claude/versions/* | "$CLAUDE") say "$p $tty" ;; *) [[ $comm == claude ]] && say "$p $tty" ;; esac
  done < <(ps -u $OWNER -o pid=,tty=,comm=)
}
# The run's own session: its tmux server and every process beneath it.
own_tree() {
  local server; server=$(pgrep -u $OWNER -xf "tmux -L $TX .*" | head -1); [[ -n $server ]] || return 0
  ps -u $OWNER -o pid=,ppid= | awk -v root="$server" '{ parent[$1] = $2 } END { for (p in parent) { q = p; while (q in parent && q != root) q = parent[q]; if (q == root) print p } }'
}
# The owner's claude supervisors and background seats the run did not start (a claude without a terminal).
foreign_background() {
  local tree p tty
  tree=" $(own_tree | tr '\n' ' ') "
  while read -r p tty; do [[ -n $p && $tty == '?' && $tree != *" $p "* ]] && say "$p"; done < <(claude_procs)
}

# ---- lane A -----------------------------------------------------------------------------------------------------------

sockets() { ls "$SH"/bridge/*.sock 2>/dev/null | sort; }
new_socket() { comm -13 $R/socks.before <(sockets) | head -1 | grep .; }
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
  sockets >$R/socks.before
  start_session ""
  sid=$(cat $R/session) || fail "no session"
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

# The session in its tmux pane (its own server, -L $TX), in the namespace; `--resume <sid>` when given. A new session's
# id is the bridge socket that appears beside those of the owner's own sessions.
start_session() {
  local resume=$1 flags=(--plugin-dir "$PLUGIN" --model sonnet -n o10-m11-lane-a) sock
  [[ -n $resume ]] && flags+=(--resume "$resume")
  as_session tmux -L $TX new-session -d -s lane-a -x 200 -y 50 -c $W "$CLAUDE ${flags[*]}" || fail "tmux"
  if [[ -n $resume ]]; then
    within 120 test -S "$SH/bridge/$resume.sock" || { pane; fail "no bridge for $resume within 120 s"; }
    return 0
  fi
  within 120 new_socket >/dev/null || { pane; fail "no new bridge within 120 s"; }
  sock=$(new_socket); basename "$sock" .sock >$R/session
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
  start_session "$sid"
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
# the claude supervisor's environment, not its spawner's, so before the spawn no supervisor or background claude of the
# owner's may run but the run's own; after it, every claude process the spawn brought must point at the scratch config
# and the stub, read from /proc/<pid>/environ and shown for those two variables alone. Exit 10: the first check failed
# and nothing was spawned; 11: the second failed and the seat was killed at once.
SPAWN_BEFORE=
spawned() { claude_procs | while read -r p _; do [[ $SPAWN_BEFORE == *" $p "* ]] || say "$p"; done; }
local_spawn() {
  local alias=$1 foreign new p env ok=1 rc
  word "$alias"
  foreign=$(foreign_background | tr '\n' ' ')
  if [[ -n ${foreign// /} ]]; then say "not spawned: a claude of the owner's runs in the background already (pid ${foreign% })"; exit 10; fi
  say "before the spawn: no claude supervisor or background claude of $OWNER's but the run's own"
  SPAWN_BEFORE=" $(claude_procs | awk '{print $1}' | tr '\n' ' ') "
  as_session bash -c "cd $W && exec $SMINOS spawn $alias 'o10-m11: a local spawn; answer ok' --cwd $W"; rc=$?
  within 30 spawned >/dev/null && sleep 2   # the supervisor, then its seat
  new=$(spawned | tr '\n' ' ')
  say "${new% }" >$R/seat.pids
  [[ -n ${new// /} ]] || { say "no seat's claude appeared"; ok=0; }
  for p in $new; do
    env=$(tr '\0' '\n' </proc/"$p"/environ 2>/dev/null | grep -E '^(CLAUDE_CONFIG_DIR|ANTHROPIC_BASE_URL)=' | sort | tr '\n' ' ')
    say "seat pid $p: ${env% }"
    [[ $env == *"ANTHROPIC_BASE_URL=$STUB_URL "* && $env == *"CLAUDE_CONFIG_DIR=$X/claude "* ]] || ok=0
  done
  if ((ok == 0)); then
    for p in $new; do kill -KILL "$p" 2>/dev/null; done
    say "the seat was killed at once: its environment is not the scratch config's and the stub's"
    exit 11
  fi
  exit $rc
}

retire() {
  word "$1"
  as_session bash -c "cd $W && exec $SMINOS retire $1"; local rc=$?
  for p in $(cat $R/seat.pids 2>/dev/null); do kill -TERM "$p" 2>/dev/null; done
  return $rc
}

# Everything of the run's lane A ended and its scratch directory removed: the tmux server and the session under it, a
# seat the run spawned, the stub, the namespace's anchor. The owner's mawsd and sminos are not the run's to end.
lane_a_down() {
  local left=0 p
  runuser -u $OWNER -- tmux -L $TX kill-server 2>/dev/null
  for p in $(cat $R/seat.pids 2>/dev/null); do kill -KILL "$p" 2>/dev/null; done
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
  down) lane_a_down ;;
  *) fail "production.sh check | up | mawsd <keys|endpoint …> | restart | cut-hub | listening | log-size <log> | log-since <log> <bytes> | lane-a-up <project> <name> | lane-a-stop | lane-a-resume | transcript <session> [token] | sminos-status | sminos-revoked | imported <token> | local-spawn <alias> | retire <alias> | down" ;;
esac
