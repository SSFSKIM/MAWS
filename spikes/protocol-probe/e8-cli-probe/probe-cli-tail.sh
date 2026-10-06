#!/bin/zsh
# E8 G0 probe, tail: uninstall and marketplace remove after the reload probe ran over the installed plugin.
set -u
ROOT=${E8_ROOT:?set E8_ROOT}
BIN=${E8_BIN:?set E8_BIN}
CFG=$ROOT/claude-config
LOG=$ROOT/g0-cli-probe.txt
export CLAUDE_CONFIG_DIR=$CFG
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SSE_PORT
export DISABLE_AUTOUPDATER=1
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
log ""; log "=== TAIL · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
run "uninstall e8-probe@e8-scratch" plugin uninstall e8-probe@e8-scratch --json
run "uninstall again (error shape)" plugin uninstall e8-probe@e8-scratch --json
run "marketplace remove e8-scratch" plugin marketplace remove e8-scratch --json
run "marketplace remove again (error shape)" plugin marketplace remove e8-scratch --json
run "marketplace list (after remove)" plugin marketplace list --json
run "plugin list (after remove)" plugin list --json
