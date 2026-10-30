#!/bin/bash
# The endpoint acceptance run's scene on the devcloud acceptance VM (P5 O10 M11; docs/doperpowers/plans/2026-10-27-p5-
# o10-endpoint.md): a scratch `mawsd` built from the branch, the sminos beside it and one terminal `claude` session
# under that sminos, all as the scratch user o10acc and all in one private mount namespace whose /etc/claude-code is an
# empty tmpfs, so no engine the scene starts reads the VM's managed settings (the friction tracker's
# devcloud-vm-carries-owner-credentials-and-gateway-managed-settings). The engine's model is the stub (stub-model.mjs):
# no credential, no spend. setup.sh installs this as /opt/o10-m11/scene.sh; the run (deploy/endpoint-machine.ts) calls
# it as root, one verb a step:
#   check                        what is installed, read only
#   up                           a fresh scene: the namespace and mawsd under its restart loop, serving, unenrolled
#   enroll <name>                `mawsd enroll --name <name> --wait 300 --json`, the code on this script's stdin
#   mawsd <args…>                the scratch daemon's command line (keys, endpoint status|policy, …)
#   restart                      `mawsd restart`, then serving again (the loop starts it, as a unit manager would)
#   cut-hub                      the scratch mawsd's sockets to the hub (:443) closed by force (ss -K)
#   listening                    the direct listener's bound addresses
#   log-size mawsd|sminos        a log's size; log-since mawsd|sminos <bytes>: its lines after that size
#   lane-a-up <project> <name>   the stub model, sminos (cut over to the endpoint) and the session in the project
#   lane-a-stop | lane-a-resume  the session's engine ended; started again on the same session (`--resume`)
#   transcript <session> [token] the session's transcript rows' uuids, in order; with a token, how many rows the
#                                session was given hold it (a user's prompt, or words a hook delivered; not the
#                                model's own, nor the queue's bookkeeping): how many times a send or words arrived
#   sminos-status | sminos-revoked   `sminos daemon status` (and whether hub.json exists); daemon/revoked.json
#   imported <token>             how many events in sminos's project logs hold the token (words it imported)
#   local-spawn <alias> | retire <alias>   a local `sminos spawn` from the project's checkout; its retirement
#   lane-b-up <tag>              a lane B session in mawsd's engine host, started over machine.sock with no app (as the
#                                app starts one: lane-b.mjs), in lane A's checkout, once sminos lists it as lane B
#   lane-b-events <app>          the engine host's own numbering of the lane B session's events (`session.events`
#                                over machine.sock, never the endpoint): `ev <launch> <seq> <idx>` a line
#   started                      the sessions the scene recorded starting: `session <id>` (lane A), `seat <id>`,
#                                `lane-b <id>` (the lane B session's engine session)
#   down                         everything of the scene ended and removed; `LEFT …` for what could not be
# Nothing here names the owner, the owner's profile, sminos or daemon, or the VM's own mawsd (port 47830): the scene is
# o10acc's alone, and `down` ends that user's processes and nothing else.
#
# Lane B's engine is mawsd's (its engine host's), which builds the engine's environment itself (src/engine-host/launch.ts):
# an allowlist over its login shell's, its gateway route's ANTHROPIC_BASE_URL and token set over anything inherited. So
# its model is reached as the gateway: MAWS_RELAY_URL on mawsd's environment names the stub (the relay's dev override,
# honoured in an unpackaged build such as the pack), which answers the relay's health check, and the token is the
# engine host's fixed non-secret marker. mawsd runs on a config dir of its own (CB) holding the sminos plugin installed
# from the scene's directory marketplace (MARKET), since a MAWS launch loads the user scope's plugins and takes no
# --plugin-dir; lane A keeps its own (`--plugin-dir`) and is not loaded twice. The engine's allowlist drops
# SMINOS_HOME, so a lane B session's sminos hooks use the default home, ~/.claude/sminos: the scene's sminos lives there.
set -uo pipefail
U=o10acc
H=/home/$U
O=/opt/o10-m11
P=$H/profile
S=$H/.claude/sminos
CB=$H/.claude-mawsd
MARKET=$O/market
LANE_B=$O/lane-b.mjs
W=$H/work
R=$H/run
DIRECT_PORT=47831
STUB_PORT=47899
NODE=$H/pack/runtime/bin/node
MAWSD_JS=$H/pack/out/main/mawsd.js
SMINOS=$O/bin/sminos
CLAUDE=$O/bin/claude
TX=o10-m11
SCENE_ENV=("HOME=$H" "USER=$U" "LOGNAME=$U" "SHELL=/bin/bash" "PATH=$O/bin:$H/pack/runtime/bin:/usr/bin:/bin" "LANG=C.UTF-8" "TERM=xterm-256color" "MAWS_USER_DATA=$P" "SMINOS_HOME=$S" "SMINOS_RL10=$P/mawsd/endpoint/rl10.json" "SMINOS_DERIVE_EVERY=0" "MAWS_ENDPOINT_DIRECT=1" "MAWS_ENDPOINT_PORT=$DIRECT_PORT" "CLAUDE_CONFIG_DIR=$H/.claude" "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1" "ANTHROPIC_BASE_URL=http://127.0.0.1:$STUB_PORT" "ANTHROPIC_AUTH_TOKEN=o10-m11-stub-no-credential" "DISABLE_AUTOUPDATER=1" "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1" "DISABLE_TELEMETRY=1" "DISABLE_ERROR_REPORTING=1")

# mawsd's environment: the scene's, on its own config dir, its engine host's gateway the stub.
MAWSD_ENV=()
for kv in "${SCENE_ENV[@]}"; do [[ $kv == CLAUDE_CONFIG_DIR=* ]] || MAWSD_ENV+=("$kv"); done
MAWSD_ENV+=("CLAUDE_CONFIG_DIR=$CB" "MAWS_RELAY_URL=http://127.0.0.1:$STUB_PORT")

say() { printf '%s\n' "$*"; }
fail() { say "$*"; exit 1; }
# A command as the scratch user, in the scene's environment alone.
as() { runuser -u $U -- env -i "${SCENE_ENV[@]}" "$@"; }
anchor() { local p; p=$(cat $R/anchor.pid 2>/dev/null) && [[ -d /proc/$p ]] && [[ $(readlink /proc/$p/ns/mnt) != "$(readlink /proc/1/ns/mnt)" ]] && say "$p"; }
# A command inside the scene's mount namespace (where /etc/claude-code is empty).
inns() { local p; p=$(anchor) || fail "no scene namespace: run up first"; nsenter --mount=/proc/$p/ns/mnt -- "$@"; }
# Waits up to <s> seconds for <command…> to succeed.
within() { local s=$1 i; shift; for ((i = 0; i < s * 2; i++)); do "$@" && return 0; sleep 0.5; done; return 1; }

# Every verb but check and down registers its pid in $VERBS while it runs: the run's end kills a step's local ssh,
# which is no proof that this script stopped on the VM, so down stops a verb still running here, its whole process
# tree frozen first so nothing forks past it, and says LEFT for one it could not.
VERBS=/run/o10-m11-scene-verbs
register() { install -d -m 700 $VERBS && say "$1" >$VERBS/$$ && trap 'rm -f $VERBS/$$' EXIT; }
# Pid $1 and every process beneath it.
tree() { ps -e -o pid=,ppid= | awk -v root="$1" '{ parent[$1] = $2 } END { for (p in parent) { q = p; while (q in parent && q != root && q > 1) q = parent[q]; if (q == root) print p } }'; }
stop_verbs() {
  local f p what pids left=0
  for f in "$VERBS"/*; do
    [[ -f $f ]] || continue
    p=${f##*/}; what=$(cat "$f" 2>/dev/null)
    [[ $p == "$$" ]] && continue
    if ! tr '\0' ' ' </proc/"$p"/cmdline 2>/dev/null | grep -qF -- "/opt/o10-m11/scene.sh "; then rm -f "$f"; continue; fi # ended, or another process now
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
mawsd_pid() { pgrep -u $U -f -- "$MAWSD_JS run --unit" | head -1; }
serving() { local n; n=$(grep -c ' serving;' $P/mawsd/mawsd.log 2>/dev/null); say "${n:-0}"; }
served() { (($(serving) >= $1)); }
mawsd_cli() { as $NODE --disable-sigusr1 $MAWSD_JS "$@"; }
logfile() { case $1 in mawsd) say $P/mawsd/mawsd.log ;; sminos) say $S/daemon.log ;; *) fail "a log: mawsd or sminos" ;; esac; }
word() { [[ $1 =~ ^[A-Za-z0-9._-]{1,64}$ ]] || fail "not a word: $1"; }

check() {
  say "user: $(id $U 2>/dev/null || echo absent)"
  say "pack: $([[ -x $NODE && -f $MAWSD_JS ]] && "$NODE" --version || echo absent)"
  say "claude: $([[ -x $CLAUDE ]] && "$CLAUDE" --version 2>/dev/null | head -1 || echo absent)"
  say "sminos: $([[ -x $SMINOS ]] && grep -m1 '"version"' $O/sminos/.claude-plugin/plugin.json | tr -d ' ,' || echo absent)"
  say "stub: $([[ -f $O/stub-model.mjs && -f $O/stub-api.mjs ]] && echo present || echo absent)"
  say "lane B: $([[ -f $LANE_B && -f $MARKET/.claude-plugin/marketplace.json && -f $MARKET/sminos/.claude-plugin/plugin.json ]] && echo present || echo absent)"
  say "tools: $(for t in tmux python3 ss nsenter unshare runuser curl git; do command -v $t >/dev/null || printf 'missing-%s ' $t; done)ok"
  say "port $DIRECT_PORT: $(ss -ltnH "( sport = :$DIRECT_PORT )" | wc -l) listener(s)"
  say "scene: $(anchor >/dev/null && echo up || echo down)"
  say "tailnet: $(ip -4 -o addr show tailscale0 2>/dev/null | awk '{print $4}')"
}

up() {
  down >/dev/null 2>&1
  [[ -x $NODE && -f $MAWSD_JS ]] || fail "no mawsd pack at $H/pack: run setup.sh first"
  install -d -m 700 -o $U -g $U $H/.claude $P $S $R $W
  # The namespace's anchor: a sleep whose mount namespace has /etc/claude-code as an empty tmpfs (propagation private,
  # so the host's own mount table never sees it). Every process of the scene is started inside it.
  setsid -f unshare -m --propagation private sh -c "mount -t tmpfs -o mode=755,size=1m tmpfs /etc/claude-code && echo \$\$ > $R/anchor.pid && exec sleep infinity" </dev/null >/dev/null 2>&1
  within 10 anchor >/dev/null || fail "the scene's namespace did not come up"
  [[ -z $(inns ls -A /etc/claude-code) ]] || fail "the namespace still shows /etc/claude-code's files"
  # mawsd as a unit would run it, under a loop that starts it again after `mawsd restart` (its exit 75) and only then.
  inns setsid -f runuser -u $U -- env -i "${MAWSD_ENV[@]}" bash -c 'while :; do "$0" --disable-sigusr1 "$1" run --unit --dir "$2"; rc=$?; [ $rc -eq 75 ] || exit $rc; done' \
    $NODE $MAWSD_JS $P/mawsd </dev/null >>$R/mawsd.out 2>&1
  within 90 served 1 || { tail -5 $R/mawsd.out; fail "mawsd did not serve within 90 s"; }
  say "serving: mawsd pid $(mawsd_pid), the direct listener on port $DIRECT_PORT once enrolled"
}

restart() {
  local before; before=$(serving)
  mawsd_cli restart || fail "mawsd restart failed"
  within 90 served $((before + 1)) || fail "mawsd did not serve again within 90 s"
  say "serving again: mawsd pid $(mawsd_pid)"
}

# The established sockets to :443 of process $1, each cut by its own four-tuple (src and dst), never by port alone: the
# VM's other processes (the owner's mawsd, sminos, the gateway) hold sockets to :443 too. Prints how many it cut;
# fails when one of them is still there.
cut_tuples() {
  local pid=$1 n=0 here there
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

cut_hub() {
  local pid n
  pid=$(mawsd_pid); [[ -n $pid ]] || fail "no scratch mawsd running"
  n=$(cut_tuples "$pid") || { say "$n"; exit 1; }
  ((n > 0)) || fail "mawsd pid $pid holds no socket to :443"
  say "cut $n socket(s) of mawsd pid $pid to :443, each by its own tuple"
}

lane_a_up() {
  local project=$1 name=$2 org sock sid launch
  [[ $project =~ ^[0-9a-f-]{36}$ ]] || fail "a project id"; word "$name"
  [[ -f $P/mawsd/endpoint/rl10.json ]] || fail "no rl10.json: the endpoint serves RL10 only once it is org-listed"
  inns setsid -f runuser -u $U -- env -i "${SCENE_ENV[@]}" $NODE $O/stub-model.mjs --port $STUB_PORT </dev/null >>$R/stub.log 2>&1
  within 20 bash -c "exec 3<>/dev/tcp/127.0.0.1/$STUB_PORT" 2>/dev/null || fail "the stub model did not listen"
  inns setsid -f runuser -u $U -- env -i "${SCENE_ENV[@]}" $SMINOS daemon run --interval 1 </dev/null >>$R/sminos.out 2>&1
  within 90 test -f $S/daemon/identity.json || { tail -5 $S/daemon.log 2>/dev/null; fail "sminos did not cut over to the endpoint within 90 s"; }
  within 60 bash -c "runuser -u $U -- env -i ${SCENE_ENV[*]} $SMINOS daemon status 2>/dev/null | grep -q 'uplink: RL10 (local-only), running'" || fail "sminos's RL10 uplink is not running"
  org=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["org"])' $S/daemon/identity.json) || fail "identity.json names no org"
  as git -c init.defaultBranch=main init -q $W || fail "git init"
  as python3 -c 'import json,sys; json.dump({"project": sys.argv[2], "name": sys.argv[3], "hub": {"org": sys.argv[4]}}, open(sys.argv[1], "w"))' $W/.smns "$project" "$name" "$org"
  as bash -c "cd $W && git add .smns && git -c user.name=o10-m11 -c user.email=o10-m11@scene.invalid commit -qm scene"
  as python3 -c 'import json,sys; w=sys.argv[2]; json.dump({"hasCompletedOnboarding": True, "projects": {w: {"hasTrustDialogAccepted": True}}}, open(sys.argv[1], "w"))' $H/.claude/.claude.json $W
  as python3 -c 'import json,sys; json.dump({"permissions": {"allow": ["Bash(echo:*)"]}}, open(sys.argv[1], "w"))' $H/.claude/settings.json
  start_session ""
  sock=$(ls $S/bridge/*.sock 2>/dev/null | head -1); sid=$(basename "$sock" .sock)
  say "$sid" > $R/session
  launch=$(bridge_launch "$sid") || fail "the bridge answered no launch"
  # The session's alias, as sminos lists it (a person's words name it beside the session id).
  alias=$(as bash -c "cd $W && $SMINOS list --here --json" | python3 -c '
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

# The session in its tmux pane, in the namespace; `--resume <sid>` when given. Waits for its bridge.
start_session() {
  local resume=$1 flags=(--plugin-dir "$O/sminos" --model sonnet -n o10-m11-lane-a)
  [[ -n $resume ]] && flags+=(--resume "$resume")
  inns runuser -u $U -- env -i "${SCENE_ENV[@]}" tmux -L $TX new-session -d -s lane-a -x 200 -y 50 -c $W "$CLAUDE ${flags[*]}" || fail "tmux"
  # A resume waits for its own session's bridge (a lane B session's may be there too); a first start has no other.
  if ! within 120 bash -c "ls $S/bridge/${resume:-*}.sock >/dev/null 2>&1"; then
    say "the pane, last lines:"; as tmux -L $TX capture-pane -p -t lane-a 2>/dev/null | grep -v '^\s*$' | tail -15
    fail "no bridge within 120 s"
  fi
}

bridge_launch() { as curl -sf --max-time 5 --unix-socket $S/bridge/$1.sock http://bridge/status | python3 -c 'import json,sys; print(json.load(sys.stdin)["launch"])'; }

lane_a_stop() {
  local sid; sid=$(cat $R/session) || fail "no session to stop"
  as tmux -L $TX kill-session -t lane-a 2>/dev/null
  # Lane A's own bridge: a lane B session's sits in the same directory.
  within 30 bash -c "[[ ! -e $S/bridge/$sid.sock ]]" || fail "the bridge did not go within 30 s"
  say "the session's engine ended"
}

lane_a_resume() {
  local sid; sid=$(cat $R/session) || fail "no session to resume"
  start_session "$sid"
  [[ -S $S/bridge/$sid.sock ]] || fail "the resumed engine bridged another session"
  python3 -c 'import json,sys; print(json.dumps({"launch": sys.argv[1]}))' "$(bridge_launch "$sid")"
}

# mawsd's config dir, as the scratch user: a command with it, in the scene's namespace, from the scratch home.
as_mawsd() { inns runuser -u $U -- env -i "${MAWSD_ENV[@]}" bash -c 'cd ~ && exec "$@"' bash "$@"; }

# Whether `sminos list` shows the session $1 as lane B (by its controller, or a `maws` origin awaiting one): its alias
# and status 0; status 2 with what it shows when it is listed otherwise; status 1 when it is not listed.
lane_b_listed() {
  as bash -c "cd $W && $SMINOS list --here --json" 2>/dev/null | python3 -c '
import json, sys
sid = sys.argv[1]
def walk(x):
    if isinstance(x, dict):
        if sid in x.values():
            yield x
        for v in x.values():
            yield from walk(v)
    elif isinstance(x, list):
        for v in x:
            yield from walk(v)
try:
    found = list(walk(json.load(sys.stdin)))
except ValueError:
    sys.exit(1)
for m in found:
    origin, controller = m.get("origin") or {}, m.get("controller") or {}
    if controller.get("lane") == "B" or (not controller and origin.get("kind") == "maws"):
        print(m.get("alias") or "")
        sys.exit(0)
if found:
    print("listed as origin %s, controller %s" % (json.dumps(found[0].get("origin")), json.dumps(found[0].get("controller"))))
    sys.exit(2)
sys.exit(1)' "$1"
}

lane_b_up() {
  local tag=$1 out app launch engine alias
  [[ $tag =~ ^[a-z0-9]{1,16}$ ]] || fail "a tag ([a-z0-9])"
  [[ -f $LANE_B && -f $MARKET/.claude-plugin/marketplace.json ]] || fail "no lane B files under $O: run setup.sh again"
  [[ -f $W/.smns ]] || fail "no checkout at $W: lane-a-up first"
  bash -c "exec 3<>/dev/tcp/127.0.0.1/$STUB_PORT" 2>/dev/null || fail "the stub model is not listening: lane-a-up first"
  # mawsd's config dir: onboarded, the checkout trusted, the sminos plugin installed and enabled in the user scope, and
  # `echo` allowed (the stub's ticks), as lane A's is.
  install -d -m 700 -o $U -g $U $CB
  as python3 -c 'import json,sys; w=sys.argv[2]; json.dump({"hasCompletedOnboarding": True, "projects": {w: {"hasTrustDialogAccepted": True}}}, open(sys.argv[1], "w"))' $CB/.claude.json $W
  as_mawsd $CLAUDE plugin marketplace add $MARKET >/dev/null 2>&1 || fail "the scene's plugin marketplace was not added to $CB"
  as_mawsd $CLAUDE plugin install sminos@o10-m11 --scope user >/dev/null 2>&1 || fail "the sminos plugin was not installed in $CB"
  as python3 -c '
import json, sys
p = sys.argv[1]
s = json.load(open(p))
if s.get("enabledPlugins", {}).get("sminos@o10-m11") is not True:
    sys.exit("the sminos plugin is not enabled in " + p)
s.setdefault("permissions", {})["allow"] = ["Bash(echo:*)"]
json.dump(s, open(p, "w"))' $CB/settings.json || fail "mawsd's config dir's settings"
  # The engine binary MAWS resolves first on a machine with no setting (src/engine-host/binary-info.ts).
  as mkdir -p $H/.local/bin && as ln -sfn $CLAUDE $H/.local/bin/claude || fail "the engine binary's link"
  out=$(as $NODE $LANE_B up $W $tag 2>&1) || { say "$out" | tail -5; fail "the lane B session did not start"; }
  read -r app launch engine < <(python3 -c 'import json,sys; v=json.loads(sys.argv[1].splitlines()[-1]); print(v["app"], v["launch"], v["engine"])' "$out") || fail "lane-b.mjs answered no ids: $(say "$out" | tail -1)"
  say "$engine" > $R/lane-b.session
  # sminos's member, which the endpoint authorizes a subscription by: its hooks ran in the session, marked MAWS's.
  if ! within 90 lane_b_listed "$engine" >/dev/null; then
    out=$(lane_b_listed "$engine")
    fail "sminos does not list $engine as lane B within 90 s${out:+: $out}"
  fi
  alias=$(lane_b_listed "$engine")
  python3 -c 'import json,sys; print(json.dumps({"app": sys.argv[1], "launch": sys.argv[2], "engine": sys.argv[3], "alias": sys.argv[4]}))' "$app" "$launch" "$engine" "$alias"
}

lane_b_events() {
  [[ ${1:-} =~ ^[0-9a-f-]{36}$ ]] || fail "an app session id"
  as $NODE $LANE_B events "$1"
}

transcript() {
  local sid=$1 file
  [[ $sid =~ ^[0-9a-f-]{36}$ ]] || fail "a session id"
  [[ -z ${2:-} || $2 =~ ^[a-z0-9-]{4,64}$ ]] || fail "a marker token ([a-z0-9-])"
  file=$(find $H/.claude/projects -name "$sid.jsonl" 2>/dev/null | head -1)
  # A session that has had no turn yet has no transcript: no rows, and no row holds the token.
  if [[ -z $file ]]; then [[ -n ${2:-} ]] && { say "rows: none"; say 0; }; return 0; fi
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

down() {
  local left=0 p
  runuser -u $U -- tmux -L $TX kill-server 2>/dev/null
  pkill -TERM -u $U 2>/dev/null
  within 10 bash -c "! pgrep -u $U >/dev/null" || pkill -KILL -u $U 2>/dev/null
  p=$(cat $R/anchor.pid 2>/dev/null) && kill "$p" 2>/dev/null
  rm -rf $P $S $W $R $H/.claude $CB $H/.claude.json $H/.config $H/.local/state $H/.local/bin/claude
  if pgrep -u $U >/dev/null; then say "LEFT processes of $U: $(pgrep -u $U | tr '\n' ' ')"; left=1; fi
  if [[ $(ss -ltnH "( sport = :$DIRECT_PORT )" | wc -l) != 0 ]]; then say "LEFT a listener on port $DIRECT_PORT"; left=1; fi
  ((left == 0)) && say "down: nothing of the scene runs or remains (the pack and build stay for the next run)"
  return $left
}

verb=${1:-}; (($#)) && shift
case $verb in check | down | "") ;; *) register "$verb" || fail "cannot register the verb $verb" ;; esac
case $verb in
  check) check ;;
  up) up ;;
  enroll) word "${1:-}"; mawsd_cli enroll --name "$1" --wait 300 --json ;;
  mawsd) for a in "$@"; do word "$a"; done; mawsd_cli "$@" ;;
  restart) restart ;;
  cut-hub) cut_hub ;;
  listening) ss -ltnH "( sport = :$DIRECT_PORT )" | awk '{print $4}' ;;
  log-size) f=$(logfile "${1:-}") || exit 1; stat -c %s "$f" 2>/dev/null || echo 0 ;;
  log-since) f=$(logfile "${1:-}") || exit 1; [[ ${2:-} =~ ^[0-9]+$ ]] || fail "a byte offset"; tail -c +$(($2 + 1)) "$f" 2>/dev/null ;;
  lane-a-up) lane_a_up "${1:-}" "${2:-}" ;;
  lane-a-stop) lane_a_stop ;;
  lane-a-resume) lane_a_resume ;;
  transcript) transcript "${1:-}" "${2:-}" ;;
  sminos-status) as $SMINOS daemon status; [[ -e $S/daemon/hub.json ]] && say "hub.json: present" || say "hub.json: absent" ;;
  imported) [[ ${1:-} =~ ^[a-z0-9-]{4,64}$ ]] || fail "a marker token"; { find $S -path '*/log/*.jsonl' -type f -exec cat {} + 2>/dev/null | grep -cF -- "$1"; true; } ;;
  sminos-revoked) if [[ -f $S/daemon/revoked.json ]]; then python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))))' $S/daemon/revoked.json; else say none; fi ;;
  local-spawn)
    word "${1:-}"
    out=$(inns runuser -u $U -- env -i "${SCENE_ENV[@]}" bash -c "cd $W && exec $SMINOS spawn $1 'o10-m11: a local spawn; answer ok' --cwd $W" 2>&1); rc=$?
    say "$out"
    # The seat's session, for the run's residue whatever becomes of the seat: `seat spawned: …  [<short> / <session>] …`.
    sed -n 's|^seat [a-z-]*: .*\[[0-9a-z]* / \([0-9a-f-]\{36\}\)\].*|\1|p' <<<"$out" | tail -1 >$R/seat.session
    exit $rc ;;
  retire) word "${1:-}"; as bash -c "cd $W && exec $SMINOS retire $1" ;;
  lane-b-up) lane_b_up "${1:-}" ;;
  lane-b-events) lane_b_events "${1:-}" ;;
  started) for f in session seat.session lane-b.session; do [[ -s $R/$f ]] && say "${f%.session} $(head -1 $R/$f)"; done; true ;;
  down) stop_verbs; v=$?; down; d=$?; exit $((v | d)) ;;
  *) fail "scene.sh check | up | enroll <name> | mawsd <args…> | restart | cut-hub | listening | log-size <log> | log-since <log> <bytes> | lane-a-up <project> <name> | lane-a-stop | lane-a-resume | transcript <session> [token] | sminos-status | sminos-revoked | imported <token> | local-spawn <alias> | retire <alias> | lane-b-up <tag> | lane-b-events <app> | started | down" ;;
esac
