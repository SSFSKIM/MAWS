#!/bin/zsh
# E8 G0 probe: the engine's plugin CLI under a scratch CLAUDE_CONFIG_DIR against a scratch local-directory marketplace.
# Every mutation runs with --json; after each step the scratch home's registry files are snapshotted. Nothing here
# reads or writes the owner's ~/.claude or ~/.claude.json (the delta check runs around the whole probe).
set -u
ROOT=${E8_ROOT:?set E8_ROOT}
BIN=${E8_BIN:?set E8_BIN}
CFG=$ROOT/claude-config
MKT=$ROOT/market
LOG=$ROOT/g0-cli-probe.txt
export CLAUDE_CONFIG_DIR=$CFG
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SSE_PORT
export DISABLE_AUTOUPDATER=1

mkdir -p "$CFG" "$MKT/.claude-plugin" "$MKT/plugins/e8-probe/.claude-plugin" "$MKT/plugins/e8-probe/skills/e8-hello" "$MKT/plugins/e8-probe/commands"
print -r -- '{}' > "$CFG/settings.json"
print -r -- '{"hasCompletedOnboarding":true,"theme":"light","projects":{}}' > "$CFG/.claude.json"
cat > "$MKT/.claude-plugin/marketplace.json" <<'EOF'
{
  "name": "e8-scratch",
  "owner": { "name": "E8 probe" },
  "description": "A scratch marketplace for the E8 grounding probe",
  "plugins": [
    { "name": "e8-probe", "source": "./plugins/e8-probe", "description": "One skill and one command, for the probe" }
  ]
}
EOF
cat > "$MKT/plugins/e8-probe/.claude-plugin/plugin.json" <<'EOF'
{ "name": "e8-probe", "version": "0.1.0", "description": "E8 grounding probe plugin", "author": { "name": "E8 probe" } }
EOF
cat > "$MKT/plugins/e8-probe/skills/e8-hello/SKILL.md" <<'EOF'
---
name: e8-hello
description: Says hello from the E8 probe plugin.
---
Reply with exactly: hello from e8-probe.
EOF
cat > "$MKT/plugins/e8-probe/commands/e8-ping.md" <<'EOF'
---
description: Answers pong, for the E8 probe.
---
Reply with exactly: pong.
EOF

log() { print -r -- "$@" >> "$LOG"; }
snap() {
  log "--- files after: $1"
  for f in settings.json plugins/known_marketplaces.json plugins/installed_plugins.json .claude.json; do
    if [[ -f $CFG/$f ]]; then log "## $f"; python3 -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1])),indent=1,sort_keys=True))" "$CFG/$f" >> "$LOG" 2>&1; else log "## $f (absent)"; fi
  done
  log "## plugins/ tree"; (cd "$CFG" 2>/dev/null && find plugins -maxdepth 4 -not -path '*/.git/*' 2>/dev/null | sort) >> "$LOG"
}
run() {
  local label=$1; shift
  log ""; log "=== $label"; log "\$ claude $*"
  local out err rc
  out=$("$BIN" "$@" 2>"$ROOT/stderr.tmp"); rc=$?
  err=$(cat "$ROOT/stderr.tmp")
  log "exit $rc"; log "stdout:"; print -r -- "$out" >> "$LOG"; [[ -n $err ]] && { log "stderr:"; print -r -- "$err" >> "$LOG"; }
  snap "$label"
}

: > "$LOG"
log "E8 G0 CLI probe · $(date -u +%Y-%m-%dT%H:%M:%SZ) · bin $BIN · $($BIN --version 2>&1 | head -1) · CLAUDE_CONFIG_DIR=$CFG · marketplace $MKT"
snap "setup"
run "validate the scratch marketplace" plugin validate "$MKT" --json
run "marketplace list (empty home)" plugin marketplace list --json
run "marketplace add (directory)" plugin marketplace add "$MKT" --json
run "marketplace list (after add)" plugin marketplace list --json
run "plugin list --available" plugin list --json --available
run "install e8-probe@e8-scratch" plugin install e8-probe@e8-scratch --json
run "plugin list (after install)" plugin list --json
run "disable e8-probe@e8-scratch" plugin disable e8-probe@e8-scratch --json
run "disable again (no-op)" plugin disable e8-probe@e8-scratch --json
run "enable e8-probe@e8-scratch" plugin enable e8-probe@e8-scratch --json
run "update e8-probe@e8-scratch" plugin update e8-probe@e8-scratch --json
run "marketplace update e8-scratch" plugin marketplace update e8-scratch --json
run "install unknown plugin (error shape)" plugin install nope@e8-scratch --json
run "marketplace add unknown directory (error shape)" plugin marketplace add /tmp/e8-does-not-exist --json
run "marketplace add again (idempotence)" plugin marketplace add "$MKT" --json
log ""; log "=== STOP: plugin kept installed and enabled for the reload probe; uninstall and marketplace remove run in probe-cli-tail.sh"
