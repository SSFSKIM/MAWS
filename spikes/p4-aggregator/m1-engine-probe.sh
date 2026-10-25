#!/bin/bash
# P4-AGG M1's scratch probe of the unmodified engine (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md,
# M1 Decisions): what the e2e harness rests on, measured against the binary the group pins, in a scratch HOME and
# CLAUDE_CONFIG_DIR under /tmp that the probe removes, with nothing of the caller's environment (`env -i`).
#   1. a fresh configuration's marketplaces, and `plugin list --available` with the engine's Anthropic Directory on
#      (its default; this step reads api.anthropic.com) and then turned off by `<config>/plugins/plugin-directory-
#      marketplace.json` = {"enabled": false} (the on/off file whose path M1 confirms);
#   2. the local test marketplace (e2e/fixtures/catalog/marketplace) added by its absolute path and `skills-only`
#      installed at user scope, offline, then the listings;
#   3. the Keychain service name a scratch CLAUDE_CONFIG_DIR's secure storage uses: `mcp add --client-secret` stores a
#      client secret there with no session and no network. The probe derives the exact name (`Claude Code-credentials-`
#      + the first 8 hex of sha256 of the directory as given, NFC) and requires it absent before. Two arms: under the
#      scratch HOME (whose `security` sees no login keychain) and under the caller's HOME with the same scratch
#      CLAUDE_CONFIG_DIR; after each it checks the item and `<config>/.credentials.json`, then deletes exactly that name
#      and checks it gone. Nothing else is read or removed.
#   spikes/p4-aggregator/m1-engine-probe.sh [engine]   (default ~/.local/share/claude/versions/2.1.309)
set -euo pipefail
engine=${1:-$HOME/.local/share/claude/versions/2.1.309}
repo=$(cd "$(dirname "$0")/../.." && pwd)
root=$(mktemp -d /tmp/maws-agg-m1-probe.XXXXXX)
config=$root/config
home=$root/home
mkdir -p "$config" "$home"
item="Claude Code-credentials-$(printf '%s' "$config" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(require("crypto").createHash("sha256").update(s.normalize("NFC")).digest("hex").slice(0,8)))')"
[[ $item =~ ^Claude\ Code-credentials-[0-9a-f]{8}$ ]] || { echo "refused: $item" >&2; exit 1; }
# Fail closed: only `security`'s item-not-found status (44) means absent; any other lookup failure, a deletion that
# fails or an item that survives its deletion stops the probe with a failure.
lookup() {
  local status=0
  security find-generic-password -s "$item" >/dev/null 2>&1 || status=$?
  case $status in
    0) state=present ;;
    44) state=absent ;;
    *) echo "probe: the lookup of \"$item\" failed (security exited $status)" >&2; exit 1 ;;
  esac
}
remove() {
  local status=0
  security delete-generic-password -s "$item" >/dev/null 2>&1 || status=$?
  (( status == 0 )) || { echo "probe: could not delete \"$item\" (security exited $status)" >&2; exit 1; }
  lookup
  [[ $state == absent ]] || { echo "probe: \"$item\" is still in the Keychain after its deletion" >&2; exit 1; }
}
created=0
cleanup() {
  local status=$? kept=0
  if (( created )); then (lookup; if [[ $state == present ]]; then remove; fi) || kept=1; fi
  rm -rf "$root"
  if (( kept )); then echo "probe: the Keychain item \"$item\" was not cleaned up" >&2; exit 1; fi
  exit "$status"
}
trap cleanup EXIT
run() { env -i HOME="$home" CLAUDE_CONFIG_DIR="$config" PATH=/usr/bin:/bin DISABLE_AUTOUPDATER=1 TERM=dumb "$engine" "$@" 2>&1; }
count() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const a=j.available??[];const by={};for(const p of a)by[p.marketplaceName]=(by[p.marketplaceName]??0)+1;console.log(JSON.stringify({installed:(j.installed??[]).length,available:a.length,byMarketplace:by}))})'; }

echo "engine: $engine · $("$engine" --version) · sha256 $(shasum -a 256 "$engine" | cut -d' ' -f1)"
echo "config: $config (exact Keychain service name: $item)"

echo; echo '== 1. a fresh configuration'
echo "marketplace list: $(run plugin marketplace list --json | tr -d '\n' | cut -c1-400)"
start=$(date +%s)
echo "available, directory at its default: $(run plugin list --json --available | count) in $(( $(date +%s) - start )) s"
echo "plugins folder after: $(cd "$config" && find plugins -maxdepth 1 2>/dev/null | sort | tr '\n' ' ')"
mkdir -p "$config/plugins"
printf '{"enabled": false}\n' >"$config/plugins/plugin-directory-marketplace.json"
start=$(date +%s)
echo "available, on/off file {\"enabled\": false}: $(run plugin list --json --available | count) in $(( $(date +%s) - start )) s"
echo "marketplace list: $(run plugin marketplace list --json | tr -d '\n' | cut -c1-400)"

echo; echo '== 2. the local test marketplace, offline'
cp -R "$repo/e2e/fixtures/catalog/marketplace" "$root/market"
echo "marketplace add: $(run plugin marketplace add "$root/market" --scope user | tail -1)"
echo "install skills-only: $(run plugin install skills-only@maws-discover-test --scope user --json | tr -d '\n' | cut -c1-400)"
echo "list: $(run plugin list --json --available | count)"
echo "settings.json: $(tr -d '\n ' <"$config/settings.json")"

echo; echo '== 3. the Keychain service name of this CLAUDE_CONFIG_DIR'
lookup
[[ $state == absent ]] || { echo "refused: $item exists before the probe" >&2; exit 1; }
echo "before: absent"
created=1
store() { # $1: the HOME the engine runs under; $2: the server name
  echo "mcp add ($2): $(env -i HOME="$1" CLAUDE_CONFIG_DIR="$config" PATH=/usr/bin:/bin DISABLE_AUTOUPDATER=1 TERM=dumb MCP_CLIENT_SECRET=m1-probe-secret "$engine" mcp add --transport http --client-id m1-probe --client-secret --scope user "$2" http://127.0.0.1:9/mcp 2>&1 | tr '\n' ' ')"
  lookup
  if [[ $state == present ]]; then echo "  item: present under exactly \"$item\""; else echo "  item: absent"; fi
  if [[ -e $config/.credentials.json ]]; then echo "  .credentials.json: present"; else echo "  .credentials.json: absent"; fi
  if [[ $state == present ]]; then
    remove
    echo "  deleted: $item; gone: yes"
  fi
}
echo "arm a: HOME=$home (scratch)"; store "$home" m1-scratch-home
echo "arm b: HOME=$HOME (the caller's), the same scratch CLAUDE_CONFIG_DIR"; store "$HOME" m1-caller-home
