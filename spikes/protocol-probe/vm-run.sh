#!/usr/bin/env bash
# vm-run.sh: the one way to launch a probe engine on a devcloud VM (VM.md beside this file says how to use it).
#
# A devcloud VM is set up like the owner's Macs: /etc/claude-code/managed-settings.json routes every engine through
# the owner's gateway and prepends the owner's plugins whatever --setting-sources says, and the owner's home holds
# their instructions, skills, settings and credentials. This script runs one command so that the engines it starts
# match the owner's sessions on the axes a probe reads, and nothing else of the owner's:
#   1. Claude Code $ENGINE_VERSION from a copy of its own under /opt/maws-probe, so the VM's self-updating
#      installation can move without moving the probes (DISABLE_AUTOUPDATER keeps the copy where it is).
#   2. The gateway through a loopback forward at 127.0.0.1:8641, the address MAWS's launch line and the scenarios'
#      RELAY_ENV use. The forward reads the gateway's address from the managed settings itself and the token only
#      travels in the environment, so neither is printed, logged or on a command line `ps` shows.
#   3. A scratch HOME under /tmp whose .claude.json carries the owner's feature-gate cache (gated tools such as
#      Monitor exist only with it; the gateway route does not fetch one) and the first-run dialogs marked seen, with
#      a trusted scratch repository to work in; the harness seeds the same cache into any config home a scenario
#      makes for itself (PROBE_FEATURE_CACHE).
#   4. A private mount namespace that hides, from this command's processes alone, the managed settings (unless
#      --managed) and the owner's ~/.claude, ~/.claude.json, ~/.config and ~/.ssh.
#   5. An environment built from nothing: the base keys, the route, the managed settings' engine switches, the
#      PROBE_* paths and what -e names.
# Usage:
#   vm-run.sh [opts] run <script.mjs> [args...]     node <script> in this folder (run-pass3.mjs <scenario>, vm-check.mjs)
#   vm-run.sh [opts] term <name> [claude flags...]  an interactive engine in tmux on socket and session <name>
# Options: --managed (leave the managed settings, so the owner's plugins load), --out DIR (fixtures go under DIR
#   instead of this folder), --prefix P (scratch folders /tmp/P-*; default uxprobe), -e NAME=VALUE (a scenario knob;
#   never a secret: it is on this command line).
set -euo pipefail
ENGINE_VERSION=2.1.322
OPT=/opt/maws-probe
ENGINE=$OPT/engines/$ENGINE_VERSION
FEATURES=$OPT/growthbook-features.json
MANAGED=/etc/claude-code/managed-settings.json
HERE=$(cd "$(dirname "$0")" && pwd)

if [[ ${1:-} == __inner ]]; then # as root, inside the new mount namespace
  shift
  [[ $VMRUN_MANAGED == 1 ]] || mount -t tmpfs -o mode=755 tmpfs /etc/claude-code
  for d in .claude .config .ssh; do [[ -d $VMRUN_OWNER_HOME/$d ]] && mount -t tmpfs -o mode=700 tmpfs "$VMRUN_OWNER_HOME/$d"; done
  [[ -f $VMRUN_OWNER_HOME/.claude.json ]] && mount --bind /dev/null "$VMRUN_OWNER_HOME/.claude.json"
  uid=$VMRUN_UID gid=$VMRUN_GID user=$VMRUN_USER cwd=$PROBE_CWD keep=" $VMRUN_KEEP "
  for v in $(compgen -e); do [[ $keep == *" $v "* ]] || unset "$v"; done
  export USER=$user LOGNAME=$user
  cd "$cwd"
  exec setpriv --reuid="$uid" --regid="$gid" --init-groups -- "$@"
fi

[[ $(id -u) != 0 ]] || { echo "vm-run.sh: run it as the VM's user, not root" >&2; exit 2; }
managed=0 out= prefix=uxprobe extra=()
while [[ ${1:-} == -* ]]; do case $1 in
  --managed) managed=1; shift;; --out) out=$(realpath -m "$2"); shift 2;; --prefix) prefix=$2; shift 2;;
  -e) extra+=("$2"); shift 2;; *) echo "vm-run.sh: unknown option $1" >&2; exit 2;; esac; done
mode=${1:-}; shift || true
[[ $mode == run || $mode == term ]] && [[ $# -ge 1 ]] || { sed -n '/^# Usage/,/^set -e/p' "$0" | sed '$d'; exit 2; }

# 1. The pinned engine: a copy of the VM's own when it has this version, else the official installer in a throwaway HOME.
if [[ ! -x $ENGINE ]]; then
  sudo mkdir -p "$OPT/engines" "$OPT/bin"
  src=$HOME/.local/share/claude/versions/$ENGINE_VERSION
  if [[ ! -x $src ]]; then t=$(mktemp -d); curl -fsSL https://claude.ai/install.sh | HOME=$t bash -s "$ENGINE_VERSION" >/dev/null; src=$t/.local/share/claude/versions/$ENGINE_VERSION; fi
  sudo install -m 755 "$src" "$ENGINE"; sudo ln -sf "$ENGINE" "$OPT/bin/claude"
fi
[[ $("$ENGINE" --version) == "$ENGINE_VERSION "* ]] || { echo "vm-run.sh: $ENGINE is not $ENGINE_VERSION" >&2; exit 1; }

# 2. The loopback forward, once per VM, as a transient systemd unit with no user of its own.
if ! (exec 3<>/dev/tcp/127.0.0.1/8641) 2>/dev/null; then
  sudo tee "$OPT/forward.mjs" >/dev/null <<'JS'
import net from 'node:net';import {readFileSync} from 'node:fs';
const u=new URL(JSON.parse(readFileSync('/etc/claude-code/managed-settings.json','utf8')).env.ANTHROPIC_BASE_URL);
if(u.protocol!=='http:')throw new Error('the gateway is not plain http; a TCP forward cannot carry it');
net.createServer(c=>{const s=net.connect(+u.port||80,u.hostname);c.pipe(s).pipe(c);c.on('error',()=>s.destroy());s.on('error',()=>c.destroy());}).listen(8641,'127.0.0.1');
JS
  sudo systemd-run --quiet --unit=maws-probe-forward -p DynamicUser=yes -p Restart=always /usr/bin/node "$OPT/forward.mjs"
  sleep 1
fi

# 3. The scratch HOME, its seeded .claude.json and the trusted scratch repository.
[[ -r $FEATURES ]] || { echo "vm-run.sh: $FEATURES is missing; copy it from a Mac (VM.md, Setup)" >&2; exit 1; }
root=$(mktemp -d "/tmp/$prefix-XXXXXX"); home=$root/home; work=$root/work
mkdir -p "$home/.claude" "$work"; echo '{}' > "$home/.claude/settings.json"
git -C "$work" init -q && echo ONE > "$work/one.txt" && git -C "$work" add one.txt && git -C "$work" -c user.name=Probe -c user.email=probe@localhost commit -qm seed
python3 -I - "$FEATURES" "$home/.claude.json" "$work" <<'PY'
import json,sys,time
feat,dest,work=sys.argv[1:]
d={'hasCompletedOnboarding':True,'hasResetAutoModeOptInForDefaultOffer':True,'hasSeenAutoDefaultNudge':True,'hasSeenAutoModeEntryWarning':True,'hasSeenAutoDefaultNotice':True,'autoModeClassifierBillingNoticeAcknowledgedAt':int(time.time()*1000),'projects':{work:{'hasTrustDialogAccepted':True,'hasCompletedProjectOnboarding':True}},**json.load(open(feat))}
json.dump(d,open(dest,'w'))
PY

# 5. The environment (the token is read here into this shell's environment; nothing prints it).
switches=()
while IFS= read -r -d '' kv; do export "$kv"; switches+=("${kv%%=*}"); done < <(python3 -I - "$MANAGED" <<'PY'
import json,sys
env=json.load(open(sys.argv[1])).get('env',{})
skip=('ANTHROPIC_BASE_URL','OTEL_','PLAYWRIGHT_','CLAUDE_CODE_PLUGIN_DIRS')
for k,v in env.items():
  if not k.startswith(skip): sys.stdout.write(f'{k}={v}\0')
PY
)
export ANTHROPIC_BASE_URL=http://127.0.0.1:8641 HOME=$home PATH=$OPT/bin:/usr/local/bin:/usr/bin:/bin SHELL=/bin/bash LANG=C.UTF-8 TMPDIR=/tmp \
  DISABLE_AUTOUPDATER=1 PROBE_ENGINE=$ENGINE MAWS_E2E_ENGINE_BIN=$ENGINE PROBE_FEATURE_CACHE=$FEATURES PROBE_ROOT=$root PROBE_WORK=$work
[[ -n $out ]] && export PROBE_FIXTURE_ROOT=$out
for kv in ${extra[@]+"${extra[@]}"}; do export "$kv"; done
keep="ANTHROPIC_BASE_URL HOME PATH SHELL LANG TMPDIR TERM DISABLE_AUTOUPDATER PROBE_ENGINE MAWS_E2E_ENGINE_BIN PROBE_FEATURE_CACHE PROBE_ROOT PROBE_WORK ${out:+PROBE_FIXTURE_ROOT} ${switches[*]} ${extra[@]+${extra[@]%%=*}}"
export VMRUN_KEEP=$keep VMRUN_MANAGED=$managed VMRUN_OWNER_HOME=$(getent passwd "$(id -un)" | cut -d: -f6) VMRUN_UID=$(id -u) VMRUN_GID=$(id -g) VMRUN_USER=$(id -un)
echo "vm-run.sh: engine $ENGINE_VERSION, scratch $root, managed settings $([[ $managed == 1 ]] && echo kept || echo hidden)" >&2

# 4. The namespace, then the command.
pass=$(echo "$keep VMRUN_KEEP VMRUN_MANAGED VMRUN_OWNER_HOME VMRUN_UID VMRUN_GID VMRUN_USER PROBE_CWD" | tr -s ' ' ',' | sed 's/^,//;s/,$//')
if [[ $mode == run ]]; then
  export TERM=dumb PROBE_CWD=$HERE
  exec sudo -n --preserve-env="$pass" unshare --mount --propagation private -- "$0" __inner node "$@"
fi
name=$1; shift
export TERM=xterm-256color PROBE_CWD=$work
sudo -n --preserve-env="$pass" unshare --mount --propagation private -- "$0" __inner \
  tmux -L "$name" new-session -d -s "$name" -x 160 -y 48 -c "$work" "$ENGINE" "$@"
echo "vm-run.sh: tmux -L $name (session $name) in $work; read it with: tmux -L $name capture-pane -p -t $name" >&2
