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
#   params                       the scene's parameters (user, ports, directories, registry), read only
# P5 O18 M6's reach scenes (`--scene a1|a2|b1|a3` before the verb; setup.sh installs this as /opt/o18-m6/scene.sh) add,
# each verb that runs sminos or an engine inside the scene's namespace, and each refused before anything runs when its
# words are not of its shape (a VM step's words admit no space and no `#`: endpoint-machine.ts):
#   as-session <session> <sub…>  the session's own shell (CLAUDE_CODE_SESSION_ID set, in the checkout), as its agent's
#                                Bash runs sminos: `say <token> <tag>…` (`<alias>[:<short>]` a tag, sent as
#                                `@<alias>[#<short>] … hello <token>`), `access <member> <level>`, `share <member>
#                                <person> <grade>`, `spawn <alias>`, `list-org`, `find <name>`
#   operator access|share …      the operator at the scene's terminal: no session, under a pty this script controls,
#                                answering `y` to sminos's confirmation. The reach scenes' alone, at staging's org alone
#   operator-say <token> <tag>   the operator's `sminos say` in the checkout (item 5: the operator's writer asks reach?)
#   forge-say <writer> <recipient> <alias> <token>   a `say` to <recipient> appended under the plain writer of the
#                                scene's session <writer> through sminos.log_append, past stream_for (acceptance 3c)
#   log-files | uplink | streams | audiences | policy-cache   the project's log files (name, size), its uplink.json and
#                                streams.json, daemon/audiences.json, the endpoint's policy/cache.json
#   grep-home <token> [--after <ts>]   per file under the sminos home, how many lines hold the token (with --after,
#                                lines whose `ts` is not after it are not counted); then `total <n>`
#   owed                         `sminos daemon owed`
#   events <token>               each event of the project's log files holding the token (its writer, seq, ts, kind,
#                                session, text, withheld, audience, verified, file)
#   row <session> <token>        the text of the first row the session was given holding the token (its frame, label)
#   archive-ls [token…]          the run's archive (/srv/o18-archive.git) as root: `file <path>` for each file on main,
#                                `tomb <path> <seq>` for each tombstone in them, `token <t> <n>` for each token's count
#   archive-evidence             what the scene's archive runs on, for an archive wait that timed out: uplink.json's
#                                designation (`archive`, `archive_at`, `archive_have`), project.json's remote and hub,
#                                daemon.json's last archive run, the running daemon's SMINOS_ARCHIVE_EVERY and groups,
#                                `git ls-remote` of the archive as the scene's user, daemon.log's last 40 archive lines
#   mawsd-freeze | mawsd-thaw | mawsd-stop | mawsd-start   mawsd (and what it started) stopped by SIGSTOP and continued;
#                                ended, and started again under its loop, serving
# Nothing here names the owner, the owner's profile, sminos or daemon, or the VM's own mawsd (port 47830): a scene is
# its user's alone, and `down` ends that user's processes and nothing else.
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
# The scene: O10 M11's (no `--scene`, the scratch user o10acc), or one of P5 O18 M6's reach scenes (`--scene <name>`,
# docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md): each its own user, home, ports, tmux socket, verb registry
# and namespace, so the hub sees four machines; their mawsd pack, stub, `claude` binary and pinned sminos copies are
# shared under /opt/o18-m6 (setup.sh), each scene's sminos the run's own copy by commit, never the VM's marketplace's.
SCENE_NAME=
if [[ ${1:-} == --scene ]]; then SCENE_NAME=${2:-}; shift; (($#)) && shift; fi
case $SCENE_NAME in
  "") U=o10acc DIRECT_PORT=47831 STUB_PORT=47899 ;;
  a1) U=o18a1 DIRECT_PORT=47841 STUB_PORT=47901 ;;
  a2) U=o18a2 DIRECT_PORT=47842 STUB_PORT=47902 ;;
  b1) U=o18b DIRECT_PORT=47843 STUB_PORT=47903 ;;
  a3) U=o18a3 DIRECT_PORT=47844 STUB_PORT=47904 ;;
  *) printf '%s\n' "a scene: --scene a1, a2, b1 or a3 (none: O10's)"; exit 1 ;;
esac
H=/home/$U
P=$H/profile
S=$H/.claude/sminos
CB=$H/.claude-mawsd
W=$H/work
R=$H/run
if [[ -z $SCENE_NAME ]]; then
  O=/opt/o10-m11
  SMN=$O/sminos
  SMINOS=$O/bin/sminos
  PACK=$H/pack
  TX=o10-m11
  VERBS=/run/o10-m11-scene-verbs
  ARCHIVE=
else
  O=/opt/o18-m6
  # A3 is the old sminos (6e: an owner's machine on sminos 1.34.0, the designated archiver); the others the new one.
  if [[ $SCENE_NAME == a3 ]]; then SMN=$O/sminos-old; else SMN=$O/sminos-new; fi
  SMINOS=$SMN/skills/sminos/scripts/sminos
  PACK=$O/pack
  TX=o18-$SCENE_NAME
  VERBS=/run/o18-$SCENE_NAME-verbs
  ARCHIVE=/srv/o18-archive.git
fi
# How a verb of this scene's reads in its process's command line: what `down` takes a registered pid to still be.
SELF_MATCH="$O/scene.sh ${SCENE_NAME:+--scene $SCENE_NAME }"
MARKET=$O/market
LANE_B=$O/lane-b.mjs
NODE=$PACK/runtime/bin/node
MAWSD_JS=$PACK/out/main/mawsd.js
CLAUDE=$O/bin/claude
# The staging org: the one org whose hub the operator's pty path (below) may widen at.
STAGING_ORG=staging-ssfskim
SCENE_ENV=("HOME=$H" "USER=$U" "LOGNAME=$U" "SHELL=/bin/bash" "PATH=$O/bin:$PACK/runtime/bin:/usr/bin:/bin" "LANG=C.UTF-8" "TERM=xterm-256color" "MAWS_USER_DATA=$P" "SMINOS_HOME=$S" "SMINOS_RL10=$P/mawsd/endpoint/rl10.json" "SMINOS_DERIVE_EVERY=0" "MAWS_ENDPOINT_DIRECT=1" "MAWS_ENDPOINT_PORT=$DIRECT_PORT" "CLAUDE_CONFIG_DIR=$H/.claude" "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1" "ANTHROPIC_BASE_URL=http://127.0.0.1:$STUB_PORT" "ANTHROPIC_AUTH_TOKEN=o10-m11-stub-no-credential" "DISABLE_AUTOUPDATER=1" "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1" "DISABLE_TELEMETRY=1" "DISABLE_ERROR_REPORTING=1")
# A reach scene archives every minute to the run's bare repository, which root owns and the scene users' group shares.
# git trusts it by a safe.directory in a global config of the run's own ($R/gitconfig, written by `up`), never the VM's.
# A command-scope one (`-c`, GIT_CONFIG_COUNT) is not enough: for a local path git starts upload-pack and receive-pack
# with the config variables cleared, so the fetch's other end refused the repository as of dubious ownership.
[[ -n $ARCHIVE ]] && SCENE_ENV+=("SMINOS_ARCHIVE_EVERY=60" "GIT_CONFIG_GLOBAL=$R/gitconfig")

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
register() { install -d -m 700 $VERBS && say "$1" >$VERBS/$$ && trap 'rm -f $VERBS/$$' EXIT; }
# Pid $1 and every process beneath it.
tree() { ps -e -o pid=,ppid= | awk -v root="$1" '{ parent[$1] = $2 } END { for (p in parent) { q = p; while (q in parent && q != root && q > 1) q = parent[q]; if (q == root) print p } }'; }
stop_verbs() {
  local f p what pids left=0
  for f in "$VERBS"/*; do
    [[ -f $f ]] || continue
    p=${f##*/}; what=$(cat "$f" 2>/dev/null)
    [[ $p == "$$" ]] && continue
    if ! tr '\0' ' ' </proc/"$p"/cmdline 2>/dev/null | grep -qF -- "$SELF_MATCH"; then rm -f "$f"; continue; fi # ended, or another process now
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
  say "sminos: $([[ -x $SMINOS ]] && grep -m1 '"version"' $SMN/.claude-plugin/plugin.json | tr -d ' ,' || echo absent)"
  say "stub: $([[ -f $O/stub-model.mjs && -f $O/stub-api.mjs ]] && echo present || echo absent)"
  say "lane B: $([[ -f $LANE_B && -f $MARKET/.claude-plugin/marketplace.json && -f $MARKET/sminos/.claude-plugin/plugin.json ]] && echo present || echo absent)"
  say "tools: $(for t in tmux python3 ss nsenter unshare runuser curl git; do command -v $t >/dev/null || printf 'missing-%s ' $t; done)ok"
  say "port $DIRECT_PORT: $(ss -ltnH "( sport = :$DIRECT_PORT )" | wc -l) listener(s)"
  say "scene: $(anchor >/dev/null && echo up || echo down)"
  say "tailnet: $(ip -4 -o addr show tailscale0 2>/dev/null | awk '{print $4}')"
}

up() {
  down >/dev/null 2>&1
  [[ -x $NODE && -f $MAWSD_JS ]] || fail "no mawsd pack at $PACK: run setup.sh first"
  install -d -m 700 -o $U -g $U $H/.claude $P $S $R $W
  [[ -z $ARCHIVE ]] || { printf '[safe]\n\tdirectory = %s\n' "$ARCHIVE" > $R/gitconfig && chown $U:$U $R/gitconfig; } || fail "no $R/gitconfig"
  # The namespace's anchor: a sleep whose mount namespace has /etc/claude-code as an empty tmpfs (propagation private,
  # so the host's own mount table never sees it). Every process of the scene is started inside it.
  setsid -f unshare -m --propagation private sh -c "mount -t tmpfs -o mode=755,size=1m tmpfs /etc/claude-code && echo \$\$ > $R/anchor.pid && exec sleep infinity" </dev/null >/dev/null 2>&1
  within 10 anchor >/dev/null || fail "the scene's namespace did not come up"
  [[ -z $(inns ls -A /etc/claude-code) ]] || fail "the namespace still shows /etc/claude-code's files"
  start_mawsd
  within 90 served 1 || { tail -5 $R/mawsd.out; fail "mawsd did not serve within 90 s"; }
  say "serving: mawsd pid $(mawsd_pid), the direct listener on port $DIRECT_PORT once enrolled"
}

# mawsd as a unit would run it, under a loop that starts it again after `mawsd restart` (its exit 75) and only then.
start_mawsd() {
  inns setsid -f runuser -u $U -- env -i "${MAWSD_ENV[@]}" bash -c 'while :; do "$0" --disable-sigusr1 "$1" run --unit --dir "$2"; rc=$?; [ $rc -eq 75 ] || exit $rc; done' \
    $NODE $MAWSD_JS $P/mawsd </dev/null >>$R/mawsd.out 2>&1
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
  # A reach scene's project keeps its archive in the run's bare repository (its `remote`, sminos_archive.py).
  as python3 -c 'import json,sys; d={"project": sys.argv[2], "name": sys.argv[3], "hub": {"org": sys.argv[4]}}; d.update({"remote": sys.argv[5]} if sys.argv[5] else {}); json.dump(d, open(sys.argv[1], "w"))' $W/.smns "$project" "$name" "$org" "$ARCHIVE"
  say "$project" > $R/project
  as bash -c "cd $W && git add .smns && git -c user.name=$TX -c user.email=$TX@scene.invalid commit -qm scene"
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
  if [[ -n $SCENE_NAME ]]; then
    # A reach scene's session is named by `@<alias>#<short>` across machines: its short, as sminos lists it.
    short=$(member_field "$sid" short) || short=
    python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1], "launch": sys.argv[2], "org": sys.argv[3], "alias": sys.argv[4], "checkout": sys.argv[5], "short": sys.argv[6]}))' "$sid" "$launch" "$org" "$alias" "$W" "$short"
  else
    python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1], "launch": sys.argv[2], "org": sys.argv[3], "alias": sys.argv[4], "checkout": sys.argv[5]}))' "$sid" "$launch" "$org" "$alias" "$W"
  fi
}

# A field of the member sminos lists for session $1 here (`sminos list --here --json`), or status 1.
member_field() {
  as bash -c "cd $W && $SMINOS list --here --json" 2>/dev/null | python3 -c '
import json, sys
def walk(x):
    if isinstance(x, dict):
        if sys.argv[1] in x.values() and isinstance(x.get(sys.argv[2]), str) and x[sys.argv[2]]:
            yield x[sys.argv[2]]
        for v in x.values():
            yield from walk(v)
    elif isinstance(x, list):
        for v in x:
            yield from walk(v)
try:
    v = next(walk(json.load(sys.stdin)), "")
except ValueError:
    v = ""
print(v)
sys.exit(0 if v else 1)' "$1" "$2"
}

# The session in its tmux pane, in the namespace; `--resume <sid>` when given. Waits for its bridge.
start_session() {
  local resume=$1 flags=(--plugin-dir "$SMN" --model sonnet -n "$TX-lane-a")
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

# The text of the first row session $1 was given holding token $2 (as `transcript` counts them), on one line, at most
# 600 characters: a delivery's frame and its sender's label (a reach scene's evidence of how a message arrived).
row() {
  local file
  file=$(find $H/.claude/projects -name "$1.jsonl" 2>/dev/null | head -1)
  [[ -n $file ]] || { say "row: none"; return 0; }
  python3 -c '
import json, sys
def text(x):
    if isinstance(x, str):
        return x
    if isinstance(x, list):
        return " ".join(text(v) for v in x)
    if isinstance(x, dict):
        return " ".join(text(v) for k, v in x.items() if k in ("content", "text", "message"))
    return ""
for line in open(sys.argv[1], encoding="utf-8"):
    try:
        r = json.loads(line)
    except ValueError:
        continue
    if isinstance(r, dict) and r.get("type") not in ("assistant", "queue-operation", "summary", "system") and sys.argv[2] in json.dumps(r, ensure_ascii=False):
        print("row:", " ".join(text(r).split())[:600])
        break
else:
    print("row: none")
' "$file" "$2"
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

# ---- P5 O18 M6's reach verbs ---------------------------------------------------------------------------------------
# Their words are checked by `reach_words` before anything runs, the verb registered or sminos started; their sminos
# runs as the scene's user, in its namespace, with the scene's environment alone.

UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
TOKEN_RE='^[a-z0-9-]{4,64}$'
# A member reference (an alias, a short, a session id) or a person (a member id, an email).
NAME_RE='^[A-Za-z0-9._@+-]{1,128}$'
TAG_RE='^[A-Za-z0-9._/-]{1,64}(:[0-9a-z]{1,16})?$'
LEVELS=" private listed org-view org-converse "
GRADES=" list view converse approve none "
TS_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{8,12}Z$'
reach_only() { [[ -n $SCENE_NAME ]] || fail "$1 is a reach scene's verb (--scene a1|a2|b1|a3)"; }
is() { [[ $2 =~ $1 ]]; }
member_change() { # access <member> <level> | share <member> <person> <grade>
  case ${1:-} in
    access) (($# == 3)) && is "$NAME_RE" "$2" && [[ $LEVELS == *" $3 "* ]] || fail "access <member> <private|listed|org-view|org-converse>" ;;
    share) (($# == 4)) && is "$NAME_RE" "$2" && is "$NAME_RE" "$3" && [[ $GRADES == *" $4 "* ]] || fail "share <member> <person> <list|view|converse|approve|none>" ;;
    *) fail "access <member> <level> | share <member> <person> <grade>" ;;
  esac
}
reach_words() {
  local verb=$1 t; shift
  case $verb in
    as-session)
      reach_only "$verb"
      is "$UUID_RE" "${1:-}" || fail "as-session <session> <subverb> …: a session id"
      case ${2:-} in
        say) is "$TOKEN_RE" "${3:-}" && (($# >= 4)) || fail "as-session <session> say <token> <tag>…"; for t in "${@:4}"; do is "$TAG_RE" "$t" || fail "a tag <alias>[:<short>], not $t"; done ;;
        access | share) member_change "${@:2}" ;;
        spawn) (($# == 3)) && is '^[a-z0-9][a-z0-9-]{0,62}$' "$3" || fail "as-session <session> spawn <alias>" ;;
        list-org) (($# == 2)) || fail "as-session <session> list-org" ;;
        find) (($# == 3)) && is "$NAME_RE" "$3" || fail "as-session <session> find <name>" ;;
        *) fail "as-session <session> say|access|share|spawn|list-org|find …" ;;
      esac ;;
    operator) reach_only "$verb"; member_change "$@" ;;
    operator-say) reach_only "$verb"; (($# == 2)) && is "$TOKEN_RE" "$1" && is "$TAG_RE" "$2" || fail "operator-say <token> <tag>" ;;
    forge-say) reach_only "$verb"; (($# == 4)) && is "$UUID_RE" "$1" && is "$UUID_RE" "$2" && is '^[a-z0-9][a-z0-9-]{0,62}$' "$3" && is "$TOKEN_RE" "$4" || fail "forge-say <writer session> <recipient session> <alias> <token>" ;;
    grep-home) reach_only "$verb"; is '^[A-Za-z0-9._:-]{4,64}$' "${1:-}" && { (($# == 1)) || { (($# == 3)) && [[ $2 == --after ]] && is "$TS_RE" "$3"; }; } || fail "grep-home <token> [--after <ts>]" ;;
    archive-ls) reach_only "$verb"; for t in "$@"; do is '^[A-Za-z0-9._:-]{4,64}$' "$t" || fail "archive-ls [token…]: not a token: $t"; done ;;
    events) reach_only "$verb"; (($# == 1)) && is '^[A-Za-z0-9._:-]{4,64}$' "$1" || fail "events <token>" ;;
    row) reach_only "$verb"; (($# == 2)) && is "$UUID_RE" "$1" && is "$TOKEN_RE" "$2" || fail "row <session> <token>" ;;
    log-files | uplink | streams | audiences | policy-cache | owed | archive-evidence | mawsd-freeze | mawsd-thaw | mawsd-stop | mawsd-start) reach_only "$verb"; (($# == 0)) || fail "$verb takes no words" ;;
  esac
}

project_id() { local p; p=$(cat $R/project 2>/dev/null) && is "$UUID_RE" "$p" && say "$p" || fail "no project: lane-a-up first"; }
project_home() { say "$S/projects/$(project_id)"; }
# A session the scene started (lane A's, or a seat one of its sessions spawned): the only shells as-session opens.
# grep reads both files itself: under pipefail, `cat` failing on a seats file not written yet failed the pipeline
# whatever grep found. With -q, a selected line exits 0 even when one file is missing.
known_session() { grep -qxF -- "$1" $R/session $R/seats 2>/dev/null || fail "not a session of this scene: $1"; }
# sminos, as the scene's user in its namespace, from the checkout; `env…` assignments first (none: the operator).
scene_sminos() {
  local -a extra=()
  while [[ ${1:-} == *=* ]]; do extra+=("$1"); shift; done
  inns runuser -u $U -- env -i "${SCENE_ENV[@]}" "${extra[@]}" bash -c 'cd "$1" && shift && exec "$@"' bash "$W" "$SMINOS" "$@"
}
# A say's text from its tags: `<alias>[:<short>]` as `@<alias>[#<short>]`, then `hello <token>`.
say_text() { local token=$1 t out=""; shift; for t in "$@"; do out+="@${t/:/#} "; done; say "${out}hello $token"; }

as_session() {
  local sid=$1 sub=$2 out rc; shift 2
  known_session "$sid"
  case $sub in
    say) scene_sminos "CLAUDE_CODE_SESSION_ID=$sid" say "$(say_text "$@")" ;;
    access | share) scene_sminos "CLAUDE_CODE_SESSION_ID=$sid" "$sub" "$@" ;;
    spawn)
      out=$(scene_sminos "CLAUDE_CODE_SESSION_ID=$sid" spawn "$1" "$TX: a spawn; answer ok" --cwd "$W" 2>&1); rc=$?
      say "$out"
      sed -n 's|^seat [a-z-]*: .*\[[0-9a-z]* / \([0-9a-f-]\{36\}\)\].*|\1|p' <<<"$out" | tail -1 >>$R/seats
      return $rc ;;
    list-org) scene_sminos "CLAUDE_CODE_SESSION_ID=$sid" list --org --json ;;
    find) scene_sminos "CLAUDE_CODE_SESSION_ID=$sid" find "$1" --org --json ;;
  esac
}

# The operator at a terminal: sminos under a pty this script holds (pty.fork: the child's controlling terminal, its
# /dev/tty, is the pty), the confirmation answered `y` once sminos asks, everything it prints passed on, its status
# the verb's; bounded at 120 s. Staging's org alone: a scene enrolled elsewhere is refused before sminos runs.
PTY_PY='
import os, pty, signal, sys, time
cwd, argv = sys.argv[1], sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execv(argv[0], argv)
signal.signal(signal.SIGALRM, lambda *_: (os.kill(pid, signal.SIGKILL), print("operator: no end within 120 s")))
signal.alarm(120)
seen, answered = b"", False
while True:
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    seen += chunk
    if not answered and b"Confirm? [y/N]" in seen:
        os.write(fd, b"y\n")
        answered = True
_, status = os.waitpid(pid, 0)
sys.stdout.write(seen.decode("utf-8", "replace").replace("\r", ""))
print("operator: %s" % ("confirmed" if answered else "not asked"))
sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else (status >> 8))
'
operator() {
  local org
  org=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["org"])' $S/daemon/identity.json 2>/dev/null) || fail "operator: no identity.json: the scene's sminos is not cut over"
  [[ $org == "$STAGING_ORG" ]] || fail "operator: the pty path widens at staging's org ($STAGING_ORG) alone, and this scene is enrolled in ${org:-none}"
  inns runuser -u $U -- env -i "${SCENE_ENV[@]}" python3 -I -c "$PTY_PY" "$W" "$SMINOS" "$@"
}

# A `say` under the plain writer of session $1, to $2 (as the alias $3), appended by sminos.log_append itself: what a
# sender that skips stream_for would write (acceptance 3c's forged say).
FORGE_PY='
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.realpath(sys.argv[1])))
import sminos as S
_, writer, recipient, alias, token = sys.argv[1:]
project = S.caller_project(S.caller_seat())
if project is None:
    sys.exit("forge-say: the checkout is in no project")
caller = S.caller_seat()
e = S.log_append(project, S.writer_id(writer), "say", **{"from": caller["alias"] if caller else S.default_from(""), "to": [{"session": recipient, "alias": alias}], "text": "@%s hello %s" % (alias, token)})
print(json.dumps({"writer": e["writer"], "seq": e["seq"]}))
'
forge_say() {
  known_session "$1"
  inns runuser -u $U -- env -i "${SCENE_ENV[@]}" "CLAUDE_CODE_SESSION_ID=$1" bash -c 'cd "$1" && shift && exec python3 -I -c "$@"' bash "$W" "$FORGE_PY" "$SMINOS" "$@"
}

GREP_PY='
import json, os, sys
root, token, after = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else None)
total = 0
for d, _, files in os.walk(root):
    for f in sorted(files):
        path = os.path.join(d, f)
        n = 0
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if token not in line:
                        continue
                    if after is not None:
                        try:
                            ts = json.loads(line).get("ts")
                        except (ValueError, AttributeError):
                            ts = None
                        if isinstance(ts, str) and ts <= after:
                            continue
                    n += 1
        except OSError:
            continue
        if n:
            print(n, os.path.relpath(path, root))
            total += n
print("total", total)
'
# Each event of the project's log files holding the token: `event <json>`, its writer, seq, ts, kind, session, text
# (at most 300 characters), withheld, audience and verified (the signer and owners sminos stored an arriving event
# with), the run's own markers and ids alone.
EVENTS_PY='
import glob, json, os, sys
for path in sorted(glob.glob(os.path.join(sys.argv[1], "*.jsonl"))):
    for line in open(path, encoding="utf-8", errors="replace"):
        if sys.argv[2] not in line:
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict):
            keep = {k: e[k] for k in ("writer", "seq", "ts", "kind", "session", "withheld", "audience", "verified") if k in e}
            if isinstance(e.get("text"), str):
                keep["text"] = e["text"][:300]
            keep["file"] = os.path.basename(path)
            print("event", json.dumps(keep, separators=(",", ":")))
'
# A JSON file printed on one line, or `none`.
json_of() { if [[ -f $1 ]]; then python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), separators=(",", ":")))' "$1"; else say none; fi; }

EVIDENCE_PY='
import json, os, sys
home = sys.argv[1]
def read(name):
    try:
        with open(os.path.join(home, name)) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return None
for name, label, keys in (("uplink.json", "uplink", ("archive", "archive_at", "archive_have")), ("project.json", "project", ("remote", "hub", "root")), ("daemon.json", "record", ("archive", "error", "tick"))):
    d = read(name)
    print(label, "none" if d is None else json.dumps({k: d.get(k) for k in keys}, separators=(",", ":")))
'
# What the archive runs on, read as root (the daemon's environment by name alone: the scene's stub token is in it).
archive_evidence() {
  local h pid every out rc
  h=$(project_home) || fail "$h"
  python3 -c "$EVIDENCE_PY" "$h"
  pid=$(pgrep -u $U -f -- 'daemon run' | head -1)
  if [[ -n $pid ]]; then
    every=$(tr '\0' '\n' </proc/$pid/environ | sed -n 's/^SMINOS_ARCHIVE_EVERY=//p')
    say "daemon $pid SMINOS_ARCHIVE_EVERY=${every:-unset}; $U in $(id -nG $U)"
  else say "daemon none running for $U"; fi
  out=$(inns runuser -u $U -- env -i "${SCENE_ENV[@]}" git ls-remote "$ARCHIVE" 2>&1); rc=$?
  say "ls-remote $ARCHIVE as $U: rc $rc $(printf '%s' "$out" | tail -3 | tr '\n' ' ')"
  grep -E 'archive|have|designat' $S/daemon.log 2>/dev/null | tail -40 | sed 's/^/log /'
  true
}

archive_ls() {
  local -a git=(git -c "safe.directory=$ARCHIVE" --git-dir="$ARCHIVE")
  [[ -d $ARCHIVE ]] || fail "no archive at $ARCHIVE: run setup.sh"
  if ! "${git[@]}" rev-parse -q --verify "main^{commit}" >/dev/null; then say "archive: no commit on main"; return 0; fi
  say "archive: main at $("${git[@]}" rev-parse --short=12 main)"
  "${git[@]}" ls-tree -r --name-only main | sed 's/^/file /'
  # Each tombstone a file on main holds (`{writer, seq, withheld: true}`): `tomb <path> <seq>`.
  "${git[@]}" ls-tree -r --name-only main | while read -r f; do
    "${git[@]}" show "main:$f" 2>/dev/null | python3 -c '
import json, sys
for line in sys.stdin:
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if isinstance(e, dict) and e.get("withheld") is True:
        print("tomb", sys.argv[1], e.get("seq"))' "$f"
  done
  for t in "$@"; do say "token $t $("${git[@]}" grep -c -F -e "$t" main 2>/dev/null | awk -F: '{n += $NF} END {print n + 0}')"; done
}

# mawsd's process and what it started (its engine host's children), each signalled.
mawsd_tree() { local p; p=$(mawsd_pid) && [[ -n $p ]] && tree "$p"; }
freeze() {
  local pids; pids=$(mawsd_tree) || fail "no scratch mawsd running"
  kill "-$1" $pids || fail "kill -$1 failed"
  say "mawsd pid $(mawsd_pid): SIG$1 to $(wc -w <<<"$pids" | tr -d ' ') process(es)"
}
mawsd_stop() {
  local p pids; p=$(mawsd_pid); [[ -n $p ]] || fail "no scratch mawsd running"
  pids=$(tree "$p"); [[ -n $pids ]] && kill -CONT $pids 2>/dev/null # a frozen mawsd ends on TERM only once continued
  kill -TERM "$p"
  within 30 bash -c "! pgrep -u $U -f -- '$MAWSD_JS run --unit' >/dev/null" || { kill -KILL "$p" 2>/dev/null; within 10 bash -c "! pgrep -u $U -f -- '$MAWSD_JS run --unit' >/dev/null" || fail "mawsd pid $p did not end"; }
  # Its loop ends with it (any status but restart's 75); a loop left would start it again.
  pkill -u $U -f -- "while :; do" 2>/dev/null
  [[ $(ss -ltnH "( sport = :$DIRECT_PORT )" | wc -l) == 0 ]] || fail "mawsd ended, and something still listens on port $DIRECT_PORT"
  say "mawsd stopped (pid $p): nothing of it runs"
}
mawsd_start() {
  local before; before=$(serving)
  [[ -z $(mawsd_pid) ]] || fail "mawsd is running already: pid $(mawsd_pid)"
  start_mawsd
  within 90 served $((before + 1)) || { tail -5 $R/mawsd.out; fail "mawsd did not serve again within 90 s"; }
  say "serving again: mawsd pid $(mawsd_pid)"
}

params() {
  say "scene: ${SCENE_NAME:-o10}"
  say "user: $U"
  say "home: $H"
  say "opt: $O"
  say "ports: direct $DIRECT_PORT, stub $STUB_PORT"
  say "tmux: $TX"
  say "verbs: $VERBS"
  say "self: $SELF_MATCH"
  say "sminos: $SMINOS"
  say "pack: $PACK"
  say "archive: ${ARCHIVE:-none}"
}

verb=${1:-}; (($#)) && shift
reach_words "$verb" "$@"
case $verb in check | down | params | "") ;; *) register "$verb" || fail "cannot register the verb $verb" ;; esac
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
  started) for f in session seat.session lane-b.session; do [[ -s $R/$f ]] && say "${f%.session} $(head -1 $R/$f)"; done; [[ -s $R/seats ]] && sed -n 's/^\([0-9a-f-]\{36\}\)$/seat \1/p' $R/seats; true ;;
  down) stop_verbs; v=$?; down; d=$?; exit $((v | d)) ;;
  params) params ;;
  as-session) as_session "$@" ;;
  operator) operator "$@" ;;
  operator-say) scene_sminos say "$(say_text "$1" "$2")" ;;
  forge-say) forge_say "$@" ;;
  row) row "$1" "$2" ;;
  events) h=$(project_home) || fail "$h"; python3 -c "$EVENTS_PY" "$h/log" "$1" ;;
  log-files) h=$(project_home) || fail "$h"; for f in "$h"/log/*.jsonl; do [[ -f $f ]] && say "$(basename "$f") $(stat -c %s "$f")"; done; true ;;
  uplink) h=$(project_home) || fail "$h"; json_of "$h/uplink.json" ;;
  streams) h=$(project_home) || fail "$h"; json_of "$h/streams.json" ;;
  audiences) json_of $S/daemon/audiences.json ;;
  policy-cache) f=$(find $P -path '*/policy/cache.json' -type f 2>/dev/null | head -1); json_of "${f:-$P/none}" ;;
  grep-home) python3 -c "$GREP_PY" "$S" "$1" ${3:+"$3"} ;;
  owed) scene_sminos daemon owed ;;
  archive-ls) archive_ls "$@" ;;
  archive-evidence) archive_evidence ;;
  mawsd-freeze) freeze STOP ;;
  mawsd-thaw) freeze CONT ;;
  mawsd-stop) mawsd_stop ;;
  mawsd-start) mawsd_start ;;
  *) fail "scene.sh [--scene a1|a2|b1|a3] check | up | enroll <name> | mawsd <args…> | restart | cut-hub | listening | log-size <log> | log-since <log> <bytes> | lane-a-up <project> <name> | lane-a-stop | lane-a-resume | transcript <session> [token] | sminos-status | sminos-revoked | imported <token> | local-spawn <alias> | retire <alias> | lane-b-up <tag> | lane-b-events <app> | started | down | params | as-session <session> <sub…> | operator access|share … | operator-say <token> <tag> | forge-say <writer> <recipient> <alias> <token> | row <session> <token> | events <token> | log-files | uplink | streams | audiences | policy-cache | grep-home <token> [--after <ts>] | owed | archive-ls [token…] | archive-evidence | mawsd-freeze | mawsd-thaw | mawsd-stop | mawsd-start" ;;
esac
